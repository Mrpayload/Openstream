// Shared stream helpers used by the catalog, stream picker, and player.
// All functions are pure and tolerant of partial/undefined inputs.
import { getAbsoluteApiUrl } from "./apiConfig";

export const hasProxyHeaders = (stream) =>
  Boolean(stream?.behaviorHints?.proxyHeaders?.request);

export const isBrowserPlayableStream = (stream) => {
  if (
    !stream?.url ||
    hasProxyHeaders(stream) ||
    isIframeUrl(stream.url) ||
    stream.isMagnet ||
    isMagnetUrl(stream.url)
  ) return false;
  if (isExternalPlayerRecommended(stream)) return false;
  if (stream.isHls || isHlsUrl(stream.url)) return true;
  const audio = checkAudioSupport(stream);
  return audio.supported !== false;
};

export const getStreamSource = (stream) =>
  stream?.name?.split("\n")[0]?.trim() || "Unknown source";

const QUALITY_REGEX = /\b(2160p|1080p|720p|480p|360p|4K)\b/i;

export const getStreamQuality = (stream) => {
  const text = `${stream?.name || ""} ${stream?.title || ""}`;
  const match = text.match(QUALITY_REGEX);
  return match?.[1]?.toUpperCase() || "Auto";
};

export const getStreamFormat = (stream) => {
  if (stream?.url?.includes(".m3u8")) return "HLS";
  if (stream?.url?.includes(".mp4")) return "MP4";
  if (isAudioOnlyStream(stream)) return getAudioFileFormat(stream.url);
  return "Stream";
};

export const getStreamLabel = (stream) => {
  const source = getStreamSource(stream);
  const quality = getStreamQuality(stream);
  return [source, quality].filter(Boolean).join(" · ") || "Selected Stream";
};

export const isHlsUrl = (url) => {
  if (!url) return false;
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return url.toLowerCase().includes(".m3u8");
  }
};

export const getSidecarUrl = (url) => {
  if (!url || !isHlsUrl(url)) return null;
  return getAbsoluteApiUrl(`/api/sidecar/stream?url=${encodeURIComponent(url)}`);
};

export const isIframeUrl = (url) => {
  if (!url) return false;
  return url.includes("vidsrc") || url.includes("embed") || url.includes("iframe") || url.includes("vidlink");
};

export const isMagnetUrl = (url) => {
  if (!url) return false;
  return /^magnet:\?/i.test(url);
};

const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|wma|alac|aiff|ape|caf)(\?|$)/i;

const AUDIO_MIME_PREFIX = "audio/";

export const isAudioOnlyUrl = (url) => {
  if (!url) return false;
  return AUDIO_EXTENSIONS.test(url);
};

export const isAudioOnlyStream = (stream) => {
  if (!stream?.url) return false;
  if (stream.mimeType?.startsWith(AUDIO_MIME_PREFIX)) return true;
  if (stream.contentType?.startsWith(AUDIO_MIME_PREFIX)) return true;
  return isAudioOnlyUrl(stream.url);
};

const AUDIO_FORMAT_MAP = {
  mp3: "MP3",
  m4a: "M4A",
  aac: "AAC",
  flac: "FLAC",
  ogg: "OGG",
  oga: "OGA",
  opus: "Opus",
  wav: "WAV",
  wma: "WMA",
  alac: "ALAC",
  aiff: "AIFF",
  ape: "APE",
  caf: "CAF",
};

export const getAudioFileFormat = (url) => {
  if (!url) return "Audio";
  const match = url.match(AUDIO_EXTENSIONS);
  if (!match) return "Audio";
  return AUDIO_FORMAT_MAP[match[1].toLowerCase()] || "Audio";
};

// True when the stream is a magnet that we should attempt to play in the
// built-in player (via webtorrent). The actual attempt may still fail if
// WebRTC is blocked or no peers are available — in that case the player
// falls back to the external-player menu.
export const isWebtorrentPlayable = (stream) => {
  if (!stream) return false;
  if (stream.isMagnet) return true;
  return isMagnetUrl(stream.url);
};

// Split a mixed list of streams into the three groups shown in StreamPicker:
// Partitions a flat stream list into display buckets:
//   - iframe:      embed players that must be rendered inside an <iframe>
//                  (vidsrc-embed, vsembed, multiembed, vidlink, ...)
//   - webstreamer: direct, browser-playable sources (FlixHQ, ezvidapi,
//                  SmashyStream, MediaFusion, webstreamrMBG, ...)
// Priority order: iframe → webstreamer
export const partitionStreams = (streams) => {
  const list = Array.isArray(streams) ? streams : [];
  const iframe = [];
  const webstreamer = [];
  const torrentio = [];
  for (const stream of list) {
    if (!stream) continue;
    // Skip magnet/torrent streams — Torrentio has been removed
    const isTorrent = stream.source === "torrentio" || stream.isMagnet || isMagnetUrl(stream.url);
    if (isTorrent) {
      torrentio.push(stream);
      continue;
    }
    if (stream.isIframe || isIframeUrl(stream.url)) {
      iframe.push(stream);
    } else {
      webstreamer.push(stream);
    }
  }
  return { iframe, webstreamer, torrentio };
};

