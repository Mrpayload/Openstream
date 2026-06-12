// vite/torrentio-plugin.js
// Server-side Vite plugin that proxies requests to the public Torrentio
// Stremio addon (https://torrentio.strem.fun/ by default) and returns
// torrent streams. The default base can be overridden via
// VITE_TORRENTIO_URL for self-hosted or regional mirrors.
//
// Torrentio follows the Stremio addon protocol but uses IMDb IDs while this
// project stores TMDB IDs, so the plugin converts TMDB → IMDb via the TMDB
// external_ids endpoint before querying Torrentio.
//
// API:
//   GET /api/torrentio/stream?tmdbId={id}&type=movie
//   GET /api/torrentio/stream?tmdbId={id}&type=tv&season={s}&episode={e}
//
// Response: { streams: [{ url, name, title, isMagnet, quality, size, source }] }
//
// Each stream is a magnet link (not directly browser-playable). The React
// app surfaces these in the "Torrentio" tab and routes selection through the
// external-player flow (VLC, etc.) via ExternalPlayerMenu.

import { loadEnv } from "vite";

let TORRENTIO_BASE = "https://torrentio.strem.fun";
const TORRENTIO_SETUP_URL = "https://torrentio.org/setup/";
const TORRENTIO_TIMEOUT_MS = 18_000;
const TMDB_TIMEOUT_MS = 8_000;

let TMDB_ACCESS_TOKEN = process.env.VITE_TMDB_ACCESS_TOKEN;
let TMDB_API_KEY = process.env.VITE_TMDB_API_KEY;

const imdbCache = new Map();
const IMDB_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Hardcoded TMDB → IMDb mapping for the fallback catalog so Torrentio works
// immediately without any TMDB credentials.  Add more entries as new titles
// are added to src/data/movies.js.
const TMDB_TO_IMDB_MAP = {
  // Movies
  324857: "tt4633694",  // Spider-Man: Into the Spider-Verse
  693134: "tt15239678", // Dune: Part Two
  545611: "tt6710474",  // Everything Everywhere All at Once
  546554: "tt8946378",  // Knives Out
  157336: "tt0816692",  // Interstellar
  313369: "tt3783958",  // La La Land
  // TV
  66732:  "tt4574334",  // Stranger Things
  119051: "tt13443470", // Wednesday
  60625:  "tt2861424",  // Rick and Morty
  93405:  "tt10919420", // Squid Game
  94605:  "tt11126994", // Arcane
  85937:  "tt9335498",  // Demon Slayer
};

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

