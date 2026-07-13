import { describe, expect, it } from "vitest";
import {
  buildExternalProtocolUrl,
  buildM3uPlaylist,
  checkAudioSupport,
  getAudioCodecLabel,
  getStreamFormat,
  getStreamLabel,
  getStreamQuality,
  getStreamSource,
  hasProxyHeaders,
  isBrowserPlayableStream,
  isExternalPlayerRecommended,
  isHlsUrl,
  isIframeUrl,
  isMagnetUrl,
  isWebtorrentPlayable,
  normalizeAudioCodec,
  partitionStreams,
} from "../streamUtils";
import {
  buildFallbackStreamList,
  FALLBACK_EMBED_PLAYER_IDS,
  isFallbackEmbedUrl,
} from "../fallbackStreams";

describe("hasProxyHeaders", () => {
  it("returns false for streams without behaviorHints", () => {
    expect(hasProxyHeaders({ url: "https://x" })).toBe(false);
  });

  it("returns true when behaviorHints.proxyHeaders.request is set", () => {
    expect(hasProxyHeaders({ behaviorHints: { proxyHeaders: { request: { Referer: "x" } } } })).toBe(true);
  });
});

describe("isHlsUrl", () => {
  it("detects .m3u8 paths", () => {
    expect(isHlsUrl("https://example.com/path/file.m3u8")).toBe(true);
    expect(isHlsUrl("https://example.com/path/file.m3u8?token=abc")).toBe(true);
  });

  it("ignores non-m3u8 URLs", () => {
    expect(isHlsUrl("https://example.com/file.mp4")).toBe(false);
    expect(isHlsUrl("")).toBe(false);
  });
});

describe("isIframeUrl", () => {
  it("matches known embed player domains", () => {
    expect(isIframeUrl("https://vidsrc-embed.ru/embed/movie?tmdb=1")).toBe(true);
    expect(isIframeUrl("https://www.2embed.cc/embed/12345")).toBe(true);
    expect(isIframeUrl("https://multiembed.mov/?video_id=1")).toBe(true);
    expect(isIframeUrl("https://vidlink.pro/movie/1")).toBe(true);
  });

  it("does not match direct stream URLs", () => {
    expect(isIframeUrl("https://cdn.example.com/stream.m3u8")).toBe(false);
    expect(isIframeUrl("https://cdn.example.com/file.mp4")).toBe(false);
  });

  it("returns false for empty / missing input", () => {
    expect(isIframeUrl("")).toBe(false);
    expect(isIframeUrl(undefined)).toBe(false);
  });
});

describe("isMagnetUrl", () => {
  it("matches magnet: URIs with their canonical query form", () => {
    expect(isMagnetUrl("magnet:?xt=urn:btih:abcd1234")).toBe(true);
    expect(isMagnetUrl("MAGNET:?xt=urn:btih:ABCD")).toBe(true);
  });

  it("does not match direct or embed URLs", () => {
    expect(isMagnetUrl("https://cdn.example.com/stream.m3u8")).toBe(false);
    expect(isMagnetUrl("https://vidsrc-embed.ru/embed/movie?tmdb=1")).toBe(false);
  });

  it("returns false for empty / missing input", () => {
    expect(isMagnetUrl("")).toBe(false);
    expect(isMagnetUrl(undefined)).toBe(false);
  });
});

describe("partitionStreams", () => {
  it("splits a mixed list into iframe and webstreamer buckets", () => {
    const result = partitionStreams([
      { url: "https://vidsrc-embed.ru/embed/movie?tmdb=1", isIframe: true },
      { url: "https://cdn.example.com/x.m3u8" }
    ]);

    expect(result.iframe).toHaveLength(1);
    expect(result.webstreamer).toHaveLength(1);
  });

  it("returns empty buckets for an empty / invalid input", () => {
    expect(partitionStreams([])).toEqual({ iframe: [], webstreamer: [] });
    expect(partitionStreams(null)).toEqual({ iframe: [], webstreamer: [] });
  });
});

describe("isBrowserPlayableStream", () => {
  it("excludes magnet links", () => {
    expect(isBrowserPlayableStream({
      url: "magnet:?xt=urn:btih:abc",
      isMagnet: true,
      name: "Torrentio · Movie.2024.1080p.AAC.H264",
      title: "1080p AAC"
    })).toBe(false);
  });
});

describe("getStreamQuality", () => {
  it("extracts 4K", () => {
    expect(getStreamQuality({ name: "Source 4K" })).toBe("4K");
  });

  it("extracts 1080p", () => {
    expect(getStreamQuality({ name: "Source", title: "1080p h264" })).toBe("1080P");
  });

  it("falls back to Auto when nothing matches", () => {
    expect(getStreamQuality({ name: "Some unnamed source" })).toBe("Auto");
  });
});