const getMediaSource = () => {
  if (typeof window === "undefined") return null;
  return window.MediaSource || window.ManagedMediaSource || null;
};

export const isAudioCodecSupportedByMse = (codec) => {
  const MediaSource = getMediaSource();
  if (!MediaSource?.isTypeSupported || !codec) return false;
  return MediaSource.isTypeSupported(`audio/mp4; codecs="${codec}"`);
};

const canPlayAudioType = (type) => {
  if (typeof document === "undefined") return false;
  const audio = document.createElement?.("audio");
  return Boolean(audio?.canPlayType?.(type));
};

export const getBrowserAudioCodecSupport = () => {
  const aac = isAudioCodecSupportedByMse("mp4a.40.2") || canPlayAudioType('audio/mp4; codecs="mp4a.40.2"');
  const mp3 = canPlayAudioType("audio/mpeg");
  const opus = isAudioCodecSupportedByMse("opus") || canPlayAudioType('audio/ogg; codecs="opus"');
  const vorbis = canPlayAudioType('audio/ogg; codecs="vorbis"');
  const eac3 = isAudioCodecSupportedByMse("ec-3");
  const ac3 = isAudioCodecSupportedByMse("ac-3");

  return {
    aac,
    mp3,
    opus,
    vorbis,
    ac3,
    eac3,
    preferredDolbyCodec: eac3 ? "ec-3" : ac3 ? "ac-3" : null,
  };
};

export const normalizeAudioCodec = (track = {}) => {
  const text = `${track.audioCodec || ""} ${track.codec || ""} ${track.attrs?.CODECS || ""}`.toLowerCase();
  if (text.includes("ec-3") || text.includes("e-ac-3") || text.includes("eac3")) return "ec-3";
  if (text.includes("ac-3") || text.includes("ac3")) return "ac-3";
  if (text.includes("mp4a") || text.includes("aac")) return "aac";
  if (text.includes("opus")) return "opus";
  if (text.includes("vorbis")) return "vorbis";
  if (text.includes("mp3") || text.includes("mpeg")) return "mp3";
  if (text.includes("dts")) return "dts";
  if (text.includes("mlpa") || text.includes("truehd")) return "truehd";
  return "";
};

export const getAudioCodecLabel = (track = {}) => {
  const codec = normalizeAudioCodec(track);
  switch (codec) {
    case "ec-3": return "Dolby Digital Plus";
    case "ac-3": return "Dolby Digital";
    case "aac": return "AAC";
    case "opus": return "Opus";
    case "vorbis": return "Vorbis";
    case "mp3": return "MP3";
    case "dts": return "DTS";
    case "truehd": return "TrueHD";
    default: return "Audio";
  }
};

export const isDolbyAudioCodec = (codec) => codec === "ec-3" || codec === "ac-3";

const AUDIO_CODEC_PATTERNS = [
  { regex: /aac/i, codec: "aac", label: "AAC" },
  { regex: /opus/i, codec: "opus", label: "Opus" },
  { regex: /mp3/i, codec: "mp3", label: "MP3" },
  { regex: /vorbis/i, codec: "vorbis", label: "Vorbis" },
  { regex: /ddp\d*\.?\d*|eac3|e-ac-3|ec-3|dolby(\s*)digital(\s*)plus/i, codec: "ec-3", label: "Dolby Digital Plus" },
  { regex: /(?<!e-)ac3|(?<!e-)ac-3|\bdd\s*[257]\.1\b|dolby(\s*)digital(?!(\s*)plus)/i, codec: "ac-3", label: "Dolby Digital" },
  { regex: /dts/i, codec: "dts", label: "DTS" },
  { regex: /truehd|mlpa/i, codec: "truehd", label: "Dolby TrueHD" },
];

export const isExternalPlayerRecommended = (stream) => {
  if (!stream?.url || hasProxyHeaders(stream) || isIframeUrl(stream.url)) return false;
  const text = `${stream?.name || ""} ${stream?.title || ""} ${stream?.url || ""}`;
  const isDirectMatroska = /\.mkv(\?|$)|video\/mkv|matroska/i.test(text);
  return Boolean(stream?.behaviorHints?.notWebReady || isDirectMatroska);
};

export const checkAudioSupport = (stream, codecSupport = getBrowserAudioCodecSupport()) => {
  const text = `${stream?.name || ""} ${stream?.title || ""}`;

  const foundCodecs = AUDIO_CODEC_PATTERNS
    .filter(({ regex }) => regex.test(text))
    .map(({ codec, label }) => ({ codec, label }));

  if (foundCodecs.length === 0) {
    return { supported: false, label: "Audio codec unknown" };
  }

  const hasSupported = foundCodecs.some(({ codec }) =>
    isAudioCodecPlayable(codec, codecSupport)
  );

  const unsupported = foundCodecs.filter(({ codec }) =>
    !isAudioCodecPlayable(codec, codecSupport)
  );

  if (hasSupported) {
    if (unsupported.length > 0) {
      return {
        supported: "partial",
        label: `${unsupported.map(c => c.label).join("/")} not supported in this browser`
      };
    }
    return { supported: true };
  }

  if (unsupported.length > 0) {
    return {
      supported: false,
      label: `${unsupported.map(c => c.label).join("/")} not supported in this browser`
    };
  }

  return { supported: true };
};

