// server/transcode-core.js
// Shared ffmpeg process manager used by the Vite dev plugin and the
// standalone production server. The transcoder pipes an upstream HLS or
// MP4/MKV source through ffmpeg with `-c:v copy -c:a aac` and re-emits
// a fresh HLS manifest whose audio is always browser-playable.
//
// Responsibilities:
//   - Detect ffmpeg availability on the host
//   - Spawn ffmpeg child processes with a concurrency cap
//   - Manage per-job temp directories (manifest + .ts segments)
//   - Rewrite the emitted manifest so segment URLs point back at the proxy
//   - Idle-evict jobs whose player has stopped polling
//   - Cleanly tear everything down on process exit
//
// No external dependencies — pure Node.js built-ins.

import { spawn } from "node:child_process";
import { mkdir, rm, stat, readFile, readdir } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";
const MAX_CONCURRENT = Math.max(1, Number(process.env.TRANSCODER_MAX_CONCURRENT || 2));
const FFMPEG_TIMEOUT_MS = Math.max(60_000, Number(process.env.TRANSCODER_TIMEOUT_MS || 4 * 60 * 60 * 1000));
const FFMPEG_STARTUP_TIMEOUT_MS = Math.max(5_000, Number(process.env.TRANSCODER_STARTUP_TIMEOUT_MS || 30_000));
const JOB_IDLE_TTL_MS = Math.max(15_000, Number(process.env.TRANSCODER_IDLE_TTL_MS || 60_000));
const TEMP_ROOT = process.env.TRANSCODER_TMP_DIR
  ? resolve(process.env.TRANSCODER_TMP_DIR)
  : resolve(process.cwd(), ".transcode-tmp");
const SWEEP_INTERVAL_MS = Math.max(10_000, Number(process.env.TRANSCODER_SWEEP_INTERVAL_MS || 30_000));
const AUDIO_BITRATE = process.env.TRANSCODER_AUDIO_BITRATE || "192k";
const HLS_SEGMENT_TIME = Number(process.env.TRANSCODER_HLS_SEGMENT_TIME || 4);

// ── ffmpeg detection ─────────────────────────────────────────────────────

let ffmpegAvailable = null;
let ffmpegVersion = null;

/** Probe the host for ffmpeg. Caches the result for the process lifetime. */
export function checkFfmpeg() {
  if (ffmpegAvailable !== null) {
    return Promise.resolve({ available: ffmpegAvailable, version: ffmpegVersion });
  }
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(FFMPEG_PATH, ["-version"]);
    } catch (err) {
      ffmpegAvailable = false;
      ffmpegVersion = null;
      resolve({ available: false, version: null, error: err?.message || String(err) });
      return;
    }
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("error", () => {
      ffmpegAvailable = false;
      ffmpegVersion = null;
      resolve({ available: false, version: null });
    });
    proc.on("exit", (code) => {
      ffmpegAvailable = code === 0;
      ffmpegVersion = code === 0 ? out.split("\n")[0].trim() : null;
      resolve({ available: ffmpegAvailable, version: ffmpegVersion });
    });
    setTimeout(() => {
      try { proc.kill(); } catch { /* noop */ }
      if (ffmpegAvailable === null) {
        ffmpegAvailable = false;
        resolve({ available: false, version: null });
      }
    }, 5000);
  });
}

// ── job state ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TranscodeJob
 * @property {string} id
 * @property {string} inputUrl
 * @property {Record<string,string>} inputHeaders
 * @property {boolean} inputIsHls
 * @property {string} workDir
 * @property {string} manifestPath
 * @property {import("node:child_process").ChildProcess} proc
 * @property {number} startedAt
 * @property {number} lastAccessAt
 * @property {boolean} aborted
 * @property {NodeJS.Timeout|null} timer
 * @property {string} stderrTail
 * @property {string} state - "starting" | "ready" | "ended" | "errored"
 */

/** @type {Map<string, TranscodeJob>} */
const activeJobs = new Map();
/** @type {Array<() => void>} */
const queue = [];
/** @type {NodeJS.Timeout|null} */
let sweepTimer = null;

