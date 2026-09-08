// Crochet Manager lookup proxy — a Cloudflare Worker (free tier is plenty).
//
// It gives the single-file app what a web page can't do on its own:
//   GET /?upc=012345678905          → UPCitemdb lookup (the API blocks direct browser calls)
//   GET /ravelry/<api path>?<query> → Ravelry API calls. Catalog calls (pattern/yarn search)
//                                     use a "Basic Auth: read only" app; personal data (your
//                                     library, queue, projects, stash) needs OAuth 2.0.
//   GET /oauth/start | /oauth/callback | /oauth/status | /oauth/logout
//                                   → one-time Ravelry sign-in; tokens are kept in Worker KV,
//                                     never in the browser.
//   GET /img?url=<ravelry image>    → pass-through for Ravelry/UPC product photos
//
// Setup (Terminal, inside the worker/ folder):
//   npx wrangler login
//   npx wrangler kv namespace create TOKENS      → paste the printed id into wrangler.toml
//   npx wrangler deploy                          → note the https://….workers.dev URL
//   Ravelry read-only app (ravelry.com/pro/developer → "Basic Auth: read only access"):
//   npx wrangler secret put RAVELRY_USER
//   npx wrangler secret put RAVELRY_PASS
//   Ravelry OAuth app (same page → "OAuth 2.0", redirect URI = <worker URL>/oauth/callback):
//   npx wrangler secret put RAVELRY_CLIENT_ID
//   npx wrangler secret put RAVELRY_CLIENT_SECRET
//   Optional: npx wrangler secret put UPCITEMDB_KEY   (paid UPCitemdb plan)
// Then paste the worker URL into Crochet Manager → Data and press "Connect Ravelry".