export const isAudioCodecPlayable = (codec, codecSupport = getBrowserAudioCodecSupport()) => {
  if (!codec) return true;
  if (codec === "aac") return codecSupport.aac;
  if (codec === "mp3") return codecSupport.mp3;
  if (codec === "opus") return codecSupport.opus;
  if (codec === "vorbis") return codecSupport.vorbis;
  if (codec === "ec-3") return codecSupport.eac3;
  if (codec === "ac-3") return codecSupport.ac3;
  return false;
};

// ─── external player integration ────────────────────────────────────────────

// Custom URL schemes registered by desktop media players. Most browsers will
// silently hand the URL off to the OS, which will launch the registered app
// if installed. iOS Safari blocks this entirely.
export const EXTERNAL_PLAYERS = [
  { id: "vlc", label: "VLC", scheme: "vlc://", platforms: ["win", "mac", "linux"] },
  { id: "mpv", label: "MPV", scheme: "mpv://", platforms: ["linux"] },
  { id: "iina", label: "IINA", scheme: "iina://", platforms: ["mac"] },
  { id: "potplayer", label: "PotPlayer", scheme: "potplayer://", platforms: ["win"] }
];

export const buildExternalProtocolUrl = (scheme, url) => {
  if (!scheme || !url) return "";
  const normalizedScheme = scheme.endsWith("://") ? scheme : `${scheme.replace(/:+$/, "")}://`;
  const utf8Bytes = new TextEncoder().encode(url);
  const binary = Array.from(utf8Bytes, (b) => String.fromCharCode(b)).join("");
  const base64 = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${normalizedScheme}${base64}`;
};

const detectPlatform = () => {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Mac/.test(ua)) return "mac";
  if (/Windows/.test(ua)) return "win";
  if (/Linux/.test(ua)) return "linux";
  return "other";
};

const isIOS = () => detectPlatform() === "ios";
const isAndroid = () => detectPlatform() === "android";

const availableExternalPlayers = () => {
  const platform = detectPlatform();
  if (platform === "ios" || platform === "android") return [];
  return EXTERNAL_PLAYERS.filter((player) => player.platforms.includes(platform));
};

const sanitizeFilename = (value) =>
  (value || "stream")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "stream";

// Build a minimal M3U playlist referencing the supplied stream(s). A single
// playable URL is the common case; multiple items fall through as fallbacks.
export const buildM3uPlaylist = ({ title, entries }) => {
  const lines = ["#EXTM3U"];
  entries.forEach((entry) => {
    if (!entry?.url) return;
    const label = entry.label || title || getStreamLabel(entry);
    lines.push(`#EXTINF:-1,${label}`);
    lines.push(entry.url);
  });
  return lines.join("\n");
};

export const downloadTextFile = (filename, contents, mime = "text/plain") => {
  if (typeof document === "undefined") return false;
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
};

export const downloadM3uPlaylist = ({ title, entries }) => {
  const playlist = buildM3uPlaylist({ title, entries });
  const filename = `${sanitizeFilename(title)}.m3u`;
  return downloadTextFile(filename, playlist, "audio/x-mpegurl");
};

export const copyToClipboard = async (text) => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to execCommand fallback
    }
  }

  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  let succeeded;
  try {
    succeeded = document.execCommand("copy");
  } catch {
    succeeded = false;
  }
  document.body.removeChild(textarea);
  return Boolean(succeeded);
};

// Try to launch a desktop app via custom URL scheme. Browser confirmation
// dialogs make launch detection fuzzy, so listen for handoff-like page state
// changes and wait long enough for the user to approve the prompt.
export const openWithProtocol = (scheme, url) =>
  new Promise((resolve) => {
    if (typeof window === "undefined" || typeof document === "undefined" || !scheme || !url) {
      resolve(false);
      return;
    }

    const timer = window.setTimeout(() => finalize(false), 5000);
    let settled = false;
    const finalize = (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resolve(value);
    };

    const onPageHide = () => finalize(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") finalize(true);
    };

    window.addEventListener("pagehide", onPageHide, { once: true });
    document.addEventListener("visibilitychange", onVisibilityChange);

    try {
      window.location.href = buildExternalProtocolUrl(scheme, url);
    } catch {
      finalize(false);
      return;
    }
  });

// Summarise a stream entry into something the external-player menu can show
// (title + URL) and the M3U generator can label.
export const describeStreamForExternal = (stream, fallbackTitle) => {
  if (!stream) return null;
  if (!stream.url) return null;
  return {
    url: stream.url,
    label: getStreamLabel(stream) || fallbackTitle || "Stream"
  };
};

export const externalPlayerSupport = {
  isIOS,
  isAndroid,
  detectPlatform,
  availableExternalPlayers
};
