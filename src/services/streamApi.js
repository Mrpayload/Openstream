export const WEBSTREAMR_BASE_URL = "https://87d6a6ef6b58-webstreamrmbg.baby-beamup.club";

const STREAM_CACHE_TTL_MS = 5 * 60 * 1000;
const streamCache = new Map();
const inFlightRequests = new Map();

const FLIXHQ_PROXY_TIMEOUT_MS = 12_000;
const EZVIDAPI_TIMEOUT_MS = 12_000;
const SMPLSTREAM_TIMEOUT_MS = 15_000;
const MEDIAFUSION_TIMEOUT_MS = 18_000;

// Calls the local Vite dev middleware at /api/flixhq/source (see vite/flixhq-plugin.js).
// Returns a normalized stream object that the existing picker/player can use, or null
// if flixhq-api couldn't find or extract a source for the given title.
export const fetchFlixhqStream = async (playable) => {
  if (!playable?.title) return null;

  const params = new URLSearchParams({
    title: playable.title,
    type: playable.streamType || "movie",
  });
  if (playable.streamType === "series" || playable.streamType === "tv") {
    if (playable.seasonNumber) params.set("season", String(playable.seasonNumber));
    if (playable.episodeNumber) params.set("episode", String(playable.episodeNumber));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLIXHQ_PROXY_TIMEOUT_MS);

  try {
    const response = await fetch(`/api/flixhq/source?${params.toString()}`, { signal: controller.signal });
    if (!response.ok) {
      console.warn(`[flixhq] ${response.status}: ${(await response.text()).slice(0, 120)}`);
      return null;
    }

    const data = await response.json();
    if (!data?.url) return null;

    return {
      url: data.url,
      name: `FlixHQ API (Server 5)${data.serverName ? `\n${data.serverName}` : ""}`,
      title: `Direct m3u8 from flixhq-api${data.encrypted ? " (encrypted)" : ""} · HLS`,
      behaviorHints: {},
      isHls: data.type === "hls" || /\.m3u8(\?|$)/i.test(data.url),
      source: "flixhq-api"
    };
  } catch (error) {
    if (error.name !== "AbortError") {
      console.warn("[flixhq] proxy error:", error.message || error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// Calls the local Vite dev middleware at /api/ezvidapi/source (see vite/ezvidapi-plugin.js).
// ezvidapi returns direct HLS URLs from multiple providers with no auth required.
export const fetchEzvidapiStream = async (playable) => {
  if (!playable?.tmdbId) return null;

  const params = new URLSearchParams({
    type: playable.streamType || "movie",
    tmdbId: String(playable.tmdbId)
  });
  if (playable.streamType === "series" || playable.streamType === "tv") {
    if (playable.seasonNumber) params.set("season", String(playable.seasonNumber));
    if (playable.episodeNumber) params.set("episode", String(playable.episodeNumber));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EZVIDAPI_TIMEOUT_MS);

  try {
    const response = await fetch(`/api/ezvidapi/embed?${params.toString()}`, { signal: controller.signal });
    if (!response.ok) {
      console.warn(`[ezvidapi] ${response.status}: ${(await response.text()).slice(0, 120)}`);
      return null;
    }

    const data = await response.json();
    if (!data?.servers?.length) return null;

    // Return the first working server as a playable stream
    return data.servers.map((server) => ({
      url: server.src,
      name: `ezvidapi (${server.provider || server.server || "unknown"})`,
      title: `Direct HLS from ezvidapi · ${server.provider || server.server || "unknown"}`,
      behaviorHints: {},
      isHls: data.hls || /\.m3u8(\?|$)/i.test(server.src),
      source: "ezvidapi"
    }));
  } catch (error) {
    if (error.name !== "AbortError") {
      console.warn("[ezvidapi] proxy error:", error.message || error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// Calls the local Vite dev middleware at /api/smplstream/source (see vite/smplstream-plugin.js).
// SmashyStream returns multiple stream sources with decoded URLs.
export const fetchSmplstreamStream = async (playable) => {
  if (!playable?.tmdbId) return null;

  const params = new URLSearchParams({
    tmdbId: String(playable.tmdbId),
    type: playable.streamType || "movie"
  });
  if (playable.streamType === "series" || playable.streamType === "tv") {
    if (playable.seasonNumber) params.set("season", String(playable.seasonNumber));
    if (playable.episodeNumber) params.set("episode", String(playable.episodeNumber));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SMPLSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(`/api/smplstream/embed?${params.toString()}`, { signal: controller.signal });
    if (!response.ok) {
      console.warn(`[smplstream] ${response.status}: ${(await response.text()).slice(0, 120)}`);
      return null;
    }

    const data = await response.json();
    if (!data?.servers?.length) return null;

    return data.servers.map((server) => ({
      url: server.src,
      name: `SmashyStream (${server.name || "Server"})`,
      title: `SmashyStream · ${server.type === "hls" ? "HLS" : "MP4"}`,
      behaviorHints: {},
      isHls: server.type === "hls" || /\.m3u8(\?|$)/i.test(server.src),
      source: "smashystream"
    }));
  } catch (error) {
    if (error.name !== "AbortError") {
      console.warn("[smplstream] proxy error:", error.message || error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// Calls the local Vite dev middleware at /api/torrentio/stream (see vite/torrentio-plugin.js).
// Torrentio (torrentio.strem.fun by default) is a Stremio addon that returns
// magnet-based torrent streams. The plugin converts TMDB → IMDb server-side.
// Each returned stream is a magnet link (isMagnet: true) and must be played
// via an external torrent-aware client (VLC, qBittorrent, etc.).
export const fetchTorrentioStream = async (playable) => {
  if (!playable?.tmdbId) return null;

  const params = new URLSearchParams({
    tmdbId: String(playable.tmdbId),
    type: playable.streamType || "movie"
  });
  if (playable.streamType === "series" || playable.streamType === "tv") {
    if (playable.seasonNumber) params.set("season", String(playable.seasonNumber));
    if (playable.episodeNumber) params.set("episode", String(playable.episodeNumber));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIAFUSION_TIMEOUT_MS);

  try {
    const response = await fetch(`/api/torrentio/stream?${params.toString()}`, { signal: controller.signal });
    if (!response.ok) {
      console.warn(`[torrentio] ${response.status}: ${(await response.text()).slice(0, 120)}`);
      return null;
    }

    const data = await response.json();
    if (!data?.streams?.length) return null;

    return data.streams;
  } catch (error) {
    if (error.name !== "AbortError") {
      console.warn("[torrentio] proxy error:", error.message || error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// Calls the local Vite dev middleware at /api/mediafusion/stream (see vite/mediafusion-plugin.js).
// MediaFusion is a Stremio addon aggregator that returns m3u8/mp4 streams.
// It converts TMDB IDs to IMDb IDs server-side, then queries a public MediaFusion instance.
const VIDLINK_EXTRACT_TIMEOUT_MS = 12_000;

export const fetchVidlinkStream = async (playable) => {
  if (!playable?.tmdbId) return null;

  const params = new URLSearchParams({
    tmdbId: String(playable.tmdbId),
    type: playable.streamType || "movie",
  });
  if (playable.streamType === "series" || playable.streamType === "tv") {
    if (playable.seasonNumber) params.set("season", String(playable.seasonNumber));
    if (playable.episodeNumber) params.set("episode", String(playable.episodeNumber));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VIDLINK_EXTRACT_TIMEOUT_MS);

  try {
    const response = await fetch(`/api/extract/vidlink?${params.toString()}`, { signal: controller.signal });
    if (!response.ok) {
      console.warn(`[vidlink] ${response.status}: ${(await response.text()).slice(0, 120)}`);
      return null;
    }

    const data = await response.json();
    if (!data?.url) return null;

    return {
      url: data.url,
      name: "VidLink Direct",
      title: "Direct HLS from VidLink · extracted server-side",
      behaviorHints: {},
      isHls: true,
      source: "vidlink"
    };
  } catch (error) {
    if (error.name !== "AbortError") {
      console.warn("[vidlink] proxy error:", error.message || error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export const fetchMediafusionStream = async (playable) => {
  if (!playable?.tmdbId) return null;

  const params = new URLSearchParams({
    tmdbId: String(playable.tmdbId),
    type: playable.streamType || "movie"
  });
  if (playable.streamType === "series" || playable.streamType === "tv") {
    if (playable.seasonNumber) params.set("season", String(playable.seasonNumber));
    if (playable.episodeNumber) params.set("episode", String(playable.episodeNumber));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIAFUSION_TIMEOUT_MS);

  try {
    const response = await fetch(`/api/mediafusion/stream?${params.toString()}`, { signal: controller.signal });
    if (!response.ok) {
      console.warn(`[mediafusion] ${response.status}: ${(await response.text()).slice(0, 120)}`);
      return null;
    }

    const data = await response.json();
    if (!data?.streams?.length) return null;

    return data.streams;
  } catch (error) {
    if (error.name !== "AbortError") {
      console.warn("[mediafusion] proxy error:", error.message || error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const normalizeType = (type) => {
  if (type === "movie") return "movie";
  if (type === "series" || type === "tv") return "series";

  throw new Error(`Unsupported stream type: ${type}`);
};

const buildStreamId = (type, tmdbId, season, episode) => {
  const normalizedType = normalizeType(type);

  if (!tmdbId) {
    throw new Error("TMDB ID is required to fetch streams");
  }

  if (normalizedType === "series") {
    if (!season || !episode) {
      throw new Error("Season and episode are required to fetch series streams");
    }

    return `tmdb:${tmdbId}:${season}:${episode}`;
  }

  return `tmdb:${tmdbId}`;
};

const buildCacheKey = (type, tmdbId, season, episode) => {
  const normalizedType = normalizeType(type);

  if (normalizedType === "series") {
    return `${normalizedType}:${tmdbId}:${season}:${episode}`;
  }

  return `${normalizedType}:${tmdbId}`;
};

export const buildStreamUrl = (type, tmdbId, season, episode) => {
  const normalizedType = normalizeType(type);
  const streamId = buildStreamId(normalizedType, tmdbId, season, episode);

  return `${WEBSTREAMR_BASE_URL}/stream/${normalizedType}/${streamId}.json`;
};

export async function checkHealth() {
  try {
    const response = await fetch(`${WEBSTREAMR_BASE_URL}/live`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchStreams(type, tmdbId, season, episode) {
  const cacheKey = buildCacheKey(type, tmdbId, season, episode);
  const cached = streamCache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < STREAM_CACHE_TTL_MS) {
    return cached.data;
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const request = fetch(buildStreamUrl(type, tmdbId, season, episode))
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`WebStreamrMBG request failed: ${response.status}`);
      }

      const data = await response.json();
      const normalizedData = {
        streams: Array.isArray(data.streams) ? data.streams : []
      };

      streamCache.set(cacheKey, {
        createdAt: Date.now(),
        data: normalizedData
      });

      return normalizedData;
    })
    .finally(() => {
      inFlightRequests.delete(cacheKey);
    });

  inFlightRequests.set(cacheKey, request);
  return request;
}

export function clearStreamCache() {
  streamCache.clear();
  inFlightRequests.clear();
}
