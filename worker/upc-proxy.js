// Crochet Manager lookup proxy — a Cloudflare Worker (free tier is plenty).
//
// It gives the single-file app three things a web page can't do on its own:
//   GET /?upc=012345678905          → UPCitemdb lookup (the API blocks direct browser calls)
//   GET /ravelry/<api path>?<query> → read-only Ravelry API calls, authenticated with
//                                     credentials that live ONLY here as Worker secrets
//   GET /img?url=<ravelry image>    → pass-through for Ravelry/UPC product photos
//
// Deploy: https://dash.cloudflare.com → Workers & Pages → Create → Start with Hello World
//   → Edit code → paste this file → Deploy.
// Ravelry: https://www.ravelry.com/pro/developer → create an app of type
//   "Basic Auth: read only access". Then in the Worker → Settings → Variables and Secrets
//   add two SECRETS: RAVELRY_USER and RAVELRY_PASS (the app's basic-auth username/password,
//   not your Ravelry login). Optional secret UPCITEMDB_KEY for a paid UPCitemdb plan.
// Finally paste the worker URL (https://….workers.dev) into Crochet Manager → Data.

const ALLOWED_ORIGINS = ["https://jjdiaz9.github.io", "http://localhost:8000", "http://127.0.0.1:8000", "null"]; // "null" = file:// pages
const RAVELRY_ALLOWED = /^(patterns\/search\.json|patterns\/\d+\.json|patterns\.json|pattern_categories\/list\.json|yarns\/search\.json|yarns\/\d+\.json|yarns\.json|yarn_companies\/search\.json|people\/[\w-]+\/(library|queue|projects|stash|favorites)\/(list|search)\.json|people\/[\w-]+\/(projects|stash)\/\d+\.json|people\/[\w-]+\.json)$/;
const IMG_HOSTS = /(^|\.)(ravelrycache\.com|ravelry\.com|upcitemdb\.com)$/;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*");
    const cors = { "Access-Control-Allow-Origin": allowed ? (origin || "*") : "https://invalid.example", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
    const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return json({ error: "GET only" }, 405);
    if (origin && !allowed) return json({ error: "origin not allowed: " + origin }, 403);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+|\/+$/g, "");

    // ---- Ravelry ----
    if (path.startsWith("ravelry/")) {
      const api = path.slice("ravelry/".length);
      if (!RAVELRY_ALLOWED.test(api)) return json({ error: "Ravelry path not allowed: " + api }, 403);
      if (!env.RAVELRY_USER || !env.RAVELRY_PASS) return json({ error: "Ravelry not configured: add RAVELRY_USER and RAVELRY_PASS secrets to the worker" }, 501);
      const target = "https://api.ravelry.com/" + api + url.search;
      const r = await fetch(target, { headers: { Authorization: "Basic " + btoa(env.RAVELRY_USER + ":" + env.RAVELRY_PASS), "User-Agent": "crochet-manager-proxy", Accept: "application/json" } });
      const body = await r.text();
      return json(safeJson(body), r.status);
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
    if (!/^\d{8,14}$/.test(upc)) return json({ error: "missing or invalid upc", usage: "/?upc=…  /ravelry/patterns/search.json?query=…  /img?url=…" }, 400);
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
function safeJson(t) { try { return JSON.parse(t); } catch { return { error: t.slice(0, 200) }; } }
