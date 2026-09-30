"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const store = require("./store");
const safeJSON = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
function render(id, rel, url) {
  const dir = store.projectDir(id),
    file = store.safeJoin(dir, rel),
    name = path.relative(dir, file);
  if (name.startsWith(".centdeck") || name === "project.json")
    throw new store.ApiError(403, "不能放映项目元数据");
  if (!/\.html?$/i.test(file)) return null;
  if (!fs.existsSync(file)) throw new store.ApiError(404, "页面不存在");
  const mobile = url.searchParams.get("mobile") === "1",
    embedded = url.searchParams.get("embedded") === "1";
  const exit =
    "/?project=" +
    encodeURIComponent(id) +
    "&view=" +
    (url.searchParams.get("from") === "edit" ? "edit" : "overview") +
    "&page=" +
    encodeURIComponent(rel);
  const controls = `<script>(()=>{if(self!==top)return;const h=document.createElement('div');h.id='centdeck-presentation-controls';h.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647';document.body.appendChild(h);const s=h.attachShadow({mode:'open'});s.innerHTML='<style>:host{all:initial}nav{display:flex;gap:7px}button{width:36px;height:36px;display:grid;place-items:center;border:1px solid #8885;border-radius:50%;background:#f8f9f1ed;color:#232920;box-shadow:0 2px 12px #0002;cursor:pointer;backdrop-filter:blur(8px)}button:focus-visible{outline:2px solid #52663d;outline-offset:3px}svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7}</style><nav><button title="${mobile ? "切换电脑" : "切换手机"}" aria-label="${mobile ? "切换电脑" : "切换手机"}"><svg viewBox="0 0 24 24">${mobile ? '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>' : '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>'}</svg></button><button title="退出放映" aria-label="退出放映"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></svg></button></nav>';const b=s.querySelectorAll('button');b[0].onclick=()=>{const u=new URL(location.href);u.searchParams.set('mobile',${mobile ? "0" : "1"});location.href=u.href};const leave=()=>{const u=new URL(${safeJSON(exit)},location.origin);u.searchParams.set('page',decodeURIComponent(location.pathname.split('/').slice(3).join('/')));location.href=u.href};b[1].onclick=leave;document.addEventListener('keydown',e=>{if(e.key==='Escape')leave()});})();</script>`;
  if (embedded) return fs.readFileSync(file, "utf8");
  if (mobile) {
    const source = new URL(url);
    source.searchParams.delete("mobile");
    source.searchParams.set("embedded", "1");
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CentDeck · 手机预览</title><style>html,body{margin:0;width:100%;height:100%;background:#1d211c}main{height:100dvh;display:grid;place-items:center}iframe{width:min(393px,100vw);height:100dvh;border:0;background:white}</style><main><iframe src="${source.pathname + source.search}" title="手机页面"></iframe></main><script>document.querySelector("iframe").addEventListener("load",e=>{try{const u=new URL(e.target.contentWindow.location.href);if(u.origin===location.origin&&u.pathname.startsWith(${safeJSON("/show/" + encodeURIComponent(id) + "/")})){const next=new URL(location.href);next.pathname=u.pathname;history.replaceState(null,"",next.href)}}catch{}})</script>${controls}</html>`;
  }
  const html = fs.readFileSync(file, "utf8");
  return /<\/body\s*>/i.test(html)
    ? html.replace(/<\/body\s*>/i, controls + "</body>")
    : html + controls;
}
module.exports = { render };
