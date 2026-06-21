import WebTorrent from "webtorrent";
import { randomUUID } from "node:crypto";
import { getMagnetFileIndex } from "../src/utils/magnet.js";
import { readJobManifest, startTranscodeJob } from "../server/transcode-core.js";

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|ts|mpeg|mpg|m4p|ogv|3gp)$/i;
const JUNK_FILE_PATTERNS = [
  /(^|[\\/])\.?[Ss]ample[\s._-]/i,
  /(?:^|[\\/])[Ss]ample\.[^/\\]+$/i,
  /\.(nfo|sfv|md5|sha1|sums|url|info|html?|css|js|json|xml)$/i,
  /\.(srt|sub|ass|ssa|vtt|sup|idx|usf|rt|smi)$/i,
  /\.(jpe?g|png|gif|bmp|webp|tiff?|ico|svg)$/i,
];

const METADATA_TIMEOUT_MS = 45_000;
const STREAM_PRIORITY = 10;
const CRITICAL_AHEAD_BYTES = 4 * 1024 * 1024;
const SOURCE_TTL_MS = 4 * 60 * 60 * 1000;
const IDLE_TORRENT_TTL_MS = 30 * 60 * 1000;
const TORRENT_SWEEP_MS = 60 * 1000;

let client;
const sourceFiles = new Map();
const torrentMeta = new Map();
let torrentSweepTimer = null;

const getClient = () => {
  client ||= new WebTorrent();
  return client;
};

const isVideoFile = (file) => file?.name && VIDEO_EXTENSIONS.test(file.name);
const isJunkFile = (file) => !file?.name || JUNK_FILE_PATTERNS.some((re) => re.test(file.name));
const getSize = (file) => Number.isFinite(file?.length) ? file.length : 0;

// Same scoring heuristics as the in-browser client (see
// src/utils/torrentPlayer.js). Keep them in sync if you change the
// weights — both are exercised by unit tests.
const scoreFile = (file) => {
  if (!isVideoFile(file) || isJunkFile(file)) return -Infinity;
  const name = file.name || "";
  const sizeScore = getSize(file) > 0 ? Math.log10(getSize(file)) * 4 : 0;
  let containerScore = 0;
  if (/\.(mp4|m4v|m4p|mov)$/i.test(name)) containerScore += 10;
  else if (/\.(webm|ogv)$/i.test(name)) containerScore += 6;
  else if (/\.(ts)$/i.test(name)) containerScore += 2;
  else if (/\.(mkv)$/i.test(name)) containerScore -= 4; // Chrome MSE can't demux MKV
  else if (/\.(avi|mpg|mpeg|3gp)$/i.test(name)) containerScore -= 2;
  return sizeScore + containerScore;
};

const pickVideoFile = (files) => {
  if (!Array.isArray(files)) return null;
  return files
    .filter((file) => isVideoFile(file) && !isJunkFile(file))
    .sort((a, b) => scoreFile(b) - scoreFile(a))[0] || null;
};

// Containers Chrome's MediaSource Extensions pipeline can demux and feed
// into an HTML5 <video> element. Must stay in sync with the in-browser
// equivalent in `src/utils/torrentPlayer.js` (`isMseContainer`) — the
// dev proxy and the in-browser player agree on what counts as playable
// so a stream that plays locally also plays via the dev proxy, and vice
// versa.
const MSE_CONTAINER_PATTERN = /\.(mp4|m4v|m4p|mov|webm|ogv)$/i;
const isMseContainer = (file) =>
  Boolean(file?.name && MSE_CONTAINER_PATTERN.test(file.name));

// Build the 415 JSON error payload the middleware returns when the
// picked file is in a non-MSE container. Exported for unit tests so
// the same string flows to the user whether the dev proxy or the
// in-browser client surfaces it.
const buildUnsupportedContainerError = (file) => {
  // Extract the extension by finding the LAST dot, not the first —
  // `split(".").pop()` on a dotless name returns the whole string,
  // which would mislead the user ("file is MOVIE, which Chrome can't
  // play" reads wrong). An extensionless file gets an empty container
  // string and the generic "this container" fallback in the message.
  const name = file?.name || "";
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx >= 0 && dotIdx < name.length - 1
    ? name.slice(dotIdx + 1).toUpperCase()
    : "";
  const extLabel = ext || "this container";
  return {
    statusCode: 415,
    body: {
      error:
        `This torrent's main file is ${extLabel}, which Chrome can't play in the browser. ` +
        `Open the magnet in VLC or your desktop torrent client.`,
      container: ext.toLowerCase(),
      fileName: name,
      needsExternalPlayer: true
    }
  };
};

