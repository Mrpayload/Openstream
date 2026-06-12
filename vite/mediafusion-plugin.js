// vite/mediafusion-plugin.js
// Server-side Vite plugin that proxies requests to a MediaFusion Stremio addon
// instance and returns playable stream URLs.
//
// MediaFusion is an open-source streaming aggregator that works as a Stremio
// addon.  It returns m3u8/mp4 streams for movies and TV shows.
//
// Because MediaFusion uses IMDb IDs (Stremio protocol) while this project
// uses TMDB IDs, the plugin converts TMDB → IMDb via the TMDB external_ids
// endpoint before querying MediaFusion.
//
// API:
//   GET /api/mediafusion/stream?tmdbId={id}&type=movie
//   GET /api/mediafusion/stream?tmdbId={id}&type=tv&season={s}&episode={e}
//
// Response: { streams: [{ url, name, title, isHls, source }] }

const MEDIAFUSION_BASE = process.env.VITE_MEDIAFUSION_URL
  || "https://mediafusion.elfhosted.com";

const MEDIAFUSION_TIMEOUT_MS = 18_000;
const TMDB_TIMEOUT_MS = 8_000;

// TMDB credentials — available server-side because VITE_ vars are inlined
const TMDB_ACCESS_TOKEN = process.env.VITE_TMDB_ACCESS_TOKEN;
const TMDB_API_KEY = process.env.VITE_TMDB_API_KEY;

// Simple in-memory cache for TMDB → IMDb ID lookups
const imdbCache = new Map();
const IMDB_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

/**
 * Convert a TMDB ID to an IMDb ID using the TMDB external_ids endpoint.
 * Returns the IMDb ID string (e.g. "tt1234567") or null.
 */
const tmdbToImdb = async (tmdbId, type) => {
  const cacheKey = `${type}:${tmdbId}`;
  const cached = imdbCache.get(cacheKey);
  if (cached && Date.now() - cached.at < IMDB_CACHE_TTL_MS) {
    return cached.imdbId;
  }

  if (!TMDB_ACCESS_TOKEN && !TMDB_API_KEY) {
    console.warn("[mediafusion] No TMDB credentials — cannot resolve IMDb ID");
    return null;
  }

  const mediaType = type === "tv" || type === "series" ? "tv" : "movie";
  const url = new URL(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/external_ids`);
  if (TMDB_API_KEY && !TMDB_ACCESS_TOKEN) {
    url.searchParams.set("api_key", TMDB_API_KEY);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: TMDB_ACCESS_TOKEN
        ? { Authorization: `Bearer ${TMDB_ACCESS_TOKEN}` }
        : {},
    });

    if (!response.ok) {
      console.warn(`[mediafusion] TMDB external_ids ${response.status} for ${tmdbId}`);
      return null;
    }

    const data = await response.json();
    const imdbId = data?.imdb_id || null;

    if (imdbId) {
      imdbCache.set(cacheKey, { imdbId, at: Date.now() });
    }

    return imdbId;
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("[mediafusion] TMDB lookup error:", error?.message || error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Fetch streams from a MediaFusion instance for the given IMDb ID.
 * Returns the raw streams array from the Stremio addon response.
 */
const fetchMediafusionStreams = async (imdbId, type, season, episode) => {
  // Stremio addon protocol: /stream/{type}/{id}.json
  // For series: /stream/series/{imdbId}:{season}:{episode}.json
  const mediaType = type === "tv" || type === "series" ? "series" : "movie";

  let streamPath;
  if (mediaType === "series") {
    streamPath = `stream/series/${imdbId}:${season}:${episode}.json`;
  } else {
    streamPath = `stream/movie/${imdbId}.json`;
  }

  const apiUrl = `${MEDIAFUSION_BASE}/${streamPath}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIAFUSION_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      console.warn(`[mediafusion] ${response.status}: ${apiUrl}`);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data?.streams) ? data.streams : [];
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("[mediafusion] fetch error:", error?.message || error);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Normalize a raw MediaFusion stream object into the format our player expects.
 * Filters out streams that don't have a direct playable URL.
 */
const normalizeStream = (raw) => {
  // MediaFusion streams can have:
  //   - url: direct m3u8/mp4 URL (playable)
  //   - infoHash: torrent hash (NOT browser-playable)
  //   - behaviorHints: { notWebReady: true } for non-web streams
  //
  // We only return streams that have a direct URL and are web-ready.
  if (!raw?.url) return null;
  if (raw.behaviorHints?.notWebReady) return null;

  const isHls = /\.m3u8(\?|$)/i.test(raw.url);
  const isMp4 = /\.mp4(\?|$)/i.test(raw.url);

  return {
    url: raw.url,
    name: `MediaFusion${raw.name ? ` · ${raw.name}` : ""}`,
    title: raw.title || `MediaFusion stream · ${isHls ? "HLS" : isMp4 ? "MP4" : "Direct"}`,
    behaviorHints: {},
    isHls,
    source: "mediafusion",
  };
};

export default function mediafusionPlugin() {
  return {
    name: "mediafusion-plugin",
    configureServer(server) {
      server.middlewares.use("/api/mediafusion/stream", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const tmdbId = url.searchParams.get("tmdbId");
          const type = url.searchParams.get("type") || "movie";
          const season = url.searchParams.get("season");
          const episode = url.searchParams.get("episode");

          if (!tmdbId) {
            sendJson(res, 400, { error: "Missing required parameter: tmdbId", streams: [] });
            return;
          }

          if ((type === "tv" || type === "series") && (!season || !episode)) {
            sendJson(res, 400, { error: "Season and episode are required for TV shows", streams: [] });
            return;
          }

          // Step 1: Convert TMDB ID → IMDb ID
          const imdbId = await tmdbToImdb(tmdbId, type);
          if (!imdbId) {
            sendJson(res, 200, {
              streams: [],
              message: "Could not resolve TMDB ID to IMDb ID (TMDB credentials may be missing)",
            });
            return;
          }

          // Step 2: Fetch streams from MediaFusion
          const rawStreams = await fetchMediafusionStreams(imdbId, type, season, episode);

          // Step 3: Normalize and filter for browser-playable streams
          const streams = rawStreams
            .map(normalizeStream)
            .filter(Boolean);

          sendJson(res, 200, { streams });
        } catch (error) {
          console.warn("[mediafusion-plugin] error:", error?.message || error);
          sendJson(res, 502, { error: error?.message || "MediaFusion proxy failed", streams: [] });
        }
      });

      // Health check
      server.middlewares.use("/api/mediafusion/health", (_req, res) => {
        sendJson(res, 200, {
          ok: true,
          plugin: "mediafusion",
          instance: MEDIAFUSION_BASE,
          hasTmdbCredentials: Boolean(TMDB_ACCESS_TOKEN || TMDB_API_KEY),
        });
      });
    },
  };
}