describe("getStreamFormat", () => {
  it("identifies HLS", () => {
    expect(getStreamFormat({ url: "https://x/manifest.m3u8" })).toBe("HLS");
  });

  it("identifies MP4", () => {
    expect(getStreamFormat({ url: "https://x/video.mp4" })).toBe("MP4");
  });

  it("falls back to Stream", () => {
    expect(getStreamFormat({ url: "https://x/something" })).toBe("Stream");
  });
});

describe("getStreamSource", () => {
  it("returns the first line of the name", () => {
    expect(getStreamSource({ name: "VidSrc Embed\n1080p" })).toBe("VidSrc Embed");
  });

  it("returns 'Unknown source' when name is missing", () => {
    expect(getStreamSource({})).toBe("Unknown source");
  });
});

describe("getStreamLabel", () => {
  it("combines source and quality", () => {
    expect(getStreamLabel({ name: "VidSrc Embed\n1080p" })).toBe("VidSrc Embed · 1080P");
  });
});

describe("normalizeAudioCodec", () => {
  it("detects ec-3 (Dolby Digital Plus)", () => {
    expect(normalizeAudioCodec({ audioCodec: "ec-3" })).toBe("ec-3");
    expect(normalizeAudioCodec({ codec: "eac3" })).toBe("ec-3");
  });

  it("detects ac-3 (Dolby Digital)", () => {
    expect(normalizeAudioCodec({ audioCodec: "ac-3" })).toBe("ac-3");
    expect(normalizeAudioCodec({ codec: "ac3" })).toBe("ac-3");
  });

  it("detects aac, opus, mp3", () => {
    expect(normalizeAudioCodec({ audioCodec: "mp4a-40.2" })).toBe("aac");
    expect(normalizeAudioCodec({ audioCodec: "opus" })).toBe("opus");
    expect(normalizeAudioCodec({ audioCodec: "mp3" })).toBe("mp3");
  });

  it("returns empty string for unknown codec", () => {
    expect(normalizeAudioCodec({})).toBe("");
  });
});

describe("getAudioCodecLabel", () => {
  it("maps ec-3 to Dolby Digital Plus", () => {
    expect(getAudioCodecLabel({ audioCodec: "ec-3" })).toBe("Dolby Digital Plus");
  });

  it("maps ac-3 to Dolby Digital", () => {
    expect(getAudioCodecLabel({ audioCodec: "ac-3" })).toBe("Dolby Digital");
  });

  it("falls back to 'Audio' for unknown codec", () => {
    expect(getAudioCodecLabel({})).toBe("Audio");
  });
});

