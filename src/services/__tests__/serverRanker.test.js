import { describe, it, expect, vi, beforeEach } from "vitest";
import { getServerRankings, getLatencyStatus, sortStreamsByLatency, pingServer, probeAllServers, SERVER_PING_URLS } from "../serverRanker";

describe("serverRanker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.localStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      clear: vi.fn()
    };
    global.fetch = vi.fn();
  });

  it("getLatencyStatus maps correctly", () => {
    expect(getLatencyStatus(Infinity)).toBe("offline");
    expect(getLatencyStatus(100)).toBe("fast");
    expect(getLatencyStatus(1000)).toBe("average");
    expect(getLatencyStatus(2000)).toBe("slow");
  });

  it("sortStreamsByLatency sorts correctly", () => {
    const streams = [
      { name: "Server A", source: "serverA" },
      { name: "Server B", source: "serverB" },
      { name: "Server C", source: "serverC" }
    ];

    const latencyMap = {
      "serverA": 1500, // slow
      "serverB": Infinity, // offline
      "serverC": 200 // fast
    };

    const sorted = sortStreamsByLatency(streams, latencyMap);
    
    expect(sorted[0].name).toBe("Server C"); // 200ms
    expect(sorted[1].name).toBe("Server A"); // 1500ms
    expect(sorted[2].name).toBe("Server B"); // Infinity
  });
});
