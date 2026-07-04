import { beforeEach, describe, expect, it, vi } from "vitest";
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
// Mock `webtorrent` BEFORE importing the module that consumes it. The mock
// exposes a class factory that the test can override per-case via
// `mockTorrentClientCtor`.
const mockTorrentClientCtor = vi.fn();
vi.mock("webtorrent", () => ({
  default: function MockWebTorrent() {
    return mockTorrentClientCtor();
  }
}));

const flushPromises = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

import {
  formatTorrentStatus,
  getMagnetFileIndex,
  hasMseCompatibleVideo,
  listVideoFiles,
  pickFileByIndex,
  pickVideoFile,
  default as TorrentStreamSession,
} from "../torrentPlayer";
import {
  buildFallbackStreamList,
  FALLBACK_EMBED_PLAYER_IDS,
  isFallbackEmbedUrl,
} from "../fallbackStreams";
import {
  isSetupOrConfigStream,
  parseMagnetSelectOnly,
  stripEmbeddedUrls,
} from "../../../vite/torrentio-plugin.js";
// `isMseContainer` and `buildUnsupportedContainerError` live in the
// dev-proxy plugin (torrent-stream-plugin.js), not the Stremio addon
// plugin (torrentio-plugin.js). They were extracted there so the
// dev proxy and the in-browser client agree on what counts as
// MSE-demuxable. Import from the correct file below.
import {
  buildUnsupportedContainerError,
  isMseContainer,
} from "../../../vite/torrent-stream-plugin.js";

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
  it("splits a mixed list into iframe, webstreamer, and torrentio buckets", () => {
    const result = partitionStreams([
      { url: "magnet:?xt=urn:btih:abc", source: "torrentio" },
      { url: "https://vidsrc-embed.ru/embed/movie?tmdb=1", isIframe: true },
      { url: "https://cdn.example.com/x.m3u8" }
    ]);

    expect(result.torrentio).toHaveLength(1);
    expect(result.iframe).toHaveLength(1);
    expect(result.webstreamer).toHaveLength(1);
  });

  it("classifies isMagnet: true entries as torrentio even without a source tag", () => {
    const result = partitionStreams([
      { url: "magnet:?xt=urn:btih:abc", isMagnet: true },
      { url: "https://example.com/x.mp4" }
    ]);
    expect(result.torrentio).toHaveLength(1);
    expect(result.webstreamer).toHaveLength(1);
  });

  it("classifies all torrent entries as torrentio or webstreamer", () => {
    const result = partitionStreams([
      { url: "/api/torrent/stream?magnet=abc", source: "stream-torrent", serverTorrent: true },
      { url: "magnet:?xt=urn:btih:abc", source: "torrentio", isMagnet: true }
    ]);
    expect(result.torrentio).toHaveLength(1);
    expect(result.webstreamer).toHaveLength(1);
  });

  it("keeps Torrentio configure links in the torrentio bucket", () => {
    const result = partitionStreams([
      { url: "https://torrentio.strem.fun/configure", source: "torrentio", isConfigLink: true }
    ]);
    expect(result.torrentio).toHaveLength(1);
  });

  it("returns empty buckets for an empty / invalid input", () => {
    expect(partitionStreams([])).toEqual({ iframe: [], webstreamer: [], torrentio: [] });
    expect(partitionStreams(null)).toEqual({ iframe: [], webstreamer: [], torrentio: [] });
  });
});

describe("isBrowserPlayableStream", () => {
  it("excludes Torrentio magnet links even when their title contains supported audio", () => {
    expect(isBrowserPlayableStream({
      url: "magnet:?xt=urn:btih:abc",
      isMagnet: true,
      name: "Torrentio · Movie.2024.1080p.AAC.H264",
      title: "1080p AAC"
    })).toBe(false);
  });
});