const tmdbToImdb = async (tmdbId, type) => {
  // 1. Check the hardcoded fallback map first (no network needed).
  const mapped = TMDB_TO_IMDB_MAP[Number(tmdbId)];
  if (mapped) return mapped;

  const cacheKey = `${type}:${tmdbId}`;
  const cached = imdbCache.get(cacheKey);
  if (cached && Date.now() - cached.at < IMDB_CACHE_TTL_MS) {
    return cached.imdbId;
  }

  if (!TMDB_ACCESS_TOKEN && !TMDB_API_KEY) {
    console.warn("[torrentio] No TMDB credentials — cannot resolve IMDb ID");
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
      console.warn(`[torrentio] TMDB external_ids ${response.status} for ${tmdbId}`);
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
      console.warn("[torrentio] TMDB lookup error:", error?.message || error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const buildMagnet = (raw) => {
  if (!raw?.infoHash) return null;
  // Mix of UDP (desktop clients) and WSS (browser WebTorrent) trackers.
  // Browsers cannot make raw UDP connections, so the wss:// entries are
  // critical for in-browser torrent streaming via WebRTC.
  const trackers = [
    "wss://tracker.openbittorrent.com:443/announce",
    "wss://tracker.webtorrent.dev:443/announce",
    "wss://tracker.files.fm:7073/announce",
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://9.rarbg.com:2810/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.stealth.si:80/announce"
  ];

  // Build magnet manually to avoid URLSearchParams URL-encoding
  // urn:btih: must stay as-is; WebTorrent's parseTorrent doesn't
  // handle the %3A-encoded variant.
  const parts = [`xt=urn:btih:${raw.infoHash}`];
  const displayName = raw.title || raw.name || "Torrent";
  parts.push(`dn=${encodeURIComponent(displayName)}`);
  if (Array.isArray(raw.sources)) {
    for (const tracker of raw.sources) parts.push(`tr=${tracker}`);
  }
  for (const fallback of trackers) parts.push(`tr=${fallback}`);
  if (raw.fileIdx !== undefined && raw.fileIdx !== null) {
    parts.push(`so=${raw.fileIdx}`);
  }

  return `magnet:?${parts.join("&")}`;
};

const parseSize = (sizeText) => {
  if (!sizeText) return null;
  const match = String(sizeText).match(/([\d.]+)\s*(GB|MB|KB|TB)/i);
  if (!match) return null;
  return `${match[1]} ${match[2].toUpperCase()}`;
};

const parseSeeds = (value) => {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/(?:\u{1F464}|\bseed(?:s|ers)?\b)\s*:?\s*(\d+)/iu);
  return match ? Number(match[1]) : null;
};

// Detect "configure/setup" stream entries. The upstream Torrentio addon can
// return stream objects that point at the public setup page instead of a real
// torrent. Keep those visible in the picker as non-playable configuration rows.
export const SETUP_URL_PATTERN = /(torrentio\.org|torrentio\.strem\.io|torrentio\.strem\.fun)/i;
export const URL_PATH_PATTERN = /(\/setup|\/manifest\.json|\/configure)/i;
export const TEXT_PATH_PATTERN = /(\/setup|\/configure)/i;

export const isSetupOrConfigStream = (raw) => {
  if (!raw) return false;

  // URL-shaped fields (raw.url, behaviorHints.configurable): full path check
  for (const value of [raw.url, raw.behaviorHints?.configurable]) {
    if (typeof value !== "string") continue;
    if (SETUP_URL_PATTERN.test(value)) return true;
    if (URL_PATH_PATTERN.test(value)) return true;
  }

  // Text fields (raw.name, raw.title): narrower check, no /manifest.json
  for (const value of [raw.name, raw.title]) {
    if (typeof value !== "string") continue;
    if (SETUP_URL_PATTERN.test(value)) return true;
    if (TEXT_PATH_PATTERN.test(value)) return true;
  }

  return false;
};

const findConfigureUrl = (raw) => {
  for (const value of [raw?.url, raw?.behaviorHints?.configurable, raw?.name, raw?.title]) {
    if (typeof value !== "string") continue;
    const match = value.match(/https?:\/\/[^\s)]+(?:\/configure|\/setup)[^\s)]*/i);
    if (match) return match[0];
  }
  return TORRENTIO_SETUP_URL;
};

// Strip embedded URLs from a human-readable string so the picker doesn't
// surface configuration pages as part of a torrent's title. Keeps the
// surrounding text intact.
export const stripEmbeddedUrls = (value) => {
  if (typeof value !== "string" || !value) return value;
  return value
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
};

const normalizeStream = (raw) => {
  if (isSetupOrConfigStream(raw)) {
    return {
      url: findConfigureUrl(raw),
      name: "Torrentio · Configure addon",
      title: "Open Torrentio configuration to enable more sources",
      behaviorHints: raw?.behaviorHints || {},
      isMagnet: false,
      isConfigLink: true,
      isHls: false,
      quality: null,
      size: null,
      seeds: null,
      source: "torrentio"
    };
  }
  const magnet = buildMagnet(raw);
  if (!magnet) return null;

  const firstLine = stripEmbeddedUrls((raw.name || "Torrentio").split("\n")[0].trim()) || "Torrentio";
  const cleanedTitle = stripEmbeddedUrls(raw.title || "");
  const size = parseSize(raw.title || "");
  const seeds = parseSeeds(raw.title || raw.name || "");
  const qualityMatch = (raw.title || "").match(/\b(2160p|1080p|720p|480p|4K)\b/i);
  const quality = qualityMatch ? qualityMatch[1].toUpperCase() : null;

  return {
    url: magnet,
    name: `Torrentio · ${firstLine}`,
    title: cleanedTitle || `Magnet stream · ${raw.infoHash.slice(0, 8)}`,
    behaviorHints: raw.behaviorHints || {},
    isMagnet: true,
    isHls: false,
    quality,
    size,
    seeds,
    source: "torrentio"
  };
};