export { isMseContainer, buildUnsupportedContainerError };

// Honour the Stremio `fileIdx` field / magnet `so=` parameter so the
// dev proxy plays the same file the addon intended.
const pickFileByIndex = (files, index) => {
  if (!Array.isArray(files) || !Number.isInteger(index)) return null;
  const file = files[index];
  if (!file || !isVideoFile(file) || isJunkFile(file)) return null;
  return file;
};

const parseFileIndex = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
};

const deselectOtherFiles = (torrent, selectedFile) => {
  for (const file of torrent?.files || []) {
    if (file === selectedFile) continue;
    try { file.deselect?.(); } catch { /* best effort */ }
  }
};

const selectFileForStreaming = (torrent, file) => {
  if (!torrent || !file) return;
  deselectOtherFiles(torrent, file);
  try { file.select?.(STREAM_PRIORITY); } catch { /* best effort */ }
};

const prioritizeByteRange = (file, start, end) => {
  const torrent = file?._torrent;
  const pieceLength = torrent?.pieceLength;
  if (!torrent || !Number.isFinite(pieceLength) || pieceLength <= 0) return;
  const absoluteStart = (file.offset || 0) + start;
  const absoluteEnd = (file.offset || 0) + Math.min(file.length - 1, end + CRITICAL_AHEAD_BYTES);
  const startPiece = Math.floor(absoluteStart / pieceLength);
  const endPiece = Math.floor(absoluteEnd / pieceLength);
  try { torrent.select(startPiece, endPiece, STREAM_PRIORITY); } catch { /* best effort */ }
  try { torrent.critical(startPiece, endPiece); } catch { /* best effort */ }
};

const getInfoHash = (magnet) => {
  const match = String(magnet || "").match(/xt=urn:btih:([^&]+)/i);
  return match ? decodeURIComponent(match[1]).toLowerCase() : null;
};

const waitForTorrent = (magnet) => new Promise((resolve, reject) => {
  const torrentClient = getClient();
  const infoHash = getInfoHash(magnet);
  const existing = infoHash ? torrentClient.get(infoHash) : null;
  if (existing?.files?.length) {
    resolve(existing);
    return;
  }

  const timer = setTimeout(() => {
    reject(new Error("Torrent metadata timed out"));
  }, METADATA_TIMEOUT_MS);

  const onTorrent = (torrent) => {
    clearTimeout(timer);
    resolve(torrent);
  };

  try {
    if (existing) {
      existing.once("metadata", () => onTorrent(existing));
      existing.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    } else {
      torrentClient.add(magnet, onTorrent);
    }
  } catch (error) {
    clearTimeout(timer);
    reject(error);
  }
});

const contentTypeFor = (name = "") => {
  if (/\.(mp4|m4v|m4p)$/i.test(name)) return "video/mp4";
  if (/\.(webm)$/i.test(name)) return "video/webm";
  if (/\.(ogv)$/i.test(name)) return "video/ogg";
  if (/\.(ts)$/i.test(name)) return "video/mp2t";
  if (/\.(mov)$/i.test(name)) return "video/quicktime";
  if (/\.(mkv)$/i.test(name)) return "video/x-matroska";
  return "application/octet-stream";
};

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk.toString(); });
  req.on("end", () => {
    if (!raw.trim()) {
      resolve({});
      return;
    }
    try { resolve(JSON.parse(raw)); }
    catch { reject(new Error("Invalid JSON body")); }
  });
  req.on("error", reject);
});

const serializeFile = (file, index) => ({
  index,
  name: file.name,
  path: file.path,
  length: file.length,
  isMedia: isVideoFile(file) && !isJunkFile(file),
  isMse: isMseContainer(file),
});

const touchTorrent = (infoHash) => {
  if (!infoHash) return;
  const meta = torrentMeta.get(infoHash);
  if (meta) meta.lastAccessedAt = Date.now();
};