const APP_URL = "https://jjdiaz9.github.io/crochet-manager/";
const ALLOWED_ORIGINS = ["https://jjdiaz9.github.io", "http://localhost:8000", "http://127.0.0.1:8000", "null"]; // "null" = file:// pages
const RAVELRY_ALLOWED = /^(current_user\.json|patterns\/search\.json|patterns\/\d+\.json|patterns\.json|pattern_categories\/list\.json|yarns\/search\.json|yarns\/\d+\.json|yarns\.json|yarn_companies\/search\.json|people\/[\w-]+\/(library|queue|projects|stash|favorites)\/(list|search)\.json|people\/[\w-]+\/(projects|stash)\/\d+\.json|people\/[\w-]+\.json)$/;
const IMG_HOSTS = /(^|\.)(ravelrycache\.com|ravelry\.com|upcitemdb\.com)$/;
const OAUTH_SCOPES = "offline"; // read access to your own data + refresh tokens

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*");
    const cors = { "Access-Control-Allow-Origin": allowed ? (origin || "*") : "https://invalid.example", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
    const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return json({ error: "GET only" }, 405);
    if (origin && !allowed) return json({ error: "origin not allowed: " + origin }, 403);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    const self = url.origin;

    // ---- OAuth 2.0 with Ravelry (tokens live in KV) ----
    if (path.startsWith("oauth/")) {
      if (!env.TOKENS) return json({ error: "KV namespace TOKENS is not bound — see wrangler.toml" }, 501);
      if (path === "oauth/status") { const t = await loadToken(env); return json({ connected: !!t, username: t?.username || null, expires_at: t?.expires_at || null, oauthConfigured: !!(env.RAVELRY_CLIENT_ID && env.RAVELRY_CLIENT_SECRET) }); }
      if (path === "oauth/logout") { await env.TOKENS.delete("ravelry"); return json({ connected: false }); }
      if (!env.RAVELRY_CLIENT_ID || !env.RAVELRY_CLIENT_SECRET) return json({ error: "OAuth not configured: add RAVELRY_CLIENT_ID and RAVELRY_CLIENT_SECRET secrets" }, 501);
      if (path === "oauth/start") {
        const state = crypto.randomUUID();
        await env.TOKENS.put("state:" + state, "1", { expirationTtl: 600 });
        const a = new URL("https://www.ravelry.com/oauth2/auth");
        a.searchParams.set("client_id", env.RAVELRY_CLIENT_ID); a.searchParams.set("redirect_uri", self + "/oauth/callback");
        a.searchParams.set("response_type", "code"); a.searchParams.set("scope", OAUTH_SCOPES); a.searchParams.set("state", state);
        return Response.redirect(a.toString(), 302);
      }
      if (path === "oauth/callback") {
        const code = url.searchParams.get("code"), state = url.searchParams.get("state") || "";
        const back = msg => Response.redirect(APP_URL + "#data/ravelry=" + encodeURIComponent(msg), 302);
        if (url.searchParams.get("error")) return back("error:" + url.searchParams.get("error"));
        if (!code || !(await env.TOKENS.get("state:" + state))) return back("error:bad_state");
        await env.TOKENS.delete("state:" + state);
        try {
          const tok = await tokenRequest(env, self, { grant_type: "authorization_code", code, redirect_uri: self + "/oauth/callback" });
          let username = null; try { const r = await fetch("https://api.ravelry.com/current_user.json", { headers: { Authorization: "Bearer " + tok.access_token } }); username = (await r.json()).user?.username || null; } catch {}
          await env.TOKENS.put("ravelry", JSON.stringify({ ...tok, username }));
          return back("connected");
        } catch (e) { return back("error:" + (e.message || "token_exchange_failed").slice(0, 80)); }
      }
      return json({ error: "unknown oauth route" }, 404);
    }

    // ---- Ravelry API ----
    if (path.startsWith("ravelry/")) {
      const api = path.slice("ravelry/".length);
      if (!RAVELRY_ALLOWED.test(api)) return json({ error: "Ravelry path not allowed: " + api }, 403);
      const headers = { "User-Agent": "crochet-manager-proxy", Accept: "application/json" };
      const tok = env.TOKENS ? await loadToken(env, self) : null;
      if (tok) headers.Authorization = "Bearer " + tok.access_token;
      else if (env.RAVELRY_USER && env.RAVELRY_PASS) headers.Authorization = "Basic " + btoa(env.RAVELRY_USER + ":" + env.RAVELRY_PASS);
      else return json({ error: "Ravelry not configured: connect with OAuth (Data → Connect Ravelry) or add RAVELRY_USER / RAVELRY_PASS secrets" }, 501);
      const r = await fetch("https://api.ravelry.com/" + api + url.search, { headers });
      const body = await r.text();
      const out = safeJson(body);
      if (r.status === 403 && !tok) out.error = (out.error || "403 Forbidden") + " — this needs a Ravelry sign-in: Data → Connect Ravelry";
      return json(out, r.status);
    }

    // ---- image pass-through ----
    if (path === "img") {
      const src = url.searchParams.get("url") || "";
      let u; try { u = new URL(src); } catch { return json({ error: "bad url" }, 400); }
      if (u.protocol !== "https:" || !IMG_HOSTS.test(u.hostname)) return json({ error: "image host not allowed" }, 403);
      const r = await fetch(u.toString(), { cf: { cacheTtl: 604800, cacheEverything: true } });
      const h = new Headers(cors); h.set("Content-Type", r.headers.get("Content-Type") || "image/jpeg"); h.set("Cache-Control", "public, max-age=604800");
      return new Response(r.body, { status: r.status, headers: h });
    }

    // ---- UPC lookup ----
    const upc = (url.searchParams.get("upc") || "").replace(/\D/g, "");
    if (!/^\d{8,14}$/.test(upc)) return json({ error: "missing or invalid upc", usage: "/?upc=…  /ravelry/patterns/search.json?query=…  /oauth/start  /img?url=…" }, 400);
    const key = env.UPCITEMDB_KEY || "";
    const target = (key ? "https://api.upcitemdb.com/prod/v1/lookup?upc=" : "https://api.upcitemdb.com/prod/trial/lookup?upc=") + upc;
    const headers = { "User-Agent": "crochet-manager-proxy", Accept: "application/json" };
    if (key) { headers.user_key = key; headers.key_type = "3scale"; }
    const cache = caches.default, cacheKey = new Request("https://upc-cache.local/" + upc);
    const cached = await cache.match(cacheKey);
    if (cached) return new Response(cached.body, { status: 200, headers: { ...cors, "Content-Type": "application/json", "X-Cache": "HIT" } });
    const r = await fetch(target, { headers });
    const body = await r.text();
    if (r.ok) await cache.put(cacheKey, new Response(body, { status: 200, headers: { "Cache-Control": "public, max-age=604800" } }));
    return json(safeJson(body), r.status, { "X-Cache": "MISS" });
  },
};

async function tokenRequest(env, self, params) {
  const body = new URLSearchParams({ ...params, client_id: env.RAVELRY_CLIENT_ID, client_secret: env.RAVELRY_CLIENT_SECRET });
  const r = await fetch("https://www.ravelry.com/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Authorization: "Basic " + btoa(env.RAVELRY_CLIENT_ID + ":" + env.RAVELRY_CLIENT_SECRET) }, body });
  const j = safeJson(await r.text());
  if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || ("token HTTP " + r.status));
  return { access_token: j.access_token, refresh_token: j.refresh_token || params.refresh_token || null, expires_at: Date.now() + ((j.expires_in || 3600) - 60) * 1000, scope: j.scope || "" };
}
// Returns a usable token record (refreshing it when expired), or null when not connected.
async function loadToken(env, self) {
  const raw = await env.TOKENS.get("ravelry"); if (!raw) return null;
  let t; try { t = JSON.parse(raw); } catch { return null; }
  if (t.expires_at && Date.now() > t.expires_at) {
    if (!t.refresh_token || !env.RAVELRY_CLIENT_ID) return null;
    try { const n = await tokenRequest(env, self, { grant_type: "refresh_token", refresh_token: t.refresh_token }); t = { ...t, ...n }; await env.TOKENS.put("ravelry", JSON.stringify(t)); }
    catch (e) { console.log("refresh failed", e.message); return null; }
  }
  return t;
}
function safeJson(t) { try { return JSON.parse(t); } catch { return { error: t.slice(0, 200) }; } }
