export const SERVER_PING_URLS = {
  "vidlink": "https://vidlink.pro/favicon.ico",
  "vidsrc-embed": "https://vsembed.ru/favicon.ico",
  "vidsrc-me": "https://vidsrcme.ru/favicon.ico",
  "superembed": "https://multiembed.mov/favicon.ico",
  "vidsrc-to": "https://vidsrc.to/favicon.ico",
  "smashystream": "https://embed.smashystream.com/favicon.ico",
  "2embed": "https://www.2embed.cc/favicon.ico",
  "flicky": "https://flicky.host/favicon.ico"
};

const CACHE_KEY = "openstream_server_latency_v1";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const PING_TIMEOUT_MS = 2500;

/**
 * Pings a URL using no-cors mode to measure network latency.
 * Returns latency in ms, or Infinity if it times out/fails.
 */
export const pingServer = async (url) => {
  const start = performance.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    
    // mode: 'no-cors' allows us to ping domains without CORS headers, 
    // we only care about the time it takes the promise to resolve/reject.
    // method: 'HEAD' is preferred but some servers block it, so we do a standard GET
    await fetch(url, { 
      mode: "no-cors", 
      signal: controller.signal,
      cache: "no-store" 
    });
    
    clearTimeout(timeout);
    return Math.round(performance.now() - start);
  } catch (error) {
    return Infinity; // Server is offline, blocked, or timed out
  }
};

/**
 * Probes all known servers in parallel and returns a map of { serverId: latencyMs }
 */
export const probeAllServers = async () => {
  const entries = Object.entries(SERVER_PING_URLS);
  
  const results = await Promise.all(
    entries.map(async ([id, url]) => {
      const latency = await pingServer(url);
      return { id, latency };
    })
  );

  const latencyMap = {};
  for (const res of results) {
    latencyMap[res.id] = res.latency;
  }

  // Save to cache
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      latencies: latencyMap
    }));
  } catch (e) {
    console.warn("Failed to save server latencies to cache", e);
  }

  return latencyMap;
};

/**
 * Gets server latencies from cache if valid, otherwise triggers a probe.
 * Returns a map of { serverId: latencyMs }
 */
export const getServerRankings = async (forceRefresh = false) => {
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
          return parsed.latencies;
        }
      }
    } catch (e) {
      console.warn("Failed to parse cached server latencies", e);
    }
  }

  // Cache is missing or expired, probe now
  return await probeAllServers();
};

/**
 * Returns a sort indicator (fast, average, slow, offline) based on latency ms
 */
export const getLatencyStatus = (latencyMs) => {
  if (latencyMs === Infinity) return "offline";
  if (latencyMs < 600) return "fast";
  if (latencyMs < 1500) return "average";
  return "slow";
};

/**
 * Helper to sort the fallback stream list produced by buildFallbackStreamList
 * based on the provided latency map.
 */
export const sortStreamsByLatency = (streams, latencyMap) => {
  return [...streams].sort((a, b) => {
    // We use the stream.source (which maps to player.id) to lookup latency
    const latA = latencyMap[a.source] ?? Infinity;
    const latB = latencyMap[b.source] ?? Infinity;
    return latA - latB;
  });
};