const fetchTorrentioStreams = async (imdbId, type, season, episode) => {
  const mediaType = type === "tv" || type === "series" ? "series" : "movie";
  const streamPath = mediaType === "series"
    ? `stream/series/${imdbId}:${season}:${episode}.json`
    : `stream/movie/${imdbId}.json`;

  const apiUrl = `${TORRENTIO_BASE}/${streamPath}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TORRENTIO_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      console.warn(`[torrentio] ${response.status}: ${apiUrl}`);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data?.streams) ? data.streams : [];
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("[torrentio] fetch error:", error?.message || error);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
};

// Build the Torrentio configure-link entry that should always be present
// in every response so the StreamPicker can show a "Configure" row.
const buildConfigLink = () => ({
  url: TORRENTIO_SETUP_URL,
  name: "Torrentio · Configure addon",
  title: "Open Torrentio configuration to enable more sources",
  behaviorHints: {},
  isMagnet: false,
  isConfigLink: true,
    isHls: false,
    quality: null,
    size: null,
    seeds: null,
    source: "torrentio"
  });

const sortTorrentioStreams = (streams) => [...streams].sort((a, b) => {
  if (a.isConfigLink && !b.isConfigLink) return 1;
  if (!a.isConfigLink && b.isConfigLink) return -1;
  return (b.seeds ?? -1) - (a.seeds ?? -1);
});

// Ensure a config link is always present in a streams array.
const ensureConfigLink = (streams) => {
  if (!streams.some((s) => s.isConfigLink)) {
    streams.push(buildConfigLink());
  }
  return streams;
};

export default function torrentioPlugin() {
  return {
    name: "torrentio-plugin",
    configResolved(config) {
      // Vite doesn't propagate .env into process.env for plugins.
      // Use loadEnv to read credentials that the user set in .env.
      const env = loadEnv(config.mode, config.envDir || process.cwd(), "");
      if (!TMDB_ACCESS_TOKEN) TMDB_ACCESS_TOKEN = env.VITE_TMDB_ACCESS_TOKEN || undefined;
      if (!TMDB_API_KEY) TMDB_API_KEY = env.VITE_TMDB_API_KEY || undefined;
      if (env.VITE_TORRENTIO_URL) TORRENTIO_BASE = env.VITE_TORRENTIO_URL;
    },
    configureServer(server) {
      server.middlewares.use("/api/torrentio/stream", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const tmdbId = url.searchParams.get("tmdbId");
          const type = url.searchParams.get("type") || "movie";
          const season = url.searchParams.get("season");
          const episode = url.searchParams.get("episode");

          if (!tmdbId) {
            sendJson(res, 400, { error: "Missing required parameter: tmdbId", streams: [buildConfigLink()] });
            return;
          }

          if ((type === "tv" || type === "series") && (!season || !episode)) {
            sendJson(res, 400, { error: "Season and episode are required for TV shows", streams: [buildConfigLink()] });
            return;
          }

          const imdbId = await tmdbToImdb(tmdbId, type);
          if (!imdbId) {
            sendJson(res, 200, {
              streams: [buildConfigLink()],
              message: "Could not resolve TMDB ID to IMDb ID (TMDB credentials may be missing)"
            });
            return;
          }

          const rawStreams = await fetchTorrentioStreams(imdbId, type, season, episode);
          const streams = ensureConfigLink(sortTorrentioStreams(rawStreams.map(normalizeStream).filter(Boolean)));

          sendJson(res, 200, { streams });
        } catch (error) {
          console.warn("[torrentio-plugin] error:", error?.message || error);
          sendJson(res, 502, { error: error?.message || "Torrentio proxy failed", streams: [buildConfigLink()] });
        }
      });

      server.middlewares.use("/api/torrentio/health", (_req, res) => {
        sendJson(res, 200, {
          ok: true,
          plugin: "torrentio",
          instance: TORRENTIO_BASE,
          hasTmdbCredentials: Boolean(TMDB_ACCESS_TOKEN || TMDB_API_KEY)
        });
      });
    }
  };
}
