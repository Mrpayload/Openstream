// vite.config.js
import { defineConfig } from "file:///V:/Antgravity/webstreamer/node_modules/vite/dist/node/index.js";
import react from "file:///V:/Antgravity/webstreamer/node_modules/@vitejs/plugin-react/dist/index.js";

// vite/flixhq-plugin.js
import { createRequire } from "module";
var __vite_injected_original_import_meta_url = "file:///V:/Antgravity/webstreamer/vite/flixhq-plugin.js";
var require2 = createRequire(__vite_injected_original_import_meta_url);
var FlixHQ = require2("flixhq-api");
var flixhqInstance = null;
var getFlixHQ = () => {
  if (!flixhqInstance) {
    flixhqInstance = new FlixHQ();
  }
  return flixhqInstance;
};
var pickSearchResult = (results, type) => {
  if (!Array.isArray(results) || results.length === 0) return null;
  const normalized = type === "series" || type === "tv" ? results.filter((r) => /tv|series|show/i.test(`${r.type || ""} ${r.id || ""}`)) : results.filter((r) => /movie|film/i.test(`${r.type || ""}`) || !/tv|series/i.test(`${r.id || ""}`));
  return normalized[0] || results[0];
};
var resolveEpisodeId = async (title, season, episode) => {
  const flixhq = getFlixHQ();
  const searchResults = await flixhq.search(title);
  const show = pickSearchResult(searchResults, "series");
  if (!show?.id) throw new Error(`FlixHQ: show not found for "${title}"`);
  const seasons = await flixhq.getSeasons(show.id);
  if (!Array.isArray(seasons) || seasons.length === 0) {
    throw new Error(`FlixHQ: no seasons found for "${title}"`);
  }
  const targetSeason = seasons.find(
    (s) => String(s.season ?? s.number ?? s.seasonNumber) === String(season)
  ) || seasons.find((s) => Number(s.season ?? s.number ?? s.seasonNumber) === Number(season));
  if (!targetSeason?.id) throw new Error(`FlixHQ: season ${season} not found`);
  const episodes = await flixhq.getEpisodes(targetSeason.id);
  const targetEpisode = episodes.find(
    (e) => String(e.episode ?? e.number ?? e.episodeNumber) === String(episode)
  ) || episodes.find((e) => Number(e.episode ?? e.number ?? e.episodeNumber) === Number(episode));
  if (!targetEpisode?.id) throw new Error(`FlixHQ: episode ${episode} not found`);
  return targetEpisode.id;
};
var resolveMovieId = async (title) => {
  const flixhq = getFlixHQ();
  const searchResults = await flixhq.search(title);
  const movie = pickSearchResult(searchResults, "movie");
  if (!movie?.id) throw new Error(`FlixHQ: movie not found for "${title}"`);
  return movie.id;
};
var resolveSource = async (contentId, type) => {
  const flixhq = getFlixHQ();
  const serverType = type === "series" || type === "tv" ? "tv" : "movie";
  const servers = await flixhq.getServers(contentId, serverType);
  if (!Array.isArray(servers) || servers.length === 0) {
    throw new Error("FlixHQ: no servers returned for this title");
  }
  let lastError = null;
  for (const server of servers) {
    if (!server?.id) continue;
    try {
      const result = await flixhq.fetchSource(server.id);
      if (result?.source) {
        return {
          url: result.source,
          type: result.type || "hls",
          serverName: server.name || server.id,
          encrypted: Boolean(result.encrypted)
        };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("FlixHQ: no server produced a playable source");
};
var sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};
function flixhqApiPlugin() {
  return {
    name: "flixhq-api-plugin",
    configureServer(server) {
      server.middlewares.use("/api/flixhq/source", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const title = url.searchParams.get("title")?.trim();
          const type = url.searchParams.get("type") || "movie";
          const season = url.searchParams.get("season");
          const episode = url.searchParams.get("episode");
          if (!title) {
            sendJson(res, 400, { error: "Missing required parameter: title" });
            return;
          }
          const contentId = type === "series" || type === "tv" ? await resolveEpisodeId(title, season, episode) : await resolveMovieId(title);
          const source = await resolveSource(contentId, type);
          sendJson(res, 200, { ...source, title, type });
        } catch (error) {
          console.warn("[flixhq-plugin]", error?.message || error);
          sendJson(res, 502, { error: error?.message || "FlixHQ lookup failed" });
        }
      });
      server.middlewares.use("/api/flixhq/health", (_req, res) => {
        sendJson(res, 200, { ok: true, plugin: "flixhq-api" });
      });
    }
  };
}

// vite/ezvidapi-plugin.js
var EZVIDAPI_BASE = "https://ezvidapi.com";
var EZVIDAPI_TIMEOUT_MS = 12e3;
var sendJson2 = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};
function ezvidApiPlugin() {
  return {
    name: "ezvidapi-plugin",
    configureServer(server) {
      server.middlewares.use("/api/ezvidapi/embed", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const type = url.searchParams.get("type") || "movie";
          const tmdbId = url.searchParams.get("tmdbId");
          const season = url.searchParams.get("season");
          const episode = url.searchParams.get("episode");
          const provider = url.searchParams.get("provider");
          if (!tmdbId) {
            sendJson2(res, 400, { error: "Missing required parameter: tmdbId" });
            return;
          }
          let apiUrl;
          if (type === "tv" || type === "series") {
            if (!season || !episode) {
              sendJson2(res, 400, { error: "Season and episode are required for TV shows" });
              return;
            }
            apiUrl = `${EZVIDAPI_BASE}/embed/tv/${tmdbId}/${season}/${episode}`;
          } else {
            apiUrl = `${EZVIDAPI_BASE}/embed/movie/${tmdbId}`;
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
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
              }
            });
            if (!response.ok) {
              const text = await response.text().catch(() => "");
              console.warn(`[ezvidapi] ${response.status}: ${text.slice(0, 200)}`);
              sendJson2(res, 502, { error: `ezvidapi returned ${response.status}`, servers: [] });
              return;
            }
            const data = await response.json();
            sendJson2(res, 200, {
              hls: Boolean(data.hls),
              servers: Array.isArray(data.servers) ? data.servers : []
            });
          } finally {
            clearTimeout(timer);
          }
        } catch (error) {
          if (error?.name === "AbortError") {
            sendJson2(res, 504, { error: "ezvidapi request timed out", servers: [] });
          } else {
            console.warn("[ezvidapi] error:", error?.message || error);
            sendJson2(res, 502, { error: error?.message || "ezvidapi proxy failed", servers: [] });
          }
        }
      });
    }
  };
}

// vite/smplstream-plugin.js
var SMPLSTREAM_BASE = "https://embed.smashystream.com";
var SMPLSTREAM_TIMEOUT_MS = 15e3;
var SMASHY_B64_PARTS = [
  "U0ZML2RVN0IvRGx4",
  "MGNhL0JWb0kvTlM5",
  "Ym94LzJTSS9aU0Zj",
  "SGJ0L1dGakIvN0dX",
  "eE52L1QwOC96N0Yz"
];
var decodeSmashyStream = (encoded) => {
  if (!encoded || typeof encoded !== "string") return null;
  try {
    let formattedB64 = encoded.slice(2);
    for (let i = SMASHY_B64_PARTS.length - 1; i >= 0; i--) {
      formattedB64 = formattedB64.replace(`//${SMASHY_B64_PARTS[i]}`, "");
    }
    return atob(formattedB64);
  } catch {
    return null;
  }
};
var sendJson3 = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};
function smplStreamPlugin() {
  return {
    name: "smplstream-plugin",
    configureServer(server) {
      server.middlewares.use("/api/smplstream/embed", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const tmdbId = url.searchParams.get("tmdbId");
          const type = url.searchParams.get("type") || "movie";
          const season = url.searchParams.get("season");
          const episode = url.searchParams.get("episode");
          if (!tmdbId) {
            sendJson3(res, 400, { error: "Missing required parameter: tmdbId", servers: [] });
            return;
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), SMPLSTREAM_TIMEOUT_MS);
          try {
            const initResponse = await fetch(`${SMPLSTREAM_BASE}/getplayer.php`, {
              method: "POST",
              signal: controller.signal,
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": SMPLSTREAM_BASE,
                "Referer": `${SMPLSTREAM_BASE}/`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
              },
              body: "g-recaptcha-response="
            });
            if (!initResponse.ok) {
              console.warn(`[smplstream] init ${initResponse.status}`);
              sendJson3(res, 502, { error: `SmashyStream init failed: ${initResponse.status}`, servers: [] });
              return;
            }
            const cookies = initResponse.headers.getSetCookie?.() || [];
            const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");
            const playerParams = new URLSearchParams({
              player: "f",
              tmdb: String(tmdbId)
            });
            if ((type === "tv" || type === "series") && season && episode) {
              playerParams.set("season", String(season));
              playerParams.set("episode", String(episode));
            }
            const playerResponse = await fetch(`${SMPLSTREAM_BASE}/getplayer.php?${playerParams.toString()}`, {
              signal: controller.signal,
              headers: {
                "Cookie": cookieHeader,
                "Referer": `${SMPLSTREAM_BASE}/`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
              }
            });
            if (!playerResponse.ok) {
              console.warn(`[smplstream] player ${playerResponse.status}`);
              sendJson3(res, 502, { error: `SmashyStream player failed: ${playerResponse.status}`, servers: [] });
              return;
            }
            const playerData = await playerResponse.json();
            const servers = [];
            if (Array.isArray(playerData.sourceUrls)) {
              for (const encoded of playerData.sourceUrls) {
                const decoded = decodeSmashyStream(encoded);
                if (decoded) {
                  servers.push({
                    src: decoded,
                    name: "SmashyStream",
                    type: decoded.includes(".m3u8") ? "hls" : "mp4"
                  });
                }
              }
            }
            sendJson3(res, 200, { servers });
          } finally {
            clearTimeout(timer);
          }
        } catch (error) {
          if (error?.name === "AbortError") {
            sendJson3(res, 504, { error: "SmashyStream request timed out", servers: [] });
          } else {
            console.warn("[smplstream] error:", error?.message || error);
            sendJson3(res, 502, { error: error?.message || "SmashyStream proxy failed", servers: [] });
          }
        }
      });
    }
  };
}

// vite/mediafusion-plugin.js
var MEDIAFUSION_BASE = process.env.VITE_MEDIAFUSION_URL || "https://mediafusion.elfhosted.com";
var MEDIAFUSION_TIMEOUT_MS = 18e3;
var TMDB_TIMEOUT_MS = 8e3;
var TMDB_ACCESS_TOKEN = process.env.VITE_TMDB_ACCESS_TOKEN;
var TMDB_API_KEY = process.env.VITE_TMDB_API_KEY;
var imdbCache = /* @__PURE__ */ new Map();
var IMDB_CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var sendJson4 = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};
var tmdbToImdb = async (tmdbId, type) => {
  const cacheKey = `${type}:${tmdbId}`;
  const cached = imdbCache.get(cacheKey);
  if (cached && Date.now() - cached.at < IMDB_CACHE_TTL_MS) {
    return cached.imdbId;
  }
  if (!TMDB_ACCESS_TOKEN && !TMDB_API_KEY) {
    console.warn("[mediafusion] No TMDB credentials \u2014 cannot resolve IMDb ID");
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
      headers: TMDB_ACCESS_TOKEN ? { Authorization: `Bearer ${TMDB_ACCESS_TOKEN}` } : {}
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
var fetchMediafusionStreams = async (imdbId, type, season, episode) => {
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
        "Accept": "application/json"
      }
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
var normalizeStream = (raw) => {
  if (!raw?.url) return null;
  if (raw.behaviorHints?.notWebReady) return null;
  const isHls = /\.m3u8(\?|$)/i.test(raw.url);
  const isMp4 = /\.mp4(\?|$)/i.test(raw.url);
  return {
    url: raw.url,
    name: `MediaFusion${raw.name ? ` \xB7 ${raw.name}` : ""}`,
    title: raw.title || `MediaFusion stream \xB7 ${isHls ? "HLS" : isMp4 ? "MP4" : "Direct"}`,
    behaviorHints: {},
    isHls,
    source: "mediafusion"
  };
};
function mediafusionPlugin() {
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
            sendJson4(res, 400, { error: "Missing required parameter: tmdbId", streams: [] });
            return;
          }
          if ((type === "tv" || type === "series") && (!season || !episode)) {
            sendJson4(res, 400, { error: "Season and episode are required for TV shows", streams: [] });
            return;
          }
          const imdbId = await tmdbToImdb(tmdbId, type);
          if (!imdbId) {
            sendJson4(res, 200, {
              streams: [],
              message: "Could not resolve TMDB ID to IMDb ID (TMDB credentials may be missing)"
            });
            return;
          }
          const rawStreams = await fetchMediafusionStreams(imdbId, type, season, episode);
          const streams = rawStreams.map(normalizeStream).filter(Boolean);
          sendJson4(res, 200, { streams });
        } catch (error) {
          console.warn("[mediafusion-plugin] error:", error?.message || error);
          sendJson4(res, 502, { error: error?.message || "MediaFusion proxy failed", streams: [] });
        }
      });
      server.middlewares.use("/api/mediafusion/health", (_req, res) => {
        sendJson4(res, 200, {
          ok: true,
          plugin: "mediafusion",
          instance: MEDIAFUSION_BASE,
          hasTmdbCredentials: Boolean(TMDB_ACCESS_TOKEN || TMDB_API_KEY)
        });
      });
    }
  };
}

