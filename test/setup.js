// test/setup.js
// Minimal browser-global polyfill for the vitest harness.
/* global process */
//
// WebTorrent's dynamic import and the in-browser TorrentStreamSession
// reference `window.location.host` when building the local WebSocket
// tracker URL. Node has no `window`, so without this polyfill every
// TorrentStreamSession test fires its onError with
// "WebTorrent could not load in this browser: window is not defined"
// before the test body even runs.
//
// We intentionally do NOT pull in jsdom or happy-dom for this — the
// TorrentStreamSession tests mock WebTorrent, renderTo, and the video
// element directly, so a full DOM environment would be dead weight and
// add ~30MB of dependencies. The only browser global the production
// code path actually needs is `window.location.host`, so we stub just
// that.
//
// The `host` value is read from `process.env.VITEST_TRACKER_HOST` when
// present (useful for CI or custom dev hosts) and falls back to
// `localhost:0` otherwise. Tests don't make real WebSocket connections,
// so the value is only used for string formatting in the tracker URL.

// Guard against re-definition if the file is loaded twice (e.g. when
// vitest reuses a worker).
if (typeof globalThis.window === "undefined") {
  const host = process.env.VITEST_TRACKER_HOST || "localhost:0";
  globalThis.window = {
    location: {
      host,
      hostname: host.split(":")[0],
      port: host.split(":")[1] || "",
      protocol: "http:",
      href: `http://${host}/`,
      origin: `http://${host}`
    }
  };
}
