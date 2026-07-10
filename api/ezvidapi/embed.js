import { getRequestUrl, sendJson } from "../_lib/http.js";

export const config = { maxDuration: 30 };

const EZVIDAPI_BASE = "https://ezvidapi.com";
const EZVIDAPI_TIMEOUT_MS = 12_000;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed", servers: [] });
    return;
  }

  try {
    const url = getRequestUrl(req);
    const type = url.searchParams.get("type") || "movie";
    const tmdbId = url.searchParams.get("tmdbId");
    const imdbId = url.searchParams.get("imdbId");
    const season = url.searchParams.get("season");
    const episode = url.searchParams.get("episode");
    const provider = url.searchParams.get("provider");

    if (!tmdbId && !imdbId) {
      sendJson(res, 400, { error: "Missing required parameter: tmdbId or imdbId", servers: [] });
      return;
    }

    const id = imdbId || tmdbId;

    let apiUrl;
    if (type === "tv" || type === "series") {
      if (!season || !episode) {
        sendJson(res, 400, { error: "Season and episode are required for TV shows", servers: [] });
        return;
      }
      apiUrl = `${EZVIDAPI_BASE}/embed/tv/${id}/${season}/${episode}`;
    } else {
      apiUrl = `${EZVIDAPI_BASE}/embed/movie/${id}`;
    }

    if (provider) {
      apiUrl += `?provider=${encodeURIComponent(provider)}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EZVIDAPI_TIMEOUT_MS);

    try {
      const response = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.warn(`[ezvidapi] ${response.status}: ${text.slice(0, 200)}`);
        sendJson(res, 200, { hls: false, servers: [] });
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("json")) {
        // Upstream returned HTML instead of JSON — the API may have changed
        // to an iframe-first model. Return gracefully, matching the dev proxy.
        console.warn(`[ezvidapi] Upstream returned ${contentType.split(";")[0]} — API may have changed`);
        sendJson(res, 200, { hls: false, servers: [] });
        return;
      }

      let data;
      try {
        data = await response.json();
      } catch {
        sendJson(res, 200, { hls: false, servers: [] });
        return;
      }
      sendJson(res, 200, {
        hls: Boolean(data.hls),
        servers: Array.isArray(data.servers) ? data.servers : [],
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      console.warn("[ezvidapi] request timed out");
    } else {
      console.warn("[ezvidapi] error:", error?.message || error);
    }
    sendJson(res, 200, { hls: false, servers: [] });
  }
}
