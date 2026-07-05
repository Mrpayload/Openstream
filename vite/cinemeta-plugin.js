export default function cinemetaPlugin() {
  return {
    name: "cinemeta-plugin",
    configureServer(server) {
      server.middlewares.use("/api/cinemeta", async (req, res) => {
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
          const targetUrl = new URL(cleanPath, "https://v3-cinemeta.strem.io/");

          for (const [key, value] of url.searchParams.entries()) {
            if (key !== "path") targetUrl.searchParams.append(key, value);
          }

          const upstreamRes = await fetch(targetUrl.toString());
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
