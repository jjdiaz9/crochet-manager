// Cloudflare Worker: forwards ?upc=XXXX to UPCitemdb's free trial API and adds the
// CORS headers a web page needs. Deploy at https://dash.cloudflare.com → Workers & Pages
// → Create → "Hello World" → Edit code → paste this → Deploy. Then paste the worker URL
// into Crochet Manager → Data → "Lookup proxy URL".
//
// Set ALLOWED_ORIGIN to your GitHub Pages origin so only your app can use the proxy.
const ALLOWED_ORIGIN = "https://jjdiaz9.github.io";
// Optional: a paid UPCitemdb key. Leave empty to use the free trial tier.
const UPCITEMDB_KEY = "";

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN || ALLOWED_ORIGIN === "*" ? origin || "*" : "null",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const upc = (new URL(request.url).searchParams.get("upc") || "").replace(/\D/g, "");
    const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });
    if (!/^\d{8,14}$/.test(upc)) return json({ error: "missing or invalid upc" }, 400);
    const url = (UPCITEMDB_KEY ? "https://api.upcitemdb.com/prod/v1/lookup?upc=" : "https://api.upcitemdb.com/prod/trial/lookup?upc=") + upc;
    const headers = { "User-Agent": "crochet-manager-upc-proxy", "Accept": "application/json" };
    if (UPCITEMDB_KEY) { headers.user_key = UPCITEMDB_KEY; headers.key_type = "3scale"; }
    const cache = caches.default;
    const cacheKey = new Request("https://upc-cache.local/" + upc);
    let cached = await cache.match(cacheKey);
    if (cached) return new Response(cached.body, { status: cached.status, headers: { ...cors, "Content-Type": "application/json", "X-Cache": "HIT" } });
    const r = await fetch(url, { headers });
    const body = await r.text();
    const res = json(safeJson(body), r.status, { "X-Cache": "MISS" });
    if (r.ok) await cache.put(cacheKey, new Response(body, { status: 200, headers: { "Cache-Control": "public, max-age=604800" } }));
    return res;
  },
};
function safeJson(t) { try { return JSON.parse(t); } catch { return { error: t.slice(0, 200) }; } }