describe("isSetupOrConfigStream", () => {
  it("flags streams that link to torrentio.org/setup", () => {
    expect(isSetupOrConfigStream({
      infoHash: "abcd",
      url: "https://torrentio.org/setup/abcd/manifest.json"
    })).toBe(true);
  });

  it("flags streams whose title contains a Torrentio setup link", () => {
    expect(isSetupOrConfigStream({
      infoHash: "abcd",
      title: "Configure at https://torrentio.org/setup/abcd"
    })).toBe(true);
  });

  it("flags streams that link to the torrentio.strem.io addon itself", () => {
    expect(isSetupOrConfigStream({
      infoHash: "abcd",
      url: "https://torrentio.strem.io/manifest.json"
    })).toBe(true);
  });

  it("flags the torrentio.strem.fun configure page", () => {
    expect(isSetupOrConfigStream({
      title: "Configure at https://torrentio.strem.fun/configure"
    })).toBe(true);
  });

  it("passes a normal torrent stream through", () => {
    expect(isSetupOrConfigStream({
      infoHash: "abcd",
      title: "Movie.Name.2024.1080p.WEB-DL",
      name: "Torrentio\n1080p"
    })).toBe(false);
  });

  it("returns false for empty / missing input", () => {
    expect(isSetupOrConfigStream(null)).toBe(false);
    expect(isSetupOrConfigStream({})).toBe(false);
  });
});