describe("buildM3uPlaylist", () => {
  it("emits an EXTM3U header and one EXTINF/URL pair per entry", () => {
    const playlist = buildM3uPlaylist({
      title: "Sample",
      entries: [
        { url: "https://a/1.m3u8", label: "Server A" },
        { url: "https://b/2.m3u8", label: "Server B" },
      ],
    });
    expect(playlist.startsWith("#EXTM3U")).toBe(true);
    expect(playlist).toContain("#EXTINF:-1,Server A");
    expect(playlist).toContain("https://a/1.m3u8");
    expect(playlist).toContain("#EXTINF:-1,Server B");
    expect(playlist).toContain("https://b/2.m3u8");
  });

  it("skips entries with no url", () => {
    const playlist = buildM3uPlaylist({
      title: "Sample",
      entries: [{ url: null }, { url: "https://a/1.m3u8" }],
    });
    expect(playlist).toContain("https://a/1.m3u8");
    expect(playlist.match(/#EXTINF/g)?.length).toBe(1);
  });
});

describe("buildExternalProtocolUrl", () => {
  const decodeUrlSafeBase64 = (value) => {
    const normalized = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    return atob(normalized);
  };

  it("base64-url-encodes the URL with the scheme prefix", () => {
    const result = buildExternalProtocolUrl("vlc://", "https://x/y.m3u8?token=+/=");
    expect(result.startsWith("vlc://")).toBe(true);
    const encoded = result.replace("vlc://", "");
    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeUrlSafeBase64(encoded)).toBe("https://x/y.m3u8?token=+/=");
  });

  it("tolerates a missing scheme", () => {
    expect(buildExternalProtocolUrl("", "https://x")).toBe("");
  });
});

describe("isExternalPlayerRecommended", () => {
  it("flags MKV sources", () => {
    expect(isExternalPlayerRecommended({ url: "https://x/y.mkv" })).toBe(true);
  });

  it("flags notWebReady sources", () => {
    expect(isExternalPlayerRecommended({ url: "https://x/y.m3u8", behaviorHints: { notWebReady: true } })).toBe(true);
  });

  it("does not flag a normal MP4", () => {
    expect(isExternalPlayerRecommended({ url: "https://x/y.mp4" })).toBe(false);
  });
});

describe("isWebtorrentPlayable", () => {
  it("flags magnet URLs", () => {
    expect(isWebtorrentPlayable({ url: "magnet:?xt=urn:btih:abcd" })).toBe(true);
  });

  it("flags isMagnet streams even without a URL prefix", () => {
    expect(isWebtorrentPlayable({ isMagnet: true, url: "" })).toBe(true);
  });

  it("does not flag direct stream URLs", () => {
    expect(isWebtorrentPlayable({ url: "https://cdn.example.com/x.m3u8" })).toBe(false);
  });

  it("returns false for empty / missing input", () => {
    expect(isWebtorrentPlayable(null)).toBe(false);
    expect(isWebtorrentPlayable({})).toBe(false);
  });
});

describe("checkAudioSupport", () => {
  const chromeAudioSupport = {
    aac: true,
    mp3: true,
    opus: true,
    vorbis: true,
    ac3: false,
    eac3: false,
  };

  it("reports unsupported for TrueHD", () => {
    expect(checkAudioSupport({ name: "Source", title: "TrueHD 7.1" }, chromeAudioSupport).supported).toBe(false);
  });

  it("reports supported for AAC", () => {
    expect(checkAudioSupport({ name: "Source", title: "AAC 2.0" }, chromeAudioSupport).supported).toBe(true);
  });

  it("reports unsupported for Dolby Digital when the browser cannot play it", () => {
    expect(checkAudioSupport({ name: "Source", title: "AC3 5.1" }, chromeAudioSupport).supported).toBe(false);
  });

  it("reports unsupported for Dolby Digital Plus when the browser cannot play it", () => {
    expect(checkAudioSupport({ name: "Source", title: "E-AC-3 5.1" }, chromeAudioSupport).supported).toBe(false);
  });

  it("reports supported for Dolby Digital Plus when the browser can play it", () => {
    expect(checkAudioSupport({ name: "Source", title: "E-AC-3 5.1" }, { ...chromeAudioSupport, eac3: true }).supported).toBe(true);
  });

  it("does not mark unknown audio as good to go", () => {
    expect(checkAudioSupport({ name: "Source", title: "1080p H.264" }, chromeAudioSupport).supported).toBe(false);
  });
});

// ─── fallbackStreams.js ─────────────────────────────────────────────────────

describe("buildFallbackStreamList", () => {
  const movie = { tmdbId: 324857, streamType: "movie" };
  const episode = { tmdbId: 66732, streamType: "series", seasonNumber: 1, episodeNumber: 1 };

  it("returns five entries for a movie", () => {
    const streams = buildFallbackStreamList(movie);
    expect(streams).toHaveLength(5);
    expect(streams.every((s) => s.isIframe)).toBe(true);
  });

  it("includes season/episode params for series streams", () => {
    const streams = buildFallbackStreamList(episode);
    expect(streams.some((s) => s.url.includes("season=1") || s.url.includes("season%3D1"))).toBe(true);
    expect(streams.some((s) => s.url.includes("episode=1") || s.url.includes("episode%3D1"))).toBe(true);
  });

  it("returns an empty list when no tmdbId is provided", () => {
    expect(buildFallbackStreamList({})).toEqual([]);
    expect(buildFallbackStreamList(null)).toEqual([]);
  });

  it("uses vidlink.pro as the first source", () => {
    const streams = buildFallbackStreamList(movie);
    expect(streams[0].url).toContain("vidlink.pro");
  });
});

describe("isFallbackEmbedUrl", () => {
  it("matches registered player URLs", () => {
    expect(isFallbackEmbedUrl("https://vsembed.ru/embed/movie?tmdb=1")).toBe(true);
    expect(isFallbackEmbedUrl("https://vidsrcme.ru/embed/movie?tmdb=1")).toBe(true);
  });

  it("returns false for unrelated URLs", () => {
    expect(isFallbackEmbedUrl("https://example.com/foo.m3u8")).toBe(false);
    expect(isFallbackEmbedUrl("")).toBe(false);
  });
});

describe("FALLBACK_EMBED_PLAYER_IDS", () => {
  it("exposes the five registered ids", () => {
    expect(FALLBACK_EMBED_PLAYER_IDS).toEqual([
      "vidlink",
      "vidsrc-embed",
      "vidsrc-me",
      "superembed",
      "vidsrc-to",
    ]);
  });
});
