// src/utils/magnet.js
// Shared magnet URI parser used by both the Vite dev plugin (Node) and
// the in-browser torrent player. Pure, no runtime dependencies, safe to
// import from either runtime.
//
// Keeping this in its own module (rather than re-exporting from
// src/utils/torrentPlayer.js) avoids coupling a Node Vite plugin to a
// browser-targeted module that lazily imports `webtorrent`.

// Parse the `so=` (select only) parameter from a magnet URI. The Stremio
// addon protocol encodes the desired file index in this parameter; many
// torrent clients (including WebTorrent) honour it as a pre-selection
// hint. Returns null when the parameter is missing or invalid.
export const getMagnetFileIndex = (magnet) => {
  if (typeof magnet !== "string") return null;
  if (!magnet.toLowerCase().startsWith("magnet:")) return null;
  const match = magnet.match(/(?:^|[?&])so=(\d+)/i);
  if (!match) return null;
  const idx = Number(match[1]);
  return Number.isInteger(idx) && idx >= 0 ? idx : null;
};
