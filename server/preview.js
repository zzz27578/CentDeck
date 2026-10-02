/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
"use strict";
// Each project has an isolated, read-only origin. No account or write API lives here.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const store = require("./store");
const servers = new Map();
const types = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
};

function scope(base) {
  const match = /^\/(preview|tpl|show)\/([^/]+)(?:\/|$)/.exec(base);
  if (!match) throw new store.ApiError(400, "Invalid preview path");
  const id = decodeURIComponent(match[2]);
  store.assertValidId(id, "Preview ID");
  const template = match[1] === "tpl";
  const root = template
    ? store.safeJoin(store.TEMPLATES_DIR, id)
    : store.projectDir(id);
  return {
    id,
    template,
    root,
    key: (template ? "template:" : "project:") + id,
  };
}
function file(res, root, relative) {
  let target = store.safeJoin(root, relative || "index.html");
  const rel = path.relative(root, target);
  if (
    rel.split(path.sep).some((p) => p.startsWith(".")) ||
    rel === "project.json"
  )
    throw new store.ApiError(403, "Private preview path");
  if (fs.statSync(target).isDirectory())
    target = path.join(target, "index.html");
  const resolved = fs.realpathSync(target),
    realRoot = fs.realpathSync(root);
  if (!resolved.startsWith(realRoot + path.sep))
    throw new store.ApiError(403, "Preview path outside project");
  res.writeHead(200, {
    "Content-Type":
      types[path.extname(target).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  fs.createReadStream(target)
    .on("error", () => res.destroy())
    .pipe(res);
}

async function origin(base, workbenchOrigin) {
  const s = scope(base);
  if (!servers.has(s.key)) {
    const entry = { server: null, promise: null };
    entry.promise = new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        try {
          if (!["GET", "HEAD"].includes(req.method))
            throw new store.ApiError(405, "Preview is read-only");
          const url = new URL(req.url, "http://127.0.0.1");
          const main = new URL(workbenchOrigin);
          if (
            [
              `http://127.0.0.1:${main.port}`,
              `http://localhost:${main.port}`,
            ].includes(req.headers.origin)
          )
            res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
          if (req.headers.host !== `127.0.0.1:${server.address().port}`)
            throw new store.ApiError(403, "Invalid preview host");
          if (url.pathname === "/runtime") {
            const parent = url.searchParams.get("parent");
            const allowed = new URL(workbenchOrigin);
            if (
              ![
                `http://127.0.0.1:${allowed.port}`,
                `http://localhost:${allowed.port}`,
              ].includes(parent)
            )
              throw new store.ApiError(403, "Invalid preview parent");
            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(
              '<!doctype html><html><head><meta charset="utf-8"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;overflow:hidden}iframe{display:block;background:white}</style></head><body><script type="module" src="/app/js/engine/preview-runtime.js"></script></body></html>',
            );
            return;
          }
          if (url.pathname.startsWith("/app/js/")) {
            file(
              res,
              path.join(store.ROOT, "app", "js"),
              decodeURIComponent(url.pathname.slice(8)),
            );
            return;
          }
          const hit = /^\/(preview|tpl|show)\/([^/]+)(?:\/(.*))?$/.exec(
            url.pathname,
          );
          if (
            !hit ||
            decodeURIComponent(hit[2]) !== s.id ||
            (hit[1] === "tpl") !== s.template
          )
            throw new store.ApiError(404, "Preview resource not found");
          const rel = decodeURIComponent(hit[3] || "index.html");
          if (hit[1] === "show" && /\.html?$/i.test(rel)) {
            const html = require("./presentation").render(s.id, rel, url, {
              workbenchOrigin,
            });
            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(html);
            return;
          }
          file(res, s.root, rel);
        } catch (error) {
          if (!res.headersSent)
            res.writeHead(error.status || 404, {
              "Content-Type": "text/plain",
            });
          res.end("Preview resource unavailable");
        }
      });
      entry.server = server;
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () =>
        resolve(`http://127.0.0.1:${server.address().port}`),
      );
    }).catch((error) => {
      servers.delete(s.key);
      throw error;
    });
    servers.set(s.key, entry);
  }
  return servers.get(s.key).promise;
}
function closeProject(id) {
  const key = "project:" + id;
  servers.get(key)?.server?.close();
  servers.delete(key);
}
function close() {
  for (const entry of servers.values()) entry.server?.close();
  servers.clear();
}
module.exports = { origin, close, closeProject };
