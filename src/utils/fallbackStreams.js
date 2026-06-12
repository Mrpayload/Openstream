// Centralized list of fallback iframe embed players.
//
// These are the "always-on" sources shown to the user immediately so playback
// is possible even when every API is slow, rate-limited, or down. The list
// is shared by App.jsx (initial stream fetch) and any UI that wants to know
// which URL patterns to recognize as embed/iframe.

const FALLBACK_EMBED_PLAYERS = [
  {
    id: "vidsrc-embed",
    label: "VidSrc Embed (Server 1)",
    title: "Embedded player via vidsrc-embed.ru (AAC Audio & Subtitles)",
    baseMovie: "https://vidsrc-embed.ru/embed/movie",
    baseTv: "https://vidsrc-embed.ru/embed/tv",
    note: "migrated from vidsrcme.ru"
  },
  {
    id: "vidsrc-me",
    label: "VidSrc.me (Server 2)",
    title: "Embedded player via vidsrc.me (Stereo/AAC Audio)",
    baseMovie: "https://vidsrc.me/embed/movie",
    baseTv: "https://vidsrc.me/embed/tv",
    note: "legacy embed domain (may redirect)"
  },
  {
    id: "vsembed",
    label: "VS Embed (Server 3)",
    title: "Embedded player via vsembed.ru (AAC Audio & Subtitles)",
    baseMovie: "https://vsembed.ru/embed/movie",
    baseTv: "https://vsembed.ru/embed/tv",
    note: "latest mirror domain"
  },
  {
    id: "superembed",
    label: "SuperEmbed (Server 4)",
    title: "Embedded player via multiembed.mov (10+ servers, subtitles, auto quality)",
    // SuperEmbed uses a single endpoint with query params
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
    id: "2embed",
    label: "2embed (Server 5)",
    title: "Embedded player via 2embed.cc (TMDB-based, multiple servers)",
    baseMovie: "https://www.2embed.cc/embed",
    baseTv: "https://www.2embed.cc/embedtv"
  },
  {
    id: "vidlink",
    label: "VidLink (Server 6)",
    title: "Embedded player via vidlink.pro (subtitles, auto quality, progress tracking)",
    // VidLink uses path segments rather than query params
    build: (playable) => {
      const id = String(playable.tmdbId || "").replace(/^tmdb:/, "");
      const autoplay = "autoplay=true&nextbutton=true";
      if (isTvPlayable(playable)) {
        return `https://vidlink.pro/tv/${id}/${playable.seasonNumber}/${playable.episodeNumber}?${autoplay}`;
      }
      return `https://vidlink.pro/movie/${id}?${autoplay}`;
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
    url: buildUrl(player, playable),
    name: player.label,
    title: player.title,
    behaviorHints: {},
    isIframe: true,
    source: player.id
  }));
};

// Test/utility helper: identify whether a URL belongs to one of the registered
// fallback embed players. Useful for StreamPicker badges or NeoPlayer to detect
// when a stream must be rendered inside an <iframe>.
export const isFallbackEmbedUrl = (url) => {
  if (!url) return false;
  return FALLBACK_EMBED_PLAYERS.some((player) => {
    if (typeof player.build === "function") {
      // Match dynamic builders by known domain patterns
      if (player.id === "superembed") return url.includes("multiembed.mov");
      if (player.id === "vidlink") return url.includes("vidlink.pro");
      return false;
    }
    return url.startsWith(player.baseMovie) || url.startsWith(player.baseTv);
  });
};

export const FALLBACK_EMBED_PLAYER_IDS = FALLBACK_EMBED_PLAYERS.map((p) => p.id);
