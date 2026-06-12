// src/utils/torrentPlayer.js
// In-browser torrent streaming helper built on top of `webtorrent`.
//
// This module mirrors what Stremio's web player does: load a magnet link
// in the browser, find a video file inside the torrent, and stream it
// directly into a <video> element via `file.renderTo()` (which uses
// MediaSource Extensions under the hood).
//
// The class is intentionally small and lifecycle-bounded — one session
// per `load()` call, full cleanup on `cleanup()`. This avoids leaking
// WebRTC peers and MediaSource buffers when the user navigates between
// titles.
//
// `webtorrent` touches Node/browser compatibility shims during module
// evaluation, so load it only when a magnet stream is actually selected.

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|ts|mpeg|mpg|m4p|ogv|3gp)$/i;

// Filename patterns that are almost never the main movie: NFO, sample
// clips, subtitles, cover art, release metadata, and extras. These are
// filtered out before scoring so they cannot win even if they're named
// ambiguously.
const JUNK_FILE_PATTERNS = [
  /(^|[\\/])\.?[Ss]ample[\s._-]/i,                  // ".../Sample.avi", "Movie-Sample.mkv"
  /(?:^|[\\/])[Ss]ample\.[^/\\]+$/i,                 // bare "Sample.mkv"
  /\.(nfo|sfv|md5|sha1|sums|url|info|html?|css|js|json|xml)$/i,
  /\.(srt|sub|ass|ssa|vtt|sup|idx|usf|rt|smi)$/i,    // subtitle files
  /\.(jpe?g|png|gif|bmp|webp|tiff?|ico|svg)$/i,      // cover / fanart
  /\.(m3u8?|m3u|pls|log|cue|md|torrent|parts)$/i,
  /^(RARBG\.txt|Torrent Downloaded|www\.|Downloaded from)/i,
  /(?:^|[\\/])Proof(?:[\\/]|$)/i,
  /(?:^|[\\/])[Cc]over(?:[\\/]|$)/i,
  /(?:^|[\\/])Featurettes?(?:[\\/]|$)/i,
  /(?:^|[\\/])Trailers?(?:[\\/]|$)/i,
  /(?:^|[\\/])Bonus(?:[\\/]|$)/i,
  /(?:^|[\\/])Extras?(?:[\\/]|$)/i,
  /(?:^|[\\/])Behind[\s._-]the[\s._-][Ss]cenes?(?:[\\/]|$)/i,
  /(?:^|[\\/])[Dd]eleted[\s._-][Ss]cenes?(?:[\\/]|$)/i,
  /(?:^|[\\/])Interviews?(?:[\\/]|$)/i,
  /(?:^|[\\/])[Cc]ommentary(?:[\\/]|$)/i,
];

// Multi-part / disc release detection: CD1/CD2, Disc1/Disc2, Part1/Part2,
// Pt1/Pt2, .R1/.R2 (RarBG disc sets). Used to penalise later parts so
// part 1 wins, and so we can group them for the UI.
const PART_PATTERNS = [
  /(?:^|[^a-z])cd\s*(\d+)/i,
  /(?:^|[^a-z])disc\s*(\d+)/i,
  /(?:^|[^a-z])part\s*(\d+)/i,
  /(?:^|[^a-z])pt\s*(\d+)/i,
  /\.R(\d+)\./i,
  /\.part(\d+)\.rar$/i,
];

// Strip external tracker URLs (and similar peer-source params) from a
// magnet URI before handing it to WebTorrent. Public WSS trackers
// embedded in the magnet (e.g. tracker.openbittorrent.com,
// tracker.files.fm) are blocked from the browser (403 / connection
// closed), and the `announce` option in bittorrent-tracker is *additive*
// — it doesn't replace the trackers in the URI. Without stripping,
// WebTorrent spends its 30s timeout failing to reach them and the
// local proxy never gets used.
const MAGNET_TRACKER_KEYS = new Set([
  "tr",
  "tr.",        // legacy alias seen in some magnets
  "ws.tracker", // BEP 23-style websocket tracker
  "tracker",    // some indexers
  "x.pe",       // peer-exchange URL
]);
const stripMagnetTrackers = (magnetUrl) => {
  if (typeof magnetUrl !== "string") return magnetUrl;
  if (!magnetUrl.toLowerCase().startsWith("magnet:")) return magnetUrl;
  const queryStart = magnetUrl.indexOf("?");
  if (queryStart < 0) return magnetUrl;
  const prefix = magnetUrl.slice(0, queryStart + 1); // "magnet:?"
  const params = magnetUrl.slice(queryStart + 1).split("&");
  const kept = params.filter((p) => {
    const eq = p.indexOf("=");
    if (eq < 0) return true;
    return !MAGNET_TRACKER_KEYS.has(p.slice(0, eq).toLowerCase());
  });    return kept.length > 0 ? prefix + kept.join("&") : magnetUrl;
};

