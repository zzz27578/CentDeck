"use strict";
const { execFile } = require("node:child_process");
const { ROOT } = require("./store");
const github = "https://github.com/zzz27578/CentDeck";
const exec = (args) =>
  new Promise((resolve, reject) =>
    execFile(
      "git",
      args,
      { cwd: ROOT, windowsHide: true, timeout: 20000 },
      (err, out) => (err ? reject(err) : resolve(out.trim())),
    ),
  );
async function info() {
  let revision = "";
  try {
    revision = await exec(["rev-parse", "--short", "HEAD"]);
  } catch {}
  return {
    name: "CentDeck",
    version: "0.2.0",
    revision,
    github,
    accountFile: "config.local/account.json",
  };
}
async function updates() {
  const current = await exec(["rev-parse", "HEAD"]);
  const remote = await exec(["ls-remote", github + ".git", "HEAD"]);
  const latest = remote.split(/\s/)[0];
  if (!/^[a-f0-9]{40}$/.test(latest))
    throw new Error("无法获取 GitHub 最新版本");
  return { ...(await info()), current, latest, available: latest !== current };
}
module.exports = { info, updates };
