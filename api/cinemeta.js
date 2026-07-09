import { getRequestUrl, sendJson } from "./_lib/http.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.end();
    return;
  }

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
  const targetUrl = new URL(cleanPath, "https://v3-cinemeta.strem.io/");

  for (const [key, value] of url.searchParams.entries()) {
    if (key !== "path") {
      targetUrl.searchParams.append(key, value);
    }
  }

  try {
    const upstreamRes = await fetch(targetUrl.toString());
    if (!upstreamRes.ok) {
      res.statusCode = upstreamRes.status;
      res.end();
      return;
    }
    const data = await upstreamRes.json();
    sendJson(res, 200, data);
  } catch (error) {
    console.warn("[cinemeta proxy] error:", error.message);
    sendJson(res, 502, { error: "Cinemeta upstream failed" });
  }
}