let webTorrentImport;

const loadWebTorrent = async () => {
  webTorrentImport ||= import("webtorrent").then((module) => module.default || module);
  return webTorrentImport;
};

const isVideoFile = (file) => {
  if (!file?.name) return false;
  return VIDEO_EXTENSIONS.test(file.name);
};

const isJunkFile = (file) => {
  if (!file?.name) return true;
  return JUNK_FILE_PATTERNS.some((re) => re.test(file.name));
};

const getPartNumber = (name) => {
  if (!name) return null;
  for (const re of PART_PATTERNS) {
    const match = name.match(re);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
};

const getFileSize = (file) => {
  // WebTorrent file objects expose `.length`; accept `.size` for generic
  // test fixtures.
  const size = file?.length ?? file?.size ?? 0;
  return Number.isFinite(size) ? size : 0;
};

// Score a file by "is this the main movie?" likelihood. Higher wins.
//   size dominates: the main video is almost always the largest file
//   .mp4/.m4v/.mov are preferred over .mkv (browser-native)
//   .webm beats .mkv in the rare case there's both
//   sample/extras/featurettes are heavily penalised
//   later parts (CD2, Part2) are mildly penalised so part 1 wins ties
const scoreFile = (file) => {
  if (!file || !isVideoFile(file) || isJunkFile(file)) return -Infinity;
  const name = file.name;

  const size = getFileSize(file);
  // log10 of bytes keeps the score in a sensible range across torrents
  // from a 50MB episode (1.7GB encoded as ~9.5) to a 80GB 4K remux (~10.9).
  const sizeScore = size > 0 ? Math.log10(size) * 4 : 0;

  let containerScore = 0;
  if (/\.(mp4|m4v|m4p|mov)$/i.test(name)) containerScore += 10;
  else if (/\.(webm|ogv)$/i.test(name)) containerScore += 6;
  else if (/\.(mkv)$/i.test(name)) containerScore += 4;
  else if (/\.(ts)$/i.test(name)) containerScore += 2;
  else if (/\.(avi|mpg|mpeg|3gp)$/i.test(name)) containerScore += 1;

  let penalty = 0;
  const part = getPartNumber(name);
  if (part && part > 1) penalty += (part - 1) * 2;

  return sizeScore + containerScore - penalty;
};

// Public: return every video file in the torrent, sorted by best-fit
// (the "main" file is index 0). Pure, no side effects.
export const listVideoFiles = (files) => {
  if (!Array.isArray(files)) return [];
  return files
    .filter((f) => isVideoFile(f) && !isJunkFile(f))
    .map((file) => ({ file, score: scoreFile(file) }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.file);
};

// Pure helper: pick the most likely main video from a torrent. Kept pure
// so it can be unit-tested without a real WebTorrent instance. Returns
// null when the torrent has no recognisable, non-junk video file.
export const pickVideoFile = (files) => {
  if (!Array.isArray(files) || files.length === 0) return null;
  const ranked = listVideoFiles(files);
  return ranked[0] || null;
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

export { formatBytes };

export const formatTorrentStatus = (status) => {
  if (!status) return "";
  const parts = [];
  parts.push(`${status.peers ?? 0} peer${status.peers === 1 ? "" : "s"}`);
  if (status.downloadSpeed > 0) {
    parts.push(`${formatBytes(status.downloadSpeed)}/s`);
  }
  if (typeof status.progress === "number" && status.progress > 0) {
    parts.push(`${(status.progress * 100).toFixed(0)}%`);
  }
  if (status.done) parts.push("done");
  return parts.join(" · ");
};

export default class TorrentStreamSession {
  constructor() {
    this.client = null;
    this.torrent = null;
    this.file = null;
    this.videoFiles = [];
    this.destroyed = false;
    this.handlers = {};
  }

  load(magnetUrl, videoElement, handlers = {}) {
    if (this.torrent || this.client) {
      this.cleanup();
    }
    if (!magnetUrl || !videoElement) {
      handlers.onError?.(new Error("Missing magnet URL or video element"));
      return;
    }

    this.handlers = handlers;
    this.destroyed = false;
    this.videoElement = videoElement;

    loadWebTorrent().then((WebTorrent) => {
      if (this.destroyed) return;

      // Use the local tracker proxy (served by Vite plugin) which relays
      // announces to HTTP trackers that are reachable from the server.
      // Direct WSS trackers often fail from browser environments due to
      // network restrictions.
      const wsTrackers = [
        `ws://${window.location.host}/ws/tracker`,
      ];

      let client;
      try {
        client = new WebTorrent({ tracker: { announce: wsTrackers } });
      } catch (err) {
        console.error("[TorrentStream] WebTorrent constructor failed:", err);
        handlers.onError?.(new Error("WebTorrent could not start in this browser: " + (err?.message || "unknown")));
        return;
      }
      this.client = client;

      client.on("error", (err) => {
        if (this.destroyed) return;
        console.error("[TorrentStream] Client error:", err);
        handlers.onError?.(err);
      });

      client.on("warning", (err) => {
        if (this.destroyed) return;
        console.warn("[TorrentStream] Client warning:", err?.message || err);
      });

      try {
        // Strip external trackers from the magnet — we want WebTorrent
        // to use the local Vite proxy (`/ws/tracker`) exclusively. The
        // `announce` option is additive and doesn't suppress the
        // trackers in the magnet URI itself.
        const cleanedMagnet = stripMagnetTrackers(magnetUrl);
        client.add(cleanedMagnet, { tracker: { announce: wsTrackers } }, (torrent) => {
          if (this.destroyed || this.client !== client) {
            try { torrent.destroy(); } catch { /* noop */ }
            return;
          }
          this.torrent = torrent;

          console.log("[TorrentStream] Torrent resolved, files:", torrent.files?.length);

          const ranked = listVideoFiles(torrent.files);
          this.videoFiles = ranked;
          // Surface the file list to the UI before kicking off playback so
          // the "Files" popover is populated the moment the torrent resolves.
          handlers.onFileList?.(ranked);

          const file = pickVideoFile(torrent.files);
          if (!file) {
            handlers.onError?.(new Error("Torrent has no playable files"));
            return;
          }
          this.file = file;
          handlers.onFileChange?.(file, ranked);

          const emitStatus = (done = false) => handlers.onStatus?.({
            peers: torrent.numPeers,
            downloadSpeed: torrent.downloadSpeed,
            uploaded: torrent.uploaded,
            downloaded: torrent.downloaded,
            progress: torrent.progress,
            done
          });

          torrent.on("download", () => { if (this.destroyed) return; emitStatus(false); });
          torrent.on("upload", () => { if (this.destroyed) return; emitStatus(false); });
          torrent.on("done", () => { if (this.destroyed) return; emitStatus(true); });
          torrent.on("error", (err) => { if (this.destroyed) return; console.error("[TorrentStream] Torrent error:", err); handlers.onError?.(err); });

          handlers.onStatus?.({
            peers: 0,
            downloadSpeed: 0,
            uploaded: 0,
            downloaded: 0,
            progress: 0,
            done: false
          });

          this.renderActiveFile();
        });
      } catch (err) {
        console.error("[TorrentStream] client.add threw:", err);
        handlers.onError?.(new Error("Invalid torrent identifier — try the external player menu (VLC, qBittorrent)."));
      }
    }).catch((err) => {
      if (this.destroyed) return;
      handlers.onError?.(new Error("WebTorrent could not load in this browser: " + (err?.message || "unknown")));
    });
  }

  // Render the currently-selected file (this.file) into the video element.
  // Called once on initial load and again whenever the user picks a
  // different file from the Files popover. The caller is expected to
  // have updated this.file (and fired onFileChange) before calling this.
  // Detaches the previously-rendered file's MediaSource so we don't leak
  // the old buffer or get A/V desync from two streams feeding the same
  // <video> element.
  renderActiveFile() {
    const file = this.file;
    const videoElement = this.videoElement;
    if (!file || !videoElement) return;

    const previous = this.renderedFile;
    if (previous && previous !== file) {
      try {
        previous.removeAllListeners?.();
        previous.deselect?.();
      } catch (err) {
        console.warn("[TorrentStream] previous file detach failed:", err);
      }
    }
    this.renderedFile = file;

    try {
      file.renderTo(videoElement, { autoplay: true, muted: true }, (err) => {
        if (this.destroyed) return;
        if (err) {
          console.error("[TorrentStream] renderTo error:", err);
          this.handlers.onError?.(err);
          return;
        }
        this.handlers.onReady?.(file);
      });
    } catch (err) {
      console.error("[TorrentStream] renderTo exception:", err);
      this.handlers.onError?.(err);
    }
  }

  // Switch to a different file within the same torrent. Caller passes a
  // WebTorrent file object (the same one returned by onFileList). No-op
  // if the file is already active.
  selectFile(file) {
    if (!file || file === this.file) return;
    this.file = file;
    this.handlers.onFileChange?.(file, this.videoFiles);
    this.renderActiveFile();
  }

  cleanup() {
    this.destroyed = true;
    if (this.renderedFile) {
      try {
        this.renderedFile.removeAllListeners?.();
        this.renderedFile.deselect?.();
      } catch { /* noop */ }
      this.renderedFile = null;
    }
    if (this.torrent) {
      try { this.torrent.destroy(); } catch { /* noop */ }
      this.torrent = null;
    }
    if (this.client) {
      try { this.client.destroy(); } catch { /* noop */ }
      this.client = null;
    }
    this.file = null;
    this.videoFiles = [];
    this.videoElement = null;
    this.handlers = {};
  }
}
