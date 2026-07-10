// vite/ezvidapi-plugin.js
// Server-side Vite plugin that proxies requests to ezvidapi.com
// (https://ezvidapi.com/docs) and returns playable stream URLs.
//
// ezvidapi returns direct HLS URLs from multiple providers with
// no auth required and 100% free usage.
//
// API:
//   GET /api/ezvidapi/embed?type=movie&tmdbId={id}
//   GET /api/ezvidapi/embed?type=tv&tmdbId={id}&season={s}&episode={e}
//
// Response: { hls: boolean, servers: [{ src, provider, server }] }

const EZVIDAPI_BASE = "https://ezvidapi.com";
const EZVIDAPI_TIMEOUT_MS = 12_000;

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

export default function ezvidApiPlugin() {
  return {
    name: "ezvidapi-plugin",
    configureServer(server) {
      server.middlewares.use("/api/ezvidapi/embed", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const type = url.searchParams.get("type") || "movie";
          const tmdbId = url.searchParams.get("tmdbId");
          const imdbId = url.searchParams.get("imdbId");
          const season = url.searchParams.get("season");
          const episode = url.searchParams.get("episode");
          const provider = url.searchParams.get("provider");

          if (!tmdbId && !imdbId) {
            sendJson(res, 400, { error: "Missing required parameter: tmdbId or imdbId" });
            return;
          }

          const id = imdbId || tmdbId;

          // Build the ezvidapi URL based on media type
          let apiUrl;
          if (type === "tv" || type === "series") {
            if (!season || !episode) {
              sendJson(res, 400, { error: "Season and episode are required for TV shows" });
              return;
            }
            apiUrl = `${EZVIDAPI_BASE}/embed/tv/${id}/${season}/${episode}`;
          } else {
            apiUrl = `${EZVIDAPI_BASE}/embed/movie/${id}`;
          }

          // Add optional provider parameter
          if (provider) {
            apiUrl += `?provider=${encodeURIComponent(provider)}`;
          }

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), EZVIDAPI_TIMEOUT_MS);

          try {
            const response = await fetch(apiUrl, {
              signal: controller.signal,
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
              }
            });

            if (!response.ok) {
              const text = await response.text().catch(() => "");
              console.warn(`[ezvidapi] ${response.status}: ${text.slice(0, 200)}`);
              sendJson(res, 200, { hls: false, servers: [] });
              return;
            }

            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("json")) {
              // Upstream returned HTML instead of JSON — the API has
              // changed to an iframe-first model.  Return gracefully.
              console.warn(`[ezvidapi] Upstream returned ${contentType.split(";")[0]} — API may have changed`);
              sendJson(res, 200, { hls: false, servers: [] });
              return;
            }

            const data = await response.json();
            sendJson(res, 200, {
              hls: Boolean(data.hls),
              servers: Array.isArray(data.servers) ? data.servers : []
            });
          } finally {
            clearTimeout(timer);
          }
        } catch (error) {
          if (error?.name !== "AbortError") {
            console.warn("[ezvidapi] error:", error?.message || error);
          }
          sendJson(res, 200, { hls: false, servers: [] });
        }
      });
    }
  };
}