// vite/torrentio-plugin.js
var TORRENTIO_BASE = process.env.VITE_TORRENTIO_URL || "https://torrentio.strem.fun";
var TORRENTIO_TIMEOUT_MS = 18e3;
var TMDB_TIMEOUT_MS2 = 8e3;
var TMDB_ACCESS_TOKEN2 = process.env.VITE_TMDB_ACCESS_TOKEN;
var TMDB_API_KEY2 = process.env.VITE_TMDB_API_KEY;
var imdbCache2 = /* @__PURE__ */ new Map();
var IMDB_CACHE_TTL_MS2 = 24 * 60 * 60 * 1e3;
var sendJson5 = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};
var tmdbToImdb2 = async (tmdbId, type) => {
  const cacheKey = `${type}:${tmdbId}`;
  const cached = imdbCache2.get(cacheKey);
  if (cached && Date.now() - cached.at < IMDB_CACHE_TTL_MS2) {
    return cached.imdbId;
  }
  if (!TMDB_ACCESS_TOKEN2 && !TMDB_API_KEY2) {
    console.warn("[torrentio] No TMDB credentials \u2014 cannot resolve IMDb ID");
    return null;
  }
  const mediaType = type === "tv" || type === "series" ? "tv" : "movie";
  const url = new URL(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/external_ids`);
  if (TMDB_API_KEY2 && !TMDB_ACCESS_TOKEN2) {
    url.searchParams.set("api_key", TMDB_API_KEY2);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS2);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: TMDB_ACCESS_TOKEN2 ? { Authorization: `Bearer ${TMDB_ACCESS_TOKEN2}` } : {}
    });
    if (!response.ok) {
      console.warn(`[torrentio] TMDB external_ids ${response.status} for ${tmdbId}`);
      return null;
    }
    const data = await response.json();
    const imdbId = data?.imdb_id || null;
    if (imdbId) {
      imdbCache2.set(cacheKey, { imdbId, at: Date.now() });
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
var buildMagnet = (raw) => {
  if (!raw?.infoHash) return null;
  const trackers = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://9.rarbg.com:2810/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.stealth.si:80/announce"
  ];
  const params = new URLSearchParams();
  params.set("xt", `urn:btih:${raw.infoHash}`);
  const displayName = raw.title || raw.name || "Torrent";
  params.set("dn", displayName);
  if (Array.isArray(raw.sources)) {
    for (const tracker of raw.sources) params.append("tr", tracker);
  }
  for (const fallback of trackers) params.append("tr", fallback);
  if (raw.fileIdx !== void 0 && raw.fileIdx !== null) {
    params.set("so", String(raw.fileIdx));
  }
  return `magnet:?${params.toString()}`;
};
var parseSize = (sizeText) => {
  if (!sizeText) return null;
  const match = String(sizeText).match(/([\d.]+)\s*(GB|MB|KB|TB)/i);
  if (!match) return null;
  return `${match[1]} ${match[2].toUpperCase()}`;
};
var SETUP_URL_PATTERN = /(torrentio\.org|torrentio\.strem\.io|torrentio\.strem\.fun)/i;
var URL_PATH_PATTERN = /(\/setup|\/manifest\.json|\/configure)/i;
var TEXT_PATH_PATTERN = /(\/setup|\/configure)/i;
var isSetupOrConfigStream = (raw) => {
  if (!raw) return false;
  for (const value of [raw.url, raw.behaviorHints?.configurable]) {
    if (typeof value !== "string") continue;
    if (SETUP_URL_PATTERN.test(value)) return true;
    if (URL_PATH_PATTERN.test(value)) return true;
  }
  for (const value of [raw.name, raw.title]) {
    if (typeof value !== "string") continue;
    if (SETUP_URL_PATTERN.test(value)) return true;
    if (TEXT_PATH_PATTERN.test(value)) return true;
  }
  return false;
};
var stripEmbeddedUrls = (value) => {
  if (typeof value !== "string" || !value) return value;
  return value.replace(/https?:\/\/\S+/gi, "").replace(/\s{2,}/g, " ").trim();
};
var normalizeStream2 = (raw) => {
  if (isSetupOrConfigStream(raw)) return null;
  const magnet = buildMagnet(raw);
  if (!magnet) return null;
  const firstLine = stripEmbeddedUrls((raw.name || "Torrentio").split("\n")[0].trim()) || "Torrentio";
  const cleanedTitle = stripEmbeddedUrls(raw.title || "");
  const size = parseSize(raw.title || "");
  const qualityMatch = (raw.title || "").match(/\b(2160p|1080p|720p|480p|4K)\b/i);
  const quality = qualityMatch ? qualityMatch[1].toUpperCase() : null;
  return {
    url: magnet,
    name: `Torrentio \xB7 ${firstLine}`,
    title: cleanedTitle || `Magnet stream \xB7 ${raw.infoHash.slice(0, 8)}`,
    behaviorHints: raw.behaviorHints || {},
    isMagnet: true,
    isHls: false,
    quality,
    size,
    source: "torrentio"
  };
};
var fetchTorrentioStreams = async (imdbId, type, season, episode) => {
  const mediaType = type === "tv" || type === "series" ? "series" : "movie";
  const streamPath = mediaType === "series" ? `stream/series/${imdbId}:${season}:${episode}.json` : `stream/movie/${imdbId}.json`;
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
function torrentioPlugin() {
  return {
    name: "torrentio-plugin",
    configureServer(server) {
      server.middlewares.use("/api/torrentio/stream", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const tmdbId = url.searchParams.get("tmdbId");
          const type = url.searchParams.get("type") || "movie";
          const season = url.searchParams.get("season");
          const episode = url.searchParams.get("episode");
          if (!tmdbId) {
            sendJson5(res, 400, { error: "Missing required parameter: tmdbId", streams: [] });
            return;
          }
          if ((type === "tv" || type === "series") && (!season || !episode)) {
            sendJson5(res, 400, { error: "Season and episode are required for TV shows", streams: [] });
            return;
          }
          const imdbId = await tmdbToImdb2(tmdbId, type);
          if (!imdbId) {
            sendJson5(res, 200, {
              streams: [],
              message: "Could not resolve TMDB ID to IMDb ID (TMDB credentials may be missing)"
            });
            return;
          }
          const rawStreams = await fetchTorrentioStreams(imdbId, type, season, episode);
          const streams = rawStreams.map(normalizeStream2).filter(Boolean);
          sendJson5(res, 200, { streams });
        } catch (error) {
          console.warn("[torrentio-plugin] error:", error?.message || error);
          sendJson5(res, 502, { error: error?.message || "Torrentio proxy failed", streams: [] });
        }
      });
      server.middlewares.use("/api/torrentio/health", (_req, res) => {
        sendJson5(res, 200, {
          ok: true,
          plugin: "torrentio",
          instance: TORRENTIO_BASE,
          hasTmdbCredentials: Boolean(TMDB_ACCESS_TOKEN2 || TMDB_API_KEY2)
        });
      });
    }
  };
}

// vite/hls-manifest.js
var UNSUPPORTED_AUDIO_CODECS = /* @__PURE__ */ new Set(["ec-3", "ac-3", "dts", "truehd"]);
function parseCodecs(codecsStr) {
  if (!codecsStr) return [];
  return codecsStr.split(",").map((c) => c.trim()).filter(Boolean);
}
function codecsToKeep(codecs) {
  return codecs.filter((c) => !UNSUPPORTED_AUDIO_CODECS.has(c.toLowerCase()));
}
function buildCodecsAttr(keepCodecs) {
  return keepCodecs.join(",");
}
function isAudioTrack(line) {
  return line.includes("#EXT-X-MEDIA:") && line.includes('TYPE="AUDIO"');
}
function isVariantStream(line) {
  return line.includes("#EXT-X-STREAM-INF:");
}
function getAttr(line, name) {
  const re = new RegExp(`${name}="([^"]*)"`, "i");
  const m = line.match(re);
  return m ? m[1] : null;
}
function extractGroupId(line) {
  return getAttr(line, "GROUP-ID");
}
function rewriteManifest(manifestText, baseUrl, proxySegmentUrl) {
  const lines = manifestText.split(/\r?\n/);
  const out = [];
  const removedAudioGroups = /* @__PURE__ */ new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (isVariantStream(line)) {
      const codecs = getAttr(line, "CODECS");
      if (codecs) {
        const parsed = parseCodecs(codecs);
        const kept = codecsToKeep(parsed);
        if (kept.length === 0) {
          i++;
          continue;
        }
        if (kept.length < parsed.length) {
          const newLine = line.replace(/CODECS="[^"]*"/, `CODECS="${buildCodecsAttr(kept)}"`);
          const audioGroup = getAttr(line, "AUDIO");
          if (audioGroup && removedAudioGroups.has(audioGroup)) {
            out.push(newLine.replace(/\s+AUDIO="[^"]*"/, ""));
          } else {
            out.push(newLine);
          }
          out.push(lines[++i].trim());
          continue;
        }
      }
      out.push(line);
      out.push(lines[++i].trim());
      continue;
    }
    if (isAudioTrack(line)) {
      const codecs = getAttr(line, "CODECS");
      if (codecs) {
        const parsed = parseCodecs(codecs);
        const kept = codecsToKeep(parsed);
        if (kept.length === 0) {
          const groupId = extractGroupId(line);
          if (groupId) removedAudioGroups.add(groupId);
          continue;
        }
      }
      out.push(line);
      continue;
    }
    if (line && !line.startsWith("#") && (line.endsWith(".ts") || line.endsWith(".m4s") || line.endsWith(".aac") || line.endsWith(".mp3") || line.endsWith(".webm"))) {
      const absoluteUrl = new URL(line, baseUrl).href;
      out.push(proxySegmentUrl(encodeURIComponent(absoluteUrl)));
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}
function parseManifestForAudioCodecs(manifestText) {
  const lines = manifestText.split(/\r?\n/);
  const audioTracks = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (isAudioTrack(trimmed)) {
      const codecs = getAttr(trimmed, "CODECS");
      const name = getAttr(trimmed, "NAME") || getAttr(trimmed, "group-id") || "unknown";
      const groupId = extractGroupId(trimmed);
      audioTracks.push({
        name,
        groupId,
        codecs: codecs ? parseCodecs(codecs) : [],
        line: trimmed
      });
    }
  }
  return audioTracks;
}
function hasUnsupportedAudioCodecs(manifestText) {
  const tracks = parseManifestForAudioCodecs(manifestText);
  return tracks.some((t) => t.codecs.some((c) => UNSUPPORTED_AUDIO_CODECS.has(c.toLowerCase())));
}

// vite/sidecar-plugin.js
import { Buffer } from "node:buffer";
var sendJson6 = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};
var sendError = (res, status, message) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(message);
};
async function fetchUrl(targetUrl, options = {}) {
  const http = targetUrl.startsWith("https:") ? await import("node:https") : await import("node:http");
  return new Promise((resolve, reject) => {
    const req = http.get(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...options.headers
      },
      timeout: 2e4
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, targetUrl).href;
        res.destroy();
        resolve(fetchUrl(nextUrl, options));
        return;
      }
      if (res.statusCode !== 200) {
        res.destroy();
        reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
        return;
      }
      resolve(res);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${targetUrl}`));
    });
  });
}
async function collectBody(stream, maxBytes = 50 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) break;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function sidecarPlugin() {
  return {
    name: "sidecar-hls-plugin",
    configureServer(server) {
      server.middlewares.use("/api/sidecar/health", (_req, res) => {
        sendJson6(res, 200, { ok: true, plugin: "sidecar-hls" });
      });
      server.middlewares.use("/api/sidecar/stream", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const encodedStreamUrl = url.searchParams.get("url");
          if (!encodedStreamUrl) {
            sendError(res, 400, "Missing ?url= parameter");
            return;
          }
          let streamUrl;
          try {
            streamUrl = decodeURIComponent(encodedStreamUrl);
          } catch {
            sendError(res, 400, "Invalid URL encoding");
            return;
          }
          if (!streamUrl.startsWith("http://") && !streamUrl.startsWith("https://")) {
            sendError(res, 400, "Only http/https URLs are supported");
            return;
          }
          if (!streamUrl.toLowerCase().includes(".m3u8")) {
            sendError(res, 400, "Only HLS (.m3u8) streams are supported by the sidecar");
            return;
          }
          const response = await fetchUrl(streamUrl);
          const body = await collectBody(response);
          const manifestText = body.toString("utf8");
          const hasBadAudio = hasUnsupportedAudioCodecs(manifestText);
          if (!hasBadAudio) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("X-Sidecar-Original", "true");
            res.end(manifestText);
            return;
          }
          const baseUrl = new URL(streamUrl);
          const proxySegmentUrl = (encodedSegUrl) => `/api/sidecar/segment?url=${encodedSegUrl}&base=${encodeURIComponent(baseUrl.origin + baseUrl.pathname.replace(/\/[^/]*$/, "/"))}`;
          const rewritten = rewriteManifest(manifestText, baseUrl.origin, proxySegmentUrl);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Sidecar-Rewritten", "true");
          res.end(rewritten);
        } catch (err) {
          console.warn("[sidecar-plugin] stream error:", err?.message || err);
          sendError(res, 502, `Sidecar error: ${err?.message || "Unknown error"}`);
        }
      });
      server.middlewares.use("/api/sidecar/segment", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const encodedSegUrl = url.searchParams.get("url");
          const encodedBase = url.searchParams.get("base");
          if (!encodedSegUrl) {
            sendError(res, 400, "Missing ?url= parameter");
            return;
          }
          let segUrl;
          try {
            segUrl = decodeURIComponent(encodedSegUrl);
          } catch {
            sendError(res, 400, "Invalid URL encoding");
            return;
          }
          if (!segUrl.startsWith("http://") && !segUrl.startsWith("https://")) {
            if (!encodedBase) {
              sendError(res, 400, "Relative segment URL requires base parameter");
              return;
            }
            try {
              const base = decodeURIComponent(encodedBase);
              segUrl = new URL(segUrl, base).href;
            } catch {
              sendError(res, 400, "Invalid base URL");
              return;
            }
          }
          const response = await fetchUrl(segUrl);
          const contentType = response.headers["content-type"] || "application/octet-stream";
          res.statusCode = 200;
          res.setHeader("Content-Type", contentType);
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Headers", "*");
          res.setHeader("Access-Control-Expose-Headers", "Content-Length,Content-Type");
          res.setHeader("Cache-Control", "public, max-age=3600");
          response.pipe(res);
        } catch (err) {
          console.warn("[sidecar-plugin] segment error:", err?.message || err);
          sendError(res, 502, `Segment error: ${err?.message || "Unknown error"}`);
        }
      });
    }
  };
}

// vite.config.js
var vite_config_default = defineConfig({
  plugins: [react(), flixhqApiPlugin(), ezvidApiPlugin(), smplStreamPlugin(), mediafusionPlugin(), torrentioPlugin(), sidecarPlugin()],
  server: {
    allowedHosts: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiLCAidml0ZS9mbGl4aHEtcGx1Z2luLmpzIiwgInZpdGUvZXp2aWRhcGktcGx1Z2luLmpzIiwgInZpdGUvc21wbHN0cmVhbS1wbHVnaW4uanMiLCAidml0ZS9tZWRpYWZ1c2lvbi1wbHVnaW4uanMiLCAidml0ZS90b3JyZW50aW8tcGx1Z2luLmpzIiwgInZpdGUvaGxzLW1hbmlmZXN0LmpzIiwgInZpdGUvc2lkZWNhci1wbHVnaW4uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJWOlxcXFxBbnRncmF2aXR5XFxcXHdlYnN0cmVhbWVyXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJWOlxcXFxBbnRncmF2aXR5XFxcXHdlYnN0cmVhbWVyXFxcXHZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9WOi9BbnRncmF2aXR5L3dlYnN0cmVhbWVyL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCdcbmltcG9ydCBmbGl4aHFBcGlQbHVnaW4gZnJvbSAnLi92aXRlL2ZsaXhocS1wbHVnaW4uanMnXG5pbXBvcnQgZXp2aWRBcGlQbHVnaW4gZnJvbSAnLi92aXRlL2V6dmlkYXBpLXBsdWdpbi5qcydcbmltcG9ydCBzbXBsU3RyZWFtUGx1Z2luIGZyb20gJy4vdml0ZS9zbXBsc3RyZWFtLXBsdWdpbi5qcydcbmltcG9ydCBtZWRpYWZ1c2lvblBsdWdpbiBmcm9tICcuL3ZpdGUvbWVkaWFmdXNpb24tcGx1Z2luLmpzJ1xuaW1wb3J0IHRvcnJlbnRpb1BsdWdpbiBmcm9tICcuL3ZpdGUvdG9ycmVudGlvLXBsdWdpbi5qcydcbmltcG9ydCBzaWRlY2FyUGx1Z2luIGZyb20gJy4vdml0ZS9zaWRlY2FyLXBsdWdpbi5qcydcblxuLy8gaHR0cHM6Ly92aXRlLmRldi9jb25maWcvXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKSwgZmxpeGhxQXBpUGx1Z2luKCksIGV6dmlkQXBpUGx1Z2luKCksIHNtcGxTdHJlYW1QbHVnaW4oKSwgbWVkaWFmdXNpb25QbHVnaW4oKSwgdG9ycmVudGlvUGx1Z2luKCksIHNpZGVjYXJQbHVnaW4oKV0sXG4gIHNlcnZlcjoge1xuICAgIGFsbG93ZWRIb3N0czogdHJ1ZVxuICB9XG59KVxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJWOlxcXFxBbnRncmF2aXR5XFxcXHdlYnN0cmVhbWVyXFxcXHZpdGVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZVxcXFxmbGl4aHEtcGx1Z2luLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9WOi9BbnRncmF2aXR5L3dlYnN0cmVhbWVyL3ZpdGUvZmxpeGhxLXBsdWdpbi5qc1wiOy8vIHZpdGUvZmxpeGhxLXBsdWdpbi5qc1xuLy8gU2VydmVyLXNpZGUgVml0ZSBwbHVnaW4gdGhhdCB3cmFwcyB0aGUgZmxpeGhxLWFwaSBOb2RlIGxpYnJhcnlcbi8vIChodHRwczovL3d3dy5ucG1qcy5jb20vcGFja2FnZS9mbGl4aHEtYXBpKSBhbmQgZXhwb3NlcyBhIHNpbmdsZVxuLy8gL2FwaS9mbGl4aHEvc291cmNlIGVuZHBvaW50IHRoYXQgdGhlIFJlYWN0IGFwcCBjYW4gY2FsbCB0byBnZXRcbi8vIGEgcmVhbCBtM3U4IFVSTCBmb3IgYSBnaXZlbiB0aXRsZSArIChvcHRpb25hbCkgc2Vhc29uL2VwaXNvZGUuXG4vL1xuLy8gVGhlIHBsdWdpbiBpcyBkZXYtb25seSAoY29uZmlndXJlU2VydmVyKSBzbyBwcm9kdWN0aW9uIGJ1aWxkcyBhcmVcbi8vIHVuYWZmZWN0ZWQuIGZsaXhocS1hcGkgdXNlcyBDb21tb25KUywgc28gd2UgdXNlIGNyZWF0ZVJlcXVpcmUgaGVyZS5cblxuaW1wb3J0IHsgY3JlYXRlUmVxdWlyZSB9IGZyb20gXCJtb2R1bGVcIjtcblxuY29uc3QgcmVxdWlyZSA9IGNyZWF0ZVJlcXVpcmUoaW1wb3J0Lm1ldGEudXJsKTtcbmNvbnN0IEZsaXhIUSA9IHJlcXVpcmUoXCJmbGl4aHEtYXBpXCIpO1xuXG4vLyBDYWNoZSB0aGUgRmxpeEhRIGluc3RhbmNlIGZvciB0aGUgbGlmZXRpbWUgb2YgdGhlIGRldiBzZXJ2ZXIuXG5sZXQgZmxpeGhxSW5zdGFuY2UgPSBudWxsO1xuY29uc3QgZ2V0RmxpeEhRID0gKCkgPT4ge1xuICBpZiAoIWZsaXhocUluc3RhbmNlKSB7XG4gICAgZmxpeGhxSW5zdGFuY2UgPSBuZXcgRmxpeEhRKCk7XG4gIH1cbiAgcmV0dXJuIGZsaXhocUluc3RhbmNlO1xufTtcblxuLy8gUGljayB0aGUgbW9zdCBsaWtlbHkgcmVzdWx0IGZyb20gYSBzZWFyY2guIFNlYXJjaCByZXR1cm5zIG1peGVkXG4vLyBtb3ZpZS9zZXJpZXMgcmVzdWx0czsgd2UgZmlsdGVyIGJ5IHRoZSByZXF1ZXN0ZWQgbWVkaWEgdHlwZS5cbmNvbnN0IHBpY2tTZWFyY2hSZXN1bHQgPSAocmVzdWx0cywgdHlwZSkgPT4ge1xuICBpZiAoIUFycmF5LmlzQXJyYXkocmVzdWx0cykgfHwgcmVzdWx0cy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB0eXBlID09PSBcInNlcmllc1wiIHx8IHR5cGUgPT09IFwidHZcIlxuICAgID8gcmVzdWx0cy5maWx0ZXIoKHIpID0+IC90dnxzZXJpZXN8c2hvdy9pLnRlc3QoYCR7ci50eXBlIHx8IFwiXCJ9ICR7ci5pZCB8fCBcIlwifWApKVxuICAgIDogcmVzdWx0cy5maWx0ZXIoKHIpID0+IC9tb3ZpZXxmaWxtL2kudGVzdChgJHtyLnR5cGUgfHwgXCJcIn1gKSB8fCAhL3R2fHNlcmllcy9pLnRlc3QoYCR7ci5pZCB8fCBcIlwifWApKTtcblxuICByZXR1cm4gbm9ybWFsaXplZFswXSB8fCByZXN1bHRzWzBdO1xufTtcblxuLy8gV2FsayB0aGUgRmxpeEhRIGZsb3cgZm9yIGEgVFYgZXBpc29kZTogc2VhcmNoIFx1MjE5MiBkZXRhaWxzIFx1MjE5MiBzZWFzb25zIFx1MjE5MiBlcGlzb2Rlc1xuY29uc3QgcmVzb2x2ZUVwaXNvZGVJZCA9IGFzeW5jICh0aXRsZSwgc2Vhc29uLCBlcGlzb2RlKSA9PiB7XG4gIGNvbnN0IGZsaXhocSA9IGdldEZsaXhIUSgpO1xuICBjb25zdCBzZWFyY2hSZXN1bHRzID0gYXdhaXQgZmxpeGhxLnNlYXJjaCh0aXRsZSk7XG4gIGNvbnN0IHNob3cgPSBwaWNrU2VhcmNoUmVzdWx0KHNlYXJjaFJlc3VsdHMsIFwic2VyaWVzXCIpO1xuICBpZiAoIXNob3c/LmlkKSB0aHJvdyBuZXcgRXJyb3IoYEZsaXhIUTogc2hvdyBub3QgZm91bmQgZm9yIFwiJHt0aXRsZX1cImApO1xuXG4gIGNvbnN0IHNlYXNvbnMgPSBhd2FpdCBmbGl4aHEuZ2V0U2Vhc29ucyhzaG93LmlkKTtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHNlYXNvbnMpIHx8IHNlYXNvbnMubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBGbGl4SFE6IG5vIHNlYXNvbnMgZm91bmQgZm9yIFwiJHt0aXRsZX1cImApO1xuICB9XG5cbiAgY29uc3QgdGFyZ2V0U2Vhc29uID0gc2Vhc29ucy5maW5kKChzKSA9PlxuICAgIFN0cmluZyhzLnNlYXNvbiA/PyBzLm51bWJlciA/PyBzLnNlYXNvbk51bWJlcikgPT09IFN0cmluZyhzZWFzb24pXG4gICkgfHwgc2Vhc29ucy5maW5kKChzKSA9PiBOdW1iZXIocy5zZWFzb24gPz8gcy5udW1iZXIgPz8gcy5zZWFzb25OdW1iZXIpID09PSBOdW1iZXIoc2Vhc29uKSk7XG5cbiAgaWYgKCF0YXJnZXRTZWFzb24/LmlkKSB0aHJvdyBuZXcgRXJyb3IoYEZsaXhIUTogc2Vhc29uICR7c2Vhc29ufSBub3QgZm91bmRgKTtcblxuICBjb25zdCBlcGlzb2RlcyA9IGF3YWl0IGZsaXhocS5nZXRFcGlzb2Rlcyh0YXJnZXRTZWFzb24uaWQpO1xuICBjb25zdCB0YXJnZXRFcGlzb2RlID0gZXBpc29kZXMuZmluZCgoZSkgPT5cbiAgICBTdHJpbmcoZS5lcGlzb2RlID8/IGUubnVtYmVyID8/IGUuZXBpc29kZU51bWJlcikgPT09IFN0cmluZyhlcGlzb2RlKVxuICApIHx8IGVwaXNvZGVzLmZpbmQoKGUpID0+IE51bWJlcihlLmVwaXNvZGUgPz8gZS5udW1iZXIgPz8gZS5lcGlzb2RlTnVtYmVyKSA9PT0gTnVtYmVyKGVwaXNvZGUpKTtcblxuICBpZiAoIXRhcmdldEVwaXNvZGU/LmlkKSB0aHJvdyBuZXcgRXJyb3IoYEZsaXhIUTogZXBpc29kZSAke2VwaXNvZGV9IG5vdCBmb3VuZGApO1xuICByZXR1cm4gdGFyZ2V0RXBpc29kZS5pZDtcbn07XG5cbmNvbnN0IHJlc29sdmVNb3ZpZUlkID0gYXN5bmMgKHRpdGxlKSA9PiB7XG4gIGNvbnN0IGZsaXhocSA9IGdldEZsaXhIUSgpO1xuICBjb25zdCBzZWFyY2hSZXN1bHRzID0gYXdhaXQgZmxpeGhxLnNlYXJjaCh0aXRsZSk7XG4gIGNvbnN0IG1vdmllID0gcGlja1NlYXJjaFJlc3VsdChzZWFyY2hSZXN1bHRzLCBcIm1vdmllXCIpO1xuICBpZiAoIW1vdmllPy5pZCkgdGhyb3cgbmV3IEVycm9yKGBGbGl4SFE6IG1vdmllIG5vdCBmb3VuZCBmb3IgXCIke3RpdGxlfVwiYCk7XG4gIHJldHVybiBtb3ZpZS5pZDtcbn07XG5cbi8vIFRyeSBldmVyeSBhdmFpbGFibGUgc2VydmVyIHVudGlsIG9uZSByZXR1cm5zIGEgcGxheWFibGUgc291cmNlLlxuY29uc3QgcmVzb2x2ZVNvdXJjZSA9IGFzeW5jIChjb250ZW50SWQsIHR5cGUpID0+IHtcbiAgY29uc3QgZmxpeGhxID0gZ2V0RmxpeEhRKCk7XG4gIGNvbnN0IHNlcnZlclR5cGUgPSB0eXBlID09PSBcInNlcmllc1wiIHx8IHR5cGUgPT09IFwidHZcIiA/IFwidHZcIiA6IFwibW92aWVcIjtcbiAgY29uc3Qgc2VydmVycyA9IGF3YWl0IGZsaXhocS5nZXRTZXJ2ZXJzKGNvbnRlbnRJZCwgc2VydmVyVHlwZSk7XG4gIGlmICghQXJyYXkuaXNBcnJheShzZXJ2ZXJzKSB8fCBzZXJ2ZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkZsaXhIUTogbm8gc2VydmVycyByZXR1cm5lZCBmb3IgdGhpcyB0aXRsZVwiKTtcbiAgfVxuXG4gIGxldCBsYXN0RXJyb3IgPSBudWxsO1xuICBmb3IgKGNvbnN0IHNlcnZlciBvZiBzZXJ2ZXJzKSB7XG4gICAgaWYgKCFzZXJ2ZXI/LmlkKSBjb250aW51ZTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmxpeGhxLmZldGNoU291cmNlKHNlcnZlci5pZCk7XG4gICAgICBpZiAocmVzdWx0Py5zb3VyY2UpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICB1cmw6IHJlc3VsdC5zb3VyY2UsXG4gICAgICAgICAgdHlwZTogcmVzdWx0LnR5cGUgfHwgXCJobHNcIixcbiAgICAgICAgICBzZXJ2ZXJOYW1lOiBzZXJ2ZXIubmFtZSB8fCBzZXJ2ZXIuaWQsXG4gICAgICAgICAgZW5jcnlwdGVkOiBCb29sZWFuKHJlc3VsdC5lbmNyeXB0ZWQpXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxhc3RFcnJvciA9IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIHRocm93IGxhc3RFcnJvciB8fCBuZXcgRXJyb3IoXCJGbGl4SFE6IG5vIHNlcnZlciBwcm9kdWNlZCBhIHBsYXlhYmxlIHNvdXJjZVwiKTtcbn07XG5cbmNvbnN0IHNlbmRKc29uID0gKHJlcywgc3RhdHVzLCBwYXlsb2FkKSA9PiB7XG4gIHJlcy5zdGF0dXNDb2RlID0gc3RhdHVzO1xuICByZXMuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOFwiKTtcbiAgcmVzLnNldEhlYWRlcihcIkNhY2hlLUNvbnRyb2xcIiwgXCJuby1zdG9yZVwiKTtcbiAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShwYXlsb2FkKSk7XG59O1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBmbGl4aHFBcGlQbHVnaW4oKSB7XG4gIHJldHVybiB7XG4gICAgbmFtZTogXCJmbGl4aHEtYXBpLXBsdWdpblwiLFxuICAgIGNvbmZpZ3VyZVNlcnZlcihzZXJ2ZXIpIHtcbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoXCIvYXBpL2ZsaXhocS9zb3VyY2VcIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXEudXJsLCBcImh0dHA6Ly9sb2NhbGhvc3RcIik7XG4gICAgICAgICAgY29uc3QgdGl0bGUgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInRpdGxlXCIpPy50cmltKCk7XG4gICAgICAgICAgY29uc3QgdHlwZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwidHlwZVwiKSB8fCBcIm1vdmllXCI7XG4gICAgICAgICAgY29uc3Qgc2Vhc29uID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZWFzb25cIik7XG4gICAgICAgICAgY29uc3QgZXBpc29kZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiZXBpc29kZVwiKTtcblxuICAgICAgICAgIGlmICghdGl0bGUpIHtcbiAgICAgICAgICAgIHNlbmRKc29uKHJlcywgNDAwLCB7IGVycm9yOiBcIk1pc3NpbmcgcmVxdWlyZWQgcGFyYW1ldGVyOiB0aXRsZVwiIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IGNvbnRlbnRJZCA9ICh0eXBlID09PSBcInNlcmllc1wiIHx8IHR5cGUgPT09IFwidHZcIilcbiAgICAgICAgICAgID8gYXdhaXQgcmVzb2x2ZUVwaXNvZGVJZCh0aXRsZSwgc2Vhc29uLCBlcGlzb2RlKVxuICAgICAgICAgICAgOiBhd2FpdCByZXNvbHZlTW92aWVJZCh0aXRsZSk7XG5cbiAgICAgICAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCByZXNvbHZlU291cmNlKGNvbnRlbnRJZCwgdHlwZSk7XG4gICAgICAgICAgc2VuZEpzb24ocmVzLCAyMDAsIHsgLi4uc291cmNlLCB0aXRsZSwgdHlwZSB9KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oXCJbZmxpeGhxLXBsdWdpbl1cIiwgZXJyb3I/Lm1lc3NhZ2UgfHwgZXJyb3IpO1xuICAgICAgICAgIHNlbmRKc29uKHJlcywgNTAyLCB7IGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBcIkZsaXhIUSBsb29rdXAgZmFpbGVkXCIgfSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICAvLyBUaW55IGhlYWx0aCBjaGVjayBmb3IgdGhlIHBsdWdpbiBlbmRwb2ludFxuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShcIi9hcGkvZmxpeGhxL2hlYWx0aFwiLCAoX3JlcSwgcmVzKSA9PiB7XG4gICAgICAgIHNlbmRKc29uKHJlcywgMjAwLCB7IG9rOiB0cnVlLCBwbHVnaW46IFwiZmxpeGhxLWFwaVwiIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xufVxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJWOlxcXFxBbnRncmF2aXR5XFxcXHdlYnN0cmVhbWVyXFxcXHZpdGVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZVxcXFxlenZpZGFwaS1wbHVnaW4uanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1Y6L0FudGdyYXZpdHkvd2Vic3RyZWFtZXIvdml0ZS9lenZpZGFwaS1wbHVnaW4uanNcIjsvLyB2aXRlL2V6dmlkYXBpLXBsdWdpbi5qc1xuLy8gU2VydmVyLXNpZGUgVml0ZSBwbHVnaW4gdGhhdCBwcm94aWVzIHJlcXVlc3RzIHRvIGV6dmlkYXBpLmNvbVxuLy8gKGh0dHBzOi8vZXp2aWRhcGkuY29tL2RvY3MpIGFuZCByZXR1cm5zIHBsYXlhYmxlIHN0cmVhbSBVUkxzLlxuLy9cbi8vIGV6dmlkYXBpIHJldHVybnMgZGlyZWN0IEhMUyBVUkxzIGZyb20gbXVsdGlwbGUgcHJvdmlkZXJzIHdpdGhcbi8vIG5vIGF1dGggcmVxdWlyZWQgYW5kIDEwMCUgZnJlZSB1c2FnZS5cbi8vXG4vLyBBUEk6XG4vLyAgIEdFVCAvYXBpL2V6dmlkYXBpL2VtYmVkP3R5cGU9bW92aWUmdG1kYklkPXtpZH1cbi8vICAgR0VUIC9hcGkvZXp2aWRhcGkvZW1iZWQ/dHlwZT10diZ0bWRiSWQ9e2lkfSZzZWFzb249e3N9JmVwaXNvZGU9e2V9XG4vL1xuLy8gUmVzcG9uc2U6IHsgaGxzOiBib29sZWFuLCBzZXJ2ZXJzOiBbeyBzcmMsIHByb3ZpZGVyLCBzZXJ2ZXIgfV0gfVxuXG5jb25zdCBFWlZJREFQSV9CQVNFID0gXCJodHRwczovL2V6dmlkYXBpLmNvbVwiO1xuY29uc3QgRVpWSURBUElfVElNRU9VVF9NUyA9IDEyXzAwMDtcblxuY29uc3Qgc2VuZEpzb24gPSAocmVzLCBzdGF0dXMsIHBheWxvYWQpID0+IHtcbiAgcmVzLnN0YXR1c0NvZGUgPSBzdGF0dXM7XG4gIHJlcy5zZXRIZWFkZXIoXCJDb250ZW50LVR5cGVcIiwgXCJhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PXV0Zi04XCIpO1xuICByZXMuc2V0SGVhZGVyKFwiQ2FjaGUtQ29udHJvbFwiLCBcIm5vLXN0b3JlXCIpO1xuICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHBheWxvYWQpKTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGV6dmlkQXBpUGx1Z2luKCkge1xuICByZXR1cm4ge1xuICAgIG5hbWU6IFwiZXp2aWRhcGktcGx1Z2luXCIsXG4gICAgY29uZmlndXJlU2VydmVyKHNlcnZlcikge1xuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShcIi9hcGkvZXp2aWRhcGkvZW1iZWRcIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXEudXJsLCBcImh0dHA6Ly9sb2NhbGhvc3RcIik7XG4gICAgICAgICAgY29uc3QgdHlwZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwidHlwZVwiKSB8fCBcIm1vdmllXCI7XG4gICAgICAgICAgY29uc3QgdG1kYklkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJ0bWRiSWRcIik7XG4gICAgICAgICAgY29uc3Qgc2Vhc29uID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZWFzb25cIik7XG4gICAgICAgICAgY29uc3QgZXBpc29kZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiZXBpc29kZVwiKTtcbiAgICAgICAgICBjb25zdCBwcm92aWRlciA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicHJvdmlkZXJcIik7XG5cbiAgICAgICAgICBpZiAoIXRtZGJJZCkge1xuICAgICAgICAgICAgc2VuZEpzb24ocmVzLCA0MDAsIHsgZXJyb3I6IFwiTWlzc2luZyByZXF1aXJlZCBwYXJhbWV0ZXI6IHRtZGJJZFwiIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIEJ1aWxkIHRoZSBlenZpZGFwaSBVUkwgYmFzZWQgb24gbWVkaWEgdHlwZVxuICAgICAgICAgIGxldCBhcGlVcmw7XG4gICAgICAgICAgaWYgKHR5cGUgPT09IFwidHZcIiB8fCB0eXBlID09PSBcInNlcmllc1wiKSB7XG4gICAgICAgICAgICBpZiAoIXNlYXNvbiB8fCAhZXBpc29kZSkge1xuICAgICAgICAgICAgICBzZW5kSnNvbihyZXMsIDQwMCwgeyBlcnJvcjogXCJTZWFzb24gYW5kIGVwaXNvZGUgYXJlIHJlcXVpcmVkIGZvciBUViBzaG93c1wiIH0pO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBhcGlVcmwgPSBgJHtFWlZJREFQSV9CQVNFfS9lbWJlZC90di8ke3RtZGJJZH0vJHtzZWFzb259LyR7ZXBpc29kZX1gO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhcGlVcmwgPSBgJHtFWlZJREFQSV9CQVNFfS9lbWJlZC9tb3ZpZS8ke3RtZGJJZH1gO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIEFkZCBvcHRpb25hbCBwcm92aWRlciBwYXJhbWV0ZXJcbiAgICAgICAgICBpZiAocHJvdmlkZXIpIHtcbiAgICAgICAgICAgIGFwaVVybCArPSBgP3Byb3ZpZGVyPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHByb3ZpZGVyKX1gO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgICAgICAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IGNvbnRyb2xsZXIuYWJvcnQoKSwgRVpWSURBUElfVElNRU9VVF9NUyk7XG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChhcGlVcmwsIHtcbiAgICAgICAgICAgICAgc2lnbmFsOiBjb250cm9sbGVyLnNpZ25hbCxcbiAgICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgIFwiVXNlci1BZ2VudFwiOiBcIk1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xMjUuMC4wLjAgU2FmYXJpLzUzNy4zNlwiXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXNwb25zZS50ZXh0KCkuY2F0Y2goKCkgPT4gXCJcIik7XG4gICAgICAgICAgICAgIGNvbnNvbGUud2FybihgW2V6dmlkYXBpXSAke3Jlc3BvbnNlLnN0YXR1c306ICR7dGV4dC5zbGljZSgwLCAyMDApfWApO1xuICAgICAgICAgICAgICBzZW5kSnNvbihyZXMsIDUwMiwgeyBlcnJvcjogYGV6dmlkYXBpIHJldHVybmVkICR7cmVzcG9uc2Uuc3RhdHVzfWAsIHNlcnZlcnM6IFtdIH0pO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XG4gICAgICAgICAgICBzZW5kSnNvbihyZXMsIDIwMCwge1xuICAgICAgICAgICAgICBobHM6IEJvb2xlYW4oZGF0YS5obHMpLFxuICAgICAgICAgICAgICBzZXJ2ZXJzOiBBcnJheS5pc0FycmF5KGRhdGEuc2VydmVycykgPyBkYXRhLnNlcnZlcnMgOiBbXVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lcik7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGlmIChlcnJvcj8ubmFtZSA9PT0gXCJBYm9ydEVycm9yXCIpIHtcbiAgICAgICAgICAgIHNlbmRKc29uKHJlcywgNTA0LCB7IGVycm9yOiBcImV6dmlkYXBpIHJlcXVlc3QgdGltZWQgb3V0XCIsIHNlcnZlcnM6IFtdIH0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oXCJbZXp2aWRhcGldIGVycm9yOlwiLCBlcnJvcj8ubWVzc2FnZSB8fCBlcnJvcik7XG4gICAgICAgICAgICBzZW5kSnNvbihyZXMsIDUwMiwgeyBlcnJvcjogZXJyb3I/Lm1lc3NhZ2UgfHwgXCJlenZpZGFwaSBwcm94eSBmYWlsZWRcIiwgc2VydmVyczogW10gfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG59XG4iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiVjpcXFxcQW50Z3Jhdml0eVxcXFx3ZWJzdHJlYW1lclxcXFx2aXRlXFxcXHNtcGxzdHJlYW0tcGx1Z2luLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9WOi9BbnRncmF2aXR5L3dlYnN0cmVhbWVyL3ZpdGUvc21wbHN0cmVhbS1wbHVnaW4uanNcIjsvLyB2aXRlL3NtcGxzdHJlYW0tcGx1Z2luLmpzXG4vLyBTZXJ2ZXItc2lkZSBWaXRlIHBsdWdpbiB0aGF0IHByb3hpZXMgcmVxdWVzdHMgdG8gU21hc2h5U3RyZWFtXG4vLyAoZW1iZWQuc21hc2h5c3RyZWFtLmNvbSkgYW5kIHJldHVybnMgZGVjb2RlZCBzdHJlYW0gVVJMcy5cbi8vXG4vLyBTbWFzaHlTdHJlYW0gQVBJIGZsb3c6XG4vLyAgIDEuIFBPU1QgdG8gL2dldHBsYXllci5waHAgd2l0aCBlbXB0eSByZWNhcHRjaGEgdG8gaW5pdCBzZXNzaW9uXG4vLyAgIDIuIEdFVCAvZ2V0cGxheWVyLnBocD9wbGF5ZXI9ZiZ0bWRiPXtpZH0mc2Vhc29uPXtzfSZlcGlzb2RlPXtlfVxuLy8gICAzLiBEZWNvZGUgYmFzZTY0IHNvdXJjZVVybHMgZnJvbSByZXNwb25zZVxuLy9cbi8vIEFQSTpcbi8vICAgR0VUIC9hcGkvc21wbHN0cmVhbS9lbWJlZD90bWRiSWQ9e2lkfSZ0eXBlPW1vdmllXG4vLyAgIEdFVCAvYXBpL3NtcGxzdHJlYW0vZW1iZWQ/dG1kYklkPXtpZH0mdHlwZT10diZzZWFzb249e3N9JmVwaXNvZGU9e2V9XG4vL1xuLy8gUmVzcG9uc2U6IHsgc2VydmVyczogW3sgc3JjLCBuYW1lLCB0eXBlIH1dIH1cblxuY29uc3QgU01QTFNUUkVBTV9CQVNFID0gXCJodHRwczovL2VtYmVkLnNtYXNoeXN0cmVhbS5jb21cIjtcbmNvbnN0IFNNUExTVFJFQU1fVElNRU9VVF9NUyA9IDE1XzAwMDtcblxuLy8gU21hc2h5U3RyZWFtIG9iZnVzY2F0ZWQgYmFzZTY0IGRlY29kaW5nXG4vLyBQYXRoIHNlZ21lbnRzIHVzZWQgaW4gVVJMIGNvbnN0cnVjdGlvbiAocmV2ZXJzZWQgb3JkZXIgZm9yIGRlY29kaW5nKVxuY29uc3QgU01BU0hZX0I2NF9QQVJUUyA9IFtcbiAgXCJVMFpNTDJSVk4wSXZSR3g0XCIsXG4gIFwiTUdOaEwwSldiMGt2VGxNNVwiLFxuICBcIlltOTRMekpUU1M5YVUwWmpcIixcbiAgXCJTR0owTDFkR2FrSXZOMGRYXCIsXG4gIFwiZUU1MkwxUXdPQzk2TjBZelwiXG5dO1xuXG5jb25zdCBkZWNvZGVTbWFzaHlTdHJlYW0gPSAoZW5jb2RlZCkgPT4ge1xuICBpZiAoIWVuY29kZWQgfHwgdHlwZW9mIGVuY29kZWQgIT09IFwic3RyaW5nXCIpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIC8vIFJlbW92ZSB0aGUgZmlyc3QgMiBjaGFyYWN0ZXJzICh2ZXJzaW9uL3R5cGUgcHJlZml4KVxuICAgIGxldCBmb3JtYXR0ZWRCNjQgPSBlbmNvZGVkLnNsaWNlKDIpO1xuICAgIC8vIFJlbW92ZSBvYmZ1c2NhdGVkIHBhdGggc2VnbWVudHMgaW4gcmV2ZXJzZSBvcmRlclxuICAgIGZvciAobGV0IGkgPSBTTUFTSFlfQjY0X1BBUlRTLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBmb3JtYXR0ZWRCNjQgPSBmb3JtYXR0ZWRCNjQucmVwbGFjZShgLy8ke1NNQVNIWV9CNjRfUEFSVFNbaV19YCwgXCJcIik7XG4gICAgfVxuICAgIHJldHVybiBhdG9iKGZvcm1hdHRlZEI2NCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59O1xuXG5jb25zdCBzZW5kSnNvbiA9IChyZXMsIHN0YXR1cywgcGF5bG9hZCkgPT4ge1xuICByZXMuc3RhdHVzQ29kZSA9IHN0YXR1cztcbiAgcmVzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLThcIik7XG4gIHJlcy5zZXRIZWFkZXIoXCJDYWNoZS1Db250cm9sXCIsIFwibm8tc3RvcmVcIik7XG4gIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkocGF5bG9hZCkpO1xufTtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gc21wbFN0cmVhbVBsdWdpbigpIHtcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBcInNtcGxzdHJlYW0tcGx1Z2luXCIsXG4gICAgY29uZmlndXJlU2VydmVyKHNlcnZlcikge1xuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShcIi9hcGkvc21wbHN0cmVhbS9lbWJlZFwiLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJlcS51cmwsIFwiaHR0cDovL2xvY2FsaG9zdFwiKTtcbiAgICAgICAgICBjb25zdCB0bWRiSWQgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInRtZGJJZFwiKTtcbiAgICAgICAgICBjb25zdCB0eXBlID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJ0eXBlXCIpIHx8IFwibW92aWVcIjtcbiAgICAgICAgICBjb25zdCBzZWFzb24gPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInNlYXNvblwiKTtcbiAgICAgICAgICBjb25zdCBlcGlzb2RlID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJlcGlzb2RlXCIpO1xuXG4gICAgICAgICAgaWYgKCF0bWRiSWQpIHtcbiAgICAgICAgICAgIHNlbmRKc29uKHJlcywgNDAwLCB7IGVycm9yOiBcIk1pc3NpbmcgcmVxdWlyZWQgcGFyYW1ldGVyOiB0bWRiSWRcIiwgc2VydmVyczogW10gfSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICAgICAgICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4gY29udHJvbGxlci5hYm9ydCgpLCBTTVBMU1RSRUFNX1RJTUVPVVRfTVMpO1xuXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIFN0ZXAgMTogSW5pdGlhbGl6ZSBzZXNzaW9uIHdpdGggZW1wdHkgcmVjYXB0Y2hhXG4gICAgICAgICAgICBjb25zdCBpbml0UmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHtTTVBMU1RSRUFNX0JBU0V9L2dldHBsYXllci5waHBgLCB7XG4gICAgICAgICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZFwiLFxuICAgICAgICAgICAgICAgIFwiT3JpZ2luXCI6IFNNUExTVFJFQU1fQkFTRSxcbiAgICAgICAgICAgICAgICBcIlJlZmVyZXJcIjogYCR7U01QTFNUUkVBTV9CQVNFfS9gLFxuICAgICAgICAgICAgICAgIFwiVXNlci1BZ2VudFwiOiBcIk1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xMjUuMC4wLjAgU2FmYXJpLzUzNy4zNlwiXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGJvZHk6IFwiZy1yZWNhcHRjaGEtcmVzcG9uc2U9XCJcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAoIWluaXRSZXNwb25zZS5vaykge1xuICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtzbXBsc3RyZWFtXSBpbml0ICR7aW5pdFJlc3BvbnNlLnN0YXR1c31gKTtcbiAgICAgICAgICAgICAgc2VuZEpzb24ocmVzLCA1MDIsIHsgZXJyb3I6IGBTbWFzaHlTdHJlYW0gaW5pdCBmYWlsZWQ6ICR7aW5pdFJlc3BvbnNlLnN0YXR1c31gLCBzZXJ2ZXJzOiBbXSB9KTtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGNvb2tpZXMgZnJvbSBpbml0IHJlc3BvbnNlIGZvciBzZXNzaW9uXG4gICAgICAgICAgICBjb25zdCBjb29raWVzID0gaW5pdFJlc3BvbnNlLmhlYWRlcnMuZ2V0U2V0Q29va2llPy4oKSB8fCBbXTtcbiAgICAgICAgICAgIGNvbnN0IGNvb2tpZUhlYWRlciA9IGNvb2tpZXNcbiAgICAgICAgICAgICAgLm1hcCgoYykgPT4gYy5zcGxpdChcIjtcIilbMF0pXG4gICAgICAgICAgICAgIC5qb2luKFwiOyBcIik7XG5cbiAgICAgICAgICAgIC8vIFN0ZXAgMjogRmV0Y2ggcGxheWVyIGRhdGFcbiAgICAgICAgICAgIGNvbnN0IHBsYXllclBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgICAgICAgICAgICBwbGF5ZXI6IFwiZlwiLFxuICAgICAgICAgICAgICB0bWRiOiBTdHJpbmcodG1kYklkKVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZiAoKHR5cGUgPT09IFwidHZcIiB8fCB0eXBlID09PSBcInNlcmllc1wiKSAmJiBzZWFzb24gJiYgZXBpc29kZSkge1xuICAgICAgICAgICAgICBwbGF5ZXJQYXJhbXMuc2V0KFwic2Vhc29uXCIsIFN0cmluZyhzZWFzb24pKTtcbiAgICAgICAgICAgICAgcGxheWVyUGFyYW1zLnNldChcImVwaXNvZGVcIiwgU3RyaW5nKGVwaXNvZGUpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgcGxheWVyUmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHtTTVBMU1RSRUFNX0JBU0V9L2dldHBsYXllci5waHA/JHtwbGF5ZXJQYXJhbXMudG9TdHJpbmcoKX1gLCB7XG4gICAgICAgICAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICBcIkNvb2tpZVwiOiBjb29raWVIZWFkZXIsXG4gICAgICAgICAgICAgICAgXCJSZWZlcmVyXCI6IGAke1NNUExTVFJFQU1fQkFTRX0vYCxcbiAgICAgICAgICAgICAgICBcIlVzZXItQWdlbnRcIjogXCJNb3ppbGxhLzUuMCAoV2luZG93cyBOVCAxMC4wOyBXaW42NDsgeDY0KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBDaHJvbWUvMTI1LjAuMC4wIFNhZmFyaS81MzcuMzZcIlxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYgKCFwbGF5ZXJSZXNwb25zZS5vaykge1xuICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtzbXBsc3RyZWFtXSBwbGF5ZXIgJHtwbGF5ZXJSZXNwb25zZS5zdGF0dXN9YCk7XG4gICAgICAgICAgICAgIHNlbmRKc29uKHJlcywgNTAyLCB7IGVycm9yOiBgU21hc2h5U3RyZWFtIHBsYXllciBmYWlsZWQ6ICR7cGxheWVyUmVzcG9uc2Uuc3RhdHVzfWAsIHNlcnZlcnM6IFtdIH0pO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHBsYXllckRhdGEgPSBhd2FpdCBwbGF5ZXJSZXNwb25zZS5qc29uKCk7XG5cbiAgICAgICAgICAgIC8vIFN0ZXAgMzogRGVjb2RlIHNvdXJjZSBVUkxzXG4gICAgICAgICAgICBjb25zdCBzZXJ2ZXJzID0gW107XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShwbGF5ZXJEYXRhLnNvdXJjZVVybHMpKSB7XG4gICAgICAgICAgICAgIGZvciAoY29uc3QgZW5jb2RlZCBvZiBwbGF5ZXJEYXRhLnNvdXJjZVVybHMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBkZWNvZGVkID0gZGVjb2RlU21hc2h5U3RyZWFtKGVuY29kZWQpO1xuICAgICAgICAgICAgICAgIGlmIChkZWNvZGVkKSB7XG4gICAgICAgICAgICAgICAgICBzZXJ2ZXJzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICBzcmM6IGRlY29kZWQsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IFwiU21hc2h5U3RyZWFtXCIsXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IGRlY29kZWQuaW5jbHVkZXMoXCIubTN1OFwiKSA/IFwiaGxzXCIgOiBcIm1wNFwiXG4gICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc2VuZEpzb24ocmVzLCAyMDAsIHsgc2VydmVycyB9KTtcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVyKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgaWYgKGVycm9yPy5uYW1lID09PSBcIkFib3J0RXJyb3JcIikge1xuICAgICAgICAgICAgc2VuZEpzb24ocmVzLCA1MDQsIHsgZXJyb3I6IFwiU21hc2h5U3RyZWFtIHJlcXVlc3QgdGltZWQgb3V0XCIsIHNlcnZlcnM6IFtdIH0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oXCJbc21wbHN0cmVhbV0gZXJyb3I6XCIsIGVycm9yPy5tZXNzYWdlIHx8IGVycm9yKTtcbiAgICAgICAgICAgIHNlbmRKc29uKHJlcywgNTAyLCB7IGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBcIlNtYXNoeVN0cmVhbSBwcm94eSBmYWlsZWRcIiwgc2VydmVyczogW10gfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG59XG4iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiVjpcXFxcQW50Z3Jhdml0eVxcXFx3ZWJzdHJlYW1lclxcXFx2aXRlXFxcXG1lZGlhZnVzaW9uLXBsdWdpbi5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVjovQW50Z3Jhdml0eS93ZWJzdHJlYW1lci92aXRlL21lZGlhZnVzaW9uLXBsdWdpbi5qc1wiOy8vIHZpdGUvbWVkaWFmdXNpb24tcGx1Z2luLmpzXG4vLyBTZXJ2ZXItc2lkZSBWaXRlIHBsdWdpbiB0aGF0IHByb3hpZXMgcmVxdWVzdHMgdG8gYSBNZWRpYUZ1c2lvbiBTdHJlbWlvIGFkZG9uXG4vLyBpbnN0YW5jZSBhbmQgcmV0dXJucyBwbGF5YWJsZSBzdHJlYW0gVVJMcy5cbi8vXG4vLyBNZWRpYUZ1c2lvbiBpcyBhbiBvcGVuLXNvdXJjZSBzdHJlYW1pbmcgYWdncmVnYXRvciB0aGF0IHdvcmtzIGFzIGEgU3RyZW1pb1xuLy8gYWRkb24uICBJdCByZXR1cm5zIG0zdTgvbXA0IHN0cmVhbXMgZm9yIG1vdmllcyBhbmQgVFYgc2hvd3MuXG4vL1xuLy8gQmVjYXVzZSBNZWRpYUZ1c2lvbiB1c2VzIElNRGIgSURzIChTdHJlbWlvIHByb3RvY29sKSB3aGlsZSB0aGlzIHByb2plY3Rcbi8vIHVzZXMgVE1EQiBJRHMsIHRoZSBwbHVnaW4gY29udmVydHMgVE1EQiBcdTIxOTIgSU1EYiB2aWEgdGhlIFRNREIgZXh0ZXJuYWxfaWRzXG4vLyBlbmRwb2ludCBiZWZvcmUgcXVlcnlpbmcgTWVkaWFGdXNpb24uXG4vL1xuLy8gQVBJOlxuLy8gICBHRVQgL2FwaS9tZWRpYWZ1c2lvbi9zdHJlYW0/dG1kYklkPXtpZH0mdHlwZT1tb3ZpZVxuLy8gICBHRVQgL2FwaS9tZWRpYWZ1c2lvbi9zdHJlYW0/dG1kYklkPXtpZH0mdHlwZT10diZzZWFzb249e3N9JmVwaXNvZGU9e2V9XG4vL1xuLy8gUmVzcG9uc2U6IHsgc3RyZWFtczogW3sgdXJsLCBuYW1lLCB0aXRsZSwgaXNIbHMsIHNvdXJjZSB9XSB9XG5cbmNvbnN0IE1FRElBRlVTSU9OX0JBU0UgPSBwcm9jZXNzLmVudi5WSVRFX01FRElBRlVTSU9OX1VSTFxuICB8fCBcImh0dHBzOi8vbWVkaWFmdXNpb24uZWxmaG9zdGVkLmNvbVwiO1xuXG5jb25zdCBNRURJQUZVU0lPTl9USU1FT1VUX01TID0gMThfMDAwO1xuY29uc3QgVE1EQl9USU1FT1VUX01TID0gOF8wMDA7XG5cbi8vIFRNREIgY3JlZGVudGlhbHMgXHUyMDE0IGF2YWlsYWJsZSBzZXJ2ZXItc2lkZSBiZWNhdXNlIFZJVEVfIHZhcnMgYXJlIGlubGluZWRcbmNvbnN0IFRNREJfQUNDRVNTX1RPS0VOID0gcHJvY2Vzcy5lbnYuVklURV9UTURCX0FDQ0VTU19UT0tFTjtcbmNvbnN0IFRNREJfQVBJX0tFWSA9IHByb2Nlc3MuZW52LlZJVEVfVE1EQl9BUElfS0VZO1xuXG4vLyBTaW1wbGUgaW4tbWVtb3J5IGNhY2hlIGZvciBUTURCIFx1MjE5MiBJTURiIElEIGxvb2t1cHNcbmNvbnN0IGltZGJDYWNoZSA9IG5ldyBNYXAoKTtcbmNvbnN0IElNREJfQ0FDSEVfVFRMX01TID0gMjQgKiA2MCAqIDYwICogMTAwMDsgLy8gMjQgaG91cnNcblxuY29uc3Qgc2VuZEpzb24gPSAocmVzLCBzdGF0dXMsIHBheWxvYWQpID0+IHtcbiAgcmVzLnN0YXR1c0NvZGUgPSBzdGF0dXM7XG4gIHJlcy5zZXRIZWFkZXIoXCJDb250ZW50LVR5cGVcIiwgXCJhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PXV0Zi04XCIpO1xuICByZXMuc2V0SGVhZGVyKFwiQ2FjaGUtQ29udHJvbFwiLCBcIm5vLXN0b3JlXCIpO1xuICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHBheWxvYWQpKTtcbn07XG5cbi8qKlxuICogQ29udmVydCBhIFRNREIgSUQgdG8gYW4gSU1EYiBJRCB1c2luZyB0aGUgVE1EQiBleHRlcm5hbF9pZHMgZW5kcG9pbnQuXG4gKiBSZXR1cm5zIHRoZSBJTURiIElEIHN0cmluZyAoZS5nLiBcInR0MTIzNDU2N1wiKSBvciBudWxsLlxuICovXG5jb25zdCB0bWRiVG9JbWRiID0gYXN5bmMgKHRtZGJJZCwgdHlwZSkgPT4ge1xuICBjb25zdCBjYWNoZUtleSA9IGAke3R5cGV9OiR7dG1kYklkfWA7XG4gIGNvbnN0IGNhY2hlZCA9IGltZGJDYWNoZS5nZXQoY2FjaGVLZXkpO1xuICBpZiAoY2FjaGVkICYmIERhdGUubm93KCkgLSBjYWNoZWQuYXQgPCBJTURCX0NBQ0hFX1RUTF9NUykge1xuICAgIHJldHVybiBjYWNoZWQuaW1kYklkO1xuICB9XG5cbiAgaWYgKCFUTURCX0FDQ0VTU19UT0tFTiAmJiAhVE1EQl9BUElfS0VZKSB7XG4gICAgY29uc29sZS53YXJuKFwiW21lZGlhZnVzaW9uXSBObyBUTURCIGNyZWRlbnRpYWxzIFx1MjAxNCBjYW5ub3QgcmVzb2x2ZSBJTURiIElEXCIpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgbWVkaWFUeXBlID0gdHlwZSA9PT0gXCJ0dlwiIHx8IHR5cGUgPT09IFwic2VyaWVzXCIgPyBcInR2XCIgOiBcIm1vdmllXCI7XG4gIGNvbnN0IHVybCA9IG5ldyBVUkwoYGh0dHBzOi8vYXBpLnRoZW1vdmllZGIub3JnLzMvJHttZWRpYVR5cGV9LyR7dG1kYklkfS9leHRlcm5hbF9pZHNgKTtcbiAgaWYgKFRNREJfQVBJX0tFWSAmJiAhVE1EQl9BQ0NFU1NfVE9LRU4pIHtcbiAgICB1cmwuc2VhcmNoUGFyYW1zLnNldChcImFwaV9rZXlcIiwgVE1EQl9BUElfS0VZKTtcbiAgfVxuXG4gIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gIGNvbnN0IHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiBjb250cm9sbGVyLmFib3J0KCksIFRNREJfVElNRU9VVF9NUyk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybC50b1N0cmluZygpLCB7XG4gICAgICBzaWduYWw6IGNvbnRyb2xsZXIuc2lnbmFsLFxuICAgICAgaGVhZGVyczogVE1EQl9BQ0NFU1NfVE9LRU5cbiAgICAgICAgPyB7IEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtUTURCX0FDQ0VTU19UT0tFTn1gIH1cbiAgICAgICAgOiB7fSxcbiAgICB9KTtcblxuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIGNvbnNvbGUud2FybihgW21lZGlhZnVzaW9uXSBUTURCIGV4dGVybmFsX2lkcyAke3Jlc3BvbnNlLnN0YXR1c30gZm9yICR7dG1kYklkfWApO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcbiAgICBjb25zdCBpbWRiSWQgPSBkYXRhPy5pbWRiX2lkIHx8IG51bGw7XG5cbiAgICBpZiAoaW1kYklkKSB7XG4gICAgICBpbWRiQ2FjaGUuc2V0KGNhY2hlS2V5LCB7IGltZGJJZCwgYXQ6IERhdGUubm93KCkgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGltZGJJZDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3I/Lm5hbWUgIT09IFwiQWJvcnRFcnJvclwiKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJbbWVkaWFmdXNpb25dIFRNREIgbG9va3VwIGVycm9yOlwiLCBlcnJvcj8ubWVzc2FnZSB8fCBlcnJvcik7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9IGZpbmFsbHkge1xuICAgIGNsZWFyVGltZW91dCh0aW1lcik7XG4gIH1cbn07XG5cbi8qKlxuICogRmV0Y2ggc3RyZWFtcyBmcm9tIGEgTWVkaWFGdXNpb24gaW5zdGFuY2UgZm9yIHRoZSBnaXZlbiBJTURiIElELlxuICogUmV0dXJucyB0aGUgcmF3IHN0cmVhbXMgYXJyYXkgZnJvbSB0aGUgU3RyZW1pbyBhZGRvbiByZXNwb25zZS5cbiAqL1xuY29uc3QgZmV0Y2hNZWRpYWZ1c2lvblN0cmVhbXMgPSBhc3luYyAoaW1kYklkLCB0eXBlLCBzZWFzb24sIGVwaXNvZGUpID0+IHtcbiAgLy8gU3RyZW1pbyBhZGRvbiBwcm90b2NvbDogL3N0cmVhbS97dHlwZX0ve2lkfS5qc29uXG4gIC8vIEZvciBzZXJpZXM6IC9zdHJlYW0vc2VyaWVzL3tpbWRiSWR9OntzZWFzb259OntlcGlzb2RlfS5qc29uXG4gIGNvbnN0IG1lZGlhVHlwZSA9IHR5cGUgPT09IFwidHZcIiB8fCB0eXBlID09PSBcInNlcmllc1wiID8gXCJzZXJpZXNcIiA6IFwibW92aWVcIjtcblxuICBsZXQgc3RyZWFtUGF0aDtcbiAgaWYgKG1lZGlhVHlwZSA9PT0gXCJzZXJpZXNcIikge1xuICAgIHN0cmVhbVBhdGggPSBgc3RyZWFtL3Nlcmllcy8ke2ltZGJJZH06JHtzZWFzb259OiR7ZXBpc29kZX0uanNvbmA7XG4gIH0gZWxzZSB7XG4gICAgc3RyZWFtUGF0aCA9IGBzdHJlYW0vbW92aWUvJHtpbWRiSWR9Lmpzb25gO1xuICB9XG5cbiAgY29uc3QgYXBpVXJsID0gYCR7TUVESUFGVVNJT05fQkFTRX0vJHtzdHJlYW1QYXRofWA7XG5cbiAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IGNvbnRyb2xsZXIuYWJvcnQoKSwgTUVESUFGVVNJT05fVElNRU9VVF9NUyk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGFwaVVybCwge1xuICAgICAgc2lnbmFsOiBjb250cm9sbGVyLnNpZ25hbCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgXCJVc2VyLUFnZW50XCI6IFwiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEyNS4wLjAuMCBTYWZhcmkvNTM3LjM2XCIsXG4gICAgICAgIFwiQWNjZXB0XCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIGNvbnNvbGUud2FybihgW21lZGlhZnVzaW9uXSAke3Jlc3BvbnNlLnN0YXR1c306ICR7YXBpVXJsfWApO1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoZGF0YT8uc3RyZWFtcykgPyBkYXRhLnN0cmVhbXMgOiBbXTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3I/Lm5hbWUgIT09IFwiQWJvcnRFcnJvclwiKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJbbWVkaWFmdXNpb25dIGZldGNoIGVycm9yOlwiLCBlcnJvcj8ubWVzc2FnZSB8fCBlcnJvcik7XG4gICAgfVxuICAgIHJldHVybiBbXTtcbiAgfSBmaW5hbGx5IHtcbiAgICBjbGVhclRpbWVvdXQodGltZXIpO1xuICB9XG59O1xuXG4vKipcbiAqIE5vcm1hbGl6ZSBhIHJhdyBNZWRpYUZ1c2lvbiBzdHJlYW0gb2JqZWN0IGludG8gdGhlIGZvcm1hdCBvdXIgcGxheWVyIGV4cGVjdHMuXG4gKiBGaWx0ZXJzIG91dCBzdHJlYW1zIHRoYXQgZG9uJ3QgaGF2ZSBhIGRpcmVjdCBwbGF5YWJsZSBVUkwuXG4gKi9cbmNvbnN0IG5vcm1hbGl6ZVN0cmVhbSA9IChyYXcpID0+IHtcbiAgLy8gTWVkaWFGdXNpb24gc3RyZWFtcyBjYW4gaGF2ZTpcbiAgLy8gICAtIHVybDogZGlyZWN0IG0zdTgvbXA0IFVSTCAocGxheWFibGUpXG4gIC8vICAgLSBpbmZvSGFzaDogdG9ycmVudCBoYXNoIChOT1QgYnJvd3Nlci1wbGF5YWJsZSlcbiAgLy8gICAtIGJlaGF2aW9ySGludHM6IHsgbm90V2ViUmVhZHk6IHRydWUgfSBmb3Igbm9uLXdlYiBzdHJlYW1zXG4gIC8vXG4gIC8vIFdlIG9ubHkgcmV0dXJuIHN0cmVhbXMgdGhhdCBoYXZlIGEgZGlyZWN0IFVSTCBhbmQgYXJlIHdlYi1yZWFkeS5cbiAgaWYgKCFyYXc/LnVybCkgcmV0dXJuIG51bGw7XG4gIGlmIChyYXcuYmVoYXZpb3JIaW50cz8ubm90V2ViUmVhZHkpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGlzSGxzID0gL1xcLm0zdTgoXFw/fCQpL2kudGVzdChyYXcudXJsKTtcbiAgY29uc3QgaXNNcDQgPSAvXFwubXA0KFxcP3wkKS9pLnRlc3QocmF3LnVybCk7XG5cbiAgcmV0dXJuIHtcbiAgICB1cmw6IHJhdy51cmwsXG4gICAgbmFtZTogYE1lZGlhRnVzaW9uJHtyYXcubmFtZSA/IGAgXHUwMEI3ICR7cmF3Lm5hbWV9YCA6IFwiXCJ9YCxcbiAgICB0aXRsZTogcmF3LnRpdGxlIHx8IGBNZWRpYUZ1c2lvbiBzdHJlYW0gXHUwMEI3ICR7aXNIbHMgPyBcIkhMU1wiIDogaXNNcDQgPyBcIk1QNFwiIDogXCJEaXJlY3RcIn1gLFxuICAgIGJlaGF2aW9ySGludHM6IHt9LFxuICAgIGlzSGxzLFxuICAgIHNvdXJjZTogXCJtZWRpYWZ1c2lvblwiLFxuICB9O1xufTtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gbWVkaWFmdXNpb25QbHVnaW4oKSB7XG4gIHJldHVybiB7XG4gICAgbmFtZTogXCJtZWRpYWZ1c2lvbi1wbHVnaW5cIixcbiAgICBjb25maWd1cmVTZXJ2ZXIoc2VydmVyKSB7XG4gICAgICBzZXJ2ZXIubWlkZGxld2FyZXMudXNlKFwiL2FwaS9tZWRpYWZ1c2lvbi9zdHJlYW1cIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXEudXJsLCBcImh0dHA6Ly9sb2NhbGhvc3RcIik7XG4gICAgICAgICAgY29uc3QgdG1kYklkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJ0bWRiSWRcIik7XG4gICAgICAgICAgY29uc3QgdHlwZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwidHlwZVwiKSB8fCBcIm1vdmllXCI7XG4gICAgICAgICAgY29uc3Qgc2Vhc29uID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZWFzb25cIik7XG4gICAgICAgICAgY29uc3QgZXBpc29kZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiZXBpc29kZVwiKTtcblxuICAgICAgICAgIGlmICghdG1kYklkKSB7XG4gICAgICAgICAgICBzZW5kSnNvbihyZXMsIDQwMCwgeyBlcnJvcjogXCJNaXNzaW5nIHJlcXVpcmVkIHBhcmFtZXRlcjogdG1kYklkXCIsIHN0cmVhbXM6IFtdIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgodHlwZSA9PT0gXCJ0dlwiIHx8IHR5cGUgPT09IFwic2VyaWVzXCIpICYmICghc2Vhc29uIHx8ICFlcGlzb2RlKSkge1xuICAgICAgICAgICAgc2VuZEpzb24ocmVzLCA0MDAsIHsgZXJyb3I6IFwiU2Vhc29uIGFuZCBlcGlzb2RlIGFyZSByZXF1aXJlZCBmb3IgVFYgc2hvd3NcIiwgc3RyZWFtczogW10gfSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gU3RlcCAxOiBDb252ZXJ0IFRNREIgSUQgXHUyMTkyIElNRGIgSURcbiAgICAgICAgICBjb25zdCBpbWRiSWQgPSBhd2FpdCB0bWRiVG9JbWRiKHRtZGJJZCwgdHlwZSk7XG4gICAgICAgICAgaWYgKCFpbWRiSWQpIHtcbiAgICAgICAgICAgIHNlbmRKc29uKHJlcywgMjAwLCB7XG4gICAgICAgICAgICAgIHN0cmVhbXM6IFtdLFxuICAgICAgICAgICAgICBtZXNzYWdlOiBcIkNvdWxkIG5vdCByZXNvbHZlIFRNREIgSUQgdG8gSU1EYiBJRCAoVE1EQiBjcmVkZW50aWFscyBtYXkgYmUgbWlzc2luZylcIixcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFN0ZXAgMjogRmV0Y2ggc3RyZWFtcyBmcm9tIE1lZGlhRnVzaW9uXG4gICAgICAgICAgY29uc3QgcmF3U3RyZWFtcyA9IGF3YWl0IGZldGNoTWVkaWFmdXNpb25TdHJlYW1zKGltZGJJZCwgdHlwZSwgc2Vhc29uLCBlcGlzb2RlKTtcblxuICAgICAgICAgIC8vIFN0ZXAgMzogTm9ybWFsaXplIGFuZCBmaWx0ZXIgZm9yIGJyb3dzZXItcGxheWFibGUgc3RyZWFtc1xuICAgICAgICAgIGNvbnN0IHN0cmVhbXMgPSByYXdTdHJlYW1zXG4gICAgICAgICAgICAubWFwKG5vcm1hbGl6ZVN0cmVhbSlcbiAgICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG5cbiAgICAgICAgICBzZW5kSnNvbihyZXMsIDIwMCwgeyBzdHJlYW1zIH0pO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUud2FybihcIlttZWRpYWZ1c2lvbi1wbHVnaW5dIGVycm9yOlwiLCBlcnJvcj8ubWVzc2FnZSB8fCBlcnJvcik7XG4gICAgICAgICAgc2VuZEpzb24ocmVzLCA1MDIsIHsgZXJyb3I6IGVycm9yPy5tZXNzYWdlIHx8IFwiTWVkaWFGdXNpb24gcHJveHkgZmFpbGVkXCIsIHN0cmVhbXM6IFtdIH0pO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgLy8gSGVhbHRoIGNoZWNrXG4gICAgICBzZXJ2ZXIubWlkZGxld2FyZXMudXNlKFwiL2FwaS9tZWRpYWZ1c2lvbi9oZWFsdGhcIiwgKF9yZXEsIHJlcykgPT4ge1xuICAgICAgICBzZW5kSnNvbihyZXMsIDIwMCwge1xuICAgICAgICAgIG9rOiB0cnVlLFxuICAgICAgICAgIHBsdWdpbjogXCJtZWRpYWZ1c2lvblwiLFxuICAgICAgICAgIGluc3RhbmNlOiBNRURJQUZVU0lPTl9CQVNFLFxuICAgICAgICAgIGhhc1RtZGJDcmVkZW50aWFsczogQm9vbGVhbihUTURCX0FDQ0VTU19UT0tFTiB8fCBUTURCX0FQSV9LRVkpLFxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0sXG4gIH07XG59XG4iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiVjpcXFxcQW50Z3Jhdml0eVxcXFx3ZWJzdHJlYW1lclxcXFx2aXRlXFxcXHRvcnJlbnRpby1wbHVnaW4uanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1Y6L0FudGdyYXZpdHkvd2Vic3RyZWFtZXIvdml0ZS90b3JyZW50aW8tcGx1Z2luLmpzXCI7Ly8gdml0ZS90b3JyZW50aW8tcGx1Z2luLmpzXG4vLyBTZXJ2ZXItc2lkZSBWaXRlIHBsdWdpbiB0aGF0IHByb3hpZXMgcmVxdWVzdHMgdG8gdGhlIHB1YmxpYyBUb3JyZW50aW9cbi8vIFN0cmVtaW8gYWRkb24gKGh0dHBzOi8vdG9ycmVudGlvLnN0cmVtLmZ1bi8gYnkgZGVmYXVsdCkgYW5kIHJldHVybnNcbi8vIHRvcnJlbnQgc3RyZWFtcy4gVGhlIGRlZmF1bHQgYmFzZSBjYW4gYmUgb3ZlcnJpZGRlbiB2aWFcbi8vIFZJVEVfVE9SUkVOVElPX1VSTCBmb3Igc2VsZi1ob3N0ZWQgb3IgcmVnaW9uYWwgbWlycm9ycy5cbi8vXG4vLyBUb3JyZW50aW8gZm9sbG93cyB0aGUgU3RyZW1pbyBhZGRvbiBwcm90b2NvbCBidXQgdXNlcyBJTURiIElEcyB3aGlsZSB0aGlzXG4vLyBwcm9qZWN0IHN0b3JlcyBUTURCIElEcywgc28gdGhlIHBsdWdpbiBjb252ZXJ0cyBUTURCIFx1MjE5MiBJTURiIHZpYSB0aGUgVE1EQlxuLy8gZXh0ZXJuYWxfaWRzIGVuZHBvaW50IGJlZm9yZSBxdWVyeWluZyBUb3JyZW50aW8uXG4vL1xuLy8gQVBJOlxuLy8gICBHRVQgL2FwaS90b3JyZW50aW8vc3RyZWFtP3RtZGJJZD17aWR9JnR5cGU9bW92aWVcbi8vICAgR0VUIC9hcGkvdG9ycmVudGlvL3N0cmVhbT90bWRiSWQ9e2lkfSZ0eXBlPXR2JnNlYXNvbj17c30mZXBpc29kZT17ZX1cbi8vXG4vLyBSZXNwb25zZTogeyBzdHJlYW1zOiBbeyB1cmwsIG5hbWUsIHRpdGxlLCBpc01hZ25ldCwgcXVhbGl0eSwgc2l6ZSwgc291cmNlIH1dIH1cbi8vXG4vLyBFYWNoIHN0cmVhbSBpcyBhIG1hZ25ldCBsaW5rIChub3QgZGlyZWN0bHkgYnJvd3Nlci1wbGF5YWJsZSkuIFRoZSBSZWFjdFxuLy8gYXBwIHN1cmZhY2VzIHRoZXNlIGluIHRoZSBcIlRvcnJlbnRpb1wiIHRhYiBhbmQgcm91dGVzIHNlbGVjdGlvbiB0aHJvdWdoIHRoZVxuLy8gZXh0ZXJuYWwtcGxheWVyIGZsb3cgKFZMQywgZXRjLikgdmlhIEV4dGVybmFsUGxheWVyTWVudS5cblxuY29uc3QgVE9SUkVOVElPX0JBU0UgPSBwcm9jZXNzLmVudi5WSVRFX1RPUlJFTlRJT19VUkwgfHwgXCJodHRwczovL3RvcnJlbnRpby5zdHJlbS5mdW5cIjtcbmNvbnN0IFRPUlJFTlRJT19USU1FT1VUX01TID0gMThfMDAwO1xuY29uc3QgVE1EQl9USU1FT1VUX01TID0gOF8wMDA7XG5cbmNvbnN0IFRNREJfQUNDRVNTX1RPS0VOID0gcHJvY2Vzcy5lbnYuVklURV9UTURCX0FDQ0VTU19UT0tFTjtcbmNvbnN0IFRNREJfQVBJX0tFWSA9IHByb2Nlc3MuZW52LlZJVEVfVE1EQl9BUElfS0VZO1xuXG5jb25zdCBpbWRiQ2FjaGUgPSBuZXcgTWFwKCk7XG5jb25zdCBJTURCX0NBQ0hFX1RUTF9NUyA9IDI0ICogNjAgKiA2MCAqIDEwMDA7IC8vIDI0IGhvdXJzXG5cbmNvbnN0IHNlbmRKc29uID0gKHJlcywgc3RhdHVzLCBwYXlsb2FkKSA9PiB7XG4gIHJlcy5zdGF0dXNDb2RlID0gc3RhdHVzO1xuICByZXMuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOFwiKTtcbiAgcmVzLnNldEhlYWRlcihcIkNhY2hlLUNvbnRyb2xcIiwgXCJuby1zdG9yZVwiKTtcbiAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShwYXlsb2FkKSk7XG59O1xuXG5jb25zdCB0bWRiVG9JbWRiID0gYXN5bmMgKHRtZGJJZCwgdHlwZSkgPT4ge1xuICBjb25zdCBjYWNoZUtleSA9IGAke3R5cGV9OiR7dG1kYklkfWA7XG4gIGNvbnN0IGNhY2hlZCA9IGltZGJDYWNoZS5nZXQoY2FjaGVLZXkpO1xuICBpZiAoY2FjaGVkICYmIERhdGUubm93KCkgLSBjYWNoZWQuYXQgPCBJTURCX0NBQ0hFX1RUTF9NUykge1xuICAgIHJldHVybiBjYWNoZWQuaW1kYklkO1xuICB9XG5cbiAgaWYgKCFUTURCX0FDQ0VTU19UT0tFTiAmJiAhVE1EQl9BUElfS0VZKSB7XG4gICAgY29uc29sZS53YXJuKFwiW3RvcnJlbnRpb10gTm8gVE1EQiBjcmVkZW50aWFscyBcdTIwMTQgY2Fubm90IHJlc29sdmUgSU1EYiBJRFwiKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IG1lZGlhVHlwZSA9IHR5cGUgPT09IFwidHZcIiB8fCB0eXBlID09PSBcInNlcmllc1wiID8gXCJ0dlwiIDogXCJtb3ZpZVwiO1xuICBjb25zdCB1cmwgPSBuZXcgVVJMKGBodHRwczovL2FwaS50aGVtb3ZpZWRiLm9yZy8zLyR7bWVkaWFUeXBlfS8ke3RtZGJJZH0vZXh0ZXJuYWxfaWRzYCk7XG4gIGlmIChUTURCX0FQSV9LRVkgJiYgIVRNREJfQUNDRVNTX1RPS0VOKSB7XG4gICAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoXCJhcGlfa2V5XCIsIFRNREJfQVBJX0tFWSk7XG4gIH1cblxuICBjb25zdCBjb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4gY29udHJvbGxlci5hYm9ydCgpLCBUTURCX1RJTUVPVVRfTVMpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwudG9TdHJpbmcoKSwge1xuICAgICAgc2lnbmFsOiBjb250cm9sbGVyLnNpZ25hbCxcbiAgICAgIGhlYWRlcnM6IFRNREJfQUNDRVNTX1RPS0VOXG4gICAgICAgID8geyBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7VE1EQl9BQ0NFU1NfVE9LRU59YCB9XG4gICAgICAgIDoge30sXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICBjb25zb2xlLndhcm4oYFt0b3JyZW50aW9dIFRNREIgZXh0ZXJuYWxfaWRzICR7cmVzcG9uc2Uuc3RhdHVzfSBmb3IgJHt0bWRiSWR9YCk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzcG9uc2UuanNvbigpO1xuICAgIGNvbnN0IGltZGJJZCA9IGRhdGE/LmltZGJfaWQgfHwgbnVsbDtcblxuICAgIGlmIChpbWRiSWQpIHtcbiAgICAgIGltZGJDYWNoZS5zZXQoY2FjaGVLZXksIHsgaW1kYklkLCBhdDogRGF0ZS5ub3coKSB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gaW1kYklkO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChlcnJvcj8ubmFtZSAhPT0gXCJBYm9ydEVycm9yXCIpIHtcbiAgICAgIGNvbnNvbGUud2FybihcIlt0b3JyZW50aW9dIFRNREIgbG9va3VwIGVycm9yOlwiLCBlcnJvcj8ubWVzc2FnZSB8fCBlcnJvcik7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9IGZpbmFsbHkge1xuICAgIGNsZWFyVGltZW91dCh0aW1lcik7XG4gIH1cbn07XG5cbmNvbnN0IGJ1aWxkTWFnbmV0ID0gKHJhdykgPT4ge1xuICBpZiAoIXJhdz8uaW5mb0hhc2gpIHJldHVybiBudWxsO1xuICBjb25zdCB0cmFja2VycyA9IFtcbiAgICBcInVkcDovL3RyYWNrZXIub3BlbnRyYWNrci5vcmc6MTMzNy9hbm5vdW5jZVwiLFxuICAgIFwidWRwOi8vdHJhY2tlci5vcGVuYml0dG9ycmVudC5jb206Njk2OS9hbm5vdW5jZVwiLFxuICAgIFwidWRwOi8vOS5yYXJiZy5jb206MjgxMC9hbm5vdW5jZVwiLFxuICAgIFwidWRwOi8vdHJhY2tlci50b3JyZW50LmV1Lm9yZzo0NTEvYW5ub3VuY2VcIixcbiAgICBcInVkcDovL2V4b2R1cy5kZXN5bmMuY29tOjY5NjkvYW5ub3VuY2VcIixcbiAgICBcInVkcDovL29wZW4uc3RlYWx0aC5zaTo4MC9hbm5vdW5jZVwiXG4gIF07XG5cbiAgY29uc3QgcGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcygpO1xuICBwYXJhbXMuc2V0KFwieHRcIiwgYHVybjpidGloOiR7cmF3LmluZm9IYXNofWApO1xuICBjb25zdCBkaXNwbGF5TmFtZSA9IHJhdy50aXRsZSB8fCByYXcubmFtZSB8fCBcIlRvcnJlbnRcIjtcbiAgcGFyYW1zLnNldChcImRuXCIsIGRpc3BsYXlOYW1lKTtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3LnNvdXJjZXMpKSB7XG4gICAgZm9yIChjb25zdCB0cmFja2VyIG9mIHJhdy5zb3VyY2VzKSBwYXJhbXMuYXBwZW5kKFwidHJcIiwgdHJhY2tlcik7XG4gIH1cbiAgZm9yIChjb25zdCBmYWxsYmFjayBvZiB0cmFja2VycykgcGFyYW1zLmFwcGVuZChcInRyXCIsIGZhbGxiYWNrKTtcbiAgaWYgKHJhdy5maWxlSWR4ICE9PSB1bmRlZmluZWQgJiYgcmF3LmZpbGVJZHggIT09IG51bGwpIHtcbiAgICBwYXJhbXMuc2V0KFwic29cIiwgU3RyaW5nKHJhdy5maWxlSWR4KSk7XG4gIH1cblxuICByZXR1cm4gYG1hZ25ldDo/JHtwYXJhbXMudG9TdHJpbmcoKX1gO1xufTtcblxuY29uc3QgcGFyc2VTaXplID0gKHNpemVUZXh0KSA9PiB7XG4gIGlmICghc2l6ZVRleHQpIHJldHVybiBudWxsO1xuICBjb25zdCBtYXRjaCA9IFN0cmluZyhzaXplVGV4dCkubWF0Y2goLyhbXFxkLl0rKVxccyooR0J8TUJ8S0J8VEIpL2kpO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIGAke21hdGNoWzFdfSAke21hdGNoWzJdLnRvVXBwZXJDYXNlKCl9YDtcbn07XG5cbi8vIFJlamVjdCBcImNvbmZpZ3VyZS9zZXR1cFwiIHN0cmVhbSBlbnRyaWVzLiBUaGUgdXBzdHJlYW0gVG9ycmVudGlvIGFkZG9uXG4vLyBvY2Nhc2lvbmFsbHkgcmV0dXJucyBzdHJlYW0gb2JqZWN0cyB3aG9zZSBgdXJsYCwgYG5hbWVgLCBvciBgdGl0bGVgIHBvaW50XG4vLyBhdCB0aGUgcHVibGljIHNldHVwIHBhZ2UgKHRvcnJlbnRpby5vcmcvc2V0dXAvLi4uKSBvciBhdCBpdHMgb3duIGFkZG9uXG4vLyBkb21haW5zLiBUaG9zZSBhcmUgbm90IHJlYWwgdG9ycmVudHMgXHUyMDE0IHRoZXkgYXJlIGNvbmZpZ3VyYXRpb24gcG9pbnRlcnNcbi8vIHRoYXQgd291bGQgbmV2ZXIgcGxheS4gV2UgZHJvcCB0aGUgZW50aXJlIHN0cmVhbSBpZiBhbnkgZmllbGQgY29udGFpbnMgYVxuLy8gVG9ycmVudGlvIGRvbWFpbiBvciBhIHNldHVwL2NvbmZpZ3VyZSBwYXRoLiBVUkwgZmllbGRzIGFyZSBjaGVja2VkIG1vcmVcbi8vIGFnZ3Jlc3NpdmVseSB0aGFuIHRleHQgZmllbGRzIGJlY2F1c2UgcmVhbCB0b3JyZW50IHRpdGxlcyBjYW4gY29pbmNpZGVudGFsbHlcbi8vIGNvbnRhaW4gdGhlIHN1YnN0cmluZyBcIm1hbmlmZXN0XCIgKGUuZy4gYSBkb2N1bWVudGFyeSBuYW1lZCBcIk1hbmlmZXN0Lmpzb25cIikuXG5leHBvcnQgY29uc3QgU0VUVVBfVVJMX1BBVFRFUk4gPSAvKHRvcnJlbnRpb1xcLm9yZ3x0b3JyZW50aW9cXC5zdHJlbVxcLmlvfHRvcnJlbnRpb1xcLnN0cmVtXFwuZnVuKS9pO1xuZXhwb3J0IGNvbnN0IFVSTF9QQVRIX1BBVFRFUk4gPSAvKFxcL3NldHVwfFxcL21hbmlmZXN0XFwuanNvbnxcXC9jb25maWd1cmUpL2k7XG5leHBvcnQgY29uc3QgVEVYVF9QQVRIX1BBVFRFUk4gPSAvKFxcL3NldHVwfFxcL2NvbmZpZ3VyZSkvaTtcblxuZXhwb3J0IGNvbnN0IGlzU2V0dXBPckNvbmZpZ1N0cmVhbSA9IChyYXcpID0+IHtcbiAgaWYgKCFyYXcpIHJldHVybiBmYWxzZTtcblxuICAvLyBVUkwtc2hhcGVkIGZpZWxkcyAocmF3LnVybCwgYmVoYXZpb3JIaW50cy5jb25maWd1cmFibGUpOiBmdWxsIHBhdGggY2hlY2tcbiAgZm9yIChjb25zdCB2YWx1ZSBvZiBbcmF3LnVybCwgcmF3LmJlaGF2aW9ySGludHM/LmNvbmZpZ3VyYWJsZV0pIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSBjb250aW51ZTtcbiAgICBpZiAoU0VUVVBfVVJMX1BBVFRFUk4udGVzdCh2YWx1ZSkpIHJldHVybiB0cnVlO1xuICAgIGlmIChVUkxfUEFUSF9QQVRURVJOLnRlc3QodmFsdWUpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIFRleHQgZmllbGRzIChyYXcubmFtZSwgcmF3LnRpdGxlKTogbmFycm93ZXIgY2hlY2ssIG5vIC9tYW5pZmVzdC5qc29uXG4gIGZvciAoY29uc3QgdmFsdWUgb2YgW3Jhdy5uYW1lLCByYXcudGl0bGVdKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgY29udGludWU7XG4gICAgaWYgKFNFVFVQX1VSTF9QQVRURVJOLnRlc3QodmFsdWUpKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoVEVYVF9QQVRIX1BBVFRFUk4udGVzdCh2YWx1ZSkpIHJldHVybiB0cnVlO1xuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuLy8gU3RyaXAgZW1iZWRkZWQgVVJMcyBmcm9tIGEgaHVtYW4tcmVhZGFibGUgc3RyaW5nIHNvIHRoZSBwaWNrZXIgZG9lc24ndFxuLy8gc3VyZmFjZSBjb25maWd1cmF0aW9uIHBhZ2VzIGFzIHBhcnQgb2YgYSB0b3JyZW50J3MgdGl0bGUuIEtlZXBzIHRoZVxuLy8gc3Vycm91bmRpbmcgdGV4dCBpbnRhY3QuXG5leHBvcnQgY29uc3Qgc3RyaXBFbWJlZGRlZFVybHMgPSAodmFsdWUpID0+IHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiB8fCAhdmFsdWUpIHJldHVybiB2YWx1ZTtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnJlcGxhY2UoL2h0dHBzPzpcXC9cXC9cXFMrL2dpLCBcIlwiKVxuICAgIC5yZXBsYWNlKC9cXHN7Mix9L2csIFwiIFwiKVxuICAgIC50cmltKCk7XG59O1xuXG5jb25zdCBub3JtYWxpemVTdHJlYW0gPSAocmF3KSA9PiB7XG4gIGlmIChpc1NldHVwT3JDb25maWdTdHJlYW0ocmF3KSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG1hZ25ldCA9IGJ1aWxkTWFnbmV0KHJhdyk7XG4gIGlmICghbWFnbmV0KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBmaXJzdExpbmUgPSBzdHJpcEVtYmVkZGVkVXJscygocmF3Lm5hbWUgfHwgXCJUb3JyZW50aW9cIikuc3BsaXQoXCJcXG5cIilbMF0udHJpbSgpKSB8fCBcIlRvcnJlbnRpb1wiO1xuICBjb25zdCBjbGVhbmVkVGl0bGUgPSBzdHJpcEVtYmVkZGVkVXJscyhyYXcudGl0bGUgfHwgXCJcIik7XG4gIGNvbnN0IHNpemUgPSBwYXJzZVNpemUocmF3LnRpdGxlIHx8IFwiXCIpO1xuICBjb25zdCBxdWFsaXR5TWF0Y2ggPSAocmF3LnRpdGxlIHx8IFwiXCIpLm1hdGNoKC9cXGIoMjE2MHB8MTA4MHB8NzIwcHw0ODBwfDRLKVxcYi9pKTtcbiAgY29uc3QgcXVhbGl0eSA9IHF1YWxpdHlNYXRjaCA/IHF1YWxpdHlNYXRjaFsxXS50b1VwcGVyQ2FzZSgpIDogbnVsbDtcblxuICByZXR1cm4ge1xuICAgIHVybDogbWFnbmV0LFxuICAgIG5hbWU6IGBUb3JyZW50aW8gXHUwMEI3ICR7Zmlyc3RMaW5lfWAsXG4gICAgdGl0bGU6IGNsZWFuZWRUaXRsZSB8fCBgTWFnbmV0IHN0cmVhbSBcdTAwQjcgJHtyYXcuaW5mb0hhc2guc2xpY2UoMCwgOCl9YCxcbiAgICBiZWhhdmlvckhpbnRzOiByYXcuYmVoYXZpb3JIaW50cyB8fCB7fSxcbiAgICBpc01hZ25ldDogdHJ1ZSxcbiAgICBpc0hsczogZmFsc2UsXG4gICAgcXVhbGl0eSxcbiAgICBzaXplLFxuICAgIHNvdXJjZTogXCJ0b3JyZW50aW9cIlxuICB9O1xufTtcblxuY29uc3QgZmV0Y2hUb3JyZW50aW9TdHJlYW1zID0gYXN5bmMgKGltZGJJZCwgdHlwZSwgc2Vhc29uLCBlcGlzb2RlKSA9PiB7XG4gIGNvbnN0IG1lZGlhVHlwZSA9IHR5cGUgPT09IFwidHZcIiB8fCB0eXBlID09PSBcInNlcmllc1wiID8gXCJzZXJpZXNcIiA6IFwibW92aWVcIjtcbiAgY29uc3Qgc3RyZWFtUGF0aCA9IG1lZGlhVHlwZSA9PT0gXCJzZXJpZXNcIlxuICAgID8gYHN0cmVhbS9zZXJpZXMvJHtpbWRiSWR9OiR7c2Vhc29ufToke2VwaXNvZGV9Lmpzb25gXG4gICAgOiBgc3RyZWFtL21vdmllLyR7aW1kYklkfS5qc29uYDtcblxuICBjb25zdCBhcGlVcmwgPSBgJHtUT1JSRU5USU9fQkFTRX0vJHtzdHJlYW1QYXRofWA7XG5cbiAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IGNvbnRyb2xsZXIuYWJvcnQoKSwgVE9SUkVOVElPX1RJTUVPVVRfTVMpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChhcGlVcmwsIHtcbiAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIFwiVXNlci1BZ2VudFwiOiBcIk1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xMjUuMC4wLjAgU2FmYXJpLzUzNy4zNlwiLFxuICAgICAgICBcIkFjY2VwdFwiOiBcImFwcGxpY2F0aW9uL2pzb25cIlxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgY29uc29sZS53YXJuKGBbdG9ycmVudGlvXSAke3Jlc3BvbnNlLnN0YXR1c306ICR7YXBpVXJsfWApO1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoZGF0YT8uc3RyZWFtcykgPyBkYXRhLnN0cmVhbXMgOiBbXTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3I/Lm5hbWUgIT09IFwiQWJvcnRFcnJvclwiKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJbdG9ycmVudGlvXSBmZXRjaCBlcnJvcjpcIiwgZXJyb3I/Lm1lc3NhZ2UgfHwgZXJyb3IpO1xuICAgIH1cbiAgICByZXR1cm4gW107XG4gIH0gZmluYWxseSB7XG4gICAgY2xlYXJUaW1lb3V0KHRpbWVyKTtcbiAgfVxufTtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gdG9ycmVudGlvUGx1Z2luKCkge1xuICByZXR1cm4ge1xuICAgIG5hbWU6IFwidG9ycmVudGlvLXBsdWdpblwiLFxuICAgIGNvbmZpZ3VyZVNlcnZlcihzZXJ2ZXIpIHtcbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoXCIvYXBpL3RvcnJlbnRpby9zdHJlYW1cIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXEudXJsLCBcImh0dHA6Ly9sb2NhbGhvc3RcIik7XG4gICAgICAgICAgY29uc3QgdG1kYklkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJ0bWRiSWRcIik7XG4gICAgICAgICAgY29uc3QgdHlwZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwidHlwZVwiKSB8fCBcIm1vdmllXCI7XG4gICAgICAgICAgY29uc3Qgc2Vhc29uID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZWFzb25cIik7XG4gICAgICAgICAgY29uc3QgZXBpc29kZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiZXBpc29kZVwiKTtcblxuICAgICAgICAgIGlmICghdG1kYklkKSB7XG4gICAgICAgICAgICBzZW5kSnNvbihyZXMsIDQwMCwgeyBlcnJvcjogXCJNaXNzaW5nIHJlcXVpcmVkIHBhcmFtZXRlcjogdG1kYklkXCIsIHN0cmVhbXM6IFtdIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgodHlwZSA9PT0gXCJ0dlwiIHx8IHR5cGUgPT09IFwic2VyaWVzXCIpICYmICghc2Vhc29uIHx8ICFlcGlzb2RlKSkge1xuICAgICAgICAgICAgc2VuZEpzb24ocmVzLCA0MDAsIHsgZXJyb3I6IFwiU2Vhc29uIGFuZCBlcGlzb2RlIGFyZSByZXF1aXJlZCBmb3IgVFYgc2hvd3NcIiwgc3RyZWFtczogW10gfSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgaW1kYklkID0gYXdhaXQgdG1kYlRvSW1kYih0bWRiSWQsIHR5cGUpO1xuICAgICAgICAgIGlmICghaW1kYklkKSB7XG4gICAgICAgICAgICBzZW5kSnNvbihyZXMsIDIwMCwge1xuICAgICAgICAgICAgICBzdHJlYW1zOiBbXSxcbiAgICAgICAgICAgICAgbWVzc2FnZTogXCJDb3VsZCBub3QgcmVzb2x2ZSBUTURCIElEIHRvIElNRGIgSUQgKFRNREIgY3JlZGVudGlhbHMgbWF5IGJlIG1pc3NpbmcpXCJcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHJhd1N0cmVhbXMgPSBhd2FpdCBmZXRjaFRvcnJlbnRpb1N0cmVhbXMoaW1kYklkLCB0eXBlLCBzZWFzb24sIGVwaXNvZGUpO1xuICAgICAgICAgIGNvbnN0IHN0cmVhbXMgPSByYXdTdHJlYW1zLm1hcChub3JtYWxpemVTdHJlYW0pLmZpbHRlcihCb29sZWFuKTtcblxuICAgICAgICAgIHNlbmRKc29uKHJlcywgMjAwLCB7IHN0cmVhbXMgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKFwiW3RvcnJlbnRpby1wbHVnaW5dIGVycm9yOlwiLCBlcnJvcj8ubWVzc2FnZSB8fCBlcnJvcik7XG4gICAgICAgICAgc2VuZEpzb24ocmVzLCA1MDIsIHsgZXJyb3I6IGVycm9yPy5tZXNzYWdlIHx8IFwiVG9ycmVudGlvIHByb3h5IGZhaWxlZFwiLCBzdHJlYW1zOiBbXSB9KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoXCIvYXBpL3RvcnJlbnRpby9oZWFsdGhcIiwgKF9yZXEsIHJlcykgPT4ge1xuICAgICAgICBzZW5kSnNvbihyZXMsIDIwMCwge1xuICAgICAgICAgIG9rOiB0cnVlLFxuICAgICAgICAgIHBsdWdpbjogXCJ0b3JyZW50aW9cIixcbiAgICAgICAgICBpbnN0YW5jZTogVE9SUkVOVElPX0JBU0UsXG4gICAgICAgICAgaGFzVG1kYkNyZWRlbnRpYWxzOiBCb29sZWFuKFRNREJfQUNDRVNTX1RPS0VOIHx8IFRNREJfQVBJX0tFWSlcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG59XG4iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiVjpcXFxcQW50Z3Jhdml0eVxcXFx3ZWJzdHJlYW1lclxcXFx2aXRlXFxcXGhscy1tYW5pZmVzdC5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVjovQW50Z3Jhdml0eS93ZWJzdHJlYW1lci92aXRlL2hscy1tYW5pZmVzdC5qc1wiOy8vIFB1cmUgTm9kZS5qcyBITFMgbWFuaWZlc3QgcGFyc2VyIGFuZCByZXdyaXRlci5cbi8vIC0gRmlsdGVycyB2YXJpYW50IHN0cmVhbXMgKCNFWFQtWC1TVFJFQU0tSU5GKSBieSBhdWRpbyBjb2RlYyBzdXBwb3J0XG4vLyAtIEZpbHRlcnMgYWx0ZXJuYXRpdmUgYXVkaW8gdHJhY2tzICgjRVhULVgtTUVESUEgd2l0aCBUWVBFPUFVRElPKSBieSBjb2RlY1xuLy8gLSBSZXdyaXRlcyBzZWdtZW50IFVSTHMgdG8gcG9pbnQgdGhyb3VnaCB0aGUgc2lkZWNhciBwcm94eVxuLy9cbi8vIE5vIGV4dGVybmFsIGRlcGVuZGVuY2llcyBcdTIwMTQgdXNlcyBvbmx5IE5vZGUuanMgYnVpbHQtaW5zLlxuXG5jb25zdCBVTlNVUFBPUlRFRF9BVURJT19DT0RFQ1MgPSBuZXcgU2V0KFtcImVjLTNcIiwgXCJhYy0zXCIsIFwiZHRzXCIsIFwidHJ1ZWhkXCJdKTtcblxuZnVuY3Rpb24gcGFyc2VDb2RlY3MoY29kZWNzU3RyKSB7XG4gIGlmICghY29kZWNzU3RyKSByZXR1cm4gW107XG4gIHJldHVybiBjb2RlY3NTdHIuc3BsaXQoXCIsXCIpLm1hcCgoYykgPT4gYy50cmltKCkpLmZpbHRlcihCb29sZWFuKTtcbn1cblxuZnVuY3Rpb24gY29kZWNzVG9LZWVwKGNvZGVjcykge1xuICByZXR1cm4gY29kZWNzLmZpbHRlcigoYykgPT4gIVVOU1VQUE9SVEVEX0FVRElPX0NPREVDUy5oYXMoYy50b0xvd2VyQ2FzZSgpKSk7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkQ29kZWNzQXR0cihrZWVwQ29kZWNzKSB7XG4gIHJldHVybiBrZWVwQ29kZWNzLmpvaW4oXCIsXCIpO1xufVxuXG5mdW5jdGlvbiBpc0F1ZGlvVHJhY2sobGluZSkge1xuICByZXR1cm4gbGluZS5pbmNsdWRlcyhcIiNFWFQtWC1NRURJQTpcIikgJiYgbGluZS5pbmNsdWRlcygnVFlQRT1cIkFVRElPXCInKTtcbn1cblxuZnVuY3Rpb24gaXNWYXJpYW50U3RyZWFtKGxpbmUpIHtcbiAgcmV0dXJuIGxpbmUuaW5jbHVkZXMoXCIjRVhULVgtU1RSRUFNLUlORjpcIik7XG59XG5cbmZ1bmN0aW9uIGdldEF0dHIobGluZSwgbmFtZSkge1xuICBjb25zdCByZSA9IG5ldyBSZWdFeHAoYCR7bmFtZX09XCIoW15cIl0qKVwiYCwgXCJpXCIpO1xuICBjb25zdCBtID0gbGluZS5tYXRjaChyZSk7XG4gIHJldHVybiBtID8gbVsxXSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RHcm91cElkKGxpbmUpIHtcbiAgcmV0dXJuIGdldEF0dHIobGluZSwgXCJHUk9VUC1JRFwiKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJld3JpdGVNYW5pZmVzdChtYW5pZmVzdFRleHQsIGJhc2VVcmwsIHByb3h5U2VnbWVudFVybCkge1xuICBjb25zdCBsaW5lcyA9IG1hbmlmZXN0VGV4dC5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBvdXQgPSBbXTtcblxuICAvLyBUcmFjayB3aGljaCBhdWRpbyBHUk9VUC1JRHMgd2UndmUgcmVtb3ZlZCBzbyB3ZSBjYW4gZHJvcCB0aGVtIGZyb20gdmFyaWFudCBzdHJlYW1zXG4gIGNvbnN0IHJlbW92ZWRBdWRpb0dyb3VwcyA9IG5ldyBTZXQoKTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2ldLnRyaW0oKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBWYXJpYW50IHN0cmVhbTogI0VYVC1YLVNUUkVBTS1JTkYgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gICAgaWYgKGlzVmFyaWFudFN0cmVhbShsaW5lKSkge1xuICAgICAgY29uc3QgY29kZWNzID0gZ2V0QXR0cihsaW5lLCBcIkNPREVDU1wiKTtcbiAgICAgIGlmIChjb2RlY3MpIHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VDb2RlY3MoY29kZWNzKTtcbiAgICAgICAgY29uc3Qga2VwdCA9IGNvZGVjc1RvS2VlcChwYXJzZWQpO1xuICAgICAgICBpZiAoa2VwdC5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAvLyBObyBzdXBwb3J0ZWQgY29kZWNzIFx1MjAxNCBza2lwIHRoaXMgZW50aXJlIHN0cmVhbSB2YXJpYW50XG4gICAgICAgICAgLy8gY29uc3VtZSB0aGUgbmV4dCBsaW5lIChVUkwpIGFuZCBjb250aW51ZVxuICAgICAgICAgIGkrKzsgLy8gc2tpcCB0aGUgVVJMIGxpbmVcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoa2VwdC5sZW5ndGggPCBwYXJzZWQubGVuZ3RoKSB7XG4gICAgICAgICAgLy8gUmVwbGFjZSBDT0RFQ1MgYXR0cmlidXRlIHdpdGggb25seSBzdXBwb3J0ZWQgY29kZWNzXG4gICAgICAgICAgY29uc3QgbmV3TGluZSA9IGxpbmUucmVwbGFjZSgvQ09ERUNTPVwiW15cIl0qXCIvLCBgQ09ERUNTPVwiJHtidWlsZENvZGVjc0F0dHIoa2VwdCl9XCJgKTtcbiAgICAgICAgICAvLyBBbHNvIHJlbW92ZSBBVURJTyBhdHRyaWJ1dGUgaWYgdGhhdCBncm91cCB3YXMgcmVtb3ZlZFxuICAgICAgICAgIGNvbnN0IGF1ZGlvR3JvdXAgPSBnZXRBdHRyKGxpbmUsIFwiQVVESU9cIik7XG4gICAgICAgICAgaWYgKGF1ZGlvR3JvdXAgJiYgcmVtb3ZlZEF1ZGlvR3JvdXBzLmhhcyhhdWRpb0dyb3VwKSkge1xuICAgICAgICAgICAgb3V0LnB1c2gobmV3TGluZS5yZXBsYWNlKC9cXHMrQVVESU89XCJbXlwiXSpcIi8sIFwiXCIpKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgb3V0LnB1c2gobmV3TGluZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIG91dC5wdXNoKGxpbmVzWysraV0udHJpbSgpKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgb3V0LnB1c2gobGluZSk7XG4gICAgICBvdXQucHVzaChsaW5lc1srK2ldLnRyaW0oKSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgQXVkaW8gdHJhY2s6ICNFWFQtWC1NRURJQSBUWVBFPUFVRElPIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICAgIGlmIChpc0F1ZGlvVHJhY2sobGluZSkpIHtcbiAgICAgIGNvbnN0IGNvZGVjcyA9IGdldEF0dHIobGluZSwgXCJDT0RFQ1NcIik7XG4gICAgICBpZiAoY29kZWNzKSB7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlQ29kZWNzKGNvZGVjcyk7XG4gICAgICAgIGNvbnN0IGtlcHQgPSBjb2RlY3NUb0tlZXAocGFyc2VkKTtcbiAgICAgICAgaWYgKGtlcHQubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgLy8gU2tpcCB0aGlzIGF1ZGlvIHRyYWNrXG4gICAgICAgICAgY29uc3QgZ3JvdXBJZCA9IGV4dHJhY3RHcm91cElkKGxpbmUpO1xuICAgICAgICAgIGlmIChncm91cElkKSByZW1vdmVkQXVkaW9Hcm91cHMuYWRkKGdyb3VwSWQpO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBvdXQucHVzaChsaW5lKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIFx1MjUwMFx1MjUwMCBTZWdtZW50IFVSTCByZXdyaXRlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICAgIGlmIChsaW5lICYmICFsaW5lLnN0YXJ0c1dpdGgoXCIjXCIpICYmIChsaW5lLmVuZHNXaXRoKFwiLnRzXCIpIHx8IGxpbmUuZW5kc1dpdGgoXCIubTRzXCIpIHx8IGxpbmUuZW5kc1dpdGgoXCIuYWFjXCIpIHx8IGxpbmUuZW5kc1dpdGgoXCIubXAzXCIpIHx8IGxpbmUuZW5kc1dpdGgoXCIud2VibVwiKSkpIHtcbiAgICAgIGNvbnN0IGFic29sdXRlVXJsID0gbmV3IFVSTChsaW5lLCBiYXNlVXJsKS5ocmVmO1xuICAgICAgb3V0LnB1c2gocHJveHlTZWdtZW50VXJsKGVuY29kZVVSSUNvbXBvbmVudChhYnNvbHV0ZVVybCkpKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIFx1MjUwMFx1MjUwMCBFdmVyeXRoaW5nIGVsc2U6IHBhc3MgdGhyb3VnaCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgICBvdXQucHVzaChsaW5lKTtcbiAgfVxuXG4gIHJldHVybiBvdXQuam9pbihcIlxcblwiKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWFuaWZlc3RGb3JBdWRpb0NvZGVjcyhtYW5pZmVzdFRleHQpIHtcbiAgY29uc3QgbGluZXMgPSBtYW5pZmVzdFRleHQuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3QgYXVkaW9UcmFja3MgPSBbXTtcblxuICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKGlzQXVkaW9UcmFjayh0cmltbWVkKSkge1xuICAgICAgY29uc3QgY29kZWNzID0gZ2V0QXR0cih0cmltbWVkLCBcIkNPREVDU1wiKTtcbiAgICAgIGNvbnN0IG5hbWUgPSBnZXRBdHRyKHRyaW1tZWQsIFwiTkFNRVwiKSB8fCBnZXRBdHRyKHRyaW1tZWQsIFwiZ3JvdXAtaWRcIikgfHwgXCJ1bmtub3duXCI7XG4gICAgICBjb25zdCBncm91cElkID0gZXh0cmFjdEdyb3VwSWQodHJpbW1lZCk7XG4gICAgICBhdWRpb1RyYWNrcy5wdXNoKHtcbiAgICAgICAgbmFtZSxcbiAgICAgICAgZ3JvdXBJZCxcbiAgICAgICAgY29kZWNzOiBjb2RlY3MgPyBwYXJzZUNvZGVjcyhjb2RlY3MpIDogW10sXG4gICAgICAgIGxpbmU6IHRyaW1tZWQsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYXVkaW9UcmFja3M7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoYXNVbnN1cHBvcnRlZEF1ZGlvQ29kZWNzKG1hbmlmZXN0VGV4dCkge1xuICBjb25zdCB0cmFja3MgPSBwYXJzZU1hbmlmZXN0Rm9yQXVkaW9Db2RlY3MobWFuaWZlc3RUZXh0KTtcbiAgcmV0dXJuIHRyYWNrcy5zb21lKCh0KSA9PiB0LmNvZGVjcy5zb21lKChjKSA9PiBVTlNVUFBPUlRFRF9BVURJT19DT0RFQ1MuaGFzKGMudG9Mb3dlckNhc2UoKSkpKTtcbn0iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiVjpcXFxcQW50Z3Jhdml0eVxcXFx3ZWJzdHJlYW1lclxcXFx2aXRlXFxcXHNpZGVjYXItcGx1Z2luLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9WOi9BbnRncmF2aXR5L3dlYnN0cmVhbWVyL3ZpdGUvc2lkZWNhci1wbHVnaW4uanNcIjsvLyB2aXRlL3NpZGVjYXItcGx1Z2luLmpzXG4vLyBWaXRlIHBsdWdpbiB0aGF0IGFjdHMgYXMgYSBzaWRlY2FyIEhMUyBzdHJlYW0gcHJvY2Vzc29yOlxuLy8gLSAvYXBpL3NpZGVjYXIvc3RyZWFtICAgXHUyMTkyIGZldGNoZXMgYSBtYW5pZmVzdCwgc3RyaXBzIHVuc3VwcG9ydGVkIGF1ZGlvIGNvZGVjcyxcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJld3JpdGVzIHNlZ21lbnQgVVJMcywgcmV0dXJucyB0aGUgY2xlYW5lZCBtYW5pZmVzdFxuLy8gLSAvYXBpL3NpZGVjYXIvc2VnbWVudCAgXHUyMTkyIHByb3hpZXMgYSBzZWdtZW50IHJlcXVlc3Qgd2l0aCBDT1JTIGhlYWRlcnNcbi8vIC0gL2FwaS9zaWRlY2FyL2hlYWx0aCAgIFx1MjE5MiBsaXZlbmVzcyBjaGVja1xuLy9cbi8vIEF1dG8tc3RhcnRzIHdoZW4gYG5wbSBydW4gZGV2YCBydW5zICh2aWEgY29uZmlndXJlU2VydmVyIGhvb2spLlxuLy8gTm8gZXh0ZXJuYWwgZGVwZW5kZW5jaWVzIFx1MjAxNCBwdXJlIE5vZGUuanMgaHR0cC9odHRwcy9wdW55Y29kZS5cblxuaW1wb3J0IHsgcmV3cml0ZU1hbmlmZXN0LCBoYXNVbnN1cHBvcnRlZEF1ZGlvQ29kZWNzIH0gZnJvbSBcIi4vaGxzLW1hbmlmZXN0LmpzXCI7XG5pbXBvcnQgeyBCdWZmZXIgfSBmcm9tIFwibm9kZTpidWZmZXJcIjtcblxuY29uc3Qgc2VuZEpzb24gPSAocmVzLCBzdGF0dXMsIHBheWxvYWQpID0+IHtcbiAgcmVzLnN0YXR1c0NvZGUgPSBzdGF0dXM7XG4gIHJlcy5zZXRIZWFkZXIoXCJDb250ZW50LVR5cGVcIiwgXCJhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PXV0Zi04XCIpO1xuICByZXMuc2V0SGVhZGVyKFwiQ2FjaGUtQ29udHJvbFwiLCBcIm5vLXN0b3JlXCIpO1xuICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHBheWxvYWQpKTtcbn07XG5cbmNvbnN0IHNlbmRFcnJvciA9IChyZXMsIHN0YXR1cywgbWVzc2FnZSkgPT4ge1xuICByZXMuc3RhdHVzQ29kZSA9IHN0YXR1cztcbiAgcmVzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcInRleHQvcGxhaW47IGNoYXJzZXQ9dXRmLThcIik7XG4gIHJlcy5zZXRIZWFkZXIoXCJDYWNoZS1Db250cm9sXCIsIFwibm8tc3RvcmVcIik7XG4gIHJlcy5lbmQobWVzc2FnZSk7XG59O1xuXG4vLyBGZXRjaCB3aXRoIGF1dG8tZm9sbG93LXJlZGlyZWN0cyAodXAgdG8gNSBob3BzKSwgcHJlc2VydmluZyBoZWFkZXJzLlxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hVcmwodGFyZ2V0VXJsLCBvcHRpb25zID0ge30pIHtcbiAgY29uc3QgaHR0cCA9IHRhcmdldFVybC5zdGFydHNXaXRoKFwiaHR0cHM6XCIpID8gYXdhaXQgaW1wb3J0KFwibm9kZTpodHRwc1wiKSA6IGF3YWl0IGltcG9ydChcIm5vZGU6aHR0cFwiKTtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCByZXEgPSBodHRwLmdldCh0YXJnZXRVcmwsIHtcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgXCJVc2VyLUFnZW50XCI6IFwiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2XCIsXG4gICAgICAgIC4uLm9wdGlvbnMuaGVhZGVycyxcbiAgICAgIH0sXG4gICAgICB0aW1lb3V0OiAyMDAwMCxcbiAgICB9LCAocmVzKSA9PiB7XG4gICAgICBpZiAocmVzLnN0YXR1c0NvZGUgPj0gMzAwICYmIHJlcy5zdGF0dXNDb2RlIDwgNDAwICYmIHJlcy5oZWFkZXJzLmxvY2F0aW9uKSB7XG4gICAgICAgIGNvbnN0IG5leHRVcmwgPSBuZXcgVVJMKHJlcy5oZWFkZXJzLmxvY2F0aW9uLCB0YXJnZXRVcmwpLmhyZWY7XG4gICAgICAgIHJlcy5kZXN0cm95KCk7XG4gICAgICAgIHJlc29sdmUoZmV0Y2hVcmwobmV4dFVybCwgb3B0aW9ucykpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAocmVzLnN0YXR1c0NvZGUgIT09IDIwMCkge1xuICAgICAgICByZXMuZGVzdHJveSgpO1xuICAgICAgICByZWplY3QobmV3IEVycm9yKGBIVFRQICR7cmVzLnN0YXR1c0NvZGV9IGZvciAke3RhcmdldFVybH1gKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHJlc29sdmUocmVzKTtcbiAgICB9KTtcbiAgICByZXEub24oXCJlcnJvclwiLCByZWplY3QpO1xuICAgIHJlcS5vbihcInRpbWVvdXRcIiwgKCkgPT4ge1xuICAgICAgcmVxLmRlc3Ryb3koKTtcbiAgICAgIHJlamVjdChuZXcgRXJyb3IoYFRpbWVvdXQgZmV0Y2hpbmcgJHt0YXJnZXRVcmx9YCkpO1xuICAgIH0pO1xuICB9KTtcbn1cblxuLy8gQ29sbGVjdCBib2R5IGZyb20gYSBzdHJlYW0gdXAgdG8gYG1heEJ5dGVzYCAoZGVmYXVsdCA1MCBNQikuXG5hc3luYyBmdW5jdGlvbiBjb2xsZWN0Qm9keShzdHJlYW0sIG1heEJ5dGVzID0gNTAgKiAxMDI0ICogMTAyNCkge1xuICBjb25zdCBjaHVua3MgPSBbXTtcbiAgbGV0IHRvdGFsID0gMDtcbiAgZm9yIGF3YWl0IChjb25zdCBjaHVuayBvZiBzdHJlYW0pIHtcbiAgICB0b3RhbCArPSBjaHVuay5sZW5ndGg7XG4gICAgaWYgKHRvdGFsID4gbWF4Qnl0ZXMpIGJyZWFrO1xuICAgIGNodW5rcy5wdXNoKGNodW5rKTtcbiAgfVxuICByZXR1cm4gQnVmZmVyLmNvbmNhdChjaHVua3MpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBzaWRlY2FyUGx1Z2luKCkge1xuICByZXR1cm4ge1xuICAgIG5hbWU6IFwic2lkZWNhci1obHMtcGx1Z2luXCIsXG5cbiAgICBjb25maWd1cmVTZXJ2ZXIoc2VydmVyKSB7XG4gICAgICAvLyBcdTI1MDBcdTI1MDAgL2FwaS9zaWRlY2FyL2hlYWx0aCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoXCIvYXBpL3NpZGVjYXIvaGVhbHRoXCIsIChfcmVxLCByZXMpID0+IHtcbiAgICAgICAgc2VuZEpzb24ocmVzLCAyMDAsIHsgb2s6IHRydWUsIHBsdWdpbjogXCJzaWRlY2FyLWhsc1wiIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFx1MjUwMFx1MjUwMCAvYXBpL3NpZGVjYXIvc3RyZWFtIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICAgICAgLy8gR0VUIC9hcGkvc2lkZWNhci9zdHJlYW0/dXJsPTxlbmNvZGVkX3VybD5cbiAgICAgIC8vIFJldHVybnMgdGhlIChwb3RlbnRpYWxseSByZXdyaXR0ZW4pIG1hbmlmZXN0IHRleHQgYXMgQ29udGVudC1UeXBlOiB2bmQuYXBwbGUubXBlZ3VybFxuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShcIi9hcGkvc2lkZWNhci9zdHJlYW1cIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXEudXJsLCBcImh0dHA6Ly9sb2NhbGhvc3RcIik7XG4gICAgICAgICAgY29uc3QgZW5jb2RlZFN0cmVhbVVybCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwidXJsXCIpO1xuXG4gICAgICAgICAgaWYgKCFlbmNvZGVkU3RyZWFtVXJsKSB7XG4gICAgICAgICAgICBzZW5kRXJyb3IocmVzLCA0MDAsIFwiTWlzc2luZyA/dXJsPSBwYXJhbWV0ZXJcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgbGV0IHN0cmVhbVVybDtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgc3RyZWFtVXJsID0gZGVjb2RlVVJJQ29tcG9uZW50KGVuY29kZWRTdHJlYW1VcmwpO1xuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgc2VuZEVycm9yKHJlcywgNDAwLCBcIkludmFsaWQgVVJMIGVuY29kaW5nXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFZhbGlkYXRlIGl0IGxvb2tzIGxpa2UgYW4gaHR0cChzKSBVUkxcbiAgICAgICAgICBpZiAoIXN0cmVhbVVybC5zdGFydHNXaXRoKFwiaHR0cDovL1wiKSAmJiAhc3RyZWFtVXJsLnN0YXJ0c1dpdGgoXCJodHRwczovL1wiKSkge1xuICAgICAgICAgICAgc2VuZEVycm9yKHJlcywgNDAwLCBcIk9ubHkgaHR0cC9odHRwcyBVUkxzIGFyZSBzdXBwb3J0ZWRcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gT25seSBoYW5kbGUgSExTIG1hbmlmZXN0c1xuICAgICAgICAgIGlmICghc3RyZWFtVXJsLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCIubTN1OFwiKSkge1xuICAgICAgICAgICAgc2VuZEVycm9yKHJlcywgNDAwLCBcIk9ubHkgSExTICgubTN1OCkgc3RyZWFtcyBhcmUgc3VwcG9ydGVkIGJ5IHRoZSBzaWRlY2FyXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2hVcmwoc3RyZWFtVXJsKTtcbiAgICAgICAgICBjb25zdCBib2R5ID0gYXdhaXQgY29sbGVjdEJvZHkocmVzcG9uc2UpO1xuICAgICAgICAgIGNvbnN0IG1hbmlmZXN0VGV4dCA9IGJvZHkudG9TdHJpbmcoXCJ1dGY4XCIpO1xuXG4gICAgICAgICAgLy8gRGV0ZWN0IGlmIG1hbmlmZXN0IGhhcyBwcm9ibGVtYXRpYyBhdWRpb1xuICAgICAgICAgIGNvbnN0IGhhc0JhZEF1ZGlvID0gaGFzVW5zdXBwb3J0ZWRBdWRpb0NvZGVjcyhtYW5pZmVzdFRleHQpO1xuXG4gICAgICAgICAgaWYgKCFoYXNCYWRBdWRpbykge1xuICAgICAgICAgICAgLy8gTm8gcmV3cml0aW5nIG5lZWRlZCBcdTIwMTQgc2VydmUgYXMtaXMgd2l0aCBhIG5vdGVcbiAgICAgICAgICAgIHJlcy5zdGF0dXNDb2RlID0gMjAwO1xuICAgICAgICAgICAgcmVzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcImFwcGxpY2F0aW9uL3ZuZC5hcHBsZS5tcGVndXJsOyBjaGFyc2V0PXV0Zi04XCIpO1xuICAgICAgICAgICAgcmVzLnNldEhlYWRlcihcIkNhY2hlLUNvbnRyb2xcIiwgXCJuby1zdG9yZVwiKTtcbiAgICAgICAgICAgIHJlcy5zZXRIZWFkZXIoXCJYLVNpZGVjYXItT3JpZ2luYWxcIiwgXCJ0cnVlXCIpO1xuICAgICAgICAgICAgcmVzLmVuZChtYW5pZmVzdFRleHQpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIEJ1aWxkIHByb3h5IHNlZ21lbnQgVVJMIGZvciB0aGlzIHN0cmVhbVxuICAgICAgICAgIGNvbnN0IGJhc2VVcmwgPSBuZXcgVVJMKHN0cmVhbVVybCk7XG4gICAgICAgICAgY29uc3QgcHJveHlTZWdtZW50VXJsID0gKGVuY29kZWRTZWdVcmwpID0+XG4gICAgICAgICAgICBgL2FwaS9zaWRlY2FyL3NlZ21lbnQ/dXJsPSR7ZW5jb2RlZFNlZ1VybH0mYmFzZT0ke2VuY29kZVVSSUNvbXBvbmVudChiYXNlVXJsLm9yaWdpbiArIGJhc2VVcmwucGF0aG5hbWUucmVwbGFjZSgvXFwvW14vXSokLywgXCIvXCIpKX1gO1xuXG4gICAgICAgICAgY29uc3QgcmV3cml0dGVuID0gcmV3cml0ZU1hbmlmZXN0KG1hbmlmZXN0VGV4dCwgYmFzZVVybC5vcmlnaW4sIHByb3h5U2VnbWVudFVybCk7XG5cbiAgICAgICAgICByZXMuc3RhdHVzQ29kZSA9IDIwMDtcbiAgICAgICAgICByZXMuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIFwiYXBwbGljYXRpb24vdm5kLmFwcGxlLm1wZWd1cmw7IGNoYXJzZXQ9dXRmLThcIik7XG4gICAgICAgICAgcmVzLnNldEhlYWRlcihcIkNhY2hlLUNvbnRyb2xcIiwgXCJuby1zdG9yZVwiKTtcbiAgICAgICAgICByZXMuc2V0SGVhZGVyKFwiWC1TaWRlY2FyLVJld3JpdHRlblwiLCBcInRydWVcIik7XG4gICAgICAgICAgcmVzLmVuZChyZXdyaXR0ZW4pO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oXCJbc2lkZWNhci1wbHVnaW5dIHN0cmVhbSBlcnJvcjpcIiwgZXJyPy5tZXNzYWdlIHx8IGVycik7XG4gICAgICAgICAgc2VuZEVycm9yKHJlcywgNTAyLCBgU2lkZWNhciBlcnJvcjogJHtlcnI/Lm1lc3NhZ2UgfHwgXCJVbmtub3duIGVycm9yXCJ9YCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICAvLyBcdTI1MDBcdTI1MDAgL2FwaS9zaWRlY2FyL3NlZ21lbnQgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gICAgICAvLyBHRVQgL2FwaS9zaWRlY2FyL3NlZ21lbnQ/dXJsPTxlbmNvZGVkX3VybD4mYmFzZT08ZW5jb2RlZF9iYXNlPlxuICAgICAgLy8gUHJveGllcyBzZWdtZW50IGRhdGEgd2l0aCBDT1JTIGhlYWRlcnMgc28gSExTLmpzIGNhbiBmZXRjaCBjcm9zcy1vcmlnaW4gc2VnbWVudHMuXG4gICAgICBzZXJ2ZXIubWlkZGxld2FyZXMudXNlKFwiL2FwaS9zaWRlY2FyL3NlZ21lbnRcIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXEudXJsLCBcImh0dHA6Ly9sb2NhbGhvc3RcIik7XG4gICAgICAgICAgY29uc3QgZW5jb2RlZFNlZ1VybCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwidXJsXCIpO1xuICAgICAgICAgIGNvbnN0IGVuY29kZWRCYXNlID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJiYXNlXCIpO1xuXG4gICAgICAgICAgaWYgKCFlbmNvZGVkU2VnVXJsKSB7XG4gICAgICAgICAgICBzZW5kRXJyb3IocmVzLCA0MDAsIFwiTWlzc2luZyA/dXJsPSBwYXJhbWV0ZXJcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgbGV0IHNlZ1VybDtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgc2VnVXJsID0gZGVjb2RlVVJJQ29tcG9uZW50KGVuY29kZWRTZWdVcmwpO1xuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgc2VuZEVycm9yKHJlcywgNDAwLCBcIkludmFsaWQgVVJMIGVuY29kaW5nXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIElmIG5vIGV4cGxpY2l0IGJhc2UgcHJvdmlkZWQsIHRoZSBzZWdtZW50IFVSTCBtdXN0IGJlIGFic29sdXRlXG4gICAgICAgICAgaWYgKCFzZWdVcmwuc3RhcnRzV2l0aChcImh0dHA6Ly9cIikgJiYgIXNlZ1VybC5zdGFydHNXaXRoKFwiaHR0cHM6Ly9cIikpIHtcbiAgICAgICAgICAgIGlmICghZW5jb2RlZEJhc2UpIHtcbiAgICAgICAgICAgICAgc2VuZEVycm9yKHJlcywgNDAwLCBcIlJlbGF0aXZlIHNlZ21lbnQgVVJMIHJlcXVpcmVzIGJhc2UgcGFyYW1ldGVyXCIpO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBjb25zdCBiYXNlID0gZGVjb2RlVVJJQ29tcG9uZW50KGVuY29kZWRCYXNlKTtcbiAgICAgICAgICAgICAgc2VnVXJsID0gbmV3IFVSTChzZWdVcmwsIGJhc2UpLmhyZWY7XG4gICAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgICAgc2VuZEVycm9yKHJlcywgNDAwLCBcIkludmFsaWQgYmFzZSBVUkxcIik7XG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoVXJsKHNlZ1VybCk7XG4gICAgICAgICAgY29uc3QgY29udGVudFR5cGUgPSByZXNwb25zZS5oZWFkZXJzW1wiY29udGVudC10eXBlXCJdIHx8IFwiYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtXCI7XG5cbiAgICAgICAgICByZXMuc3RhdHVzQ29kZSA9IDIwMDtcbiAgICAgICAgICByZXMuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIGNvbnRlbnRUeXBlKTtcbiAgICAgICAgICByZXMuc2V0SGVhZGVyKFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCIsIFwiKlwiKTtcbiAgICAgICAgICByZXMuc2V0SGVhZGVyKFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVyc1wiLCBcIipcIik7XG4gICAgICAgICAgcmVzLnNldEhlYWRlcihcIkFjY2Vzcy1Db250cm9sLUV4cG9zZS1IZWFkZXJzXCIsIFwiQ29udGVudC1MZW5ndGgsQ29udGVudC1UeXBlXCIpO1xuICAgICAgICAgIHJlcy5zZXRIZWFkZXIoXCJDYWNoZS1Db250cm9sXCIsIFwicHVibGljLCBtYXgtYWdlPTM2MDBcIik7XG4gICAgICAgICAgLy8gRGlzYWJsZSBjaHVua2VkIGVuY29kaW5nIFx1MjAxNCB3ZSBtYXkgbm90IGhhdmUgQ29udGVudC1MZW5ndGggYnV0IHdlIGFyZSBmb3J3YXJkaW5nIGZyb20gYW4gb3BlbiBjb25uZWN0aW9uXG4gICAgICAgICAgcmVzcG9uc2UucGlwZShyZXMpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oXCJbc2lkZWNhci1wbHVnaW5dIHNlZ21lbnQgZXJyb3I6XCIsIGVycj8ubWVzc2FnZSB8fCBlcnIpO1xuICAgICAgICAgIHNlbmRFcnJvcihyZXMsIDUwMiwgYFNlZ21lbnQgZXJyb3I6ICR7ZXJyPy5tZXNzYWdlIHx8IFwiVW5rbm93biBlcnJvclwifWApO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9LFxuICB9O1xufSJdLAogICJtYXBwaW5ncyI6ICI7QUFBbVEsU0FBUyxvQkFBb0I7QUFDaFMsT0FBTyxXQUFXOzs7QUNRbEIsU0FBUyxxQkFBcUI7QUFUK0ksSUFBTSwyQ0FBMkM7QUFXOU4sSUFBTUEsV0FBVSxjQUFjLHdDQUFlO0FBQzdDLElBQU0sU0FBU0EsU0FBUSxZQUFZO0FBR25DLElBQUksaUJBQWlCO0FBQ3JCLElB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QUEsWUFDRjtBQUFBLFVBQ0Y7QUFFQSxnQkFBTSxXQUFXLE1BQU0sU0FBUyxNQUFNO0FBQ3RDLGdCQUFNLGNBQWMsU0FBUyxRQUFRLGNBQWMsS0FBSztBQUV4RCxjQUFJLGFBQWE7QUFDakIsY0FBSSxVQUFVLGdCQUFnQixXQUFXO0FBQ3pDLGNBQUksVUFBVSwrQkFBK0IsR0FBRztBQUNoRCxjQUFJLFVBQVUsZ0NBQWdDLEdBQUc7QUFDakQsY0FBSSxVQUFVLGlDQUFpQyw2QkFBNkI7QUFDNUUsY0FBSSxVQUFVLGlCQUFpQixzQkFBc0I7QUFFckQsbUJBQVMsS0FBSyxHQUFHO0FBQUEsUUFDbkIsU0FBUyxLQUFLO0FBQ1osa0JBQVEsS0FBSyxtQ0FBbUMsS0FBSyxXQUFXLEdBQUc7QUFDbkUsb0JBQVUsS0FBSyxLQUFLLGtCQUFrQixLQUFLLFdBQVcsZUFBZSxFQUFFO0FBQUEsUUFDekU7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUNGOzs7QVBsTUEsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sR0FBRyxnQkFBZ0IsR0FBRyxlQUFlLEdBQUcsaUJBQWlCLEdBQUcsa0JBQWtCLEdBQUcsZ0JBQWdCLEdBQUcsY0FBYyxDQUFDO0FBQUEsRUFDbkksUUFBUTtBQUFBLElBQ04sY0FBYztBQUFBLEVBQ2hCO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFsicmVxdWlyZSIsICJzZW5kSnNvbiIsICJzZW5kSnNvbiIsICJzZW5kSnNvbiIsICJUTURCX1RJTUVPVVRfTVMiLCAiVE1EQl9BQ0NFU1NfVE9LRU4iLCAiVE1EQl9BUElfS0VZIiwgImltZGJDYWNoZSIsICJJTURCX0NBQ0hFX1RUTF9NUyIsICJzZW5kSnNvbiIsICJ0bWRiVG9JbWRiIiwgIm5vcm1hbGl6ZVN0cmVhbSIsICJzZW5kSnNvbiJdCn0K
