// Centralized list of fallback iframe embed players.
//
// These are the "always-on" sources shown to the user immediately so playback
// is possible even when every API is slow, rate-limited, or down. The list
// is shared by App.jsx (initial stream fetch) and any UI that wants to know
// which URL patterns to recognize as embed/iframe.

import { getAbsoluteApiUrl } from "./apiConfig";

// In development, route embed URLs through the proxy so the guard script
// can block popups. In production, use the direct URL (no proxy available).
const PROXY_PREFIX = getAbsoluteApiUrl("/api/embed-proxy?url=");

const proxyUrl = (url) => {
  const isCapacitor = typeof window !== "undefined" && (window.Capacitor || window.location?.protocol === "capacitor:");
  
  // If inside the APK, native Android interception handles ad-blocking.
  // We do not want to proxy requests through our server.
  if (isCapacitor) {
    return url;
  }

  // Fallback to local dev proxy when testing in standard browser.
  const isLocalhost = typeof window !== "undefined" && (window.location?.hostname === "localhost" || window.location?.hostname === "127.0.0.1");
  if (isLocalhost) {
    return PROXY_PREFIX + encodeURIComponent(url);
  }
  return url;
};

const FALLBACK_EMBED_PLAYERS = [
  {
    id: "vidlink",
    label: "VidLink (Server 1)",
    title: "Embedded player via vidlink.pro (subtitles, auto quality, progress tracking)",
    build: (playable) => {
      const id = String(playable.tmdbId || "").replace(/^tmdb:/, "");
      const autoplay = "autoplay=true&nextbutton=true";
      if (isTvPlayable(playable)) {
        return `https://vidlink.pro/tv/${id}/${playable.seasonNumber}/${playable.episodeNumber}?${autoplay}`;
      }
      return `https://vidlink.pro/movie/${id}?${autoplay}`;
    }
  },
  {
    id: "vidsrc-embed",
    label: "VidSrc Embed (Server 2)",
    title: "Embedded player via vsembed.ru (AAC Audio & Subtitles)",
    baseMovie: "https://vsembed.ru/embed/movie",
    baseTv: "https://vsembed.ru/embed/tv",
    note: "migrated from vidsrc-embed.ru"
  },
  {
    id: "vidsrc-me",
    label: "VidSrc.me (Server 3)",
    title: "Embedded player via vidsrcme.ru (Stereo/AAC Audio)",
    baseMovie: "https://vidsrcme.ru/embed/movie",
    baseTv: "https://vidsrcme.ru/embed/tv",
    note: "updated from vidsrc.me"
  },
  {
    id: "superembed",
    label: "SuperEmbed (Server 4)",
    title: "Embedded player via streamingnow.mov (10+ servers, subtitles, auto quality)",
    build: (playable) => {
      const id = String(playable.tmdbId || "").replace(/^tmdb:/, "");
      const params = new URLSearchParams({ video_id: id, tmdb: "1" });
      if (isTvPlayable(playable)) {
        params.set("s", String(playable.seasonNumber));
        params.set("e", String(playable.episodeNumber));
      }
      return `https://multiembed.mov/?${params.toString()}`;
    }
  },
  {
    id: "vidsrc-to",
    label: "VidSrc.to (Server 5)",
    title: "Embedded player via vidsrc.to (Subtitles, Server switching)",
    build: (playable) => {
      const id = String(playable.tmdbId || "").replace(/^tmdb:/, "");
      if (isTvPlayable(playable)) {
        return `https://vidsrc.to/embed/tv/${id}/${playable.seasonNumber}/${playable.episodeNumber}`;
      }
      return `https://vidsrc.to/embed/movie/${id}`;
    }
  }
];

// Detect TV episodes by streamType OR by presence of season/episode numbers.
const isTvPlayable = (playable) =>
  playable.streamType === "series" || playable.streamType === "tv" ||
  Boolean(playable.seasonNumber && playable.episodeNumber);

// Build the standardized URL each embed player should use for a given playable.
const buildUrl = (player, playable) => {
  if (typeof player.build === "function") {
    return player.build(playable);
  }

  const id = String(playable.tmdbId || "").replace(/^tmdb:/, "");
  if (isTvPlayable(playable)) {
    return `${player.baseTv}?tmdb=${id}&season=${playable.seasonNumber}&episode=${playable.episodeNumber}&autoplay=1`;
  }
  return `${player.baseMovie}?tmdb=${id}&autoplay=1`;
};

// Return an array of normalized stream objects ready for StreamPicker.
// Each entry has the same shape as API-returned streams: { url, name, title, isIframe, behaviorHints }
export const buildFallbackStreamList = (playable) => {
  if (!playable?.tmdbId) return [];

  return FALLBACK_EMBED_PLAYERS.map((player) => ({
    url: proxyUrl(buildUrl(player, playable)),
    name: player.label,
    title: player.title,
    behaviorHints: {},
    isIframe: true,
    source: player.id
  }));
};

// Test/utility helper: identify whether a URL belongs one of the registered
// fallback embed players. Useful for StreamPicker badges or NeoPlayer to detect
// when a stream must be rendered inside an <iframe>.
export const isFallbackEmbedUrl = (url) => {
  if (!url) return false;
  // Also match proxied URLs
  const raw = url.includes(PROXY_PREFIX)
    ? decodeURIComponent(url.split(PROXY_PREFIX)[1] || "")
    : url;
  return FALLBACK_EMBED_PLAYERS.some((player) => {
    if (typeof player.build === "function") {
      // Match dynamic builders by known domain patterns
      if (player.id === "superembed") return raw.includes("multiembed.mov");
      if (player.id === "vidlink") return raw.includes("vidlink.pro");
      if (player.id === "vidsrc-to") return raw.includes("vidsrc.to");
      return false;
    }
    return raw.startsWith(player.baseMovie) || raw.startsWith(player.baseTv);
  });
};

export const FALLBACK_EMBED_PLAYER_IDS = FALLBACK_EMBED_PLAYERS.map((p) => p.id);