let teardownRegistered = false;
function registerTeardown() {
  if (teardownRegistered) return;
  teardownRegistered = true;
  const handler = () => {
    for (const job of activeJobs.values()) {
      try { job.proc.kill("SIGTERM"); } catch { /* noop */ }
    }
    process.exit(0);
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
  process.once("beforeExit", () => {
    for (const job of activeJobs.values()) {
      try { job.proc.kill("SIGTERM"); } catch { /* noop */ }
    }
  });
}

// ── helpers ──────────────────────────────────────────────────────────────

function appendFfmpegHeader(headerLines, key, value) {
  if (!value) return;
  const sanitized = String(value).replace(/[\r\n]+/g, " ").trim();
  if (!sanitized) return;
  headerLines.push(`${key}: ${sanitized}`);
}

/** Build the ffmpeg argv for a transcoding job. */
export function buildFfmpegArgs({ inputUrl, inputHeaders = {}, inputIsHls, workDir }) {
  const args = [];

  // Upstream headers
  const headerLines = [];
  appendFfmpegHeader(headerLines, "User-Agent", inputHeaders["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");
  appendFfmpegHeader(headerLines, "Referer", inputHeaders["Referer"]);
  appendFfmpegHeader(headerLines, "Origin", inputHeaders["Origin"]);
  appendFfmpegHeader(headerLines, "Authorization", inputHeaders["Authorization"]);
  appendFfmpegHeader(headerLines, "Cookie", inputHeaders["Cookie"]);

  if (headerLines.length > 0) {
    args.push("-headers", headerLines.join("\r\n") + "\r\n");
  }

  // HLS-specific safety
  if (inputIsHls) {
    args.push("-protocol_whitelist", "file,http,https,tcp,tls,crypto,data");
  }

  // Quiet but useful stderr
  args.push("-hide_banner", "-loglevel", "warning", "-stats");

  // Input
  args.push("-fflags", "+genpts", "-i", inputUrl);

  // Output: keep video, transcode audio
  args.push(
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", AUDIO_BITRATE,
    "-ac", "2",
    "-f", "hls",
    "-hls_time", String(HLS_SEGMENT_TIME),
    "-hls_list_size", "0",
    "-hls_segment_filename", join(workDir, "seg-%05d.ts"),
    "-hls_playlist_type", "event",
    "-hls_flags", "independent_segments",
    join(workDir, "manifest.m3u8")
  );

  return args;
}

/** Rewrite the manifest so segment URLs point back at the proxy base path. */
export function rewriteManifest(manifestText, segmentUrlBase) {
  const lines = manifestText.split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { out.push(""); continue; }
    if (line.startsWith("#")) {
      out.push(line);
      continue;
    }
    // Replace with proxied URL
    const filename = line.split("?")[0].split("#")[0];
    out.push(`${segmentUrlBase}/${encodeURIComponent(filename)}`);
  }
  return out.join("\n");
}

async function waitForManifest(workDir, manifestPath, timeoutMs) {
  const started = Date.now();
  let lastSize = 0;
  while (Date.now() - started < timeoutMs) {
    if (existsSync(manifestPath)) {
      try {
        const s = await stat(manifestPath);
        if (s.size > 0 && s.size !== lastSize) {
          lastSize = s.size;
          // Wait for at least one segment to exist too — hls.js needs it
          const files = await readdir(workDir).catch(() => []);
          if (files.some((f) => /^seg-\d+\.ts$/.test(f))) {
            return true;
          }
        }
      } catch { /* not yet */ }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function takeSlot() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (activeJobs.size < MAX_CONCURRENT) {
        resolve();
        return;
      }
      queue.push(tryAcquire);
    };
    tryAcquire();
  });
}

function releaseSlot() {
  while (queue.length > 0 && activeJobs.size < MAX_CONCURRENT) {
    const next = queue.shift();
    try { next(); } catch { /* noop */ }
  }
}

// ── public API ───────────────────────────────────────────────────────────

/**
 * Start a new transcoding job.
 * @param {Object} options
 * @param {string} options.inputUrl
 * @param {Record<string,string>} [options.inputHeaders]
 * @param {boolean} [options.inputIsHls]
 * @returns {Promise<TranscodeJob>}
 */
