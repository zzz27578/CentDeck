/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { CONFIG_DIR, ApiError } = require("./store");
const file = path.join(CONFIG_DIR, "account.json");
const sessions = new Map(),
  attempts = new Map();
function account() {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(
        { username: "centdeck", password: "centdeck", mustChange: true },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  const a = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  if (!a.username || !a.password)
    throw new ApiError(
      500,
      "请检查 config.local/account.json 的 username 和 password",
    );
  return a;
}
const stamp = (a) =>
  crypto.createHash("sha256").update(JSON.stringify(a)).digest("hex");
const same = (a, b) =>
  crypto.timingSafeEqual(
    crypto.createHash("sha256").update(String(a)).digest(),
    crypto.createHash("sha256").update(String(b)).digest(),
  );
function session(req) {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("cd_session="))
    ?.slice(11);
  const s = sessions.get(token);
  if (!s || s.expires < Date.now() || s.stamp !== stamp(account())) {
    sessions.delete(token);
    return null;
  }
  return s;
}
function issue(res, a) {
  const token = crypto.randomBytes(32).toString("hex");
  const s = {
    username: a.username,
    mustChange: !!a.mustChange || a.password === "centdeck",
    stamp: stamp(a),
    expires: Date.now() + 86400000,
  };
  sessions.set(token, s);
  res.setHeader(
    "Set-Cookie",
    `cd_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
  );
  return s;
}
function login(req, res, body) {
  const ip = req.socket.remoteAddress,
    at = attempts.get(ip) || { count: 0, until: 0 };
  if (at.until > Date.now() && at.count >= 10)
    throw new ApiError(429, "尝试过于频繁，请一分钟后重试");
  const a = account();
  if (!same(a.username, body.username) || !same(a.password, body.password)) {
    attempts.set(ip, {
      count: at.until > Date.now() ? at.count + 1 : 1,
      until: Date.now() + 60000,
    });
    throw new ApiError(401, "账号或密码不正确");
  }
  attempts.delete(ip);
  return publicSession(issue(res, a));
}
function publicSession(s) {
  return {
    authenticated: !!s,
    username: s?.username || "",
    mustChange: !!s?.mustChange,
  };
}
function requireSession(req, setup = false) {
  const s = session(req);
  if (!s) throw new ApiError(401, "请先登录");
  if (s.mustChange && !setup) throw new ApiError(403, "请先设置新密码");
  return s;
}
function update(req, res, b) {
  const s = requireSession(req, true),
    a = account();
  if (!s.mustChange && !same(a.password, b.currentPassword))
    throw new ApiError(400, "当前密码不正确");
  if (
    typeof b.password !== "string" ||
    b.password.length < 8 ||
    b.password.length > 256 ||
    b.password === "centdeck"
  )
    throw new ApiError(400, "新密码至少 8 位，不能使用初始密码");
  const username = String(b.username || a.username).trim();
  if (!username || username.length > 60)
    throw new ApiError(400, "用户名为 1–60 个字符");
  const next = { username, password: b.password, mustChange: false };
  fs.writeFileSync(file + ".tmp", JSON.stringify(next, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.renameSync(file + ".tmp", file);
  sessions.clear();
  return publicSession(issue(res, next));
}
function logout(req, res) {
  const s = session(req);
  for (const [k, v] of sessions) if (v === s) sessions.delete(k);
  res.setHeader(
    "Set-Cookie",
    "cd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
  );
  return { authenticated: false };
}
function checkOrigin(req) {
  const host = req.headers.host || "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))
    throw new ApiError(403, "仅允许本机访问");
  if (req.headers.origin && req.headers.origin !== `http://${host}`)
    throw new ApiError(403, "不允许跨站请求");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers["x-centdeck"] !== "1"
  )
    throw new ApiError(403, "请求来源无效");
}
module.exports = {
  account,
  session,
  publicSession,
  login,
  update,
  logout,
  requireSession,
  checkOrigin,
};
