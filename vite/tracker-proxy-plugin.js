/**
 * Vite plugin: local WebSocket tracker proxy for WebTorrent.
 *
 * Exposes a WebSocket endpoint at `/ws/tracker` that speaks the BitTorrent
 * WebSocket tracker protocol (BEP 23).  When a WebTorrent client announces
 * to this local endpoint, the proxy forwards the announce to public HTTP
 * trackers (which are reachable from the server but not from the browser),
 * merges the peer lists, and returns them to the client.
 *
 * This solves the problem where browsers cannot reach external WSS trackers
 * due to network restrictions.
 */
import http from "http";
import https from "https";
import { URL } from "url";
import { WebSocketServer } from "ws";

const PROXY_TRACKERS = [
  { url: "http://tracker.opentrackr.org:1337/announce", name: "opentrackr" },
  { url: "http://open.stealth.si:80/announce", name: "stealth" },
  { url: "http://tracker.torrent.eu.org:451/announce", name: "torrent-eu" },
  { url: "http://exodus.desync.com:6969/announce", name: "desync" },
];

// ── Minimal bencode encoder/decoder ──────────────────────────────────────

function bencodeEncode(value) {
  if (typeof value === "number") return `i${value}e`;
  if (typeof value === "string") return `${value.length}:${value}`;
  if (Array.isArray(value)) return `l${value.map(bencodeEncode).join("")}e`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `d${keys.map((k) => `${bencodeEncode(k)}${bencodeEncode(value[k])}`).join("")}e`;
  }
  return "";
}

function bencodeDecode(buf, start = 0) {
  if (typeof buf === "string") buf = Buffer.from(buf, "latin1");
  const ch = buf[start];

  // Integer: i<number>e
  if (ch === 0x69) {
    const end = buf.indexOf(0x65, start + 1);
    return { value: parseInt(buf.toString("latin1", start + 1, end), 10), next: end + 1 };
  }

  // List: l<items>e
  if (ch === 0x6c) {
    const items = [];
    let pos = start + 1;
    while (buf[pos] !== 0x65) {
      const item = bencodeDecode(buf, pos);
      items.push(item.value);
      pos = item.next;
    }
    return { value: items, next: pos + 1 };
  }

  // Dict: d<key><value>...e
  if (ch === 0x64) {
    const dict = {};
    let pos = start + 1;
    while (buf[pos] !== 0x65) {
      const key = bencodeDecode(buf, pos);
      const val = bencodeDecode(buf, key.next);
      dict[key.value] = val.value;
      pos = val.next;
    }
    return { value: dict, next: pos + 1 };
  }

  // String: <length>:<data>
  const colonIdx = buf.indexOf(0x3a, start);
  const len = parseInt(buf.toString("latin1", start, colonIdx), 10);
  const strStart = colonIdx + 1;
  return { value: buf.toString("latin1", strStart, strStart + len), next: strStart + len };
}

// ── Compact peers ↔ object peers ────────────────────────────────────────

function compactPeersToObjects(compact) {
  const buf = typeof compact === "string" ? Buffer.from(compact, "latin1") : compact;
  const peers = [];
  for (let i = 0; i + 6 <= buf.length; i += 6) {
    const ip = `${buf[i]}.${buf[i + 1]}.${buf[i + 2]}.${buf[i + 3]}`;
    const port = (buf[i + 4] << 8) | buf[i + 5];
    if (port > 0 && port < 65536) peers.push({ ip, port });
  }
  return peers;
}

function peerObjectsToCompact(peers) {
  const buf = Buffer.alloc(peers.length * 6);
  peers.forEach((p, i) => {
    const off = i * 6;
    const parts = p.ip.split(".").map(Number);
    buf[off] = parts[0];
    buf[off + 1] = parts[1];
    buf[off + 2] = parts[2];
    buf[off + 3] = parts[3];
    buf[off + 4] = (p.port >> 8) & 0xff;
    buf[off + 5] = p.port & 0xff;
  });
  return buf;
}