const ensureTorrentSweep = () => {
  if (torrentSweepTimer) return;
  torrentSweepTimer = setInterval(() => {
    const torrentClient = getClient();
    const now = Date.now();
    for (const torrent of torrentClient.torrents || []) {
      const meta = torrentMeta.get(torrent.infoHash);
      if (!meta || now - meta.lastAccessedAt <= IDLE_TORRENT_TTL_MS) continue;
      torrentClient.remove(torrent.infoHash, () => {});
      torrentMeta.delete(torrent.infoHash);
    }
  }, TORRENT_SWEEP_MS);
  torrentSweepTimer.unref?.();
};

const trackTorrent = (torrent) => {
  if (!torrent?.infoHash || torrentMeta.has(torrent.infoHash)) return;
  const metadataTimer = setTimeout(() => {
    const meta = torrentMeta.get(torrent.infoHash);
    if (meta && !torrent.ready) meta.metadataTimedOut = true;
  }, METADATA_TIMEOUT_MS);
  metadataTimer.unref?.();
  torrentMeta.set(torrent.infoHash, {
    addedAt: Date.now(),
    lastAccessedAt: Date.now(),
    metadataTimedOut: false,
    metadataTimer,
  });
  torrent.once?.("metadata", () => {
    const meta = torrentMeta.get(torrent.infoHash);
    if (meta?.metadataTimer) {
      clearTimeout(meta.metadataTimer);
      meta.metadataTimer = null;
    }
    const selected = pickFileByIndex(torrent.files, getMagnetFileIndex(torrent.magnetURI || "")) || pickVideoFile(torrent.files);
    if (selected) selectFileForStreaming(torrent, selected);
  });
  torrent.on?.("error", (error) => {
    console.warn(`[torrent-stream] ${torrent.infoHash} error:`, error?.message || error);
  });
  ensureTorrentSweep();
};

const addTorrent = (magnet) => {
  const torrentClient = getClient();
  const infoHash = getInfoHash(magnet);
  const existing = infoHash ? torrentClient.get(infoHash) : null;
  if (existing) {
    touchTorrent(existing.infoHash);
    trackTorrent(existing);
    return existing;
  }
  const torrent = torrentClient.add(magnet, { strategy: "sequential" });
  trackTorrent(torrent);
  return torrent;
};

const getTorrentStatus = (infoHash) => {
  const torrent = getClient().get(infoHash);
  if (!torrent) return null;
  touchTorrent(infoHash);
  const meta = torrentMeta.get(infoHash);
  return {
    infoHash: torrent.infoHash,
    name: torrent.name || null,
    ready: Boolean(torrent.ready || torrent.files?.length),
    progress: torrent.progress || 0,
    downloaded: torrent.downloaded || 0,
    uploaded: torrent.uploaded || 0,
    downloadSpeed: torrent.downloadSpeed || 0,
    uploadSpeed: torrent.uploadSpeed || 0,
    peers: torrent.numPeers || 0,
    files: torrent.files?.map(serializeFile) || [],
    metadataTimedOut: Boolean(meta?.metadataTimedOut),
    lastAccessedAt: meta?.lastAccessedAt ? new Date(meta.lastAccessedAt).toISOString() : null,
  };
};

const resolveTorrentFile = (infoHash, fileIndex) => {
  const torrent = getClient().get(infoHash);
  if (!torrent) return { statusCode: 404, error: "Torrent not found" };
  touchTorrent(infoHash);
  if (!torrent.files?.length) return { statusCode: 409, error: "Torrent metadata is not ready yet" };
  const index = parseFileIndex(fileIndex);
  if (index === null) return { statusCode: 400, error: "Invalid file index" };
  const file = torrent.files[index];
  if (!file || !isVideoFile(file) || isJunkFile(file)) return { statusCode: 404, error: "File not found" };
  selectFileForStreaming(torrent, file);
  return { torrent, file };
};

const registerSourceFile = (file) => {
  const id = randomUUID();
  sourceFiles.set(id, file);
  setTimeout(() => sourceFiles.delete(id), SOURCE_TTL_MS).unref?.();
  return id;
};

const sendTorrentFile = (req, res, file, { exposeFileName = false } = {}) => {
  const size = file.length;
  const range = req.headers.range;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentTypeFor(file.name));
  if (exposeFileName) {
    res.setHeader("X-Torrent-File", encodeURIComponent(file.name));
  }

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || end >= size || start > end) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    prioritizeByteRange(file, start, end);
    file.createReadStream({ start, end }).pipe(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Length", String(size));
  prioritizeByteRange(file, 0, Math.min(size - 1, CRITICAL_AHEAD_BYTES));
  file.createReadStream().pipe(res);
};

