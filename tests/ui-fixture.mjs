// Disposable browser QA workspace; never reads the user's configuration or projects.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "centdeck-ui-"));
process.env.CENTDECK_CONFIG_DIR = path.join(temp, "config");
process.env.CENTDECK_PROJECTS_DIR = path.join(temp, "projects");
process.env.CENTDECK_NO_OPEN = "1";
process.env.PORT = "8430";
fs.mkdirSync(process.env.CENTDECK_CONFIG_DIR);
fs.mkdirSync(process.env.CENTDECK_PROJECTS_DIR);
fs.writeFileSync(
  path.join(process.env.CENTDECK_CONFIG_DIR, "account.json"),
  JSON.stringify({
    username: "tester",
    password: "centdeck-test-only",
    mustChange: false,
  }),
);
const upstream = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url.endsWith("/models")) {
    res.end(
      JSON.stringify({
        data: [{ id: "design-local" }, { id: "review-local" }],
      }),
    );
    return;
  }
  let raw = "";
  for await (const c of req) raw += c;
  const b = JSON.parse(raw);
  const already = b.messages.some((m) => m.role === "tool");
  const create = b.tools?.some((t) => t.function.name === "publish_variant");
  const m =
    !already && create
      ? {
          role: "assistant",
          content: "方案已经准备好。",
          tool_calls: [
            {
              id: "publish-1",
              type: "function",
              function: {
                name: "publish_variant",
                arguments: JSON.stringify({
                  name: "纸与墨",
                  colors: {
                    brand: "#536642",
                    accent: "#b6c594",
                    bg: "#f5f5ed",
                    text: "#22291e",
                  },
                  fontFamily: "system-ui",
                  pages: [
                    {
                      file: "index.html",
                      title: "纸与墨 · 首页",
                      html: '<!doctype html><html lang="zh"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>纸与墨</title><style>body{background:#f5f5ed;color:#22291e;margin:0;font-family:system-ui}main{padding:12vw}h1{font-size:clamp(40px,6vw,90px)}p{font-size:20px;color:#536642}button{background:#536642;color:white;border:0;border-radius:30px;padding:18px 28px}@media(max-width:600px){main{padding:30px}h1{font-size:42px}}</style><main><p>FIELD NOTES / 01</p><h1>留一点空间，<br>让灵感发生。</h1><button onclick="this.textContent=\'已开始\'">开始探索 ↗</button></main></html>',
                    },
                  ],
                }),
              },
            },
          ],
        }
      : {
          role: "assistant",
          content: create
            ? "已创建「纸与墨」方案，设计规范已关联到首页。"
            : "建议以温暖纸色和深墨绿建立视觉秩序，使用宽阔留白与清晰的字号层级。确定方向后可切换创建模式。",
        };
  res.end(
    JSON.stringify({ choices: [{ message: m }], usage: { total_tokens: 180 } }),
  );
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const store = createRequire(import.meta.url)("../server/store.js");
store.saveAssistants([
  {
    id: "assistant-default",
    name: "Cent",
    role: "总览设计",
    responsibility: "网站创意与整体设计",
    avatar: "centdeck",
    model: "auto",
    skills: ["design-variants"],
    think: "mid",
  },
  {
    id: "assistant-review",
    name: "Echo",
    role: "审查员",
    responsibility: "体验、交互与无障碍",
    avatar: "centdeck",
    model: "auto",
    skills: ["page-edit"],
    think: "high",
  },
]);
store.saveSettings({
  providers: [
    {
      id: "qa-local",
      name: "本地验收模型",
      baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
      noKey: true,
      enabled: true,
      models: ["design-local", "review-local"],
    },
  ],
  defaultModel: "qa-local:design-local",
});
const a = store.createProject({ template: "qichuan", name: "栖川 · 旅宿工作台" }),
  b = store.createProject({ template: "site", name: "云帆 · 品牌官网" });
store.createProject({ blank: true, name: "未命名的灵感" });
const srv = spawn(process.execPath, ["server/server.js"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: process.env,
  stdio: ["ignore", "pipe", "inherit"],
});
srv.stdout.pipe(process.stdout);
console.log("QA_PROJECT=" + a.id + " QA_SITE=" + b.id + " QA_DIR=" + temp);
function stop() {
  srv.kill();
  upstream.closeAllConnections();
  upstream.close();
  if (
    path.dirname(temp) === os.tmpdir() &&
    path.basename(temp).startsWith("centdeck-ui-")
  )
    fs.rmSync(temp, { recursive: true, force: true });
  setTimeout(() => process.exit(), 300);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
