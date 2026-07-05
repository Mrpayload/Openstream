import { getRequestUrl, sendJson } from "./_lib/http.js";

const TMDB_ACCESS_TOKEN = process.env.VITE_TMDB_ACCESS_TOKEN;
const TMDB_API_KEY = process.env.VITE_TMDB_API_KEY;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const url = getRequestUrl(req);
  const path = url.searchParams.get("path");
  if (!path) {
    sendJson(res, 400, { error: "Missing required parameter: path" });
    return;
  }

  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const targetUrl = new URL(cleanPath, "https://api.themoviedb.org/3/");

  for (const [key, value] of url.searchParams.entries()) {
    if (key !== "path") {
      targetUrl.searchParams.append(key, value);
    }
  }

  if (TMDB_API_KEY && !TMDB_ACCESS_TOKEN) {
    targetUrl.searchParams.set("api_key", TMDB_API_KEY);
  }

  try {
    const headers = TMDB_ACCESS_TOKEN
      ? { Authorization: `Bearer ${TMDB_ACCESS_TOKEN}` }
      : {};

    const upstreamRes = await fetch(targetUrl.toString(), { headers });
    if (!upstreamRes.ok) {
      res.statusCode = upstreamRes.status;
      res.end();
      return;
    }
    const data = await upstreamRes.json();
    sendJson(res, 200, data);
  } catch (error) {
    console.warn("[tmdb proxy] error:", error.message);
    sendJson(res, 502, { error: "TMDB upstream failed" });
  }
}
