// vitest.config.js
// Standalone vitest config. We intentionally do NOT inherit from
// vite.config.js because (a) it exports a callback config (async
// ({ command }) => …) that mergeConfig cannot handle, and (b) the dev
// plugins in vite.config.js need a real HTTP server, which vitest's
// harness does not provide.
//
// The one piece of vite.config.js the test harness needs is the
// `webtorrent → webtorrent.min.js` resolve alias. Without it, any
// module that statically imports `webtorrent` (e.g.
// vite/torrent-stream-plugin.js) fails to load in Node, and its named
// exports come back undefined — which is what caused the 4
// "isMseContainer is not a function" failures in the previous run.
//
// The only browser global the production code path actually needs is
// `window.location.host` (used to build the local WebSocket tracker
// URL). We polyfill that via the setup file rather than pulling in
// jsdom/happy-dom — the TorrentStreamSession tests mock the DOM and
// WebTorrent directly, so a full browser environment would be dead
// weight.
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      webtorrent: fileURLToPath(
        new URL("./node_modules/webtorrent/dist/webtorrent.min.js", import.meta.url)
      )
    }
  },
  test: {
    setupFiles: ["./test/setup.js"],
    // Tests use `vi.waitFor` and `flushPromises` extensively; default
    // 5s hook timeout is fine, but bump it a touch for the webtorrent
    // lazy-import path which can be slow on first hit.
    hookTimeout: 10_000
  }
});