const transcodeTorrentFile = async (req, res, file) => {
  const sourceId = registerSourceFile(file);
  const inputUrl = `http://${req.headers.host || "localhost"}/api/torrent/source/${sourceId}`;
  const job = await startTranscodeJob({
    inputUrl,
    inputHeaders: {
      "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
    },
    inputIsHls: false,
  });
  const segmentBase = `/api/transcode/segment/${job.id}`;
  const manifest = await readJobManifest(job, segmentBase);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Transcode-Job", job.id);
  res.setHeader("X-Transcode-State", job.state);
  res.setHeader("X-Torrent-File", encodeURIComponent(file.name));
  res.end(manifest);
};

export default function torrentStreamPlugin() {
  return {
    name: "torrent-stream-plugin",
    configureServer(server) {
      server.middlewares.use("/api/torrent/source/", (req, res) => {
        const id = decodeURIComponent(req.url.split("?")[0].replace(/^\/+/, ""));
        const file = sourceFiles.get(id);
        if (!file) {
          sendJson(res, 404, { error: "Torrent source expired" });
          return;
        }
        sendTorrentFile(req, res, file);
      });

      server.middlewares.use("/api/stream", async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        const parts = url.pathname.split("/").filter(Boolean);
        try {
          if (req.method === "POST" && parts.length === 0) {
            const body = await readJsonBody(req);
            const magnet = String(body?.magnet || "").trim();
            if (!magnet.startsWith("magnet:?")) {
              sendJson(res, 400, { error: "Missing magnet URL" });
              return;
            }
            const torrent = addTorrent(magnet);
            sendJson(res, 200, { infoHash: torrent.infoHash || getInfoHash(magnet) });
            return;
          }

          if (req.method === "GET" && parts.length === 2 && parts[1] === "status") {
            const status = getTorrentStatus(parts[0]);
            if (!status) {
              sendJson(res, 404, { error: "Torrent not found" });
              return;
            }
            sendJson(res, 200, status);
            return;
          }

          if (req.method === "GET" && parts.length === 2) {
            const resolved = resolveTorrentFile(parts[0], parts[1]);
            if (resolved.error) {
              sendJson(res, resolved.statusCode, { error: resolved.error });
              return;
            }
            const shouldTranscode = url.searchParams.get("transcode") === "1" || url.searchParams.get("transcode") === "true";
            if (shouldTranscode) {
              await transcodeTorrentFile(req, res, resolved.file);
              return;
            }
            if (!isMseContainer(resolved.file)) {
              const { statusCode, body } = buildUnsupportedContainerError(resolved.file);
              sendJson(res, statusCode, body);
              return;
            }
            sendTorrentFile(req, res, resolved.file, { exposeFileName: true });
            return;
          }

          sendJson(res, 404, { error: "Not found" });
        } catch (error) {
          sendJson(res, 504, { error: error?.message || "Torrent stream failed" });
        }
      });

      server.middlewares.use("/api/torrent/stream", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const magnet = url.searchParams.get("magnet");
          if (!magnet?.startsWith("magnet:?")) {
            sendJson(res, 400, { error: "Missing magnet URL" });
            return;
          }

          const torrent = await waitForTorrent(magnet);

          // Honour the Stremio `fileIdx` / magnet `so=` parameter when
          // present so the dev proxy plays the same file the addon picked.
          // Fall back to the score-ranked best fit otherwise.
          const explicitIdx = parseFileIndex(url.searchParams.get("fileIdx")) ?? getMagnetFileIndex(magnet);
          const file = (explicitIdx !== null
            ? pickFileByIndex(torrent.files, explicitIdx)
            : null) || pickVideoFile(torrent.files);

          if (!file) {
            sendJson(res, 404, { error: "Torrent has no playable video file" });
            return;
          }

          selectFileForStreaming(torrent, file);

          const shouldTranscode = url.searchParams.get("transcode") === "1" || url.searchParams.get("transcode") === "true";
          if (shouldTranscode) {
            await transcodeTorrentFile(req, res, file);
            return;
          }

          if (!isMseContainer(file)) {
            const { statusCode, body } = buildUnsupportedContainerError(file);
            sendJson(res, statusCode, body);
            return;
          }

          sendTorrentFile(req, res, file, { exposeFileName: true });
        } catch (error) {
          sendJson(res, 504, { error: error?.message || "Torrent stream failed" });
        }
      });
    },
  };
}
