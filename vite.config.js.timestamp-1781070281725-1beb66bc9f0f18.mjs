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
var sendJson5 = (res, status, payload) => {
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
        sendJson5(res, 200, { ok: true, plugin: "sidecar-hls" });
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
  plugins: [react(), flixhqApiPlugin(), ezvidApiPlugin(), smplStreamPlugin(), mediafusionPlugin(), sidecarPlugin()]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiLCAidml0ZS9mbGl4aHEtcGx1Z2luLmpzIiwgInZpdGUvZXp2aWRhcGktcGx1Z2luLmpzIiwgInZpdGUvc21wbHN0cmVhbS1wbHVnaW4uanMiLCAidml0ZS9tZWRpYWZ1c2lvbi1wbHVnaW4uanMiLCAidml0ZS9obHMtbWFuaWZlc3QuanMiLCAidml0ZS9zaWRlY2FyLXBsdWdpbi5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1Y6L0FudGdyYXZpdHkvd2Vic3RyZWFtZXIvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuaW1wb3J0IGZsaXhocUFwaVBsdWdpbiBmcm9tICcuL3ZpdGUvZmxpeGhxLXBsdWdpbi5qcydcbmltcG9ydCBlenZpZEFwaVBsdWdpbiBmcm9tICcuL3ZpdGUvZXp2aWRhcGktcGx1Z2luLmpzJ1xuaW1wb3J0IHNtcGxTdHJlYW1QbHVnaW4gZnJvbSAnLi92aXRlL3NtcGxzdHJlYW0tcGx1Z2luLmpzJ1xuaW1wb3J0IG1lZGlhZnVzaW9uUGx1Z2luIGZyb20gJy4vdml0ZS9tZWRpYWZ1c2lvbi1wbHVnaW4uanMnXG5pbXBvcnQgc2lkZWNhclBsdWdpbiBmcm9tICcuL3ZpdGUvc2lkZWNhci1wbHVnaW4uanMnXG5cbi8vIGh0dHBzOi8vdml0ZS5kZXYvY29uZmlnL1xuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCksIGZsaXhocUFwaVBsdWdpbigpLCBlenZpZEFwaVBsdWdpbigpLCBzbXBsU3RyZWFtUGx1Z2luKCksIG1lZGlhZnVzaW9uUGx1Z2luKCksIHNpZGVjYXJQbHVnaW4oKV0sXG59KVxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJWOlxcXFxBbnRncmF2aXR5XFxcXHdlYnN0cmVhbWVyXFxcXHZpdGVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZVxcXFxmbGl4aHEtcGx1Z2luLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9WOi9BbnRncmF2aXR5L3dlYnN0cmVhbWVyL3ZpdGUvZmxpeGhxLXBsdWdpbi5qc1wiOy8vIHZpdGUvZmxpeGhxLXBsdWdpbi5qc1xuLy8gU2VydmVyLXNpZGUgVml0ZSBwbHVnaW4gdGhhdCB3cmFwcyB0aGUgZmxpeGhxLWFwaSBOb2RlIGxpYnJhcnlcbi8vIChodHRwczovL3d3dy5ucG1qcy5jb20vcGFja2FnZS9mbGl4aHEtYXBpKSBhbmQgZXhwb3NlcyBhIHNpbmdsZVxuLy8gL2FwaS9mbGl4aHEvc291cmNlIGVuZHBvaW50IHRoYXQgdGhlIFJlYWN0IGFwcCBjYW4gY2FsbCB0byBnZXRcbi8vIGEgcmVhbCBtM3U4IFVSTCBmb3IgYSBnaXZlbiB0aXRsZSArIChvcHRpb25hbCkgc2Vhc29uL2VwaXNvZGUuXG4vL1xuLy8gVGhlIHBsdWdpbiBpcyBkZXYtb25seSAoY29uZmlndXJlU2VydmVyKSBzbyBwcm9kdWN0aW9uIGJ1aWxkcyBhcmVcbi8vIHVuYWZmZWN0ZWQuIGZsaXhocS1hcGkgdXNlcyBDb21tb25KUywgc28gd2UgdXNlIGNyZWF0ZVJlcXVpcmUgaGVyZS5cblxuaW1wb3J0IHsgY3JlYXRlUmVxdWlyZSB9IGZyb20gXCJtb2R1bGVcIjtcblxuY29uc3QgcmVxdWlyZSA9IGNyZWF0ZVJlcXVpcmUoaW1wb3J0Lm1ldGEudXJsKTtcbmNvbnN0IEZsaXhIUSA9IHJlcXVpcmUoXCJmbGl4aHEtYXBpXCIpO1xuXG4vLyBDYWNoZSB0aGUgRmxpeEhRIGluc3RhbmNlIGZvciB0aGUgbGlmZXRpbWUgb2YgdGhlIGRldiBzZXJ2ZXIuXG5sZXQgZmxpeGhxSW5zdGFuY2UgPSBudWxsO1xuY29uc3QgZ2V0RmxpeEhRID0gKCkgPT4ge1xuICBpZiAoIWZsaXhocUluc3RhbmNlKSB7XG4gICAgZmxpeGhxSW5zdGFuY2UgPSBuZXcgRmxpeEhRKCk7XG4gIH1cbiAgcmV0dXJuIGZsaXhocUluc3RhbmNlO1xufTtcblxuLy8gUGljayB0aGUgbW9zdCBsaWtlbHkgcmVzdWx0IGZyb20gYSBzZWFyY2guIFNlYXJjaCByZXR1cm5zIG1peGVkXG4vLyBtb3ZpZS9zZXJpZXMgcmVzdWx0czsgd2UgZmlsdGVyIGJ5IHRoZSByZXF1ZXN0ZWQgbWVkaWEgdHlwZS5cbmNvbnN0IHBpY2tTZWFyY2hSZXN1bHQgPSAocmVzdWx0cywgdHlwZSkgPT4ge1xuICBpZiAoIUFycmF5LmlzQXJyYXkocmVzdWx0cykgfHwgcmVzdWx0cy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB0eXBlID09PSBcInNlcmllc1wiIHx8IHR5cGUgPT09IFwidHZcIlxuICAgID8gcmVzdWx0cy5maWx0ZXIoKHIpID0+IC90dnxzZXJpZXN8c2hvdy9pLnRlc3QoYCR7ci50eXBlIHx8IFwiXCJ9ICR7ci5pZCB8fCBcIlwifWApKVxuICAgIDogcmVzdWx0cy5maWx0ZXIoKHIpID0+IC9tb3ZpZXxmaWxtL2kudGVzdChgJHtyLnR5cGUgfHwgXCJcIn1gKSB8fCAhL3R2fHNlcmllcy9pLnRlc3QoYCR7ci5pZCB8fCBcIlwifWApKTtcblxuICByZXR1cm4gbm9ybWFsaXplZFswXSB8fCByZXN1bHRzWzBdO1xufTtcblxuLy8gV2FsayB0aGUgRmxpeEhRIGZsb3cgZm9yIGEgVFYgZXBpc29kZTogc2VhcmNoIFx1MjE5MiBkZXRhaWxzIFx1MjE5MiBzZWFzb25zIFx1MjE5MiBlcGlzb2Rlc1xuY29uc3QgcmVzb2x2ZUVwaXNvZGVJZCA9IGFzeW5jICh0aXRsZSwgc2Vhc29uLCBlcGlzb2RlKSA9PiB7XG4gIGNvbnN0IGZsaXhocSA9IGdldEZsaXhIUSgpO1xuICBjb25zdCBzZWFyY2hSZXN1bHRzID0gYXdhaXQgZmxpeGhxLnNlYXJjaCh0aXRsZSk7XG4gIGNvbnN0IHNob3cgPSBwaWNrU2VhcmNoUmVzdWx0KHNlYXJjaFJlc3VsdHMsIFwic2VyaWVzXCIpO1xuICBpZiAoIXNob3c/LmlkKSB0aHJvdyBuZXcgRXJyb3IoYEZsaXhIUTogc2hvdyBub3QgZm91bmQgZm9yIFwiJHt0aXRsZX1cImApO1xuXG4gIGNvbnN0IHNlYXNvbnMgPSBhd2FpdCBmbGl4aHEuZ2V0U2Vhc29ucyhzaG93LmlkKTtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHNlYXNvbnMpIHx8IHNlYXNvbnMubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBGbGl4SFE6IG5vIHNlYXNvbnMgZm91bmQgZm9yIFwiJHt0aXRsZX1cImApO1xuICB9XG5cbiAgY29uc3QgdGFyZ2V0U2Vhc29uID0gc2Vhc29ucy5maW5kKChzKSA9PlxuICAgIFN0cmluZyhzLnNlYXNvbiA/PyBzLm51bWJlciA/PyBzLnNlYXNvbk51bWJlcikgPT09IFN0cmluZyhzZWFzb24pXG4gICkgfHwgc2Vhc29ucy5maW5kKChzKSA9PiBOdW1iZXIocy5zZWFzb24gPz8gcy5udW1iZXIgPz8gcy5zZWFzb25OdW1iZXIpID09PSBOdW1iZXIoc2Vhc29uKSk7XG5cbiAgaWYgKCF0YXJnZXRTZWFzb24/LmlkKSB0aHJvdyBuZXcgRXJyb3IoYEZsaXhIUTogc2Vhc29uICR7c2Vhc29ufSBub3QgZm91bmRgKTtcblxuICBjb25zdCBlcGlzb2RlcyA9IGF3YWl0IGZsaXhocS5nZXRFcGlzb2Rlcyh0YXJnZXRTZWFzb24uaWQpO1xuICBjb25zdCB0YXJnZXRFcGlzb2RlID0gZXBpc29kZXMuZmluZCgoZSkgPT5cbiAgICBTdHJpbmcoZS5lcGlzb2RlID8/IGUubnVtYmVyID8/IGUuZXBpc29kZU51bWJlcikgPT09IFN0cmluZyhlcGlzb2RlKVxuICApIHx8IGVwaXNvZGVzLmZpbmQoKGUpID0+IE51bWJlcihlLmVwaXNvZGUgPz8gZS5udW1iZXIgPz8gZS5lcGlzb2RlTnVtYmVyKSA9PT0gTnVtYmVyKGVwaXNvZGUpKTtcblxuICBpZiAoIXRhcmdldEVwaXNvZGU/LmlkKSB0aHJvdyBuZXcgRXJyb3IoYEZsaXhIUTogZXBpc29kZSAke2VwaXNvZGV9IG5vdCBmb3VuZGApO1xuICByZXR1cm4gdGFyZ2V0RXBpc29kZS5pZDtcbn07XG5cbmNvbnN0IHJlc29sdmVNb3ZpZUlkID0gYXN5bmMgKHRpdGxlKSA9PiB7XG4gIGNvbnN0IGZsaXhocSA9IGdldEZsaXhIUSgpO1xuICBjb25zdCBzZWFyY2hSZXN1bHRzID0gYXdhaXQgZmxpeGhxLnNlYXJjaCh0aXRsZSk7XG4gIGNvbnN0IG1vdmllID0gcGlja1NlYXJjaFJlc3VsdChzZWFyY2hSZXN1bHRzLCBcIm1vdmllXCIpO1xuICBpZiAoIW1vdmllPy5pZCkgdGhyb3cgbmV3IEVycm9yKGBGbGl4SFE6IG1vdmllIG5vdCBmb3VuZCBmb3IgXCIke3RpdGxlfVwiYCk7XG4gIHJldHVybiBtb3ZpZS5pZDtcbn07XG5cbi8vIFRyeSBldmVyeSBhdmFpbGFibGUgc2VydmVyIHVudGlsIG9uZSByZXR1cm5zIGEgcGxheWFibGUgc291cmNlLlxuY29uc3QgcmVzb2x2ZVNvdXJjZSA9IGFzeW5jIChjb250ZW50SWQsIHR5cGUpID0+IHtcbiAgY29uc3QgZmxpeGhxID0gZ2V0RmxpeEhRKCk7XG4gIGNvbnN0IHNlcnZlclR5cGUgPSB0eXBlID09PSBcInNlcmllc1wiIHx8IHR5cGUgPT09IFwidHZcIiA/IFwidHZcIiA6IFwibW92aWVcIjtcbiAgY29uc3Qgc2VydmVycyA9IGF3YWl0IGZsaXhocS5nZXRTZXJ2ZXJzKGNvbnRlbnRJZCwgc2VydmVyVHlwZSk7XG4gIGlmICghQXJyYXkuaXNBcnJheShzZXJ2ZXJzKSB8fCBzZXJ2ZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkZsaXhIUTogbm8gc2VydmVycyByZXR1cm5lZCBmb3IgdGhpcyB0aXRsZVwiKTtcbiAgfVxuXG4gIGxldCBsYXN0RXJyb3IgPSBudWxsO1xuICBmb3IgKGNvbnN0IHNlcnZlciBvZiBzZXJ2ZXJzKSB7XG4gICAgaWYgKCFzZXJ2ZXI/LmlkKSBjb250aW51ZTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmxpeGhxLmZldGNoU291cmNlKHNlcnZlci5pZCk7XG4gICAgICBpZiAocmVzdWx0Py5zb3VyY2UpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICB1cmw6IHJlc3VsdC5zb3VyY2UsXG4gICAgICAgICAgdHlwZTogcmVzdWx0LnR5cGUgfHwgXCJobHNcIixcbiAgICAgICAgICBzZXJ2ZXJOYW1lOiBzZXJ2ZXIubmFtZSB8fCBzZXJ2ZXIuaWQsXG4gICAgICAgICAgZW5jcnlwdGVkOiBCb29sZWFuKHJlc3VsdC5lbmNyeXB0ZWQpXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxhc3RFcnJvciA9IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIHRocm93IGxhc3RFcnJvciB8fCBuZXcgRXJyb3IoXCJGbGl4SFE6IG5vIHNlcnZlciBwcm9kdWNlZCBhIHBsYXlhYmxlIHNvdXJjZVwiKTtcbn07XG5cbmNvbnN0IHNlbmRKc29uID0gKHJlcywgc3RhdHVzLCBwYXlsb2FkKSA9PiB7XG4gIHJlcy5zdGF0dXNDb2RlID0gc3RhdHVzO1xuICByZXMuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOFwiKTtcbiAgcmVzLnNldEhlYWRlcihcIkNhY2hlLUNvbnRyb2xcIiwgXCJuby1zdG9yZVwiKTtcbiAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShwYXlsb2FkKSk7XG59O1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBmbGl4aHFBcGlQbHVnaW4oKSB7XG4gIHJldHVybiB7XG4gICAgbmFtZTogXCJmbGl4aHEtYXBpLXBsdWdpblwiLFxuICAgIGNvbmZpZ3VyZVNlcnZlcihzZXJ2ZXIpIHtcbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoXCIvYXBpL2ZsaXhocS9zb3VyY2VcIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXEudXJsLCBcImh0dHA6Ly9sb2NhbGhvc3RcIik7XG4gICAgICAgICAgY29uc3QgdGl0bGUgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInRpdGxlXCIpPy50cmltKCk7XG4gICAgICAgICAgY29uc3QgdHlwZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwidHlwZVwiKSB8fCBcIm1vdmllXCI7XG4gICAgICAgICAgY29uc3Qgc2Vhc29uID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZWFzb25cIik7XG4gICAgICAgICAgY29uc3QgZXBpc29kZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiZXBpc29kZVwiKTtcblxuICAgICAgICAgIGlmICghdGl0bGUpIHtcbiAgICAgICAgICAgIHNlbmRKc29uKHJlcywgNDAwLCB7IGVycm9yOiBcIk1pc3NpbmcgcmVxdWlyZWQgcGFyYW1ldGVyOiB0aXRsZVwiIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IGNvbnRlbnRJZCA9ICh0eXBlID09PSBcInNlcmllc1wiIHx8IHR5cGUgPT09IFwidHZcIilcbiAgICAgICAgICAgID8gYXdhaXQgcmVzb2x2ZUVwaXNvZGVJZCh0aXRsZSwgc2Vhc29uLCBlcGlzb2RlKVxuICAgICAgICAgICAgOiBhd2FpdCByZXNvbHZlTW92aWVJZCh0aXRsZSk7XG5cbiAgICAgICAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCByZXNvbHZlU291cmNlKGNvbnRlbnRJZCwgdHlwZSk7XG4gICAgICAgICAgc2VuZEpzb24ocmVzLCAyMDAsIHsgLi4uc291cmNlLCB0aXRsZSwgdHlwZSB9KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oXCJbZmxpeGhxLXBsdWdpbl1cIiwgZXJyb3I/Lm1lc3NhZ2UgfHwgZXJyb3IpO1xuICAgICAgICAgIHNlbmRKc29uKHJlcywgNTAyLCB7IGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBcIkZsaXhIUSBsb29rdXAgZmFpbGVkXCIgfSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICAvLyBUaW55IGhlYWx0aCBjaGVjayBmb3IgdGhlIHBsdWdpbiBlbmRwb2ludFxuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShcIi9hcGkvZmxpeGhxL2hlYWx0aFwiLCAoX3JlcSwgcmVzKSA9PiB7XG4gICAgICAgIHNlbmRKc29uKHJlcywgMjAwLCB7IG9rOiB0cnVlLCBwbHVnaW46IFwiZmxpeGhxLWFwaVwiIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xufVxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJWOlxcXFxBbnRncmF2aXR5XFxcXHdlYnN0cmVhbWVyXFxcXHZpdGVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZVxcXFxlenZpZGFwaS1wbHVnaW4uanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1Y6L0FudGdyYXZpdHkvd2Vic3RyZWFtZXIvdml0ZS9lenZpZGFwaS1wbHVnaW4uanNcIjsvLyB2aXRlL2V6dmlkYXBpLXBsdWdpbi5qc1xuLy8gU2VydmVyLXNpZGUgVml0ZSBwbHVnaW4gdGhhdCBwcm94aWVzIHJlcXVlc3RzIHRvIGV6dmlkYXBpLmNvbVxuLy8gKGh0dHBzOi8vZXp2aWRhcGkuY29tL2RvY3MpIGFuZCByZXR1cm5zIHBsYXlhYmxlIHN0cmVhbSBVUkxzLlxuLy9cbi8vIGV6dmlkYXBpIHJldHVybnMgZGlyZWN0IEhMUyBVUkxzIGZyb20gbXVsdGlwbGUgcHJvdmlkZXJzIHdpdGhcbi8vIG5vIGF1dGggcmVxdWlyZWQgYW5kIDEwMCUgZnJlZSB1c2FnZS5cbi8vXG4vLyBBUEk6XG4vLyAgIEdFVCAvYXBpL2V6dmlkYXBpL2VtYmVkP3R5cGU9bW92aWUmdG1kYklkPXtpZH1cbi8vICAgR0VUIC9hcGkvZXp2aWRhcGkvZW1iZWQ/dHlwZT10diZ0bWRiSWQ9e2lkfSZzZWFzb249e3N9JmVwaXNvZGU9e2V9XG4vL1xuLy8gUmVzcG9uc2U6IHsgaGxzOiBib29sZWFuLCBzZXJ2ZXJzOiBbeyBzcmMsIHByb3ZpZGVyLCBzZXJ2ZXIgfV0gfVxuXG5jb25zdCBFWlZJREFQSV9CQVNFID0gXCJodHRwczovL2V6dmlkYXBpLmNvbVwiO1xuY29uc3QgRVpWSURBUElfVElNRU9VVF9NUyA9IDEyXzAwMDtcblxuY29uc3Qgc2VuZEpzb24gPSAocmVzLCBzdGF0dXMsIHBheWxvYWQpID0+IHtcbiAgcmVzLnN0YXR1c0NvZGUgPSBzdGF0dXM7XG4gIHJlcy5zZXRIZWFkZXIoXCJDb250ZW50LVR5cGVcIiwgXCJhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PXV0Zi04XCIpO1xuICByZXMuc2V0SGVhZGVyKFwiQ2FjaGUtQ29udHJvbFwiLCBcIm5vLXN0b3JlXCIpO1xuICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHBheWxvYWQpKTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGV6dmlkQXBpUGx1Z2luKCkge1xuICByZXR1cm4ge1xuICAgIG5hbWU6IFwiZXp2aWRhcGktcGx1Z2luXCIsXG4gICAgY29uZmlndXJlU2VydmVyKHNlcnZlcikge1xuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShcIi9hcGkvZXp2aWRhcGkvZW1iZWRcIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXEudXJsLCBcImh0dHA6Ly9sb2NhbGhvc3RcIik7XG4gICAgICAgICAgY29uc3QgdHlwZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwidHlwZVwiKSB8fCBcIm1vdmllXCI7XG4gICAgICAgICAgY29uc3QgdG1kYklkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJ0bWRiSWRcIik7XG4gICAgICAgICAgY29uc3Qgc2Vhc29uID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZWFzb25cIik7XG4gICAgICAgICAgY29uc3QgZXBpc29kZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiZXBpc29kZVwiKTtcbiAgICAgICAgICBjb25zdCBwcm92aWRlciA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicHJvdmlkZXJcIik7XG5cbiAgICAgICAgICBpZiAoIXRtZGJJZCkge1xuICAgICAgICAgICAgc2VuZEpzb24ocmVzLCA0MDAsIHsgZXJyb3I6IFwiTWlzc2luZyByZXF1aXJlZCBwYXJhbWV0ZXI6IHRtZGJJZFwiIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIEJ1aWxkIHRoZSBlenZpZGFwaSBVUkwgYmFzZWQgb24gbWVkaWEgdHlwZVxuICAgICAgICAgIGxldCBhcGlVcmw7XG4gICAgICAgICAgaWYgKHR5cGUgPT09IFwidHZcIiB8fCB0eXBlID09PSBcInNlcmllc1wiKSB7XG4gICAgICAgICAgICBpZiAoIXNlYXNvbiB8fCAhZXBpc29kZSkge1xuICAgICAgICAgICAgICBzZW5kSnNvbihyZXMsIDQwMCwgeyBlcnJvcjogXCJTZWFzb24gYW5kIGVwaXNvZGUgYXJlIHJlcXVpcmVkIGZvciBUViBzaG93c1wiIH0pO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBhcGlVcmwgPSBgJHtFWlZJREFQSV9CQVNFfS9lbWJlZC90di8ke3RtZGJJZH0vJHtzZWFzb259LyR7ZXBpc29kZX1gO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhcGlVcmwgPSBgJHtFWlZJREFQSV9CQVNFfS9lbWJlZC9tb3ZpZS8ke3RtZGJJZH1gO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIEFkZCBvcHRpb25hbCBwcm92aWRlciBwYXJhbWV0ZXJcbiAgICAgICAgICBpZiAocHJvdmlkZXIpIHtcbiAgICAgICAgICAgIGFwaVVybCArPSBgP3Byb3ZpZGVyPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHByb3ZpZGVyKX1gO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgICAgICAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IGNvbnRyb2xsZXIuYWJvcnQoKSwgRVpWSURBUElfVElNRU9VVF9NUyk7XG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChhcGlVcmwsIHtcbiAgICAgICAgICAgICAgc2lnbmFsOiBjb250cm9sbGVyLnNpZ25hbCxcbiAgICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgIFwiVXNlci1BZ2VudFwiOiBcIk1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xMjUuMC4wLjAgU2FmYXJpLzUzNy4zNlwiXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXNwb25zZS50ZXh0KCkuY2F0Y2goKCkgPT4gXCJcIik7XG4gICAgICAgICAgICAgIGNvbnNvbGUud2FybihgW2V6dmlkYXBpXSAke3Jlc3BvbnNlLnN0YXR1c306ICR7dGV4dC5zbGljZSgwLCAyMDApfWApO1xuICAgICAgICAgICAgICBzZW5kSnNvbihyZXMsIDUwMiwgeyBlcnJvcjogYGV6dmlkYXBpIHJldHVybmVkICR7cmVzcG9uc2Uuc3RhdHVzfWAsIHNlcnZlcnM6IFtdIH0pO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XG4gICAgICAgICAgICBzZW5kSnNvbihyZXMsIDIwMCwge1xuICAgICAgICAgICAgICBobHM6IEJvb2xlYW4oZGF0YS5obHMpLFxuICAgICAgICAgICAgICBzZXJ2ZXJzOiBBcnJheS5pc0FycmF5KGRhdGEuc2VydmVycykgPyBkYXRhLnNlcnZlcnMgOiBbXVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lcik7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGlmIChlcnJvcj8ubmFtZSA9PT0gXCJBYm9ydEVycm9yXCIpIHtcbiAgICAgICAgICAgIHNlbmRKc29uKHJlcywgNTA0LCB7IGVycm9yOiBcImV6dmlkYXBpIHJlcXVlc3QgdGltZWQgb3V0XCIsIHNlcnZlcnM6IFtdIH0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oXCJbZXp2aWRhcGldIGVycm9yOlwiLCBlcnJvcj8ubWVzc2FnZSB8fCBlcnJvcik7XG4gICAgICAgICAgICBzZW5kSnNvbihyZXMsIDUwMiwgeyBlcnJvcjogZXJyb3I/Lm1lc3NhZ2UgfHwgXCJlenZpZGFwaSBwcm94eSBmYWlsZWRcIiwgc2VydmVyczogW10gfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG59XG4iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiVjpcXFxcQW50Z3Jhdml0eVxcXFx3ZWJzdHJlYW1lclxcXFx2aXRlXFxcXHNtcGxzdHJlYW0tcGx1Z2luLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9WOi9BbnRncmF2aXR5L3dlYnN0cmVhbWVyL3ZpdGUvc21wbHN0cmVhbS1wbHVnaW4uanNcIjsvLyB2aXRlL3NtcGxzdHJlYW0tcGx1Z2luLmpzXG4vLyBTZXJ2ZXItc2lkZSBWaXRlIHBsdWdpbiB0aGF0IHByb3hpZXMgcmVxdWVzdHMgdG8gU21hc2h5U3RyZWFtXG4vLyAoZW1iZWQuc21hc2h5c3RyZWFtLmNvbSkgYW5kIHJldHVybnMgZGVjb2RlZCBzdHJlYW0gVVJMcy5cbi8vXG4vLyBTbWFzaHlTdHJlYW0gQVBJIGZsb3c6XG4vLyAgIDEuIFBPU1QgdG8gL2dldHBsYXllci5waHAgd2l0aCBlbXB0eSByZWNhcHRjaGEgdG8gaW5pdCBzZXNzaW9uXG4vLyAgIDIuIEdFVCAvZ2V0cGxheWVyLnBocD9wbGF5ZXI9ZiZ0bWRiPXtpZH0mc2Vhc29uPXtzfSZlcGlzb2RlPXtlfVxuLy8gICAzLiBEZWNvZGUgYmFzZTY0IHNvdXJjZVVybHMgZnJvbSByZXNwb25zZVxuLy9cbi8vIEFQSTpcbi8vICAgR0VUIC9hcGkvc21wbHN0cmVhbS9lbWJlZD90bWRiSWQ9e2lkfSZ0eXBlPW1vdmllXG4vLyAgIEdFVCAvYXBpL3NtcGxzdHJlYW0vZW1iZWQ/dG1kYklkPXtpZH0mdHlwZT10diZzZWFzb249e3N9JmVwaXNvZGU9e2V9XG4vL1xuLy8gUmVzcG9uc2U6IHsgc2VydmVyczogW3sgc3JjLCBuYW1lLCB0eXBlIH1dIH1cblxuY29uc3QgU01QTFNUUkVBTV9CQVNFID0gXCJodHRwczovL2VtYmVkLnNtYXNoeXN0cmVhbS5jb21cIjtcbmNvbnN0IFNNUExTVFJFQU1fVElNRU9VVF9NUyA9IDE1XzAwMDtcblxuLy8gU21hc2h5U3RyZWFtIG9iZnVzY2F0ZWQgYmFzZTY0IGRlY29kaW5nXG4vLyBQYXRoIHNlZ21lbnRzIHVzZWQgaW4gVVJMIGNvbnN0cnVjdGlvbiAocmV2ZXJzZWQgb3JkZXIgZm9yIGRlY29kaW5nKVxuY29uc3QgU01BU0hZX0I2NF9QQVJUUyA9IFtcbiAgXCJVMFpNTDJSVk4wSXZSR3g0XCIsXG4gIFwiTUdOaEwwSldiMGt2VGxNNVwiLFxuICBcIlltOTRMekpUU1M5YVUwWmpcIixcbiAgXCJTR0owTDFkR2FrSXZOMGRYXCIsXG4gIFwiZUU1MkwxUXdPQzk2TjBZelwiXG5dO1xuXG5jb25zdCBkZWNvZGVTbWFzaHlTdHJlYW0gPSAoZW5jb2RlZCkgPT4ge1xuICBpZiAoIWVuY29kZWQgfHwgdHlwZW9mIGVuY29kZWQgIT09IFwic3RyaW5nXCIpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIC8vIFJlbW92ZSB0aGUgZmlyc3QgMiBjaGFyYWN0ZXJzICh2ZXJzaW9uL3R5cGUgcHJlZml4KVxuICAgIGxldCBmb3JtYXR0ZWRCNjQgPSBlbmNvZGVkLnNsaWNlKDIpO1xuICAgIC8vIFJlbW92ZSBvYmZ1c2NhdGVkIHBhdGggc2VnbWVudHMgaW4gcmV2ZXJzZSBvcmRlclxuICAgIGZvciAobGV0IGkgPSBTTUFTSFlfQjY0X1BBUlRTLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBmb3JtYXR0ZWRCNjQgPSBmb3JtYXR0ZWRCNjQucmVwbGFjZShgLy8ke1NNQVNIWV9CNjRfUEFSVFNbaV19YCwgXCJcIik7XG4gICAgfVxuICAgIHJldHVybiBhdG9iKGZvcm1hdHRlZEI2NCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59O1xuXG5jb25zdCBzZW5kSnNvbiA9IChyZXMsIHN0YXR1cywgcGF5bG9hZCkgPT4ge1xuICByZXMuc3RhdHVzQ29kZSA9IHN0YXR1cztcbiAgcmVzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLThcIik7XG4gIHJlcy5zZXRIZWFkZXIoXCJDYWNoZS1Db250cm9sXCIsIFwibm8tc3RvcmVcIik7XG4gIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkocGF5bG9hZCkpO1xufTtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gc21wbFN0cmVhbVBsdWdpbigpIHtcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBcInNtcGxzdHJlYW0tcGx1Z2luXCIsXG4gICAgY29uZmlndXJlU2VydmVyKHNlcnZlcikge1xuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShcIi9hcGkvc21wbHN0cmVhbS9lbWJlZFwiLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJlcS51cmwsIFwiaHR0cDovL2xvY2FsaG9zdFwiKTtcbiAgICAgICAgICBjb25zdCB0bWRiSWQgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInRtZGJJZFwiKTtcbiAgICAgICAgICBjb25zdCB0eXBlID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJ0eXBlXCIpIHx8IFwibW92aWVcIjtcbiAgICAgICAgICBjb25zdCBzZWFzb24gPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInNlYXNvblwiKTtcbiAgICAgICAgICBjb25zdCBlcGlzb2RlID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJlcGlzb2RlXCIpO1xuXG4gICAgICAgICAgaWYgKCF0bWRiSWQpIHtcbiAgICAgICAgICAgIHNlbmRKc29uKHJlcywgNDAwLCB7IGVycm9yOiBcIk1pc3NpbmcgcmVxdWlyZWQgcGFyYW1ldGVyOiB0bWRiSWRcIiwgc2VydmVyczogW10gfSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICAgICAgICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4gY29udHJvbGxlci5hYm9ydCgpLCBTTVBMU1RSRUFNX1RJTUVPVVRfTVMpO1xuXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIFN0ZXAgMTogSW5pdGlhbGl6ZSBzZXNzaW9uIHdpdGggZW1wdHkgcmVjYXB0Y2hhXG4gICAgICAgICAgICBjb25zdCBpbml0UmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHtTTVBMU1RSRUFNX0JBU0V9L2dldHBsYXllci5waHBgLCB7XG4gICAgICAgICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZFwiLFxuICAgICAgICAgICAgICAgIFwiT3JpZ2luXCI6IFNNUExTVFJFQU1fQkFTRSxcbiAgICAgICAgICAgICAgICBcIlJlZmVyZXJcIjogYCR7U01QTFNUUkVBTV9CQVNFfS9gLFxuICAgICAgICAgICAgICAgIFwiVXNlci1BZ2VudFwiOiBcIk1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xMjUuMC4wLjAgU2FmYXJpLzUzNy4zNlwiXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGJvZHk6IFwiZy1yZWNhcHRjaGEtcmVzcG9uc2U9XCJcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAoIWluaXRSZXNwb25zZS5vaykge1xuICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtzbXBsc3RyZWFtXSBpbml0ICR7aW5pdFJlc3BvbnNlLnN0YXR1c31gKTtcbiAgICAgICAgICAgICAgc2VuZEpzb24ocmVzLCA1MDIsIHsgZXJyb3I6IGBTbWFzaHlTdHJlYW0gaW5pdCBmYWlsZWQ6ICR7aW5pdFJlc3BvbnNlLnN0YXR1c31gLCBzZXJ2ZXJzOiBbXSB9KTtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGNvb2tpZXMgZnJvbSBpbml0IHJlc3BvbnNlIGZvciBzZXNzaW9uXG4gICAgICAgICAgICBjb25zdCBjb29raWVzID0gaW5pdFJlc3BvbnNlLmhlYWRlcnMuZ2V0U2V0Q29va2llPy4oKSB8fCBbXTtcbiAgICAgICAgICAgIGNvbnN0IGNvb2tpZUhlYWRlciA9IGNvb2tpZXNcbiAgICAgICAgICAgICAgLm1hcCgoYykgPT4gYy5zcGxpdChcIjtcIilbMF0pXG4gICAgICAgICAgICAgIC5qb2luKFwiOyBcIik7XG5cbiAgICAgICAgICAgIC8vIFN0ZXAgMjogRmV0Y2ggcGxheWVyIGRhdGFcbiAgICAgICAgICAgIGNvbnN0IHBsYXllclBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgICAgICAgICAgICBwbGF5ZXI6IFwiZlwiLFxuICAgICAgICAgICAgICB0bWRiOiBTdHJpbmcodG1kYklkKVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZiAoKHR5cGUgPT09IFwidHZcIiB8fCB0eXBlID09PSBcInNlcmllc1wiKSAmJiBzZWFzb24gJiYgZXBpc29kZSkge1xuICAgICAgICAgICAgICBwbGF5ZXJQYXJhbXMuc2V0KFwic2Vhc29uXCIsIFN0cmluZyhzZWFzb24pKTtcbiAgICAgICAgICAgICAgcGxheWVyUGFyYW1zLnNldChcImVwaXNvZGVcIiwgU3RyaW5nKGVwaXNvZGUpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgcGxheWVyUmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHtTTVBMU1RSRUFNX0JBU0V9L2dldHBsYXllci5waHA/JHtwbGF5ZXJQYXJhbXMudG9TdHJpbmcoKX1gLCB7XG4gICAgICAgICAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICBcIkNvb2tpZVwiOiBjb29raWVIZWFkZXIsXG4gICAgICAgICAgICAgICAgXCJSZWZlcmVyXCI6IGAke1NNUExTVFJFQU1fQkFTRX0vYCxcbiAgICAgICAgICAgICAgICBcIlVzZXItQWdlbnRcIjogXCJNb3ppbGxhLzUuMCAoV2luZG93cyBOVCAxMC4wOyBXaW42NDsgeDY0KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBDaHJvbWUvMTI1LjAuMC4wIFNhZmFyaS81MzcuMzZcIlxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYgKCFwbGF5ZXJSZXNwb25zZS5vaykge1xuICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtzbXBsc3RyZWFtXSBwbGF5ZXIgJHtwbGF5ZXJSZXNwb25zZS5zdGF0dXN9YCk7XG4gICAgICAgICAgICAgIHNlbmRKc29uKHJlcywgNTAyLCB7IGVycm9yOiBgU21hc2h5U3RyZWFtIHBsYXllciBmYWlsZWQ6ICR7cGxheWVyUmVzcG9uc2Uuc3RhdHVzfWAsIHNlcnZlcnM6IFtdIH0pO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHBsYXllckRhdGEgPSBhd2FpdCBwbGF5ZXJSZXNwb25zZS5qc29uKCk7XG5cbiAgICAgICAgICAgIC8vIFN0ZXAgMzogRGVjb2RlIHNvdXJjZSBVUkxzXG4gICAgICAgICAgICBjb25zdCBzZXJ2ZXJzID0gW107XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShwbGF5ZXJEYXRhLnNvdXJjZVVybHMpKSB7XG4gICAgICAgICAgICAgIGZvciAoY29uc3QgZW5jb2RlZCBvZiBwbGF5ZXJEYXRhLnNvdXJjZVVybHMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBkZWNvZGVkID0gZGVjb2RlU21hc2h5U3RyZWFtKGVuY29kZWQpO1xuICAgICAgICAgICAgICAgIGlmIChkZWNvZGVkKSB7XG4gICAgICAgICAgICAgICAgICBzZXJ2ZXJzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICBzcmM6IGRlY29kZWQsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IFwiU21hc2h5U3RyZWFtXCIsXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IGRlY29kZWQuaW5jbHVkZXMoXCIubTN1OFwiKSA/IFwiaGxzXCIgOiBcIm1wNFwiXG4gICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc2VuZEpzb24ocmVzLCAyMDAsIHsgc2VydmVycyB9KTtcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVyKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgaWYgKGVycm9yPy5uYW1lID09PSBcIkFib3J0RXJyb3JcIikge1xuICAgICAgICAgICAgc2VuZEpzb24ocmVzLCA1MDQsIHsgZXJyb3I6IFwiU21hc2h5U3RyZWFtIHJlcXVlc3QgdGltZWQgb3V0XCIsIHNlcnZlcnM6IFtdIH0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oXCJbc21wbHN0cmVhbV0gZXJyb3I6XCIsIGVycm9yPy5tZXNzYWdlIHx8IGVycm9yKTtcbiAgICAgICAgICAgIHNlbmRKc29uKHJlcywgNTAyLCB7IGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBcIlNtYXNoeVN0cmVhbSBwcm94eSBmYWlsZWRcIiwgc2VydmVyczogW10gfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG59XG4iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiVjpcXFxcQW50Z3Jhdml0eVxcXFx3ZWJzdHJlYW1lclxcXFx2aXRlXFxcXG1lZGlhZnVzaW9uLXBsdWdpbi5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVjovQW50Z3Jhdml0eS93ZWJzdHJlYW1lci92aXRlL21lZGlhZnVzaW9uLXBsdWdpbi5qc1wiOy8qIGdsb2JhbCBwcm9jZXNzICovXG4vLyB2aXRlL21lZGlhZnVzaW9uLXBsdWdpbi5qc1xuLy8gU2VydmVyLXNpZGUgVml0ZSBwbHVnaW4gdGhhdCBwcm94aWVzIHJlcXVlc3RzIHRvIGEgTWVkaWFGdXNpb24gU3RyZW1pbyBhZGRvblxuLy8gaW5zdGFuY2UgYW5kIHJldHVybnMgcGxheWFibGUgc3RyZWFtIFVSTHMuXG4vL1xuLy8gTWVkaWFGdXNpb24gaXMgYW4gb3Blbi1zb3VyY2Ugc3RyZWFtaW5nIGFnZ3JlZ2F0b3IgdGhhdCB3b3JrcyBhcyBhIFN0cmVtaW9cbi8vIGFkZG9uLiAgSXQgcmV0dXJucyBtM3U4L21wNCBzdHJlYW1zIGZvciBtb3ZpZXMgYW5kIFRWIHNob3dzLlxuLy9cbi8vIEJlY2F1c2UgTWVkaWFGdXNpb24gdXNlcyBJTURiIElEcyAoU3RyZW1pbyBwcm90b2NvbCkgd2hpbGUgdGhpcyBwcm9qZWN0XG4vLyB1c2VzIFRNREIgSURzLCB0aGUgcGx1Z2luIGNvbnZlcnRzIFRNREIgXHUyMTkyIElNRGIgdmlhIHRoZSBUTURCIGV4dGVybmFsX2lkc1xuLy8gZW5kcG9pbnQgYmVmb3JlIHF1ZXJ5aW5nIE1lZGlhRnVzaW9uLlxuLy9cbi8vIEFQSTpcbi8vICAgR0VUIC9hcGkvbWVkaWFmdXNpb24vc3RyZWFtP3RtZGJJZD17aWR9JnR5cGU9bW92aWVcbi8vICAgR0VUIC9hcGkvbWVkaWFmdXNpb24vc3RyZWFtP3RtZGJJZD17aWR9JnR5cGU9dHYmc2Vhc29uPXtzfSZlcGlzb2RlPXtlfVxuLy9cbi8vIFJlc3BvbnNlOiB7IHN0cmVhbXM6IFt7IHVybCwgbmFtZSwgdGl0bGUsIGlzSGxzLCBzb3VyY2UgfV0gfVxuXG5jb25zdCBNRURJQUZVU0lPTl9CQVNFID0gcHJvY2Vzcy5lbnYuVklURV9NRURJQUZVU0lPTl9VUkxcbiAgfHwgXCJodHRwczovL21lZGlhZnVzaW9uLmVsZmhvc3RlZC5jb21cIjtcblxuY29uc3QgTUVESUFGVVNJT05fVElNRU9VVF9NUyA9IDE4XzAwMDtcbmNvbnN0IFRNREJfVElNRU9VVF9NUyA9IDhfMDAwO1xuXG4vLyBUTURCIGNyZWRlbnRpYWxzIFx1MjAxNCBhdmFpbGFibGUgc2VydmVyLXNpZGUgYmVjYXVzZSBWSVRFXyB2YXJzIGFyZSBpbmxpbmVkXG5jb25zdCBUTURCX0FDQ0VTU19UT0tFTiA9IHByb2Nlc3MuZW52LlZJVEVfVE1EQl9BQ0NFU1NfVE9LRU47XG5jb25zdCBUTURCX0FQSV9LRVkgPSBwcm9jZXNzLmVudi5WSVRFX1RNREJfQVBJX0tFWTtcblxuLy8gU2ltcGxlIGluLW1lbW9yeSBjYWNoZSBmb3IgVE1EQiBcdTIxOTIgSU1EYiBJRCBsb29rdXBzXG5jb25zdCBpbWRiQ2FjaGUgPSBuZXcgTWFwKCk7XG5jb25zdCBJTURCX0NBQ0hFX1RUTF9NUyA9IDI0ICogNjAgKiA2MCAqIDEwMDA7IC8vIDI0IGhvdXJzXG5cbmNvbnN0IHNlbmRKc29uID0gKHJlcywgc3RhdHVzLCBwYXlsb2FkKSA9PiB7XG4gIHJlcy5zdGF0dXNDb2RlID0gc3RhdHVzO1xuICByZXMuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOFwiKTtcbiAgcmVzLnNldEhlYWRlcihcIkNhY2hlLUNvbnRyb2xcIiwgXCJuby1zdG9yZVwiKTtcbiAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShwYXlsb2FkKSk7XG59O1xuXG4vKipcbiAqIENvbnZlcnQgYSBUTURCIElEIHRvIGFuIElNRGIgSUQgdXNpbmcgdGhlIFRNREIgZXh0ZXJuYWxfaWRzIGVuZHBvaW50LlxuICogUmV0dXJucyB0aGUgSU1EYiBJRCBzdHJpbmcgKGUuZy4gXCJ0dDEyMzQ1NjdcIikgb3IgbnVsbC5cbiAqL1xuY29uc3QgdG1kYlRvSW1kYiA9IGFzeW5jICh0bWRiSWQsIHR5cGUpID0+IHtcbiAgY29uc3QgY2FjaGVLZXkgPSBgJHt0eXBlfToke3RtZGJJZH1gO1xuICBjb25zdCBjYWNoZWQgPSBpbWRiQ2FjaGUuZ2V0KGNhY2hlS2V5KTtcbiAgaWYgKGNhY2hlZCAmJiBEYXRlLm5vdygpIC0gY2FjaGVkLmF0IDwgSU1EQl9DQUNIRV9UVExfTVMpIHtcbiAgICByZXR1cm4gY2FjaGVkLmltZGJJZDtcbiAgfVxuXG4gIGlmICghVE1EQl9BQ0NFU1NfVE9LRU4gJiYgIVRNREJfQVBJX0tFWSkge1xuICAgIGNvbnNvbGUud2FybihcIlttZWRpYWZ1c2lvbl0gTm8gVE1EQiBjcmVkZW50aWFscyBcdTIwMTQgY2Fubm90IHJlc29sdmUgSU1EYiBJRFwiKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IG1lZGlhVHlwZSA9IHR5cGUgPT09IFwidHZcIiB8fCB0eXBlID09PSBcInNlcmllc1wiID8gXCJ0dlwiIDogXCJtb3ZpZVwiO1xuICBjb25zdCB1cmwgPSBuZXcgVVJMKGBodHRwczovL2FwaS50aGVtb3ZpZWRiLm9yZy8zLyR7bWVkaWFUeXBlfS8ke3RtZGJJZH0vZXh0ZXJuYWxfaWRzYCk7XG4gIGlmIChUTURCX0FQSV9LRVkgJiYgIVRNREJfQUNDRVNTX1RPS0VOKSB7XG4gICAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoXCJhcGlfa2V5XCIsIFRNREJfQVBJX0tFWSk7XG4gIH1cblxuICBjb25zdCBjb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4gY29udHJvbGxlci5hYm9ydCgpLCBUTURCX1RJTUVPVVRfTVMpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwudG9TdHJpbmcoKSwge1xuICAgICAgc2lnbmFsOiBjb250cm9sbGVyLnNpZ25hbCxcbiAgICAgIGhlYWRlcnM6IFRNREJfQUNDRVNTX1RPS0VOXG4gICAgICAgID8geyBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7VE1EQl9BQ0NFU1NfVE9LRU59YCB9XG4gICAgICAgIDoge30sXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICBjb25zb2xlLndhcm4oYFttZWRpYWZ1c2lvbl0gVE1EQiBleHRlcm5hbF9pZHMgJHtyZXNwb25zZS5zdGF0dXN9IGZvciAke3RtZGJJZH1gKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XG4gICAgY29uc3QgaW1kYklkID0gZGF0YT8uaW1kYl9pZCB8fCBudWxsO1xuXG4gICAgaWYgKGltZGJJZCkge1xuICAgICAgaW1kYkNhY2hlLnNldChjYWNoZUtleSwgeyBpbWRiSWQsIGF0OiBEYXRlLm5vdygpIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBpbWRiSWQ7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKGVycm9yPy5uYW1lICE9PSBcIkFib3J0RXJyb3JcIikge1xuICAgICAgY29uc29sZS53YXJuKFwiW21lZGlhZnVzaW9uXSBUTURCIGxvb2t1cCBlcnJvcjpcIiwgZXJyb3I/Lm1lc3NhZ2UgfHwgZXJyb3IpO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfSBmaW5hbGx5IHtcbiAgICBjbGVhclRpbWVvdXQodGltZXIpO1xuICB9XG59O1xuXG4vKipcbiAqIEZldGNoIHN0cmVhbXMgZnJvbSBhIE1lZGlhRnVzaW9uIGluc3RhbmNlIGZvciB0aGUgZ2l2ZW4gSU1EYiBJRC5cbiAqIFJldHVybnMgdGhlIHJhdyBzdHJlYW1zIGFycmF5IGZyb20gdGhlIFN0cmVtaW8gYWRkb24gcmVzcG9uc2UuXG4gKi9cbmNvbnN0IGZldGNoTWVkaWFmdXNpb25TdHJlYW1zID0gYXN5bmMgKGltZGJJZCwgdHlwZSwgc2Vhc29uLCBlcGlzb2RlKSA9PiB7XG4gIC8vIFN0cmVtaW8gYWRkb24gcHJvdG9jb2w6IC9zdHJlYW0ve3R5cGV9L3tpZH0uanNvblxuICAvLyBGb3Igc2VyaWVzOiAvc3RyZWFtL3Nlcmllcy97aW1kYklkfTp7c2Vhc29ufTp7ZXBpc29kZX0uanNvblxuICBjb25zdCBtZWRpYVR5cGUgPSB0eXBlID09PSBcInR2XCIgfHwgdHlwZSA9PT0gXCJzZXJpZXNcIiA/IFwic2VyaWVzXCIgOiBcIm1vdmllXCI7XG5cbiAgbGV0IHN0cmVhbVBhdGg7XG4gIGlmIChtZWRpYVR5cGUgPT09IFwic2VyaWVzXCIpIHtcbiAgICBzdHJlYW1QYXRoID0gYHN0cmVhbS9zZXJpZXMvJHtpbWRiSWR9OiR7c2Vhc29ufToke2VwaXNvZGV9Lmpzb25gO1xuICB9IGVsc2Uge1xuICAgIHN0cmVhbVBhdGggPSBgc3RyZWFtL21vdmllLyR7aW1kYklkfS5qc29uYDtcbiAgfVxuXG4gIGNvbnN0IGFwaVVybCA9IGAke01FRElBRlVTSU9OX0JBU0V9LyR7c3RyZWFtUGF0aH1gO1xuXG4gIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gIGNvbnN0IHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiBjb250cm9sbGVyLmFib3J0KCksIE1FRElBRlVTSU9OX1RJTUVPVVRfTVMpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChhcGlVcmwsIHtcbiAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIFwiVXNlci1BZ2VudFwiOiBcIk1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xMjUuMC4wLjAgU2FmYXJpLzUzNy4zNlwiLFxuICAgICAgICBcIkFjY2VwdFwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICBjb25zb2xlLndhcm4oYFttZWRpYWZ1c2lvbl0gJHtyZXNwb25zZS5zdGF0dXN9OiAke2FwaVVybH1gKTtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzcG9uc2UuanNvbigpO1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KGRhdGE/LnN0cmVhbXMpID8gZGF0YS5zdHJlYW1zIDogW107XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKGVycm9yPy5uYW1lICE9PSBcIkFib3J0RXJyb3JcIikge1xuICAgICAgY29uc29sZS53YXJuKFwiW21lZGlhZnVzaW9uXSBmZXRjaCBlcnJvcjpcIiwgZXJyb3I/Lm1lc3NhZ2UgfHwgZXJyb3IpO1xuICAgIH1cbiAgICByZXR1cm4gW107XG4gIH0gZmluYWxseSB7XG4gICAgY2xlYXJUaW1lb3V0KHRpbWVyKTtcbiAgfVxufTtcblxuLyoqXG4gKiBOb3JtYWxpemUgYSByYXcgTWVkaWFGdXNpb24gc3RyZWFtIG9iamVjdCBpbnRvIHRoZSBmb3JtYXQgb3VyIHBsYXllciBleHBlY3RzLlxuICogRmlsdGVycyBvdXQgc3RyZWFtcyB0aGF0IGRvbid0IGhhdmUgYSBkaXJlY3QgcGxheWFibGUgVVJMLlxuICovXG5jb25zdCBub3JtYWxpemVTdHJlYW0gPSAocmF3KSA9PiB7XG4gIC8vIE1lZGlhRnVzaW9uIHN0cmVhbXMgY2FuIGhhdmU6XG4gIC8vICAgLSB1cmw6IGRpcmVjdCBtM3U4L21wNCBVUkwgKHBsYXlhYmxlKVxuICAvLyAgIC0gaW5mb0hhc2g6IHRvcnJlbnQgaGFzaCAoTk9UIGJyb3dzZXItcGxheWFibGUpXG4gIC8vICAgLSBiZWhhdmlvckhpbnRzOiB7IG5vdFdlYlJlYWR5OiB0cnVlIH0gZm9yIG5vbi13ZWIgc3RyZWFtc1xuICAvL1xuICAvLyBXZSBvbmx5IHJldHVybiBzdHJlYW1zIHRoYXQgaGF2ZSBhIGRpcmVjdCBVUkwgYW5kIGFyZSB3ZWItcmVhZHkuXG4gIGlmICghcmF3Py51cmwpIHJldHVybiBudWxsO1xuICBpZiAocmF3LmJlaGF2aW9ySGludHM/Lm5vdFdlYlJlYWR5KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBpc0hscyA9IC9cXC5tM3U4KFxcP3wkKS9pLnRlc3QocmF3LnVybCk7XG4gIGNvbnN0IGlzTXA0ID0gL1xcLm1wNChcXD98JCkvaS50ZXN0KHJhdy51cmwpO1xuXG4gIHJldHVybiB7XG4gICAgdXJsOiByYXcudXJsLFxuICAgIG5hbWU6IGBNZWRpYUZ1c2lvbiR7cmF3Lm5hbWUgPyBgIFx1MDBCNyAke3Jhdy5uYW1lfWAgOiBcIlwifWAsXG4gICAgdGl0bGU6IHJhdy50aXRsZSB8fCBgTWVkaWFGdXNpb24gc3RyZWFtIFx1MDBCNyAke2lzSGxzID8gXCJITFNcIiA6IGlzTXA0ID8gXCJNUDRcIiA6IFwiRGlyZWN0XCJ9YCxcbiAgICBiZWhhdmlvckhpbnRzOiB7fSxcbiAgICBpc0hscyxcbiAgICBzb3VyY2U6IFwibWVkaWFmdXNpb25cIixcbiAgfTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIG1lZGlhZnVzaW9uUGx1Z2luKCkge1xuICByZXR1cm4ge1xuICAgIG5hbWU6IFwibWVkaWFmdXNpb24tcGx1Z2luXCIsXG4gICAgY29uZmlndXJlU2VydmVyKHNlcnZlcikge1xuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShcIi9hcGkvbWVkaWFmdXNpb24vc3RyZWFtXCIsIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxLnVybCwgXCJodHRwOi8vbG9jYWxob3N0XCIpO1xuICAgICAgICAgIGNvbnN0IHRtZGJJZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwidG1kYklkXCIpO1xuICAgICAgICAgIGNvbnN0IHR5cGUgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInR5cGVcIikgfHwgXCJtb3ZpZVwiO1xuICAgICAgICAgIGNvbnN0IHNlYXNvbiA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwic2Vhc29uXCIpO1xuICAgICAgICAgIGNvbnN0IGVwaXNvZGUgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcImVwaXNvZGVcIik7XG5cbiAgICAgICAgICBpZiAoIXRtZGJJZCkge1xuICAgICAgICAgICAgc2VuZEpzb24ocmVzLCA0MDAsIHsgZXJyb3I6IFwiTWlzc2luZyByZXF1aXJlZCBwYXJhbWV0ZXI6IHRtZGJJZFwiLCBzdHJlYW1zOiBbXSB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoKHR5cGUgPT09IFwidHZcIiB8fCB0eXBlID09PSBcInNlcmllc1wiKSAmJiAoIXNlYXNvbiB8fCAhZXBpc29kZSkpIHtcbiAgICAgICAgICAgIHNlbmRKc29uKHJlcywgNDAwLCB7IGVycm9yOiBcIlNlYXNvbiBhbmQgZXBpc29kZSBhcmUgcmVxdWlyZWQgZm9yIFRWIHNob3dzXCIsIHN0cmVhbXM6IFtdIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFN0ZXAgMTogQ29udmVydCBUTURCIElEIFx1MjE5MiBJTURiIElEXG4gICAgICAgICAgY29uc3QgaW1kYklkID0gYXdhaXQgdG1kYlRvSW1kYih0bWRiSWQsIHR5cGUpO1xuICAgICAgICAgIGlmICghaW1kYklkKSB7XG4gICAgICAgICAgICBzZW5kSnNvbihyZXMsIDIwMCwge1xuICAgICAgICAgICAgICBzdHJlYW1zOiBbXSxcbiAgICAgICAgICAgICAgbWVzc2FnZTogXCJDb3VsZCBub3QgcmVzb2x2ZSBUTURCIElEIHRvIElNRGIgSUQgKFRNREIgY3JlZGVudGlhbHMgbWF5IGJlIG1pc3NpbmcpXCIsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBTdGVwIDI6IEZldGNoIHN0cmVhbXMgZnJvbSBNZWRpYUZ1c2lvblxuICAgICAgICAgIGNvbnN0IHJhd1N0cmVhbXMgPSBhd2FpdCBmZXRjaE1lZGlhZnVzaW9uU3RyZWFtcyhpbWRiSWQsIHR5cGUsIHNlYXNvbiwgZXBpc29kZSk7XG5cbiAgICAgICAgICAvLyBTdGVwIDM6IE5vcm1hbGl6ZSBhbmQgZmlsdGVyIGZvciBicm93c2VyLXBsYXlhYmxlIHN0cmVhbXNcbiAgICAgICAgICBjb25zdCBzdHJlYW1zID0gcmF3U3RyZWFtc1xuICAgICAgICAgICAgLm1hcChub3JtYWxpemVTdHJlYW0pXG4gICAgICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuXG4gICAgICAgICAgc2VuZEpzb24ocmVzLCAyMDAsIHsgc3RyZWFtcyB9KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oXCJbbWVkaWFmdXNpb24tcGx1Z2luXSBlcnJvcjpcIiwgZXJyb3I/Lm1lc3NhZ2UgfHwgZXJyb3IpO1xuICAgICAgICAgIHNlbmRKc29uKHJlcywgNTAyLCB7IGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBcIk1lZGlhRnVzaW9uIHByb3h5IGZhaWxlZFwiLCBzdHJlYW1zOiBbXSB9KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIEhlYWx0aCBjaGVja1xuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShcIi9hcGkvbWVkaWFmdXNpb24vaGVhbHRoXCIsIChfcmVxLCByZXMpID0+IHtcbiAgICAgICAgc2VuZEpzb24ocmVzLCAyMDAsIHtcbiAgICAgICAgICBvazogdHJ1ZSxcbiAgICAgICAgICBwbHVnaW46IFwibWVkaWFmdXNpb25cIixcbiAgICAgICAgICBpbnN0YW5jZTogTUVESUFGVVNJT05fQkFTRSxcbiAgICAgICAgICBoYXNUbWRiQ3JlZGVudGlhbHM6IEJvb2xlYW4oVE1EQl9BQ0NFU1NfVE9LRU4gfHwgVE1EQl9BUElfS0VZKSxcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9LFxuICB9O1xufVxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJWOlxcXFxBbnRncmF2aXR5XFxcXHdlYnN0cmVhbWVyXFxcXHZpdGVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZVxcXFxobHMtbWFuaWZlc3QuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1Y6L0FudGdyYXZpdHkvd2Vic3RyZWFtZXIvdml0ZS9obHMtbWFuaWZlc3QuanNcIjsvLyBQdXJlIE5vZGUuanMgSExTIG1hbmlmZXN0IHBhcnNlciBhbmQgcmV3cml0ZXIuXG4vLyAtIEZpbHRlcnMgdmFyaWFudCBzdHJlYW1zICgjRVhULVgtU1RSRUFNLUlORikgYnkgYXVkaW8gY29kZWMgc3VwcG9ydFxuLy8gLSBGaWx0ZXJzIGFsdGVybmF0aXZlIGF1ZGlvIHRyYWNrcyAoI0VYVC1YLU1FRElBIHdpdGggVFlQRT1BVURJTykgYnkgY29kZWNcbi8vIC0gUmV3cml0ZXMgc2VnbWVudCBVUkxzIHRvIHBvaW50IHRocm91Z2ggdGhlIHNpZGVjYXIgcHJveHlcbi8vXG4vLyBObyBleHRlcm5hbCBkZXBlbmRlbmNpZXMgXHUyMDE0IHVzZXMgb25seSBOb2RlLmpzIGJ1aWx0LWlucy5cblxuY29uc3QgVU5TVVBQT1JURURfQVVESU9fQ09ERUNTID0gbmV3IFNldChbXCJlYy0zXCIsIFwiYWMtM1wiLCBcImR0c1wiLCBcInRydWVoZFwiXSk7XG5cbmZ1bmN0aW9uIHBhcnNlQ29kZWNzKGNvZGVjc1N0cikge1xuICBpZiAoIWNvZGVjc1N0cikgcmV0dXJuIFtdO1xuICByZXR1cm4gY29kZWNzU3RyLnNwbGl0KFwiLFwiKS5tYXAoKGMpID0+IGMudHJpbSgpKS5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmZ1bmN0aW9uIGNvZGVjc1RvS2VlcChjb2RlY3MpIHtcbiAgcmV0dXJuIGNvZGVjcy5maWx0ZXIoKGMpID0+ICFVTlNVUFBPUlRFRF9BVURJT19DT0RFQ1MuaGFzKGMudG9Mb3dlckNhc2UoKSkpO1xufVxuXG5mdW5jdGlvbiBidWlsZENvZGVjc0F0dHIoa2VlcENvZGVjcykge1xuICByZXR1cm4ga2VlcENvZGVjcy5qb2luKFwiLFwiKTtcbn1cblxuZnVuY3Rpb24gaXNBdWRpb1RyYWNrKGxpbmUpIHtcbiAgcmV0dXJuIGxpbmUuaW5jbHVkZXMoXCIjRVhULVgtTUVESUE6XCIpICYmIGxpbmUuaW5jbHVkZXMoJ1RZUEU9XCJBVURJT1wiJyk7XG59XG5cbmZ1bmN0aW9uIGlzVmFyaWFudFN0cmVhbShsaW5lKSB7XG4gIHJldHVybiBsaW5lLmluY2x1ZGVzKFwiI0VYVC1YLVNUUkVBTS1JTkY6XCIpO1xufVxuXG5mdW5jdGlvbiBnZXRBdHRyKGxpbmUsIG5hbWUpIHtcbiAgY29uc3QgcmUgPSBuZXcgUmVnRXhwKGAke25hbWV9PVwiKFteXCJdKilcImAsIFwiaVwiKTtcbiAgY29uc3QgbSA9IGxpbmUubWF0Y2gocmUpO1xuICByZXR1cm4gbSA/IG1bMV0gOiBudWxsO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0R3JvdXBJZChsaW5lKSB7XG4gIHJldHVybiBnZXRBdHRyKGxpbmUsIFwiR1JPVVAtSURcIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXdyaXRlTWFuaWZlc3QobWFuaWZlc3RUZXh0LCBiYXNlVXJsLCBwcm94eVNlZ21lbnRVcmwpIHtcbiAgY29uc3QgbGluZXMgPSBtYW5pZmVzdFRleHQuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3Qgb3V0ID0gW107XG5cbiAgLy8gVHJhY2sgd2hpY2ggYXVkaW8gR1JPVVAtSURzIHdlJ3ZlIHJlbW92ZWQgc28gd2UgY2FuIGRyb3AgdGhlbSBmcm9tIHZhcmlhbnQgc3RyZWFtc1xuICBjb25zdCByZW1vdmVkQXVkaW9Hcm91cHMgPSBuZXcgU2V0KCk7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpXS50cmltKCk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgVmFyaWFudCBzdHJlYW06ICNFWFQtWC1TVFJFQU0tSU5GIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICAgIGlmIChpc1ZhcmlhbnRTdHJlYW0obGluZSkpIHtcbiAgICAgIGNvbnN0IGNvZGVjcyA9IGdldEF0dHIobGluZSwgXCJDT0RFQ1NcIik7XG4gICAgICBpZiAoY29kZWNzKSB7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlQ29kZWNzKGNvZGVjcyk7XG4gICAgICAgIGNvbnN0IGtlcHQgPSBjb2RlY3NUb0tlZXAocGFyc2VkKTtcbiAgICAgICAgaWYgKGtlcHQubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgLy8gTm8gc3VwcG9ydGVkIGNvZGVjcyBcdTIwMTQgc2tpcCB0aGlzIGVudGlyZSBzdHJlYW0gdmFyaWFudFxuICAgICAgICAgIC8vIGNvbnN1bWUgdGhlIG5leHQgbGluZSAoVVJMKSBhbmQgY29udGludWVcbiAgICAgICAgICBpKys7IC8vIHNraXAgdGhlIFVSTCBsaW5lXG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGtlcHQubGVuZ3RoIDwgcGFyc2VkLmxlbmd0aCkge1xuICAgICAgICAgIC8vIFJlcGxhY2UgQ09ERUNTIGF0dHJpYnV0ZSB3aXRoIG9ubHkgc3VwcG9ydGVkIGNvZGVjc1xuICAgICAgICAgIGNvbnN0IG5ld0xpbmUgPSBsaW5lLnJlcGxhY2UoL0NPREVDUz1cIlteXCJdKlwiLywgYENPREVDUz1cIiR7YnVpbGRDb2RlY3NBdHRyKGtlcHQpfVwiYCk7XG4gICAgICAgICAgLy8gQWxzbyByZW1vdmUgQVVESU8gYXR0cmlidXRlIGlmIHRoYXQgZ3JvdXAgd2FzIHJlbW92ZWRcbiAgICAgICAgICBjb25zdCBhdWRpb0dyb3VwID0gZ2V0QXR0cihsaW5lLCBcIkFVRElPXCIpO1xuICAgICAgICAgIGlmIChhdWRpb0dyb3VwICYmIHJlbW92ZWRBdWRpb0dyb3Vwcy5oYXMoYXVkaW9Hcm91cCkpIHtcbiAgICAgICAgICAgIG91dC5wdXNoKG5ld0xpbmUucmVwbGFjZSgvXFxzK0FVRElPPVwiW15cIl0qXCIvLCBcIlwiKSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG91dC5wdXNoKG5ld0xpbmUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBvdXQucHVzaChsaW5lc1srK2ldLnRyaW0oKSk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIG91dC5wdXNoKGxpbmUpO1xuICAgICAgb3V0LnB1c2gobGluZXNbKytpXS50cmltKCkpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gXHUyNTAwXHUyNTAwIEF1ZGlvIHRyYWNrOiAjRVhULVgtTUVESUEgVFlQRT1BVURJTyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgICBpZiAoaXNBdWRpb1RyYWNrKGxpbmUpKSB7XG4gICAgICBjb25zdCBjb2RlY3MgPSBnZXRBdHRyKGxpbmUsIFwiQ09ERUNTXCIpO1xuICAgICAgaWYgKGNvZGVjcykge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUNvZGVjcyhjb2RlY3MpO1xuICAgICAgICBjb25zdCBrZXB0ID0gY29kZWNzVG9LZWVwKHBhcnNlZCk7XG4gICAgICAgIGlmIChrZXB0Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIC8vIFNraXAgdGhpcyBhdWRpbyB0cmFja1xuICAgICAgICAgIGNvbnN0IGdyb3VwSWQgPSBleHRyYWN0R3JvdXBJZChsaW5lKTtcbiAgICAgICAgICBpZiAoZ3JvdXBJZCkgcmVtb3ZlZEF1ZGlvR3JvdXBzLmFkZChncm91cElkKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgb3V0LnB1c2gobGluZSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgU2VnbWVudCBVUkwgcmV3cml0ZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgICBpZiAobGluZSAmJiAhbGluZS5zdGFydHNXaXRoKFwiI1wiKSAmJiAobGluZS5lbmRzV2l0aChcIi50c1wiKSB8fCBsaW5lLmVuZHNXaXRoKFwiLm00c1wiKSB8fCBsaW5lLmVuZHNXaXRoKFwiLmFhY1wiKSB8fCBsaW5lLmVuZHNXaXRoKFwiLm1wM1wiKSB8fCBsaW5lLmVuZHNXaXRoKFwiLndlYm1cIikpKSB7XG4gICAgICBjb25zdCBhYnNvbHV0ZVVybCA9IG5ldyBVUkwobGluZSwgYmFzZVVybCkuaHJlZjtcbiAgICAgIG91dC5wdXNoKHByb3h5U2VnbWVudFVybChlbmNvZGVVUklDb21wb25lbnQoYWJzb2x1dGVVcmwpKSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgRXZlcnl0aGluZyBlbHNlOiBwYXNzIHRocm91Z2ggXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gICAgb3V0LnB1c2gobGluZSk7XG4gIH1cblxuICByZXR1cm4gb3V0LmpvaW4oXCJcXG5cIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1hbmlmZXN0Rm9yQXVkaW9Db2RlY3MobWFuaWZlc3RUZXh0KSB7XG4gIGNvbnN0IGxpbmVzID0gbWFuaWZlc3RUZXh0LnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IGF1ZGlvVHJhY2tzID0gW107XG5cbiAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmIChpc0F1ZGlvVHJhY2sodHJpbW1lZCkpIHtcbiAgICAgIGNvbnN0IGNvZGVjcyA9IGdldEF0dHIodHJpbW1lZCwgXCJDT0RFQ1NcIik7XG4gICAgICBjb25zdCBuYW1lID0gZ2V0QXR0cih0cmltbWVkLCBcIk5BTUVcIikgfHwgZ2V0QXR0cih0cmltbWVkLCBcImdyb3VwLWlkXCIpIHx8IFwidW5rbm93blwiO1xuICAgICAgY29uc3QgZ3JvdXBJZCA9IGV4dHJhY3RHcm91cElkKHRyaW1tZWQpO1xuICAgICAgYXVkaW9UcmFja3MucHVzaCh7XG4gICAgICAgIG5hbWUsXG4gICAgICAgIGdyb3VwSWQsXG4gICAgICAgIGNvZGVjczogY29kZWNzID8gcGFyc2VDb2RlY3MoY29kZWNzKSA6IFtdLFxuICAgICAgICBsaW5lOiB0cmltbWVkLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGF1ZGlvVHJhY2tzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaGFzVW5zdXBwb3J0ZWRBdWRpb0NvZGVjcyhtYW5pZmVzdFRleHQpIHtcbiAgY29uc3QgdHJhY2tzID0gcGFyc2VNYW5pZmVzdEZvckF1ZGlvQ29kZWNzKG1hbmlmZXN0VGV4dCk7XG4gIHJldHVybiB0cmFja3Muc29tZSgodCkgPT4gdC5jb2RlY3Muc29tZSgoYykgPT4gVU5TVVBQT1JURURfQVVESU9fQ09ERUNTLmhhcyhjLnRvTG93ZXJDYXNlKCkpKSk7XG59IiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJWOlxcXFxBbnRncmF2aXR5XFxcXHdlYnN0cmVhbWVyXFxcXHZpdGVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIlY6XFxcXEFudGdyYXZpdHlcXFxcd2Vic3RyZWFtZXJcXFxcdml0ZVxcXFxzaWRlY2FyLXBsdWdpbi5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVjovQW50Z3Jhdml0eS93ZWJzdHJlYW1lci92aXRlL3NpZGVjYXItcGx1Z2luLmpzXCI7Ly8gdml0ZS9zaWRlY2FyLXBsdWdpbi5qc1xuLy8gVml0ZSBwbHVnaW4gdGhhdCBhY3RzIGFzIGEgc2lkZWNhciBITFMgc3RyZWFtIHByb2Nlc3Nvcjpcbi8vIC0gL2FwaS9zaWRlY2FyL3N0cmVhbSAgIFx1MjE5MiBmZXRjaGVzIGEgbWFuaWZlc3QsIHN0cmlwcyB1bnN1cHBvcnRlZCBhdWRpbyBjb2RlY3MsXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXdyaXRlcyBzZWdtZW50IFVSTHMsIHJldHVybnMgdGhlIGNsZWFuZWQgbWFuaWZlc3Rcbi8vIC0gL2FwaS9zaWRlY2FyL3NlZ21lbnQgIFx1MjE5MiBwcm94aWVzIGEgc2VnbWVudCByZXF1ZXN0IHdpdGggQ09SUyBoZWFkZXJzXG4vLyAtIC9hcGkvc2lkZWNhci9oZWFsdGggICBcdTIxOTIgbGl2ZW5lc3MgY2hlY2tcbi8vXG4vLyBBdXRvLXN0YXJ0cyB3aGVuIGBucG0gcnVuIGRldmAgcnVucyAodmlhIGNvbmZpZ3VyZVNlcnZlciBob29rKS5cbi8vIE5vIGV4dGVybmFsIGRlcGVuZGVuY2llcyBcdTIwMTQgcHVyZSBOb2RlLmpzIGh0dHAvaHR0cHMvcHVueWNvZGUuXG5cbmltcG9ydCB7IHJld3JpdGVNYW5pZmVzdCwgaGFzVW5zdXBwb3J0ZWRBdWRpb0NvZGVjcyB9IGZyb20gXCIuL2hscy1tYW5pZmVzdC5qc1wiO1xuaW1wb3J0IHsgQnVmZmVyIH0gZnJvbSBcIm5vZGU6YnVmZmVyXCI7XG5cbmNvbnN0IHNlbmRKc29uID0gKHJlcywgc3RhdHVzLCBwYXlsb2FkKSA9PiB7XG4gIHJlcy5zdGF0dXNDb2RlID0gc3RhdHVzO1xuICByZXMuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOFwiKTtcbiAgcmVzLnNldEhlYWRlcihcIkNhY2hlLUNvbnRyb2xcIiwgXCJuby1zdG9yZVwiKTtcbiAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShwYXlsb2FkKSk7XG59O1xuXG5jb25zdCBzZW5kRXJyb3IgPSAocmVzLCBzdGF0dXMsIG1lc3NhZ2UpID0+IHtcbiAgcmVzLnN0YXR1c0NvZGUgPSBzdGF0dXM7XG4gIHJlcy5zZXRIZWFkZXIoXCJDb250ZW50LVR5cGVcIiwgXCJ0ZXh0L3BsYWluOyBjaGFyc2V0PXV0Zi04XCIpO1xuICByZXMuc2V0SGVhZGVyKFwiQ2FjaGUtQ29udHJvbFwiLCBcIm5vLXN0b3JlXCIpO1xuICByZXMuZW5kKG1lc3NhZ2UpO1xufTtcblxuLy8gRmV0Y2ggd2l0aCBhdXRvLWZvbGxvdy1yZWRpcmVjdHMgKHVwIHRvIDUgaG9wcyksIHByZXNlcnZpbmcgaGVhZGVycy5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoVXJsKHRhcmdldFVybCwgb3B0aW9ucyA9IHt9KSB7XG4gIGNvbnN0IGh0dHAgPSB0YXJnZXRVcmwuc3RhcnRzV2l0aChcImh0dHBzOlwiKSA/IGF3YWl0IGltcG9ydChcIm5vZGU6aHR0cHNcIikgOiBhd2FpdCBpbXBvcnQoXCJub2RlOmh0dHBcIik7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgcmVxID0gaHR0cC5nZXQodGFyZ2V0VXJsLCB7XG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIFwiVXNlci1BZ2VudFwiOiBcIk1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNlwiLFxuICAgICAgICAuLi5vcHRpb25zLmhlYWRlcnMsXG4gICAgICB9LFxuICAgICAgdGltZW91dDogMjAwMDAsXG4gICAgfSwgKHJlcykgPT4ge1xuICAgICAgaWYgKHJlcy5zdGF0dXNDb2RlID49IDMwMCAmJiByZXMuc3RhdHVzQ29kZSA8IDQwMCAmJiByZXMuaGVhZGVycy5sb2NhdGlvbikge1xuICAgICAgICBjb25zdCBuZXh0VXJsID0gbmV3IFVSTChyZXMuaGVhZGVycy5sb2NhdGlvbiwgdGFyZ2V0VXJsKS5ocmVmO1xuICAgICAgICByZXMuZGVzdHJveSgpO1xuICAgICAgICByZXNvbHZlKGZldGNoVXJsKG5leHRVcmwsIG9wdGlvbnMpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKHJlcy5zdGF0dXNDb2RlICE9PSAyMDApIHtcbiAgICAgICAgcmVzLmRlc3Ryb3koKTtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgSFRUUCAke3Jlcy5zdGF0dXNDb2RlfSBmb3IgJHt0YXJnZXRVcmx9YCkpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICByZXNvbHZlKHJlcyk7XG4gICAgfSk7XG4gICAgcmVxLm9uKFwiZXJyb3JcIiwgcmVqZWN0KTtcbiAgICByZXEub24oXCJ0aW1lb3V0XCIsICgpID0+IHtcbiAgICAgIHJlcS5kZXN0cm95KCk7XG4gICAgICByZWplY3QobmV3IEVycm9yKGBUaW1lb3V0IGZldGNoaW5nICR7dGFyZ2V0VXJsfWApKTtcbiAgICB9KTtcbiAgfSk7XG59XG5cbi8vIENvbGxlY3QgYm9keSBmcm9tIGEgc3RyZWFtIHVwIHRvIGBtYXhCeXRlc2AgKGRlZmF1bHQgNTAgTUIpLlxuYXN5bmMgZnVuY3Rpb24gY29sbGVjdEJvZHkoc3RyZWFtLCBtYXhCeXRlcyA9IDUwICogMTAyNCAqIDEwMjQpIHtcbiAgY29uc3QgY2h1bmtzID0gW107XG4gIGxldCB0b3RhbCA9IDA7XG4gIGZvciBhd2FpdCAoY29uc3QgY2h1bmsgb2Ygc3RyZWFtKSB7XG4gICAgdG90YWwgKz0gY2h1bmsubGVuZ3RoO1xuICAgIGlmICh0b3RhbCA+IG1heEJ5dGVzKSBicmVhaztcbiAgICBjaHVua3MucHVzaChjaHVuayk7XG4gIH1cbiAgcmV0dXJuIEJ1ZmZlci5jb25jYXQoY2h1bmtzKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gc2lkZWNhclBsdWdpbigpIHtcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBcInNpZGVjYXItaGxzLXBsdWdpblwiLFxuXG4gICAgY29uZmlndXJlU2VydmVyKHNlcnZlcikge1xuICAgICAgLy8gXHUyNTAwXHUyNTAwIC9hcGkvc2lkZWNhci9oZWFsdGggXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gICAgICBzZXJ2ZXIubWlkZGxld2FyZXMudXNlKFwiL2FwaS9zaWRlY2FyL2hlYWx0aFwiLCAoX3JlcSwgcmVzKSA9PiB7XG4gICAgICAgIHNlbmRKc29uKHJlcywgMjAwLCB7IG9rOiB0cnVlLCBwbHVnaW46IFwic2lkZWNhci1obHNcIiB9KTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBcdTI1MDBcdTI1MDAgL2FwaS9zaWRlY2FyL3N0cmVhbSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgICAgIC8vIEdFVCAvYXBpL3NpZGVjYXIvc3RyZWFtP3VybD08ZW5jb2RlZF91cmw+XG4gICAgICAvLyBSZXR1cm5zIHRoZSAocG90ZW50aWFsbHkgcmV3cml0dGVuKSBtYW5pZmVzdCB0ZXh0IGFzIENvbnRlbnQtVHlwZTogdm5kLmFwcGxlLm1wZWd1cmxcbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoXCIvYXBpL3NpZGVjYXIvc3RyZWFtXCIsIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxLnVybCwgXCJodHRwOi8vbG9jYWxob3N0XCIpO1xuICAgICAgICAgIGNvbnN0IGVuY29kZWRTdHJlYW1VcmwgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInVybFwiKTtcblxuICAgICAgICAgIGlmICghZW5jb2RlZFN0cmVhbVVybCkge1xuICAgICAgICAgICAgc2VuZEVycm9yKHJlcywgNDAwLCBcIk1pc3NpbmcgP3VybD0gcGFyYW1ldGVyXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGxldCBzdHJlYW1Vcmw7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHN0cmVhbVVybCA9IGRlY29kZVVSSUNvbXBvbmVudChlbmNvZGVkU3RyZWFtVXJsKTtcbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIHNlbmRFcnJvcihyZXMsIDQwMCwgXCJJbnZhbGlkIFVSTCBlbmNvZGluZ1wiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBWYWxpZGF0ZSBpdCBsb29rcyBsaWtlIGFuIGh0dHAocykgVVJMXG4gICAgICAgICAgaWYgKCFzdHJlYW1Vcmwuc3RhcnRzV2l0aChcImh0dHA6Ly9cIikgJiYgIXN0cmVhbVVybC5zdGFydHNXaXRoKFwiaHR0cHM6Ly9cIikpIHtcbiAgICAgICAgICAgIHNlbmRFcnJvcihyZXMsIDQwMCwgXCJPbmx5IGh0dHAvaHR0cHMgVVJMcyBhcmUgc3VwcG9ydGVkXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIE9ubHkgaGFuZGxlIEhMUyBtYW5pZmVzdHNcbiAgICAgICAgICBpZiAoIXN0cmVhbVVybC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwiLm0zdThcIikpIHtcbiAgICAgICAgICAgIHNlbmRFcnJvcihyZXMsIDQwMCwgXCJPbmx5IEhMUyAoLm0zdTgpIHN0cmVhbXMgYXJlIHN1cHBvcnRlZCBieSB0aGUgc2lkZWNhclwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoVXJsKHN0cmVhbVVybCk7XG4gICAgICAgICAgY29uc3QgYm9keSA9IGF3YWl0IGNvbGxlY3RCb2R5KHJlc3BvbnNlKTtcbiAgICAgICAgICBjb25zdCBtYW5pZmVzdFRleHQgPSBib2R5LnRvU3RyaW5nKFwidXRmOFwiKTtcblxuICAgICAgICAgIC8vIERldGVjdCBpZiBtYW5pZmVzdCBoYXMgcHJvYmxlbWF0aWMgYXVkaW9cbiAgICAgICAgICBjb25zdCBoYXNCYWRBdWRpbyA9IGhhc1Vuc3VwcG9ydGVkQXVkaW9Db2RlY3MobWFuaWZlc3RUZXh0KTtcblxuICAgICAgICAgIGlmICghaGFzQmFkQXVkaW8pIHtcbiAgICAgICAgICAgIC8vIE5vIHJld3JpdGluZyBuZWVkZWQgXHUyMDE0IHNlcnZlIGFzLWlzIHdpdGggYSBub3RlXG4gICAgICAgICAgICByZXMuc3RhdHVzQ29kZSA9IDIwMDtcbiAgICAgICAgICAgIHJlcy5zZXRIZWFkZXIoXCJDb250ZW50LVR5cGVcIiwgXCJhcHBsaWNhdGlvbi92bmQuYXBwbGUubXBlZ3VybDsgY2hhcnNldD11dGYtOFwiKTtcbiAgICAgICAgICAgIHJlcy5zZXRIZWFkZXIoXCJDYWNoZS1Db250cm9sXCIsIFwibm8tc3RvcmVcIik7XG4gICAgICAgICAgICByZXMuc2V0SGVhZGVyKFwiWC1TaWRlY2FyLU9yaWdpbmFsXCIsIFwidHJ1ZVwiKTtcbiAgICAgICAgICAgIHJlcy5lbmQobWFuaWZlc3RUZXh0KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBCdWlsZCBwcm94eSBzZWdtZW50IFVSTCBmb3IgdGhpcyBzdHJlYW1cbiAgICAgICAgICBjb25zdCBiYXNlVXJsID0gbmV3IFVSTChzdHJlYW1VcmwpO1xuICAgICAgICAgIGNvbnN0IHByb3h5U2VnbWVudFVybCA9IChlbmNvZGVkU2VnVXJsKSA9PlxuICAgICAgICAgICAgYC9hcGkvc2lkZWNhci9zZWdtZW50P3VybD0ke2VuY29kZWRTZWdVcmx9JmJhc2U9JHtlbmNvZGVVUklDb21wb25lbnQoYmFzZVVybC5vcmlnaW4gKyBiYXNlVXJsLnBhdGhuYW1lLnJlcGxhY2UoL1xcL1teL10qJC8sIFwiL1wiKSl9YDtcblxuICAgICAgICAgIGNvbnN0IHJld3JpdHRlbiA9IHJld3JpdGVNYW5pZmVzdChtYW5pZmVzdFRleHQsIGJhc2VVcmwub3JpZ2luLCBwcm94eVNlZ21lbnRVcmwpO1xuXG4gICAgICAgICAgcmVzLnN0YXR1c0NvZGUgPSAyMDA7XG4gICAgICAgICAgcmVzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcImFwcGxpY2F0aW9uL3ZuZC5hcHBsZS5tcGVndXJsOyBjaGFyc2V0PXV0Zi04XCIpO1xuICAgICAgICAgIHJlcy5zZXRIZWFkZXIoXCJDYWNoZS1Db250cm9sXCIsIFwibm8tc3RvcmVcIik7XG4gICAgICAgICAgcmVzLnNldEhlYWRlcihcIlgtU2lkZWNhci1SZXdyaXR0ZW5cIiwgXCJ0cnVlXCIpO1xuICAgICAgICAgIHJlcy5lbmQocmV3cml0dGVuKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKFwiW3NpZGVjYXItcGx1Z2luXSBzdHJlYW0gZXJyb3I6XCIsIGVycj8ubWVzc2FnZSB8fCBlcnIpO1xuICAgICAgICAgIHNlbmRFcnJvcihyZXMsIDUwMiwgYFNpZGVjYXIgZXJyb3I6ICR7ZXJyPy5tZXNzYWdlIHx8IFwiVW5rbm93biBlcnJvclwifWApO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgLy8gXHUyNTAwXHUyNTAwIC9hcGkvc2lkZWNhci9zZWdtZW50IFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICAgICAgLy8gR0VUIC9hcGkvc2lkZWNhci9zZWdtZW50P3VybD08ZW5jb2RlZF91cmw+JmJhc2U9PGVuY29kZWRfYmFzZT5cbiAgICAgIC8vIFByb3hpZXMgc2VnbWVudCBkYXRhIHdpdGggQ09SUyBoZWFkZXJzIHNvIEhMUy5qcyBjYW4gZmV0Y2ggY3Jvc3Mtb3JpZ2luIHNlZ21lbnRzLlxuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShcIi9hcGkvc2lkZWNhci9zZWdtZW50XCIsIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxLnVybCwgXCJodHRwOi8vbG9jYWxob3N0XCIpO1xuICAgICAgICAgIGNvbnN0IGVuY29kZWRTZWdVcmwgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInVybFwiKTtcbiAgICAgICAgICBjb25zdCBlbmNvZGVkQmFzZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiYmFzZVwiKTtcblxuICAgICAgICAgIGlmICghZW5jb2RlZFNlZ1VybCkge1xuICAgICAgICAgICAgc2VuZEVycm9yKHJlcywgNDAwLCBcIk1pc3NpbmcgP3VybD0gcGFyYW1ldGVyXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGxldCBzZWdVcmw7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHNlZ1VybCA9IGRlY29kZVVSSUNvbXBvbmVudChlbmNvZGVkU2VnVXJsKTtcbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIHNlbmRFcnJvcihyZXMsIDQwMCwgXCJJbnZhbGlkIFVSTCBlbmNvZGluZ1wiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBJZiBubyBleHBsaWNpdCBiYXNlIHByb3ZpZGVkLCB0aGUgc2VnbWVudCBVUkwgbXVzdCBiZSBhYnNvbHV0ZVxuICAgICAgICAgIGlmICghc2VnVXJsLnN0YXJ0c1dpdGgoXCJodHRwOi8vXCIpICYmICFzZWdVcmwuc3RhcnRzV2l0aChcImh0dHBzOi8vXCIpKSB7XG4gICAgICAgICAgICBpZiAoIWVuY29kZWRCYXNlKSB7XG4gICAgICAgICAgICAgIHNlbmRFcnJvcihyZXMsIDQwMCwgXCJSZWxhdGl2ZSBzZWdtZW50IFVSTCByZXF1aXJlcyBiYXNlIHBhcmFtZXRlclwiKTtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgY29uc3QgYmFzZSA9IGRlY29kZVVSSUNvbXBvbmVudChlbmNvZGVkQmFzZSk7XG4gICAgICAgICAgICAgIHNlZ1VybCA9IG5ldyBVUkwoc2VnVXJsLCBiYXNlKS5ocmVmO1xuICAgICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAgIHNlbmRFcnJvcihyZXMsIDQwMCwgXCJJbnZhbGlkIGJhc2UgVVJMXCIpO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaFVybChzZWdVcmwpO1xuICAgICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcmVzcG9uc2UuaGVhZGVyc1tcImNvbnRlbnQtdHlwZVwiXSB8fCBcImFwcGxpY2F0aW9uL29jdGV0LXN0cmVhbVwiO1xuXG4gICAgICAgICAgcmVzLnN0YXR1c0NvZGUgPSAyMDA7XG4gICAgICAgICAgcmVzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBjb250ZW50VHlwZSk7XG4gICAgICAgICAgcmVzLnNldEhlYWRlcihcIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpblwiLCBcIipcIik7XG4gICAgICAgICAgcmVzLnNldEhlYWRlcihcIkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnNcIiwgXCIqXCIpO1xuICAgICAgICAgIHJlcy5zZXRIZWFkZXIoXCJBY2Nlc3MtQ29udHJvbC1FeHBvc2UtSGVhZGVyc1wiLCBcIkNvbnRlbnQtTGVuZ3RoLENvbnRlbnQtVHlwZVwiKTtcbiAgICAgICAgICByZXMuc2V0SGVhZGVyKFwiQ2FjaGUtQ29udHJvbFwiLCBcInB1YmxpYywgbWF4LWFnZT0zNjAwXCIpO1xuICAgICAgICAgIC8vIERpc2FibGUgY2h1bmtlZCBlbmNvZGluZyBcdTIwMTQgd2UgbWF5IG5vdCBoYXZlIENvbnRlbnQtTGVuZ3RoIGJ1dCB3ZSBhcmUgZm9yd2FyZGluZyBmcm9tIGFuIG9wZW4gY29ubmVjdGlvblxuICAgICAgICAgIHJlc3BvbnNlLnBpcGUocmVzKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKFwiW3NpZGVjYXItcGx1Z2luXSBzZWdtZW50IGVycm9yOlwiLCBlcnI/Lm1lc3NhZ2UgfHwgZXJyKTtcbiAgICAgICAgICBzZW5kRXJyb3IocmVzLCA1MDIsIGBTZWdtZW50IGVycm9yOiAke2Vycj8ubWVzc2FnZSB8fCBcIlVua25vd24gZXJyb3JcIn1gKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSxcbiAgfTtcbn0iXSwKICAibWFwcGluZ3MiOiAiO0FBQW1RLFNBQVMsb0JBQW9CO0FBQ2hTLE9BQU8sV0FBVzs7O0FDUWxCLFNBQVMscUJBQXFCO0FBVCtJLElBQU0sMkNBQTJDO0FBVzlOLElBQU1BLFdBQVUsY0FBYyx3Q0FBZTtBQUM3QyxJQUFNLFNBQVNBLFNBQVEsWUFBWTtBQUduQyxJQUFJLGlCQUFpQjtBQUNyQixJQUFNLFlBQVksTUFBTTtBQUN0QixNQUFJLENBQUMsZ0JBQWdCO0FBQ25CLHFCQUFpQixJQUFJLE9BQU87QUFBQSxFQUM5QjtBQUNBLFNBQU87QUFDVDtBQUlBLElBQU0sbUJBQW1CLENBQUMsU0FBUyxTQUFTO0FBQzFDLE1BQUksQ0FBQyxNQUFNLFFBQVEsT0FBTyxLQUFLLFFBQVEsV0FBVyxFQUFHLFFBQU87QUFFNUQsUUFBTSxhQUFhLFNBQVMsWUFBWSxTQUFTLE9BQzdDLFFBQVEsT0FBTyxDQUFDLE1BQU0sa0JBQWtCLEtBQUssR0FBRyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLEVBQUUsQ0FBQyxJQUM3RSxRQUFRLE9BQU8sQ0FBQyxNQUFNLGNBQWMsS0FBSyxHQUFHLEVBQUUsUUFBUSxFQUFFLEVBQUUsS0FBSyxDQUFDLGFBQWEsS0FBSyxHQUFHLEVBQUUsTUFBTSxFQUFFLEVBQUUsQ0FBQztBQUV0RyxTQUFPLFdBQVcsQ0FBQyxLQUFLLFFBQVEsQ0FBQztBQUNuQztBQUdBLElBQU0sbUJBQW1CLE9BQU8sT0FBTyxRQUFRLFlBQVk7QUFDekQsUUFBTSxTQUFTLFVBQVU7QUFDekIsUUFBTSxnQkFBZ0IsTUFBTSxPQUFPLE9BQU8sS0FBSztBQUMvQyxRQUFNLE9BQU8saUJBQWlCLGVBQWUsUUFBUTtBQUNyRCxNQUFJLENBQUMsTUFBTSxHQUFJLE9BQU0sSUFBSSxNQUFNLCtCQUErQixLQUFLLEdBQUc7QUFFdEUsUUFBTSxVQUFVLE1BQU0sT0FBTyxXQUFXLEtBQUssRUFBRTtBQUMvQyxNQUFJLENBQUMsTUFBTSxRQUFRLE9BQU8sS0FBSyxRQUFRLFdBQVcsR0FBRztBQUNuRCxVQUFNLElBQUksTUFBTSxpQ0FBaUMsS0FBSyxHQUFHO0FBQUEsRUFDM0Q7QUFFQSxRQUFNLGVBQWUsUUFBUTtBQUFBLElBQUssQ0FBQyxNQUNqQyxPQUFPLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxZQUFZLE1BQU0sT0FBTyxNQUFNO0FBQUEsRUFDbEUsS0FBSyxRQUFRLEtBQUssQ0FBQyxNQUFNLE9BQU8sRUFBRSxVQUFVLEVBQUUsVUFBVSxFQUFFLFlBQVksTUFBTSxPQUFPLE1BQU0sQ0FBQztBQUUxRixNQUFJLENBQUMsY0FBYyxHQUFJLE9BQU0sSUFBSSxNQUFNLGtCQUFrQixNQUFNLFlBQVk7QUFFM0UsUUFBTSxXQUFXLE1BQU0sT0FBTyxZQUFZLGFBQWEsRUFBRTtBQUN6RCxRQUFNLGdCQUFnQixTQUFTO0FBQUEsSUFBSyxDQUFDLE1BQ25DLE9BQU8sRUFBRSxXQUFXLEVBQUUsVUFBVSxFQUFFLGFBQWEsTUFBTSxPQUFPLE9BQU87QUFBQSxFQUNyRSxLQUFLLFNBQVMsS0FBSyxDQUFDLE1BQU0sT0FBTyxFQUFFLFdBQVcsRUFBRSxVQUFVLEVBQUUsYUFBYSxNQUFNLE9BQU8sT0FBTyxDQUFDO0FBRTlGLE1BQUksQ0FBQyxlQUFlLEdBQUksT0FBTSxJQUFJLE1BQU0sbUJBQW1CLE9BQU8sWUFBWTtBQUM5RSxTQUFPLGNBQWM7QUFDdkI7QUFFQSxJQUFNLGlCQUFpQixPQUFPLFVBQVU7QUFDdEMsUUFBTSxTQUFTLFVBQVU7QUFDekIsUUFBTSxnQkFBZ0IsTUFBTSxPQUFPLE9BQU8sS0FBSztBQUMvQyxRQUFNLFFBQVEsaUJBQWlCLGVBQWUsT0FBTztBQUNyRCxNQUFJLENBQUMsT0FBTyxHQUFJLE9BQU0sSUFBSSxNQUFNLGdDQUFnQyxLQUFLLEdBQUc7QUFDeEUsU0FBTyxNQUFNO0FBQ2Y7QUFHQSxJQUFNLGdCQUFnQixPQUFPLFdBQVcsU0FBUztBQUMvQyxRQUFNLFNBQVMsVUFBVTtBQUN6QixRQUFNLGFBQWEsU0FBUyxZQUFZLFNBQVMsT0FBTyxPQUFPO0FBQy9ELFFBQU0sVUFBVSxNQUFNLE9BQU8sV0FBVyxXQUFXLFVBQVU7QUFDN0QsTUFBSSxDQUFDLE1BQU0sUUFBUSxPQUFPLEtBQUssUUFBUSxXQUFXLEdBQUc7QUFDbkQsVUFBTSxJQUFJLE1BQU0sNENBQTRDO0FBQUEsRUFDOUQ7QUFFQSxNQUFJLFlBQVk7QUFDaEIsYUFBVyxVQUFVLFNBQVM7QUFDNUIsUUFBSSxDQUFDLFFBQVEsR0FBSTtBQUNqQixRQUFJO0FBQ0YsWUFBTSxTQUFTLE1BQU0sT0FBTyxZQUFZLE9BQU8sRUFBRTtBQUNqRCxVQUFJLFFBQVEsUUFBUTtBQUNsQixlQUFPO0FBQUEsVUFDTCxLQUFLLE9BQU87QUFBQSxVQUNaLE1BQU0sT0FBTyxRQUFRO0FBQUEsVUFDckIsWUFBWSxPQUFPLFFBQVEsT0FBTztBQUFBLFVBQ2xDLFdBQVcsUUFBUSxPQUFPLFNBQVM7QUFBQSxRQUNyQztBQUFBLE1BQ0Y7QUFBQSxJQUNGLFNBQVMsT0FBTztBQUNkLGtCQUFZO0FBQUEsSUFDZDtBQUFBLEVBQ0Y7QUFFQSxRQUFNLGFBQWEsSUFBSSxNQUFNLDhDQUE4QztBQUM3RTtBQUVBLElBQU0sV0FBVyxDQUFDLEtBQUssUUFBUSxZQUFZO0FBQ3pDLE1BQUksYUFBYTtBQUNqQixNQUFJLFVBQVUsZ0JBQWdCLGlDQUFpQztBQUMvRCxNQUFJLFVBQVUsaUJBQWlCLFVBQVU7QUFDekMsTUFBSSxJQUFJLEtBQUssVUFBVSxPQUFPLENBQUM7QUFDakM7QUFFZSxTQUFSLGtCQUFtQztBQUN4QyxTQUFPO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixnQkFBZ0IsUUFBUTtBQUN0QixhQUFPLFlBQVksSUFBSSxzQkFBc0IsT0FBTyxLQUFLLFFBQVE7QUFDL0QsWUFBSTtBQUNGLGdCQUFNLE1BQU0sSUFBSSxJQUFJLElBQUksS0FBSyxrQkFBa0I7QUFDL0MsZ0JBQU0sUUFBUSxJQUFJLGFBQWEsSUFBSSxPQUFPLEdBQUcsS0FBSztBQUNsRCxnQkFBTSxPQUFPLElBQUksYUFBYSxJQUFJLE1BQU0sS0FBSztBQUM3QyxnQkFBTSxTQUFTLElBQUksYUFBYSxJQUFJLFFBQVE7QUFDNUMsZ0JBQU0sVUFBVSxJQUFJLGFBQWEsSUFBSSxTQUFTO0FBRTlDLGNBQUksQ0FBQyxPQUFPO0FBQ1YscUJBQVMsS0FBSyxLQUFLLEVBQUUsT0FBTyxvQ0FBb0MsQ0FBQztBQUNqRTtBQUFBLFVBQ0Y7QUFFQSxnQkFBTSxZQUFhLFNBQVMsWUFBWSxTQUFTLE9BQzdDLE1BQU0saUJBQWlCLE9BQU8sUUFBUSxPQUFPLElBQzdDLE1BQU0sZUFBZSxLQUFLO0FBRTlCLGdCQUFNLFNBQVMsTUFBTSxjQUFjLFdBQVcsSUFBSTtBQUNsRCxtQkFBUyxLQUFLLEtBQUssRUFBRSxHQUFHLFFBQVEsT0FBTyxLQUFLLENBQUM7QUFBQSxRQUMvQyxTQUFTLE9BQU87QUFDZCxrQkFBUSxLQUFLLG1CQUFtQixPQUFPLFdBQVcsS0FBSztBQUN2RCxtQkFBUyxLQUFLLEtBQUssRUFBRSxPQUFPLE9BQU8sV0FBVyx1QkFBdUIsQ0FBQztBQUFBLFFBQ3hFO0FBQUEsTUFDRixDQUFDO0FBR0QsYUFBTyxZQUFZLElBQUksc0JBQXNCLENBQUMsTUFBTSxRQUFRO0FBQzFELGlCQUFTLEtBQUssS0FBSyxFQUFFLElBQUksTUFBTSxRQUFRLGFBQWEsQ0FBQztBQUFBLE1BQ3ZELENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUNGOzs7QUNqSUEsSUFBTSxnQkFBZ0I7QUFDdEIsSUFBTSxzQkFBc0I7QUFFNUIsSUFBTUMsWUFBVyxDQUFDLEtBQUssUUFBUSxZQUFZO0FBQ3pDLE1BQUksYUFBYTtBQUNqQixNQUFJLFVBQVUsZ0JBQWdCLGlDQUFpQztBQUMvRCxNQUFJLFVBQVUsaUJBQWlCLFVBQVU7QUFDekMsTUFBSSxJQUFJLEtBQUssVUFBVSxPQUFPLENBQUM7QUFDakM7QUFFZSxTQUFSLGlCQUFrQztBQUN2QyxTQUFPO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixnQkFBZ0IsUUFBUTtBQUN0QixhQUFPLFlBQVksSUFBSSx1QkFBdUIsT0FBTyxLQUFLLFFBQVE7QUFDaEUsWUFBSTtBQUNGLGdCQUFNLE1BQU0sSUFBSSxJQUFJLElBQUksS0FBSyxrQkFBa0I7QUFDL0MsZ0JBQU0sT0FBTyxJQUFJLGFBQWEsSUFBSSxNQUFNLEtBQUs7QUFDN0MsZ0JBQU0sU0FBUyxJQUFJLGFBQWEsSUFBSSxRQUFRO0FBQzVDLGdCQUFNLFNBQVMsSUFBSSxhQUFhLElBQUksUUFBUTtBQUM1QyxnQkFBTSxVQUFVLElBQUksYUFBYSxJQUFJLFNBQVM7QUFDOUMsZ0JBQU0sV0FBVyxJQUFJLGFBQWEsSUFBSSxVQUFVO0FBRWhELGNBQUksQ0FBQyxRQUFRO0FBQ1gsWUFBQUEsVUFBUyxLQUFLLEtBQUssRUFBRSxPQUFPLHFDQUFxQyxDQUFDO0FBQ2xFO0FBQUEsVUFDRjtBQUdBLGNBQUk7QUFDSixjQUFJLFNBQVMsUUFBUSxTQUFTLFVBQVU7QUFDdEMsZ0JBQUksQ0FBQyxVQUFVLENBQUMsU0FBUztBQUN2QixjQUFBQSxVQUFTLEtBQUssS0FBSyxFQUFFLE9BQU8sK0NBQStDLENBQUM7QUFDNUU7QUFBQSxZQUNGO0FBQ0EscUJBQVMsR0FBRyxhQUFhLGFBQWEsTUFBTSxJQUFJLE1BQU0sSUFBSSxPQUFPO0FBQUEsVUFDbkUsT0FBTztBQUNMLHFCQUFTLEdBQUcsYUFBYSxnQkFBZ0IsTUFBTTtBQUFBLFVBQ2pEO0FBR0EsY0FBSSxVQUFVO0FBQ1osc0JBQVUsYUFBYSxtQkFBbUIsUUFBUSxDQUFDO0FBQUEsVUFDckQ7QUFFQSxnQkFBTSxhQUFhLElBQUksZ0JBQWdCO0FBQ3ZDLGdCQUFNLFFBQVEsV0FBVyxNQUFNLFdBQVcsTUFBTSxHQUFHLG1CQUFtQjtBQUV0RSxjQUFJO0FBQ0Ysa0JBQU0sV0FBVyxNQUFNLE1BQU0sUUFBUTtBQUFBLGNBQ25DLFFBQVEsV0FBVztBQUFBLGNBQ25CLFNBQVM7QUFBQSxnQkFDUCxjQUFjO0FBQUEsY0FDaEI7QUFBQSxZQUNGLENBQUM7QUFFRCxnQkFBSSxDQUFDLFNBQVMsSUFBSTtBQUNoQixvQkFBTSxPQUFPLE1BQU0sU0FBUyxLQUFLLEVBQUUsTUFBTSxNQUFNLEVBQUU7QUFDakQsc0JBQVEsS0FBSyxjQUFjLFNBQVMsTUFBTSxLQUFLLEtBQUssTUFBTSxHQUFHLEdBQUcsQ0FBQyxFQUFFO0FBQ25FLGNBQUFBLFVBQVMsS0FBSyxLQUFLLEVBQUUsT0FBTyxxQkFBcUIsU0FBUyxNQUFNLElBQUksU0FBUyxDQUFDLEVBQUUsQ0FBQztBQUNqRjtBQUFBLFlBQ0Y7QUFFQSxrQkFBTSxPQUFPLE1BQU0sU0FBUyxLQUFLO0FBQ2pDLFlBQUFBLFVBQVMsS0FBSyxLQUFLO0FBQUEsY0FDakIsS0FBSyxRQUFRLEtBQUssR0FBRztBQUFBLGNBQ3JCLFNBQVMsTUFBTSxRQUFRLEtBQUssT0FBTyxJQUFJLEtBQUssVUFBVSxDQUFDO0FBQUEsWUFDekQsQ0FBQztBQUFBLFVBQ0gsVUFBRTtBQUNBLHlCQUFhLEtBQUs7QUFBQSxVQUNwQjtBQUFBLFFBQ0YsU0FBUyxPQUFPO0FBQ2QsY0FBSSxPQUFPLFNBQVMsY0FBYztBQUNoQyxZQUFBQSxVQUFTLEtBQUssS0FBSyxFQUFFLE9BQU8sOEJBQThCLFNBQVMsQ0FBQyxFQUFFLENBQUM7QUFBQSxVQUN6RSxPQUFPO0FBQ0wsb0JBQVEsS0FBSyxxQkFBcUIsT0FBTyxXQUFXLEtBQUs7QUFDekQsWUFBQUEsVUFBUyxLQUFLLEtBQUssRUFBRSxPQUFPLE9BQU8sV0FBVyx5QkFBeUIsU0FBUyxDQUFDLEVBQUUsQ0FBQztBQUFBLFVBQ3RGO0FBQUEsUUFDRjtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBQ0Y7OztBQ2hGQSxJQUFNLGtCQUFrQjtBQUN4QixJQUFNLHdCQUF3QjtBQUk5QixJQUFNLG1CQUFtQjtBQUFBLEVBQ3ZCO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUNGO0FBRUEsSUFBTSxxQkFBcUIsQ0FBQyxZQUFZO0FBQ3RDLE1BQUksQ0FBQyxXQUFXLE9BQU8sWUFBWSxTQUFVLFFBQU87QUFDcEQsTUFBSTtBQUVGLFFBQUksZUFBZSxRQUFRLE1BQU0sQ0FBQztBQUVsQyxhQUFTLElBQUksaUJBQWlCLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUNyRCxxQkFBZSxhQUFhLFFBQVEsS0FBSyxpQkFBaUIsQ0FBQyxDQUFDLElBQUksRUFBRTtBQUFBLElBQ3BFO0FBQ0EsV0FBTyxLQUFLLFlBQVk7QUFBQSxFQUMxQixRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQUVBLElBQU1DLFlBQVcsQ0FBQyxLQUFLLFFBQVEsWUFBWTtBQUN6QyxNQUFJLGFBQWE7QUFDakIsTUFBSSxVQUFVLGdCQUFnQixpQ0FBaUM7QUFDL0QsTUFBSSxVQUFVLGlCQUFpQixVQUFVO0FBQ3pDLE1BQUksSUFBSSxLQUFLLFVBQVUsT0FBTyxDQUFDO0FBQ2pDO0FBRWUsU0FBUixtQkFBb0M7QUFDekMsU0FBTztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sZ0JBQWdCLFFBQVE7QUFDdEIsYUFBTyxZQUFZLElBQUkseUJBQXlCLE9BQU8sS0FBSyxRQUFRO0FBQ2xFLFlBQUk7QUFDRixnQkFBTSxNQUFNLElBQUksSUFBSSxJQUFJLEtBQUssa0JBQWtCO0FBQy9DLGdCQUFNLFNBQVMsSUFBSSxhQUFhLElBQUksUUFBUTtBQUM1QyxnQkFBTSxPQUFPLElBQUksYUFBYSxJQUFJLE1BQU0sS0FBSztBQUM3QyxnQkFBTSxTQUFTLElBQUksYUFBYSxJQUFJLFFBQVE7QUFDNUMsZ0JBQU0sVUFBVSxJQUFJLGFBQWEsSUFBSSxTQUFTO0FBRTlDLGNBQUksQ0FBQyxRQUFRO0FBQ1gsWUFBQUEsVUFBUyxLQUFLLEtBQUssRUFBRSxPQUFPLHNDQUFzQyxTQUFTLENBQUMsRUFBRSxDQUFDO0FBQy9FO0FBQUEsVUFDRjtBQUVBLGdCQUFNLGFBQWEsSUFBSSxnQkFBZ0I7QUFDdkMsZ0JBQU0sUUFBUSxXQUFXLE1BQU0sV0FBVyxNQUFNLEdBQUcscUJBQXFCO0FBRXhFLGNBQUk7QUFFRixrQkFBTSxlQUFlLE1BQU0sTUFBTSxHQUFHLGVBQWUsa0JBQWtCO0FBQUEsY0FDbkUsUUFBUTtBQUFBLGNBQ1IsUUFBUSxXQUFXO0FBQUEsY0FDbkIsU0FBUztBQUFBLGdCQUNQLGdCQUFnQjtBQUFBLGdCQUNoQixVQUFVO0FBQUEsZ0JBQ1YsV0FBVyxHQUFHLGVBQWU7QUFBQSxnQkFDN0IsY0FBYztBQUFBLGNBQ2hCO0FBQUEsY0FDQSxNQUFNO0FBQUEsWUFDUixDQUFDO0FBRUQsZ0JBQUksQ0FBQyxhQUFhLElBQUk7QUFDcEIsc0JBQVEsS0FBSyxxQkFBcUIsYUFBYSxNQUFNLEVBQUU7QUFDdkQsY0FBQUEsVUFBUyxLQUFLLEtBQUssRUFBRSxPQUFPLDZCQUE2QixhQUFhLE1BQU0sSUFBSSxTQUFTLENBQUMsRUFBRSxDQUFDO0FBQzdGO0FBQUEsWUFDRjtBQUdBLGtCQUFNLFVBQVUsYUFBYSxRQUFRLGVBQWUsS0FBSyxDQUFDO0FBQzFELGtCQUFNLGVBQWUsUUFDbEIsSUFBSSxDQUFDLE1BQU0sRUFBRSxNQUFNLEdBQUcsRUFBRSxDQUFDLENBQUMsRUFDMUIsS0FBSyxJQUFJO0FBR1osa0JBQU0sZUFBZSxJQUFJLGdCQUFnQjtBQUFBLGNBQ3ZDLFFBQVE7QUFBQSxjQUNSLE1BQU0sT0FBTyxNQUFNO0FBQUEsWUFDckIsQ0FBQztBQUNELGlCQUFLLFNBQVMsUUFBUSxTQUFTLGFBQWEsVUFBVSxTQUFTO0FBQzdELDJCQUFhLElBQUksVUFBVSxPQUFPLE1BQU0sQ0FBQztBQUN6QywyQkFBYSxJQUFJLFdBQVcsT0FBTyxPQUFPLENBQUM7QUFBQSxZQUM3QztBQUVBLGtCQUFNLGlCQUFpQixNQUFNLE1BQU0sR0FBRyxlQUFlLGtCQUFrQixhQUFhLFNBQVMsQ0FBQyxJQUFJO0FBQUEsY0FDaEcsUUFBUSxXQUFXO0FBQUEsY0FDbkIsU0FBUztBQUFBLGdCQUNQLFVBQVU7QUFBQSxnQkFDVixXQUFXLEdBQUcsZUFBZTtBQUFBLGdCQUM3QixjQUFjO0FBQUEsY0FDaEI7QUFBQSxZQUNGLENBQUM7QUFFRCxnQkFBSSxDQUFDLGVBQWUsSUFBSTtBQUN0QixzQkFBUSxLQUFLLHVCQUF1QixlQUFlLE1BQU0sRUFBRTtBQUMzRCxjQUFBQSxVQUFTLEtBQUssS0FBSyxFQUFFLE9BQU8sK0JBQStCLGVBQWUsTUFBTSxJQUFJLFNBQVMsQ0FBQyxFQUFFLENBQUM7QUFDakc7QUFBQSxZQUNGO0FBRUEsa0JBQU0sYUFBYSxNQUFNLGVBQWUsS0FBSztBQUc3QyxrQkFBTSxVQUFVLENBQUM7QUFDakIsZ0JBQUksTUFBTSxRQUFRLFdBQVcsVUFBVSxHQUFHO0FBQ3hDLHlCQUFXLFdBQVcsV0FBVyxZQUFZO0FBQzNDLHNCQUFNLFVBQVUsbUJBQW1CLE9BQU87QUFDMUMsb0JBQUksU0FBUztBQUNYLDBCQUFRLEtBQUs7QUFBQSxvQkFDWCxLQUFLO0FBQUEsb0JBQ0wsTUFBTTtBQUFBLG9CQUNOLE1BQU0sUUFBUSxTQUFTLE9BQU8sSUFBSSxRQUFRO0FBQUEsa0JBQzVDLENBQUM7QUFBQSxnQkFDSDtBQUFBLGNBQ0Y7QUFBQSxZQUNGO0FBRUEsWUFBQUEsVUFBUyxLQUFLLEtBQUssRUFBRSxRQUFRLENBQUM7QUFBQSxVQUNoQyxVQUFFO0FBQ0EseUJBQWEsS0FBSztBQUFBLFVBQ3BCO0FBQUEsUUFDRixTQUFTLE9BQU87QUFDZCxjQUFJLE9BQU8sU0FBUyxjQUFjO0FBQ2hDLFlBQUFBLFVBQVMsS0FBSyxLQUFLLEVBQUUsT0FBTyxrQ0FBa0MsU0FBUyxDQUFDLEVBQUUsQ0FBQztBQUFBLFVBQzdFLE9BQU87QUFDTCxvQkFBUSxLQUFLLHVCQUF1QixPQUFPLFdBQVcsS0FBSztBQUMzRCxZQUFBQSxVQUFTLEtBQUssS0FBSyxFQUFFLE9BQU8sT0FBTyxXQUFXLDZCQUE2QixTQUFTLENBQUMsRUFBRSxDQUFDO0FBQUEsVUFDMUY7QUFBQSxRQUNGO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0Y7QUFDRjs7O0FDdklBLElBQU0sbUJBQW1CLFFBQVEsSUFBSSx3QkFDaEM7QUFFTCxJQUFNLHlCQUF5QjtBQUMvQixJQUFNLGtCQUFrQjtBQUd4QixJQUFNLG9CQUFvQixRQUFRLElBQUk7QUFDdEMsSUFBTSxlQUFlLFFBQVEsSUFBSTtBQUdqQyxJQUFNLFlBQVksb0JBQUksSUFBSTtBQUMxQixJQUFNLG9CQUFvQixLQUFLLEtBQUssS0FBSztBQUV6QyxJQUFNQyxZQUFXLENBQUMsS0FBSyxRQUFRLFlBQVk7QUFDekMsTUFBSSxhQUFhO0FBQ2pCLE1BQUksVUFBVSxnQkFBZ0IsaUNBQWlDO0FBQy9ELE1BQUksVUFBVSxpQkFBaUIsVUFBVTtBQUN6QyxNQUFJLElBQUksS0FBSyxVQUFVLE9BQU8sQ0FBQztBQUNqQztBQU1BLElBQU0sYUFBYSxPQUFPLFFBQVEsU0FBUztBQUN6QyxRQUFNLFdBQVcsR0FBRyxJQUFJLElBQUksTUFBTTtBQUNsQyxRQUFNLFNBQVMsVUFBVSxJQUFJLFFBQVE7QUFDckMsTUFBSSxVQUFVLEtBQUssSUFBSSxJQUFJLE9BQU8sS0FBSyxtQkFBbUI7QUFDeEQsV0FBTyxPQUFPO0FBQUEsRUFDaEI7QUFFQSxNQUFJLENBQUMscUJBQXFCLENBQUMsY0FBYztBQUN2QyxZQUFRLEtBQUssaUVBQTREO0FBQ3pFLFdBQU87QUFBQSxFQUNUO0FBRUEsUUFBTSxZQUFZLFNBQVMsUUFBUSxTQUFTLFdBQVcsT0FBTztBQUM5RCxRQUFNLE1BQU0sSUFBSSxJQUFJLGdDQUFnQyxTQUFTLElBQUksTUFBTSxlQUFlO0FBQ3RGLE1BQUksZ0JBQWdCLENBQUMsbUJBQW1CO0FBQ3RDLFFBQUksYUFBYSxJQUFJLFdBQVcsWUFBWTtBQUFBLEVBQzlDO0FBRUEsUUFBTSxhQUFhLElBQUksZ0JBQWdCO0FBQ3ZDLFFBQU0sUUFBUSxXQUFXLE1BQU0sV0FBVyxNQUFNLEdBQUcsZUFBZTtBQUVsRSxNQUFJO0FBQ0YsVUFBTSxXQUFXLE1BQU0sTUFBTSxJQUFJLFNBQVMsR0FBRztBQUFBLE1BQzNDLFFBQVEsV0FBVztBQUFBLE1BQ25CLFNBQVMsb0JBQ0wsRUFBRSxlQUFlLFVBQVUsaUJBQWlCLEdBQUcsSUFDL0MsQ0FBQztBQUFBLElBQ1AsQ0FBQztBQUVELFFBQUksQ0FBQyxTQUFTLElBQUk7QUFDaEIsY0FBUSxLQUFLLG1DQUFtQyxTQUFTLE1BQU0sUUFBUSxNQUFNLEVBQUU7QUFDL0UsYUFBTztBQUFBLElBQ1Q7QUFFQSxVQUFNLE9BQU8sTUFBTSxTQUFTLEtBQUs7QUFDakMsVUFBTSxTQUFTLE1BQU0sV0FBVztBQUVoQyxRQUFJLFFBQVE7QUFDVixnQkFBVSxJQUFJLFVBQVUsRUFBRSxRQUFRLElBQUksS0FBSyxJQUFJLEVBQUUsQ0FBQztBQUFBLElBQ3BEO0FBRUEsV0FBTztBQUFBLEVBQ1QsU0FBUyxPQUFPO0FBQ2QsUUFBSSxPQUFPLFNBQVMsY0FBYztBQUNoQyxjQUFRLEtBQUssb0NBQW9DLE9BQU8sV0FBVyxLQUFLO0FBQUEsSUFDMUU7QUFDQSxXQUFPO0FBQUEsRUFDVCxVQUFFO0FBQ0EsaUJBQWEsS0FBSztBQUFBLEVBQ3BCO0FBQ0Y7QUFNQSxJQUFNLDBCQUEwQixPQUFPLFFBQVEsTUFBTSxRQUFRLFlBQVk7QUFHdkUsUUFBTSxZQUFZLFNBQVMsUUFBUSxTQUFTLFdBQVcsV0FBVztBQUVsRSxNQUFJO0FBQ0osTUFBSSxjQUFjLFVBQVU7QUFDMUIsaUJBQWEsaUJBQWlCLE1BQU0sSUFBSSxNQUFNLElBQUksT0FBTztBQUFBLEVBQzNELE9BQU87QUFDTCxpQkFBYSxnQkFBZ0IsTUFBTTtBQUFBLEVBQ3JDO0FBRUEsUUFBTSxTQUFTLEdBQUcsZ0JBQWdCLElBQUksVUFBVTtBQUVoRCxRQUFNLGFBQWEsSUFBSSxnQkFBZ0I7QUFDdkMsUUFBTSxRQUFRLFdBQVcsTUFBTSxXQUFXLE1BQU0sR0FBRyxzQkFBc0I7QUFFekUsTUFBSTtBQUNGLFVBQU0sV0FBVyxNQUFNLE1BQU0sUUFBUTtBQUFBLE1BQ25DLFFBQVEsV0FBVztBQUFBLE1BQ25CLFNBQVM7QUFBQSxRQUNQLGNBQWM7QUFBQSxRQUNkLFVBQVU7QUFBQSxNQUNaO0FBQUEsSUFDRixDQUFDO0FBRUQsUUFBSSxDQUFDLFNBQVMsSUFBSTtBQUNoQixjQUFRLEtBQUssaUJBQWlCLFNBQVMsTUFBTSxLQUFLLE1BQU0sRUFBRTtBQUMxRCxhQUFPLENBQUM7QUFBQSxJQUNWO0FBRUEsVUFBTSxPQUFPLE1BQU0sU0FBUyxLQUFLO0FBQ2pDLFdBQU8sTUFBTSxRQUFRLE1BQU0sT0FBTyxJQUFJLEtBQUssVUFBVSxDQUFDO0FBQUEsRUFDeEQsU0FBUyxPQUFPO0FBQ2QsUUFBSSxPQUFPLFNBQVMsY0FBYztBQUNoQyxjQUFRLEtBQUssOEJBQThCLE9BQU8sV0FBVyxLQUFLO0FBQUEsSUFDcEU7QUFDQSxXQUFPLENBQUM7QUFBQSxFQUNWLFVBQUU7QUFDQSxpQkFBYSxLQUFLO0FBQUEsRUFDcEI7QUFDRjtBQU1BLElBQU0sa0JBQWtCLENBQUMsUUFBUTtBQU8vQixNQUFJLENBQUMsS0FBSyxJQUFLLFFBQU87QUFDdEIsTUFBSSxJQUFJLGVBQWUsWUFBYSxRQUFPO0FBRTNDLFFBQU0sUUFBUSxnQkFBZ0IsS0FBSyxJQUFJLEdBQUc7QUFDMUMsUUFBTSxRQUFRLGVBQWUsS0FBSyxJQUFJLEdBQUc7QUFFekMsU0FBTztBQUFBLElBQ0wsS0FBSyxJQUFJO0FBQUEsSUFDVCxNQUFNLGNBQWMsSUFBSSxPQUFPLFNBQU0sSUFBSSxJQUFJLEtBQUssRUFBRTtBQUFBLElBQ3BELE9BQU8sSUFBSSxTQUFTLDJCQUF3QixRQUFRLFFBQVEsUUFBUSxRQUFRLFFBQVE7QUFBQSxJQUNwRixlQUFlLENBQUM7QUFBQSxJQUNoQjtBQUFBLElBQ0EsUUFBUTtBQUFBLEVBQ1Y7QUFDRjtBQUVlLFNBQVIsb0JBQXFDO0FBQzFDLFNBQU87QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLGdCQUFnQixRQUFRO0FBQ3RCLGFBQU8sWUFBWSxJQUFJLDJCQUEyQixPQUFPLEtBQUssUUFBUTtBQUNwRSxZQUFJO0FBQ0YsZ0JBQU0sTUFBTSxJQUFJLElBQUksSUFBSSxLQUFLLGtCQUFrQjtBQUMvQyxnQkFBTSxTQUFTLElBQUksYUFBYSxJQUFJLFFBQVE7QUFDNUMsZ0JBQU0sT0FBTyxJQUFJLGFBQWEsSUFBSSxNQUFNLEtBQUs7QUFDN0MsZ0JBQU0sU0FBUyxJQUFJLGFBQWEsSUFBSSxRQUFRO0FBQzVDLGdCQUFNLFVBQVUsSUFBSSxhQUFhLElBQUksU0FBUztBQUU5QyxjQUFJLENBQUMsUUFBUTtBQUNYLFlBQUFBLFVBQVMsS0FBSyxLQUFLLEVBQUUsT0FBTyxzQ0FBc0MsU0FBUyxDQUFDLEVBQUUsQ0FBQztBQUMvRTtBQUFBLFVBQ0Y7QUFFQSxlQUFLLFNBQVMsUUFBUSxTQUFTLGNBQWMsQ0FBQyxVQUFVLENBQUMsVUFBVTtBQUNqRSxZQUFBQSxVQUFTLEtBQUssS0FBSyxFQUFFLE9BQU8sZ0RBQWdELFNBQVMsQ0FBQyxFQUFFLENBQUM7QUFDekY7QUFBQSxVQUNGO0FBR0EsZ0JBQU0sU0FBUyxNQUFNLFdBQVcsUUFBUSxJQUFJO0FBQzVDLGNBQUksQ0FBQyxRQUFRO0FBQ1gsWUFBQUEsVUFBUyxLQUFLLEtBQUs7QUFBQSxjQUNqQixTQUFTLENBQUM7QUFBQSxjQUNWLFNBQVM7QUFBQSxZQUNYLENBQUM7QUFDRDtBQUFBLFVBQ0Y7QUFHQSxnQkFBTSxhQUFhLE1BQU0sd0JBQXdCLFFBQVEsTUFBTSxRQUFRLE9BQU87QUFHOUUsZ0JBQU0sVUFBVSxXQUNiLElBQUksZUFBZSxFQUNuQixPQUFPLE9BQU87QUFFakIsVUFBQUEsVUFBUyxLQUFLLEtBQUssRUFBRSxRQUFRLENBQUM7QUFBQSxRQUNoQyxTQUFTLE9BQU87QUFDZCxrQkFBUSxLQUFLLCtCQUErQixPQUFPLFdBQVcsS0FBSztBQUNuRSxVQUFBQSxVQUFTLEtBQUssS0FBSyxFQUFFLE9BQU8sT0FBTyxXQUFXLDRCQUE0QixTQUFTLENBQUMsRUFBRSxDQUFDO0FBQUEsUUFDekY7QUFBQSxNQUNGLENBQUM7QUFHRCxhQUFPLFlBQVksSUFBSSwyQkFBMkIsQ0FBQyxNQUFNLFFBQVE7QUFDL0QsUUFBQUEsVUFBUyxLQUFLLEtBQUs7QUFBQSxVQUNqQixJQUFJO0FBQUEsVUFDSixRQUFRO0FBQUEsVUFDUixVQUFVO0FBQUEsVUFDVixvQkFBb0IsUUFBUSxxQkFBcUIsWUFBWTtBQUFBLFFBQy9ELENBQUM7QUFBQSxNQUNILENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUNGOzs7QUM1TkEsSUFBTSwyQkFBMkIsb0JBQUksSUFBSSxDQUFDLFFBQVEsUUFBUSxPQUFPLFFBQVEsQ0FBQztBQUUxRSxTQUFTLFlBQVksV0FBVztBQUM5QixNQUFJLENBQUMsVUFBVyxRQUFPLENBQUM7QUFDeEIsU0FBTyxVQUFVLE1BQU0sR0FBRyxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDLEVBQUUsT0FBTyxPQUFPO0FBQ2pFO0FBRUEsU0FBUyxhQUFhLFFBQVE7QUFDNUIsU0FBTyxPQUFPLE9BQU8sQ0FBQyxNQUFNLENBQUMseUJBQXlCLElBQUksRUFBRSxZQUFZLENBQUMsQ0FBQztBQUM1RTtBQUVBLFNBQVMsZ0JBQWdCLFlBQVk7QUFDbkMsU0FBTyxXQUFXLEtBQUssR0FBRztBQUM1QjtBQUVBLFNBQVMsYUFBYSxNQUFNO0FBQzFCLFNBQU8sS0FBSyxTQUFTLGVBQWUsS0FBSyxLQUFLLFNBQVMsY0FBYztBQUN2RTtBQUVBLFNBQVMsZ0JBQWdCLE1BQU07QUFDN0IsU0FBTyxLQUFLLFNBQVMsb0JBQW9CO0FBQzNDO0FBRUEsU0FBUyxRQUFRLE1BQU0sTUFBTTtBQUMzQixRQUFNLEtBQUssSUFBSSxPQUFPLEdBQUcsSUFBSSxjQUFjLEdBQUc7QUFDOUMsUUFBTSxJQUFJLEtBQUssTUFBTSxFQUFFO0FBQ3ZCLFNBQU8sSUFBSSxFQUFFLENBQUMsSUFBSTtBQUNwQjtBQUVBLFNBQVMsZUFBZSxNQUFNO0FBQzVCLFNBQU8sUUFBUSxNQUFNLFVBQVU7QUFDakM7QUFFTyxTQUFTLGdCQUFnQixjQUFjLFNBQVMsaUJBQWlCO0FBQ3RFLFFBQU0sUUFBUSxhQUFhLE1BQU0sT0FBTztBQUN4QyxRQUFNLE1BQU0sQ0FBQztBQUdiLFFBQU0scUJBQXFCLG9CQUFJLElBQUk7QUFFbkMsV0FBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsS0FBSztBQUNyQyxVQUFNLE9BQU8sTUFBTSxDQUFDLEVBQUUsS0FBSztBQUczQixRQUFJLGdCQUFnQixJQUFJLEdBQUc7QUFDekIsWUFBTSxTQUFTLFFBQVEsTUFBTSxRQUFRO0FBQ3JDLFVBQUksUUFBUTtBQUNWLGNBQU0sU0FBUyxZQUFZLE1BQU07QUFDakMsY0FBTSxPQUFPLGFBQWEsTUFBTTtBQUNoQyxZQUFJLEtBQUssV0FBVyxHQUFHO0FBR3JCO0FBQ0E7QUFBQSxRQUNGO0FBQ0EsWUFBSSxLQUFLLFNBQVMsT0FBTyxRQUFRO0FBRS9CLGdCQUFNLFVBQVUsS0FBSyxRQUFRLGtCQUFrQixXQUFXLGdCQUFnQixJQUFJLENBQUMsR0FBRztBQUVsRixnQkFBTSxhQUFhLFFBQVEsTUFBTSxPQUFPO0FBQ3hDLGNBQUksY0FBYyxtQkFBbUIsSUFBSSxVQUFVLEdBQUc7QUFDcEQsZ0JBQUksS0FBSyxRQUFRLFFBQVEsb0JBQW9CLEVBQUUsQ0FBQztBQUFBLFVBQ2xELE9BQU87QUFDTCxnQkFBSSxLQUFLLE9BQU87QUFBQSxVQUNsQjtBQUNBLGNBQUksS0FBSyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEtBQUssQ0FBQztBQUMxQjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQ0EsVUFBSSxLQUFLLElBQUk7QUFDYixVQUFJLEtBQUssTUFBTSxFQUFFLENBQUMsRUFBRSxLQUFLLENBQUM7QUFDMUI7QUFBQSxJQUNGO0FBR0EsUUFBSSxhQUFhLElBQUksR0FBRztBQUN0QixZQUFNLFNBQVMsUUFBUSxNQUFNLFFBQVE7QUFDckMsVUFBSSxRQUFRO0FBQ1YsY0FBTSxTQUFTLFlBQVksTUFBTTtBQUNqQyxjQUFNLE9BQU8sYUFBYSxNQUFNO0FBQ2hDLFlBQUksS0FBSyxXQUFXLEdBQUc7QUFFckIsZ0JBQU0sVUFBVSxlQUFlLElBQUk7QUFDbkMsY0FBSSxRQUFTLG9CQUFtQixJQUFJLE9BQU87QUFDM0M7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUNBLFVBQUksS0FBSyxJQUFJO0FBQ2I7QUFBQSxJQUNGO0FBR0EsUUFBSSxRQUFRLENBQUMsS0FBSyxXQUFXLEdBQUcsTUFBTSxLQUFLLFNBQVMsS0FBSyxLQUFLLEtBQUssU0FBUyxNQUFNLEtBQUssS0FBSyxTQUFTLE1BQU0sS0FBSyxLQUFLLFNBQVMsTUFBTSxLQUFLLEtBQUssU0FBUyxPQUFPLElBQUk7QUFDaEssWUFBTSxjQUFjLElBQUksSUFBSSxNQUFNLE9BQU8sRUFBRTtBQUMzQyxVQUFJLEtBQUssZ0JBQWdCLG1CQUFtQixXQUFXLENBQUMsQ0FBQztBQUN6RDtBQUFBLElBQ0Y7QUFHQSxRQUFJLEtBQUssSUFBSTtBQUFBLEVBQ2Y7QUFFQSxTQUFPLElBQUksS0FBSyxJQUFJO0FBQ3RCO0FBRU8sU0FBUyw0QkFBNEIsY0FBYztBQUN4RCxRQUFNLFFBQVEsYUFBYSxNQUFNLE9BQU87QUFDeEMsUUFBTSxjQUFjLENBQUM7QUFFckIsYUFBVyxRQUFRLE9BQU87QUFDeEIsVUFBTSxVQUFVLEtBQUssS0FBSztBQUMxQixRQUFJLGFBQWEsT0FBTyxHQUFHO0FBQ3pCLFlBQU0sU0FBUyxRQUFRLFNBQVMsUUFBUTtBQUN4QyxZQUFNLE9BQU8sUUFBUSxTQUFTLE1BQU0sS0FBSyxRQUFRLFNBQVMsVUFBVSxLQUFLO0FBQ3pFLFlBQU0sVUFBVSxlQUFlLE9BQU87QUFDdEMsa0JBQVksS0FBSztBQUFBLFFBQ2Y7QUFBQSxRQUNBO0FBQUEsUUFDQSxRQUFRLFNBQVMsWUFBWSxNQUFNLElBQUksQ0FBQztBQUFBLFFBQ3hDLE1BQU07QUFBQSxNQUNSLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUVBLFNBQU87QUFDVDtBQUVPLFNBQVMsMEJBQTBCLGNBQWM7QUFDdEQsUUFBTSxTQUFTLDRCQUE0QixZQUFZO0FBQ3ZELFNBQU8sT0FBTyxLQUFLLENBQUMsTUFBTSxFQUFFLE9BQU8sS0FBSyxDQUFDLE1BQU0seUJBQXlCLElBQUksRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFDO0FBQy9GOzs7QUM5SEEsU0FBUyxjQUFjO0FBRXZCLElBQU1DLFlBQVcsQ0FBQyxLQUFLLFFBQVEsWUFBWTtBQUN6QyxNQUFJLGFBQWE7QUFDakIsTUFBSSxVQUFVLGdCQUFnQixpQ0FBaUM7QUFDL0QsTUFBSSxVQUFVLGlCQUFpQixVQUFVO0FBQ3pDLE1BQUksSUFBSSxLQUFLLFVBQVUsT0FBTyxDQUFDO0FBQ2pDO0FBRUEsSUFBTSxZQUFZLENBQUMsS0FBSyxRQUFRLFlBQVk7QUFDMUMsTUFBSSxhQUFhO0FBQ2pCLE1BQUksVUFBVSxnQkFBZ0IsMkJBQTJCO0FBQ3pELE1BQUksVUFBVSxpQkFBaUIsVUFBVTtBQUN6QyxNQUFJLElBQUksT0FBTztBQUNqQjtBQUdBLGVBQWUsU0FBUyxXQUFXLFVBQVUsQ0FBQyxHQUFHO0FBQy9DLFFBQU0sT0FBTyxVQUFVLFdBQVcsUUFBUSxJQUFJLE1BQU0sT0FBTyxZQUFZLElBQUksTUFBTSxPQUFPLFdBQVc7QUFDbkcsU0FBTyxJQUFJLFFBQVEsQ0FBQyxTQUFTLFdBQVc7QUFDdEMsVUFBTSxNQUFNLEtBQUssSUFBSSxXQUFXO0FBQUEsTUFDOUIsU0FBUztBQUFBLFFBQ1AsY0FBYztBQUFBLFFBQ2QsR0FBRyxRQUFRO0FBQUEsTUFDYjtBQUFBLE1BQ0EsU0FBUztBQUFBLElBQ1gsR0FBRyxDQUFDLFFBQVE7QUFDVixVQUFJLElBQUksY0FBYyxPQUFPLElBQUksYUFBYSxPQUFPLElBQUksUUFBUSxVQUFVO0FBQ3pFLGNBQU0sVUFBVSxJQUFJLElBQUksSUFBSSxRQUFRLFVBQVUsU0FBUyxFQUFFO0FBQ3pELFlBQUksUUFBUTtBQUNaLGdCQUFRLFNBQVMsU0FBUyxPQUFPLENBQUM7QUFDbEM7QUFBQSxNQUNGO0FBQ0EsVUFBSSxJQUFJLGVBQWUsS0FBSztBQUMxQixZQUFJLFFBQVE7QUFDWixlQUFPLElBQUksTUFBTSxRQUFRLElBQUksVUFBVSxRQUFRLFNBQVMsRUFBRSxDQUFDO0FBQzNEO0FBQUEsTUFDRjtBQUNBLGNBQVEsR0FBRztBQUFBLElBQ2IsQ0FBQztBQUNELFFBQUksR0FBRyxTQUFTLE1BQU07QUFDdEIsUUFBSSxHQUFHLFdBQVcsTUFBTTtBQUN0QixVQUFJLFFBQVE7QUFDWixhQUFPLElBQUksTUFBTSxvQkFBb0IsU0FBUyxFQUFFLENBQUM7QUFBQSxJQUNuRCxDQUFDO0FBQUEsRUFDSCxDQUFDO0FBQ0g7QUFHQSxlQUFlLFlBQVksUUFBUSxXQUFXLEtBQUssT0FBTyxNQUFNO0FBQzlELFFBQU0sU0FBUyxDQUFDO0FBQ2hCLE1BQUksUUFBUTtBQUNaLG1CQUFpQixTQUFTLFFBQVE7QUFDaEMsYUFBUyxNQUFNO0FBQ2YsUUFBSSxRQUFRLFNBQVU7QUFDdEIsV0FBTyxLQUFLLEtBQUs7QUFBQSxFQUNuQjtBQUNBLFNBQU8sT0FBTyxPQUFPLE1BQU07QUFDN0I7QUFFZSxTQUFSLGdCQUFpQztBQUN0QyxTQUFPO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFFTixnQkFBZ0IsUUFBUTtBQUV0QixhQUFPLFlBQVksSUFBSSx1QkFBdUIsQ0FBQyxNQUFNLFFBQVE7QUFDM0QsUUFBQUEsVUFBUyxLQUFLLEtBQUssRUFBRSxJQUFJLE1BQU0sUUFBUSxjQUFjLENBQUM7QUFBQSxNQUN4RCxDQUFDO0FBS0QsYUFBTyxZQUFZLElBQUksdUJBQXVCLE9BQU8sS0FBSyxRQUFRO0FBQ2hFLFlBQUk7QUFDRixnQkFBTSxNQUFNLElBQUksSUFBSSxJQUFJLEtBQUssa0JBQWtCO0FBQy9DLGdCQUFNLG1CQUFtQixJQUFJLGFBQWEsSUFBSSxLQUFLO0FBRW5ELGNBQUksQ0FBQyxrQkFBa0I7QUFDckIsc0JBQVUsS0FBSyxLQUFLLHlCQUF5QjtBQUM3QztBQUFBLFVBQ0Y7QUFFQSxjQUFJO0FBQ0osY0FBSTtBQUNGLHdCQUFZLG1CQUFtQixnQkFBZ0I7QUFBQSxVQUNqRCxRQUFRO0FBQ04sc0JBQVUsS0FBSyxLQUFLLHNCQUFzQjtBQUMxQztBQUFBLFVBQ0Y7QUFHQSxjQUFJLENBQUMsVUFBVSxXQUFXLFNBQVMsS0FBSyxDQUFDLFVBQVUsV0FBVyxVQUFVLEdBQUc7QUFDekUsc0JBQVUsS0FBSyxLQUFLLG9DQUFvQztBQUN4RDtBQUFBLFVBQ0Y7QUFHQSxjQUFJLENBQUMsVUFBVSxZQUFZLEVBQUUsU0FBUyxPQUFPLEdBQUc7QUFDOUMsc0JBQVUsS0FBSyxLQUFLLHVEQUF1RDtBQUMzRTtBQUFBLFVBQ0Y7QUFFQSxnQkFBTSxXQUFXLE1BQU0sU0FBUyxTQUFTO0FBQ3pDLGdCQUFNLE9BQU8sTUFBTSxZQUFZLFFBQVE7QUFDdkMsZ0JBQU0sZUFBZSxLQUFLLFNBQVMsTUFBTTtBQUd6QyxnQkFBTSxjQUFjLDBCQUEwQixZQUFZO0FBRTFELGNBQUksQ0FBQyxhQUFhO0FBRWhCLGdCQUFJLGFBQWE7QUFDakIsZ0JBQUksVUFBVSxnQkFBZ0IsOENBQThDO0FBQzVFLGdCQUFJLFVBQVUsaUJBQWlCLFVBQVU7QUFDekMsZ0JBQUksVUFBVSxzQkFBc0IsTUFBTTtBQUMxQyxnQkFBSSxJQUFJLFlBQVk7QUFDcEI7QUFBQSxVQUNGO0FBR0EsZ0JBQU0sVUFBVSxJQUFJLElBQUksU0FBUztBQUNqQyxnQkFBTSxrQkFBa0IsQ0FBQyxrQkFDdkIsNEJBQTRCLGFBQWEsU0FBUyxtQkFBbUIsUUFBUSxTQUFTLFFBQVEsU0FBUyxRQUFRLFlBQVksR0FBRyxDQUFDLENBQUM7QUFFbEksZ0JBQU0sWUFBWSxnQkFBZ0IsY0FBYyxRQUFRLFFBQVEsZUFBZTtBQUUvRSxjQUFJLGFBQWE7QUFDakIsY0FBSSxVQUFVLGdCQUFnQiw4Q0FBOEM7QUFDNUUsY0FBSSxVQUFVLGlCQUFpQixVQUFVO0FBQ3pDLGNBQUksVUFBVSx1QkFBdUIsTUFBTTtBQUMzQyxjQUFJLElBQUksU0FBUztBQUFBLFFBQ25CLFNBQVMsS0FBSztBQUNaLGtCQUFRLEtBQUssa0NBQWtDLEtBQUssV0FBVyxHQUFHO0FBQ2xFLG9CQUFVLEtBQUssS0FBSyxrQkFBa0IsS0FBSyxXQUFXLGVBQWUsRUFBRTtBQUFBLFFBQ3pFO0FBQUEsTUFDRixDQUFDO0FBS0QsYUFBTyxZQUFZLElBQUksd0JBQXdCLE9BQU8sS0FBSyxRQUFRO0FBQ2pFLFlBQUk7QUFDRixnQkFBTSxNQUFNLElBQUksSUFBSSxJQUFJLEtBQUssa0JBQWtCO0FBQy9DLGdCQUFNLGdCQUFnQixJQUFJLGFBQWEsSUFBSSxLQUFLO0FBQ2hELGdCQUFNLGNBQWMsSUFBSSxhQUFhLElBQUksTUFBTTtBQUUvQyxjQUFJLENBQUMsZUFBZTtBQUNsQixzQkFBVSxLQUFLLEtBQUsseUJBQXlCO0FBQzdDO0FBQUEsVUFDRjtBQUVBLGNBQUk7QUFDSixjQUFJO0FBQ0YscUJBQVMsbUJBQW1CLGFBQWE7QUFBQSxVQUMzQyxRQUFRO0FBQ04sc0JBQVUsS0FBSyxLQUFLLHNCQUFzQjtBQUMxQztBQUFBLFVBQ0Y7QUFHQSxjQUFJLENBQUMsT0FBTyxXQUFXLFNBQVMsS0FBSyxDQUFDLE9BQU8sV0FBVyxVQUFVLEdBQUc7QUFDbkUsZ0JBQUksQ0FBQyxhQUFhO0FBQ2hCLHdCQUFVLEtBQUssS0FBSyw4Q0FBOEM7QUFDbEU7QUFBQSxZQUNGO0FBQ0EsZ0JBQUk7QUFDRixvQkFBTSxPQUFPLG1CQUFtQixXQUFXO0FBQzNDLHVCQUFTLElBQUksSUFBSSxRQUFRLElBQUksRUFBRTtBQUFBLFlBQ2pDLFFBQVE7QUFDTix3QkFBVSxLQUFLLEtBQUssa0JBQWtCO0FBQ3RDO0FBQUEsWUFDRjtBQUFBLFVBQ0Y7QUFFQSxnQkFBTSxXQUFXLE1BQU0sU0FBUyxNQUFNO0FBQ3RDLGdCQUFNLGNBQWMsU0FBUyxRQUFRLGNBQWMsS0FBSztBQUV4RCxjQUFJLGFBQWE7QUFDakIsY0FBSSxVQUFVLGdCQUFnQixXQUFXO0FBQ3pDLGNBQUksVUFBVSwrQkFBK0IsR0FBRztBQUNoRCxjQUFJLFVBQVUsZ0NBQWdDLEdBQUc7QUFDakQsY0FBSSxVQUFVLGlDQUFpQyw2QkFBNkI7QUFDNUUsY0FBSSxVQUFVLGlCQUFpQixzQkFBc0I7QUFFckQsbUJBQVMsS0FBSyxHQUFHO0FBQUEsUUFDbkIsU0FBUyxLQUFLO0FBQ1osa0JBQVEsS0FBSyxtQ0FBbUMsS0FBSyxXQUFXLEdBQUc7QUFDbkUsb0JBQVUsS0FBSyxLQUFLLGtCQUFrQixLQUFLLFdBQVcsZUFBZSxFQUFFO0FBQUEsUUFDekU7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUNGOzs7QU5uTUEsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sR0FBRyxnQkFBZ0IsR0FBRyxlQUFlLEdBQUcsaUJBQWlCLEdBQUcsa0JBQWtCLEdBQUcsY0FBYyxDQUFDO0FBQ2xILENBQUM7IiwKICAibmFtZXMiOiBbInJlcXVpcmUiLCAic2VuZEpzb24iLCAic2VuZEpzb24iLCAic2VuZEpzb24iLCAic2VuZEpzb24iXQp9Cg==