// Normalize an info_hash to hex for Map keys and external HTTP tracker
// announces. Accepts: a Buffer (BEP 23, 20 bytes), a 40-char hex string
// (legacy JSON path), or anything else (fall through with the raw value
// — better to be permissive than to throw or double-encode).
function asHex(v) {
  if (Buffer.isBuffer(v)) return v.toString("hex");
  const s = String(v);
  return /^[0-9a-fA-F]{40}$/.test(s) ? s.toLowerCase() : s;
}

// ── HTTP tracker announce ───────────────────────────────────────────────

function announceToHttpTracker(trackerUrl, infoHash, peerId, port = 6881) {
  return new Promise((resolve) => {
    try {
      const url = new URL(trackerUrl);

      // Convert hex info_hash to 20-byte binary for HTTP trackers.
      // Must percent-encode manually because URLSearchParams UTF-8 encodes
      // Buffer data, which corrupts binary values.
      const infoHashBuf = Buffer.from(infoHash, "hex");
      const encodedInfoHash = Array.from(infoHashBuf)
        .map((b) => "%" + b.toString(16).toUpperCase().padStart(2, "0"))
        .join("");

      // peer_id is a 20-char ASCII string — URLSearchParams is fine
      const peerIdBuf = peerId;
      const encodedPeerId = Array.from(Buffer.from(peerId, "ascii"))
        .map((b) => "%" + b.toString(16).toUpperCase().padStart(2, "0"))
        .join("");

      const qs = [
        "info_hash=" + encodedInfoHash,
        "peer_id=" + encodedPeerId,
        "port=" + port,
        "uploaded=0",
        "downloaded=0",
        "left=67108864",
        "compact=1",
        "numwant=80",
        "event=started",
      ].join("&");

      const fullUrl = `${url.protocol}//${url.host}${url.pathname}?${qs}`;
      const mod = url.protocol === "https:" ? https : http;

      const req = mod.get(fullUrl, { timeout: 8000 }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            const body = Buffer.concat(chunks);
            const decoded = bencodeDecode(body, 0);
            const dict = decoded.value;
            const peersRaw = dict.peers;
            let peers = [];

            if (typeof peersRaw === "string" || Buffer.isBuffer(peersRaw)) {
              peers = compactPeersToObjects(peersRaw);
            } else if (Array.isArray(peersRaw)) {
              peers = peersRaw.map((p) => ({
                ip: p.ip || p["ip"],
                port: Number(p.port),
              }));
            }

            resolve(peers);
          } catch {
            resolve([]);
          }
        });
      });

      req.on("error", () => resolve([]));
      req.on("timeout", () => {
        req.destroy();
        resolve([]);
      });
    } catch {
      resolve([]);
    }
  });
}

// ── Plugin ──────────────────────────────────────────────────────────────