describe("stripEmbeddedUrls", () => {
  it("removes http(s) URLs from a string", () => {
    expect(stripEmbeddedUrls("Movie 2024 1080p - configure at https://torrentio.org/setup/x"))
      .toBe("Movie 2024 1080p - configure at");
  });

  it("collapses extra whitespace left after URL removal", () => {
    expect(stripEmbeddedUrls("Foo  https://x.com  bar"))
      .toBe("Foo bar");
  });

  it("passes through strings without URLs unchanged", () => {
    expect(stripEmbeddedUrls("Clean title with no link")).toBe("Clean title with no link");
  });

  it("returns the input untouched for empty / non-string values", () => {
    expect(stripEmbeddedUrls("")).toBe("");
    expect(stripEmbeddedUrls(null)).toBe(null);
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

describe("pickVideoFile", () => {
  it("prefers the largest non-junk video when junk files are present", () => {
    const files = [
      { name: "Movie.Name.2024.1080p.nfo", length: 1200 },
      { name: "RARBG.txt", length: 30 },
      { name: "Movie.Name.2024.1080p/sample.mkv", length: 12_000_000 },
      { name: "Movie.Name.2024.1080p.mkv", length: 4_500_000_000 },
      { name: "Movie.Name.2024.1080p.srt", length: 80_000 }
    ];
    expect(pickVideoFile(files).name).toBe("Movie.Name.2024.1080p.mkv");
  });

  it("prefers MP4 over MKV when both are present and sizes are close", () => {
    const files = [
      { name: "movie.mkv", length: 2_000_000_000 },
      { name: "movie.mp4", length: 1_900_000_000 }
    ];
    expect(pickVideoFile(files).name).toBe("movie.mp4");
  });

  it("falls back to webm when no mp4 is present", () => {
    const files = [
      { name: "movie.webm", length: 800_000_000 },
      { name: "movie.srt", length: 50_000 }
    ];
    expect(pickVideoFile(files).name).toBe("movie.webm");
  });

  it("falls back to any video extension when MP4/WebM are missing", () => {
    const files = [
      { name: "movie.ts", length: 600_000_000 },
      { name: "movie.txt", length: 200 }
    ];
    expect(pickVideoFile(files).name).toBe("movie.ts");
  });

  it("skips sample files even when they're the only candidate", () => {
    const files = [
      { name: "Release/sample.mkv", length: 12_000_000 },
      { name: "Release/Subs/English.srt", length: 60_000 }
    ];
    expect(pickVideoFile(files)).toBe(null);
  });

  it("prefers part 1 over part 2 in a multi-part release", () => {
    // DISC1 and DISC2 share the same size and container, so the only
    // thing that can separate them is the part-number penalty. We put
    // DISC2 first to verify the scorer (not Array order) decides the
    // winner.
    const files = [
      { name: "Movie.Name.2024.DISC2.mkv", length: 8_000_000_000 },
      { name: "Movie.Name.2024.DISC1.mkv", length: 8_000_000_000 }
    ];
    const picked = pickVideoFile(files);
    expect(picked?.name).toBe("Movie.Name.2024.DISC1.mkv");
  });

  it("respects RarBG .R1/.R2 disc-set ordering", () => {
    const files = [
      { name: "Movie.2024.Remux.R2.mkv", length: 25_000_000_000 },
      { name: "Movie.2024.Remux.R1.mkv", length: 25_000_000_000 }
    ];
    const picked = pickVideoFile(files);
    expect(picked?.name).toBe("Movie.2024.Remux.R1.mkv");
  });

  it("ignores .partN.rar and other RarBG-style partials", () => {
    const files = [
      { name: "movie.part01.rar", length: 100_000_000 },
      { name: "movie.part02.rar", length: 100_000_000 },
      { name: "movie.mp4", length: 1_200_000_000 }
    ];
    expect(pickVideoFile(files).name).toBe("movie.mp4");
  });

  it("prefers a smaller MP4 sibling over a much larger MKV when the MKV can't be MSE-demuxed", () => {
    // Without the container penalty, size dominates and the 8GB MKV
    // would always win. With the MKV penalty, a 1.5GB MP4 sibling is
    // the safer browser-playable pick.
    const files = [
      { name: "release/movie.mkv", length: 8_000_000_000 },
      { name: "release/movie.mp4", length: 1_500_000_000 }
    ];
    const picked = pickVideoFile(files);
    expect(picked?.name).toBe("release/movie.mp4");
  });

  it("prefers WebM over MKV of similar size when no MP4 is present", () => {
    const files = [
      { name: "release/movie.mkv", length: 2_500_000_000 },
      { name: "release/movie.webm", length: 2_300_000_000 }
    ];
    expect(pickVideoFile(files)?.name).toBe("release/movie.webm");
  });

  it("still falls back to MKV when no MSE-compatible container is present", () => {
    const files = [
      { name: "release/movie.mkv", length: 4_000_000_000 }
    ];
    expect(pickVideoFile(files)?.name).toBe("release/movie.mkv");
  });

  it("returns null for empty / invalid input", () => {
    expect(pickVideoFile([])).toBe(null);
    expect(pickVideoFile(null)).toBe(null);
    expect(pickVideoFile(undefined)).toBe(null);
  });
});

describe("listVideoFiles", () => {
  it("returns all non-junk video files sorted by score", () => {
    const files = [
      { name: "Release/movie.mkv", length: 4_000_000_000 },
      { name: "Release/sample.mkv", length: 8_000_000 },
      { name: "Release/cover.jpg", length: 80_000 },
      { name: "Release/Subs/English.srt", length: 50_000 },
      { name: "Release/movie.nfo", length: 1_200 },
      { name: "Release/Featurettes/behind.mkv", length: 200_000_000 }
    ];
    const ranked = listVideoFiles(files);
    // The Featurettes/ behind-the-scenes extras are correctly
    // identified as junk by the JUNK_FILE_PATTERNS, so the ranked list
    // only contains the main MKV. (The earlier test expected 2 entries
    // because the Featurettes pattern hadn't been added yet.)
    expect(ranked).toHaveLength(1);
    expect(ranked[0].name).toBe("Release/movie.mkv");
  });

  it("returns an empty array for empty / invalid input", () => {
    expect(listVideoFiles([])).toEqual([]);
    expect(listVideoFiles(null)).toEqual([]);
    expect(listVideoFiles(undefined)).toEqual([]);
  });
});

describe("getMagnetFileIndex", () => {
  it("parses the so= parameter from a magnet URI", () => {
    expect(getMagnetFileIndex("magnet:?xt=urn:btih:abc&so=3&dn=foo")).toBe(3);
  });

  it("accepts so= as the first query parameter", () => {
    expect(getMagnetFileIndex("magnet:?so=0&xt=urn:btih:abc")).toBe(0);
  });

  it("returns null when the parameter is missing", () => {
    expect(getMagnetFileIndex("magnet:?xt=urn:btih:abc&dn=foo")).toBe(null);
  });

  it("returns null for non-numeric so= values", () => {
    expect(getMagnetFileIndex("magnet:?xt=urn:btih:abc&so=abc")).toBe(null);
  });

  it("returns null for negative indices", () => {
    expect(getMagnetFileIndex("magnet:?xt=urn:btih:abc&so=-1")).toBe(null);
  });

  it("returns null for non-magnet input", () => {
    expect(getMagnetFileIndex("https://example.com/foo.mkv")).toBe(null);
    expect(getMagnetFileIndex("")).toBe(null);
    expect(getMagnetFileIndex(null)).toBe(null);
  });
});

describe("parseMagnetSelectOnly (vite plugin re-export)", () => {
  it("matches the in-browser parser", () => {
    expect(parseMagnetSelectOnly("magnet:?xt=urn:btih:abc&so=2")).toBe(2);
    expect(parseMagnetSelectOnly("magnet:?xt=urn:btih:abc")).toBe(null);
  });
});

describe("isMseContainer (dev proxy)", () => {
  it("flags the browser-native MP4/M4V/MOV/WEBM/OGV containers", () => {
    expect(isMseContainer({ name: "movie.mp4" })).toBe(true);
    expect(isMseContainer({ name: "movie.m4v" })).toBe(true);
    expect(isMseContainer({ name: "movie.m4p" })).toBe(true);
    expect(isMseContainer({ name: "movie.mov" })).toBe(true);
    expect(isMseContainer({ name: "movie.webm" })).toBe(true);
    expect(isMseContainer({ name: "movie.ogv" })).toBe(true);
    expect(isMseContainer({ name: "Release/movie.mp4" })).toBe(true);
  });

  it("rejects containers Chrome cannot demux in MSE", () => {
    expect(isMseContainer({ name: "movie.mkv" })).toBe(false);
    expect(isMseContainer({ name: "movie.avi" })).toBe(false);
    expect(isMseContainer({ name: "movie.ts" })).toBe(false);
    expect(isMseContainer({ name: "movie.mpg" })).toBe(false);
  });

  it("returns false for files without a name", () => {
    expect(isMseContainer({})).toBe(false);
    expect(isMseContainer(null)).toBe(false);
    expect(isMseContainer({ name: "" })).toBe(false);
  });
});

describe("buildUnsupportedContainerError (dev proxy 415 payload)", () => {
  it("returns a 415 with the container extension and an actionable message", () => {
    const { statusCode, body } = buildUnsupportedContainerError({ name: "movie.mkv" });
    expect(statusCode).toBe(415);
    expect(body.container).toBe("mkv");
    expect(body.fileName).toBe("movie.mkv");
    expect(body.needsExternalPlayer).toBe(true);
    expect(body.error).toMatch(/MKV/);
    expect(body.error).toMatch(/VLC|torrent client/i);
  });

  it("falls back to a generic message for files without an extension", () => {
    const { body } = buildUnsupportedContainerError({ name: "movie" });
    expect(body.container).toBe("");
    expect(body.error).toMatch(/this container/);
  });

  it("tolerates a missing file object", () => {
    const { body } = buildUnsupportedContainerError(null);
    expect(body.fileName).toBe("");
    expect(body.error).toMatch(/this container/);
  });
});

describe("pickFileByIndex", () => {
  it("returns the file at the given zero-based index", () => {
    const files = [
      { name: "movie.mkv", length: 4_000_000_000 },
      { name: "sample.mkv", length: 8_000_000 },
      { name: "movie.mp4", length: 1_500_000_000 }
    ];
    expect(pickFileByIndex(files, 2)?.name).toBe("movie.mp4");
  });

  it("skips junk files even when the index points at them", () => {
    const files = [
      { name: "movie.mkv", length: 4_000_000_000 },
      { name: "sample.mkv", length: 8_000_000 }
    ];
    expect(pickFileByIndex(files, 1)).toBe(null);
  });

  it("returns null for an out-of-range index", () => {
    expect(pickFileByIndex([{ name: "movie.mkv" }], 5)).toBe(null);
  });

  it("returns null for non-integer or missing indices", () => {
    const files = [{ name: "movie.mkv", length: 4_000_000_000 }];
    expect(pickFileByIndex(files, undefined)).toBe(null);
    expect(pickFileByIndex(files, null)).toBe(null);
    expect(pickFileByIndex(files, 0.5)).toBe(null);
  });
});

describe("hasMseCompatibleVideo", () => {
  it("returns true when at least one MSE-compatible file is present", () => {
    expect(hasMseCompatibleVideo([
      { name: "movie.mkv" },
      { name: "movie.mp4" }
    ])).toBe(true);
  });

  it("returns false when only non-MSE containers are present", () => {
    expect(hasMseCompatibleVideo([
      { name: "movie.mkv" },
      { name: "movie.avi" }
    ])).toBe(false);
  });

  it("returns false for empty / invalid input", () => {
    expect(hasMseCompatibleVideo([])).toBe(false);
    expect(hasMseCompatibleVideo(null)).toBe(false);
  });
});

describe("formatTorrentStatus", () => {
  it("renders peer count, speed, and progress", () => {
    const out = formatTorrentStatus({ peers: 12, downloadSpeed: 1024 * 256, progress: 0.42 });
    expect(out).toContain("12 peers");
    expect(out).toContain("256 KB/s");
    expect(out).toContain("42%");
  });

  it("singularises 'peer' for one peer", () => {
    const out = formatTorrentStatus({ peers: 1, downloadSpeed: 0, progress: 0 });
    expect(out).toBe("1 peer");
    expect(out).not.toMatch(/1 peers/);
  });

  it("appends 'done' when the torrent is complete", () => {
    const out = formatTorrentStatus({ peers: 4, downloadSpeed: 0, progress: 1, done: true });
    expect(out).toContain("done");
  });

  it("returns empty string for falsy input", () => {
    expect(formatTorrentStatus(null)).toBe("");
    expect(formatTorrentStatus(undefined)).toBe("");
  });
});

describe("TorrentStreamSession", () => {
  // The fake client is a *stable* instance so the test can override
  // `add` after `load()` has already grabbed a reference to it. (Calling
  // a `ctor` factory twice would yield two different objects, and the
  // second `add` override would never reach the live client.)
  const makeFakeClient = ({ torrent }) => {
    const calls = { add: 0, destroyed: 0 };
    const instance = {
      add: (magnet, opts, cb) => { calls.add++; cb(torrent); },
      on: () => {},
      destroy: () => { calls.destroyed++; }
    };
    return {
      calls,
      instance,
      ctor: () => instance
    };
  };

  beforeEach(() => {
    mockTorrentClientCtor.mockReset();
  });

  it("reports an error when given a missing magnet / video element", () => {
    const session = new TorrentStreamSession();
    const errors = [];
    session.load("", null, { onError: (e) => errors.push(e) });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Missing magnet URL/);
  });

  it("creates a client, calls renderTo, and surfaces onReady", async () => {
    const fakeFile = {
      name: "movie.mp4",
      renderTo: (videoElement, opts, cb) => { cb(); }
    };
    const fakeTorrent = {
      files: [fakeFile],
      numPeers: 0,
      downloadSpeed: 0,
      uploaded: 0,
      downloaded: 0,
      progress: 0,
      on: () => {},
      destroy: () => {}
    };
    const { calls, ctor } = makeFakeClient({ torrent: fakeTorrent });
    mockTorrentClientCtor.mockImplementation(ctor);

    const session = new TorrentStreamSession();
    const ready = [];
    const statuses = [];
    session.load("magnet:?xt=urn:btih:abc", {}, {
      onReady: (f) => ready.push(f),
      onStatus: (s) => statuses.push(s)
    });
    await vi.waitFor(() => expect(calls.add).toBe(1));
    expect(ready[0]).toBe(fakeFile);
    expect(statuses.length).toBeGreaterThanOrEqual(1);

    session.cleanup();
    expect(calls.destroyed).toBe(1);
  });

  it("honours the Stremio fileIdx from the load() handler context", async () => {
    const files = [
      { name: "Release/movie.mkv", length: 4_000_000_000 },
      { name: "Release/movie.mp4", length: 1_500_000_000 }
    ];
    const fakeTorrent = {
      files,
      numPeers: 0,
      downloadSpeed: 0,
      uploaded: 0,
      downloaded: 0,
      progress: 0,
      on: () => {},
      destroy: () => {}
    };
    const { ctor } = makeFakeClient({ torrent: fakeTorrent });
    mockTorrentClientCtor.mockImplementation(ctor);

    const session = new TorrentStreamSession();
    const fileChanges = [];
    const renderTargets = [];
    // Override renderTo on the chosen file so we can assert which file
    // the session picked.
    files[1].renderTo = (video, opts, cb) => { renderTargets.push(files[1].name); cb(); };
    session.load("magnet:?xt=urn:btih:abc", {}, {
      fileIdx: 1,
      onFileChange: (f) => fileChanges.push(f?.name)
    });
    await vi.waitFor(() => expect(renderTargets).toHaveLength(1));
    expect(fileChanges[0]).toBe("Release/movie.mp4");
    expect(renderTargets[0]).toBe("Release/movie.mp4");

    session.cleanup();
  });

  it("honours the magnet so= parameter when no fileIdx is supplied", async () => {
    const files = [
      { name: "Release/movie.mkv", length: 4_000_000_000 },
      { name: "Release/movie.mp4", length: 1_500_000_000 }
    ];
    const fakeTorrent = {
      files,
      numPeers: 0,
      downloadSpeed: 0,
      uploaded: 0,
      downloaded: 0,
      progress: 0,
      on: () => {},
      destroy: () => {}
    };
    const { ctor } = makeFakeClient({ torrent: fakeTorrent });
    mockTorrentClientCtor.mockImplementation(ctor);

    const session = new TorrentStreamSession();
    const fileChanges = [];
    files[1].renderTo = (_v, _o, cb) => cb();
    session.load("magnet:?xt=urn:btih:abc&so=1", {}, {
      onFileChange: (f) => fileChanges.push(f?.name)
    });
    await vi.waitFor(() => expect(fileChanges).toHaveLength(1));
    expect(fileChanges[0]).toBe("Release/movie.mp4");

    session.cleanup();
  });

  it("surfaces a clear error when the only file is not MSE-compatible", async () => {
    const fakeFile = {
      name: "movie.mkv",
      renderTo: () => {}
    };
    const fakeTorrent = {
      files: [fakeFile],
      numPeers: 0,
      downloadSpeed: 0,
      uploaded: 0,
      downloaded: 0,
      progress: 0,
      on: () => {},
      destroy: () => {}
    };
    const { ctor } = makeFakeClient({ torrent: fakeTorrent });
    mockTorrentClientCtor.mockImplementation(ctor);

    const session = new TorrentStreamSession();
    const errors = [];
    const fileChanges = [];
    session.load("magnet:?xt=urn:btih:abc", {}, {
      onError: (e) => errors.push(e),
      onFileChange: (f) => fileChanges.push(f?.name)
    });
    await flushPromises();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/MKV/);
    expect(errors[0].message).toMatch(/torrent client|VLC/i);
    // renderTo must NOT have been called.
    expect(fileChanges).toHaveLength(0);

    session.cleanup();
  });

  it("respects the addon's isNotWebReady hint and short-circuits when there is no MSE sibling", async () => {
    // isNotWebReady only fires when there is *no* MSE-compatible sibling
    // in the torrent. We use an MKV-only file list so the
    // `isNotWebReady && !anyMse` branch actually triggers.
    const fakeFile = {
      name: "movie.mkv",
      renderTo: () => {}
    };
    const fakeTorrent = {
      files: [fakeFile],
      numPeers: 0,
      downloadSpeed: 0,
      uploaded: 0,
      downloaded: 0,
      progress: 0,
      on: () => {},
      destroy: () => {}
    };
    const { ctor } = makeFakeClient({ torrent: fakeTorrent });
    mockTorrentClientCtor.mockImplementation(ctor);

    const session = new TorrentStreamSession();
    const errors = [];
    session.load("magnet:?xt=urn:btih:abc", {}, {
      isNotWebReady: true,
      onError: (e) => errors.push(e)
    });
    await flushPromises();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/not web-ready/);

    session.cleanup();
  });

  it("ignores isNotWebReady when an MSE-compatible sibling exists (user can pick it from Files)", async () => {
    // The user should be able to fall back to the MP4 sibling even when
    // the addon flagged a different file as not web-ready.
    const fakeFiles = [
      { name: "movie.mkv", renderTo: () => {} },
      { name: "movie.mp4", renderTo: (_v, _o, cb) => cb() }
    ];
    const fakeTorrent = {
      files: fakeFiles,
      numPeers: 0,
      downloadSpeed: 0,
      uploaded: 0,
      downloaded: 0,
      progress: 0,
      on: () => {},
      destroy: () => {}
    };
    const { ctor } = makeFakeClient({ torrent: fakeTorrent });
    mockTorrentClientCtor.mockImplementation(ctor);

    const session = new TorrentStreamSession();
    const errors = [];
    const fileChanges = [];
    session.load("magnet:?xt=urn:btih:abc", {}, {
      isNotWebReady: true,
      onError: (e) => errors.push(e),
      onFileChange: (f) => fileChanges.push(f?.name)
    });
    await flushPromises();
    expect(errors).toHaveLength(0);
    expect(fileChanges).toHaveLength(1);
    expect(fileChanges[0]).toBe("movie.mp4");

    session.cleanup();
  });

  it("reports an error when the torrent has no files", async () => {
    const fakeTorrent = { files: [], on: () => {}, destroy: () => {} };
    const { ctor } = makeFakeClient({ torrent: fakeTorrent });
    mockTorrentClientCtor.mockImplementation(ctor);

    const session = new TorrentStreamSession();
    const errors = [];
    session.load("magnet:?xt=urn:btih:abc", {}, { onError: (e) => errors.push(e) });
    await flushPromises();
    expect(errors[0].message).toMatch(/no playable files/);

    session.cleanup();
  });

  it("destroys an orphan torrent that resolves after cleanup()", async () => {
    const fakeTorrent = {
      files: [{ name: "movie.mp4" }],
      numPeers: 0,
      downloadSpeed: 0,
      uploaded: 0,
      downloaded: 0,
      progress: 0,
      on: () => {},
      destroy: vi.fn()
    };
    const { instance, ctor } = makeFakeClient({ torrent: fakeTorrent });
    mockTorrentClientCtor.mockImplementation(ctor);

    // Replace add() with a deferred variant so we can call cleanup()
    // before the torrent resolves.
    let resolveAdd = () => {};
    instance.add = (magnet, opts, cb) => { resolveAdd = () => cb(fakeTorrent); };

    const session = new TorrentStreamSession();
    session.load("magnet:?xt=urn:btih:abc", {}, { onError: () => {} });
    await flushPromises();
    session.cleanup();
    // Drain the pending callback after cleanup so the
    // torrent should be destroyed, not assigned to this.torrent.
    resolveAdd();
    expect(fakeTorrent.destroy).toHaveBeenCalled();
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
