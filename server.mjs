// Shared request handler for the Vite plugin and the standalone server.
// Serves the overlay and stores annotations (JSON + optional PNG) in a local folder.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OVERLAY = join(dirname(fileURLToPath(import.meta.url)), "overlay.js");
const MAX_BYTES = 25e6;
const KEEP = 10;
const MAX_SHOTS = 12;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const hostname = (value) => {
  try {
    return new URL(value.includes("://") ? value : "http://" + value).hostname;
  } catch {
    return "";
  }
};

/**
 * @param {{ dir: string, cwd?: string, allowedHosts?: string[] }} options
 *   dir: where annotations are written. allowedHosts: extra hostnames (besides
 *   loopback) allowed to call the API, e.g. a custom dev domain.
 */
export function createHandler({ dir, cwd = process.cwd(), allowedHosts = [] }) {
  const allowed = new Set([...LOOPBACK, ...allowedHosts]);
  const outDir = resolve(dir);
  const shown = (file) => relative(cwd, join(outDir, file)).split("\\").join("/");

  return async function annotateMiddleware(req, res, next) {
    const url = (req.url || "").split("?")[0];
    if (!url.startsWith("/__annotate/")) return next?.();

    // Only the developer's own machine and pages may use this: the Host header
    // (DNS rebinding) and the Origin header (other websites) must be allowed.
    const origin = req.headers.origin;
    if (!allowed.has(hostname(req.headers.host || "")) || (origin && !allowed.has(hostname(origin))))
      return send(res, 403, { error: "forbidden" });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.statusCode = 204;
      return res.end();
    }

    if (url === "/__annotate/overlay.js" && req.method === "GET") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      try {
        return res.end(await readFile(OVERLAY));
      } catch {
        return send(res, 500, { error: "overlay unavailable" });
      }
    }
    if (url === "/__annotate/ping") return send(res, 200, { ok: true, dir: shown("") || "." });
    if (url === "/__annotate/save" && req.method === "POST") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return send(res, e.code === "TOO_BIG" ? 413 : 400, { error: "bad request" });
      }
      const { json, pngs = [] } = body || {};
      if (
        !json ||
        typeof json !== "object" ||
        !Array.isArray(pngs) ||
        pngs.length > MAX_SHOTS ||
        !pngs.every((p) => typeof p === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(p))
      )
        return send(res, 400, { error: "bad payload" });
      try {
        return send(res, 200, save(outDir, json, pngs, shown));
      } catch {
        return send(res, 500, { error: "could not save" });
      }
    }
    return send(res, 404, { error: "not found" });
  };
}

function save(outDir, json, pngs, shown) {
  mkdirSync(outDir, { recursive: true });
  const ignore = join(outDir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  // Never leave screenshots from an earlier Send behind.
  for (const f of readdirSync(outDir))
    if (/^latest(-shot-\d+)?\.png$/.test(f)) rmSync(join(outDir, f), { force: true });
  const files = pngs.map((png, i) => {
    const data = Buffer.from(png.split(",")[1], "base64");
    writeFileSync(join(outDir, `${stamp}-shot-${i + 1}.png`), data);
    writeFileSync(join(outDir, `latest-shot-${i + 1}.png`), data);
    return shown(`latest-shot-${i + 1}.png`);
  });
  json.screenshots = files.map((file, i) => ({ file, ...(json.screenshots?.[i] || {}) }));
  writeFileSync(join(outDir, `${stamp}.json`), JSON.stringify(json, null, 2));
  copyFileSync(join(outDir, `${stamp}.json`), join(outDir, "latest.json"));
  // Keep the newest few sends, drop the rest.
  const stampOf = (f) => f.split(/\.json$|-shot-/)[0];
  const stamps = [
    ...new Set(
      readdirSync(outDir)
        .filter((f) => !f.startsWith("latest") && f !== ".gitignore")
        .map(stampOf),
    ),
  ].sort();
  const old = new Set(stamps.slice(0, -KEEP));
  for (const f of readdirSync(outDir))
    if (!f.startsWith("latest") && old.has(stampOf(f))) rmSync(join(outDir, f), { force: true });
  return { dir: shown("").replace(/\/$/, "") || ".", json: shown("latest.json"), pngs: files };
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BYTES) {
        const e = new Error("too big");
        e.code = "TOO_BIG";
        reject(e);
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(data));
}