export default function trackerProxyPlugin() {
  /** @type {WebSocketServer|null} */
  let wss = null;

  return {
    name: "tracker-proxy",

    configureServer(server) {
      wss = new WebSocketServer({ noServer: true });

      // Handle WebSocket upgrade for /ws/tracker
      server.httpServer.on("upgrade", (req, socket, head) => {
        if (req.url === "/ws/tracker") {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        }
      });

      // ── Peer store: infoHash → Map<ws, { peerId, ip, port }> ──────────
      const peerStore = new Map();

      function generatePeerId() {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let id = "-WP0001-";
        for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
        return id;
      }

      wss.on("connection", (ws, req) => {
        const announced = new Set();
        const proxyPeerId = generatePeerId();
        console.log("[TrackerProxy] WebSocket connection from", req.socket.remoteAddress);

        // BEP 23: messages are bencoded binary, not JSON. The previous
        // version of this plugin called JSON.parse and silently dropped
        // every announce — that's why the browser test showed zero
        // peers and the spinner never resolved.
        const decodeMessage = (raw) => {
          const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "latin1");
          if (buf.length === 0) return null;
          // bencode: dictionaries start with 'd' (0x64). All bittorrent-
          // tracker WS traffic starts with 'd', so check first to skip
          // any plain-text frames cheaply.
          if (buf[0] === 0x64 /* 'd' */) {
            try { return bencodeDecode(buf, 0).value; } catch { return null; }
          }
          // Fallback: JSON. Some custom clients use a JSON-over-WS
          // variant; we still want to be useful in dev.
          try { return JSON.parse(buf.toString("utf8")); } catch { return null; }
        };

        ws.on("message", async (raw) => {
          const msg = decodeMessage(raw);
          if (!msg) {
            console.log("[TrackerProxy] Unparseable message:", raw.length, "bytes");
            return;
          }

          // info_hash in BEP 23 is a 20-byte binary string; the legacy
          // JSON path would have sent it as hex. Normalize to hex for
          // Map keys + external HTTP tracker announces (see asHex).
          const infoHashRaw = msg.info_hash;
          const infoHashHex = asHex(infoHashRaw);
          const peerIdRaw = msg.peer_id || proxyPeerId;
          const port = Number(msg.port) || 6881;

          console.log(
            "[TrackerProxy] Received:", msg.action,
            "info_hash:", infoHashHex?.substring(0, 8) + "..."
          );

          if (msg.action === "announce") {
            announced.add(infoHashHex);

            // Store this peer (keyed by hex hash for ergonomic Map lookups)
            if (!peerStore.has(infoHashHex)) peerStore.set(infoHashHex, new Map());
            peerStore.get(infoHashHex).set(ws, { peerId: peerIdRaw, port, ip: "127.0.0.1" });

            // Collect local peers (excluding this client)
            const localPeers = [];
            for (const [client, peer] of peerStore.get(infoHashHex)) {
              if (client !== ws) {
                localPeers.push({ ip: peer.ip, port: peer.port });
              }
            }

            // Fetch from external HTTP trackers in parallel. Pass hex
            // info_hash; the helper percent-encodes the binary form.
            const externalResults = await Promise.all(
              PROXY_TRACKERS.map((t) => announceToHttpTracker(t.url, infoHashHex, proxyPeerId, port))
            );
            const externalPeers = externalResults.flat();

            // Deduplicate by ip:port
            const seen = new Set();
            const allPeers = [];
            for (const p of [...localPeers, ...externalPeers]) {
              const key = `${p.ip}:${p.port}`;
              if (!seen.has(key) && p.ip && p.port) {
                seen.add(key);
                allPeers.push(p);
              }
            }

            console.log(
              `[tracker-proxy] announce info_hash=${infoHashHex?.substring(0, 8)}… ` +
              `local=${localPeers.length} external=${externalPeers.length} total=${allPeers.length}`
            );

            // BEP 23 response: bencoded, with peers as a compact 6-bytes-
            // per-peer binary string. The client always sends
            // `compact=1`, and a dict-list response would still parse
            // but is non-standard for bittorrent-tracker.
            const response = {
              action: "announce",
              info_hash: infoHashRaw,        // echo back as 20-byte binary
              "tracker id": "local-proxy",
              interval: 120,
              "min interval": 60,
              complete: allPeers.length,
              incomplete: 0,
              peers: peerObjectsToCompact(allPeers).toString("latin1"),
            };

            try {
              ws.send(Buffer.from(bencodeEncode(response), "latin1"));
            } catch {
              // client disconnected
            }
          }

          if (msg.action === "scrape") {
            // Minimal scrape response, also bencoded.
            const result = {};
            const rawHashes = Array.isArray(msg.info_hash) ? msg.info_hash : [msg.info_hash];
            for (const h of rawHashes) {
              const hex = asHex(h);
              const peers = peerStore.get(hex);
              result[hex] = {
                complete: peers ? peers.size : 0,
                incomplete: 0,
                downloaded: 0,
              };
            }
            try {
              ws.send(Buffer.from(bencodeEncode({ action: "scrape", files: result }), "latin1"));
            } catch {
              // client disconnected
            }
          }
        });

        ws.on("close", () => {
          for (const hash of announced) {
            const peers = peerStore.get(hash);
            if (peers) {
              peers.delete(ws);
              if (peers.size === 0) peerStore.delete(hash);
            }
          }
        });
      });

      console.log("[tracker-proxy] WebSocket tracker proxy listening on /ws/tracker");
    },
  };
}