export async function startTranscodeJob({ inputUrl, inputHeaders = {}, inputIsHls = true }) {
  if (!inputUrl) throw new Error("startTranscodeJob: inputUrl is required");

  const { available } = await checkFfmpeg();
  if (!available) {
    throw new Error("ffmpeg is not available on this host. Install ffmpeg and ensure it is on PATH (or set FFMPEG_PATH).");
  }

  await takeSlot();
  registerTeardown();

  const id = randomUUID();
  const workDir = join(TEMP_ROOT, id);
  await mkdir(workDir, { recursive: true });

  const manifestPath = join(workDir, "manifest.m3u8");
  const args = buildFfmpegArgs({ inputUrl, inputHeaders, inputIsHls, workDir });

  const proc = spawn(FFMPEG_PATH, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  /** @type {TranscodeJob} */
  const job = {
    id,
    inputUrl,
    inputHeaders,
    inputIsHls,
    workDir,
    manifestPath,
    proc,
    startedAt: Date.now(),
    lastAccessAt: Date.now(),
    aborted: false,
    timer: null,
    stderrTail: "",
    state: "starting",
  };

  proc.stderr?.on("data", (d) => {
    const chunk = d.toString();
    job.stderrTail = (job.stderrTail + chunk).slice(-16384);
  });

  proc.on("exit", (code, signal) => {
    job.state = code === 0 || signal === "SIGTERM" ? "ended" : "errored";
    if (job.timer) clearTimeout(job.timer);
    activeJobs.delete(id);
    releaseSlot();
    // Best-effort cleanup of temp dir after a grace period
    setTimeout(() => {
      rm(workDir, { recursive: true, force: true }).catch(() => {});
    }, 5_000);
  });

  // Absolute timeout
  job.timer = setTimeout(() => {
    job.aborted = true;
    try { proc.kill("SIGTERM"); } catch { /* noop */ }
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* noop */ }
    }, 3000);
  }, FFMPEG_TIMEOUT_MS);

  activeJobs.set(id, job);
  ensureSweepTimer();

  // Block until first manifest + first segment exist
  const ready = await waitForManifest(workDir, manifestPath, FFMPEG_STARTUP_TIMEOUT_MS);
  if (!ready) {
    job.state = "errored";
    job.aborted = true;
    try { proc.kill("SIGTERM"); } catch { /* noop */ }
    activeJobs.delete(id);
    releaseSlot();
    const detail = job.stderrTail.trim().split("\n").slice(-3).join("\n");
    throw new Error(`ffmpeg did not produce a manifest within ${FFMPEG_STARTUP_TIMEOUT_MS}ms${detail ? `\n${detail}` : ""}`);
  }
  job.state = "ready";
  job.lastAccessAt = Date.now();
  return job;
}

/** Look up a job by id, updating last-access time. */
export function touchJob(id) {
  const job = activeJobs.get(id);
  if (job) job.lastAccessAt = Date.now();
  return job;
}

export function getJob(id) {
  return activeJobs.get(id) || null;
}

export function listJobs() {
  return [...activeJobs.values()].map((j) => ({
    id: j.id,
    state: j.state,
    startedAt: j.startedAt,
    inputUrl: j.inputUrl,
    inputIsHls: j.inputIsHls,
  }));
}

/** Read the rewritten manifest text. */
export async function readJobManifest(job, segmentUrlBase) {
  const text = await readFile(job.manifestPath, "utf8");
  return rewriteManifest(text, segmentUrlBase);
}

/** Resolve a relative segment filename (e.g. "seg-00001.ts") to an absolute path. */
export function resolveSegmentPath(job, encodedFilename) {
  // The frontend re-encodes the filename; we decode it back.
  const filename = decodeURIComponent(encodedFilename);
  // Defence in depth: prevent path traversal
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return null;
  }
  return join(job.workDir, filename);
}

/** Stop a job explicitly. */
export function stopJob(id) {
  const job = activeJobs.get(id);
  if (!job) return false;
  job.aborted = true;
  try { job.proc.kill("SIGTERM"); } catch { /* noop */ }
  if (job.timer) clearTimeout(job.timer);
  return true;
}

/** Stop every active job. */
export function stopAllJobs() {
  for (const id of activeJobs.keys()) stopJob(id);
}

function ensureSweepTimer() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, job] of activeJobs) {
      if (now - job.lastAccessAt > JOB_IDLE_TTL_MS) {
        stopJob(id);
      }
    }
    if (activeJobs.size === 0 && sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

export function getConfig() {
  return {
    ffmpegPath: FFMPEG_PATH,
    maxConcurrent: MAX_CONCURRENT,
    ffmpegTimeoutMs: FFMPEG_TIMEOUT_MS,
    startupTimeoutMs: FFMPEG_STARTUP_TIMEOUT_MS,
    jobIdleTtlMs: JOB_IDLE_TTL_MS,
    tempRoot: TEMP_ROOT,
    audioBitrate: AUDIO_BITRATE,
    hlsSegmentTime: HLS_SEGMENT_TIME,
  };
}

export { createReadStream, existsSync, stat };
