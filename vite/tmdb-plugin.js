import { loadEnv } from "vite";

export default function tmdbPlugin() {
  let TMDB_ACCESS_TOKEN = "";
  let TMDB_API_KEY = "";

  return {
    name: "tmdb-plugin",
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir || process.cwd(), "");
      TMDB_ACCESS_TOKEN = env.VITE_TMDB_ACCESS_TOKEN || "";
      TMDB_API_KEY = env.VITE_TMDB_API_KEY || "";
    },
    configureServer(server) {
      server.middlewares.use("/api/tmdb", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const path = url.searchParams.get("path");
          if (!path) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing path" }));
            return;
          }

          const cleanPath = path.startsWith("/") ? path.slice(1) : path;
          const targetUrl = new URL(cleanPath, "https://api.themoviedb.org/3/");

          for (const [key, value] of url.searchParams.entries()) {
            if (key !== "path") targetUrl.searchParams.append(key, value);
          }

          if (TMDB_API_KEY && !TMDB_ACCESS_TOKEN) {
            targetUrl.searchParams.set("api_key", TMDB_API_KEY);
          }

          const headers = TMDB_ACCESS_TOKEN ? { Authorization: `Bearer ${TMDB_ACCESS_TOKEN}` } : {};

          const upstreamRes = await fetch(targetUrl.toString(), { headers });
          res.statusCode = upstreamRes.status;
          res.setHeader("Content-Type", "application/json");
          res.end(await upstreamRes.text());
        } catch (err) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    }
  };
}
