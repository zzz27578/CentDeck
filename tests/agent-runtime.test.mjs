/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, ".."),
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "centdeck-runtime-"));
const config = path.join(tmp, "config"),
  projects = path.join(tmp, "projects");
fs.mkdirSync(config);
fs.mkdirSync(projects);
let pendingSlow = null,
  requests = 0;
const seenModels = [];
const seenEfforts = [];
const tool = (name, args) => ({
  role: "assistant",
  content: null,
  tool_calls: [
    {
      id: "tool-" + requests,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});
const upstream = http.createServer(async (req, res) => {
  if (req.url === "/v1/models") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        data: [{ id: "local-fixture" }, { id: "local-fixture-vision" }],
      }),
    );
    return;
  }
  let raw = "";
  for await (const c of req) raw += c;
  const b = JSON.parse(raw);
  requests++;
  seenModels.push(b.model);
  seenEfforts.push(b.reasoning_effort);
  const goal = b.messages.find((m) => m.role === "user")?.content || "",
    results = b.messages
      .filter((m) => m.role === "tool")
      .map((m) => JSON.parse(m.content));
  let m = { role: "assistant", content: "测试完成。" };
  if (goal.includes("QUESTION") && !results.length)
    m = tool("request_input", {
      question: "选择页面风格",
      options: ["明亮", "深色"],
    });
  else if (goal.includes("ILLEGAL"))
    m = tool("write_files", {
      files: [
        {
          path: "index.html",
          content: "<h1>BAD</h1>",
          baseHash: createHash("sha256")
            .update("<h1>Original</h1>")
            .digest("hex"),
        },
      ],
    });
  else if (goal.includes("DELEGATE") && !results.length)
    m = tool("delegate", {
      assistantId: "helper",
      text: "READ ONLY",
      scope: "all",
    });
  else if (goal.includes("VARIANT") && !results.length)
    m = tool("publish_variant", {
      name: "薄荷",
      colors: { brand: "#446644", bg: "#fafafa", text: "#222222" },
      fontFamily: "system-ui",
      pages: [
        {
          file: "index.html",
          title: "方案首页",
          html: "<!doctype html><title>新方案</title><h1>新方案</h1>",
        },
      ],
    });
  else if (goal.includes("WRITE") || goal.includes("SLOW")) {
    const file = goal.includes("SECOND") ? "second.html" : "index.html";
    if (!results.length) m = tool("read_page", { path: file });
    else if (results.length === 1)
      m = tool("write_files", {
        files: [
          {
            path: file,
            baseHash: results[0].baseHash,
            content: "<h1>Changed " + file + "</h1>",
          },
        ],
      });
    if (goal.includes("SLOW") && results.length === 1) {
      await new Promise((resolve) => {
        pendingSlow = resolve;
      });
      pendingSlow = null;
    }
  }
  if(goal.includes('BATCH LIMIT')&&!results.length){m=tool('read_page',{path:'index.html'});m.tool_calls=Array.from({length:4},(_,i)=>({...m.tool_calls[0],id:'batch-'+i}));}
  if(goal.includes('LOOP LIMIT'))m=tool('read_page',{path:'index.html'});
  if(goal.includes('LIMIT FINAL')&&results.length<2)m=tool('read_page',{path:'index.html'});
  const truncated=goal.includes('TRUNCATE')&&!b.messages.some(m=>m.role==='assistant');
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({ choices: [{ message: m,finish_reason:truncated?'length':'stop' }], usage: { total_tokens: 30 } }),
  );
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
let srv,
  port,
  cookie = "",
  passed = 0;
const startServer = async () => {
  srv = spawn(process.execPath, ["server/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: "8494",
      CENTDECK_NO_OPEN: "1",
      CENTDECK_CONFIG_DIR: config,
      CENTDECK_PROJECTS_DIR: projects,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.stderr.on("data", (b) => process.stderr.write(b));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("start timeout")), 10000);
    srv.stdout.on("data", (b) => {
      const m = String(b).match(/localhost:(\d+)/);
      if (m) {
        port = +m[1];
        clearTimeout(timer);
        resolve();
      }
    });
    srv.once("exit", (c) => {
      clearTimeout(timer);
      reject(Error("early exit " + c));
    });
  });
};
async function req(method, p, b, expected = 200) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CentDeck": "1",
      Cookie: cookie,
    },
    body: b ? JSON.stringify(b) : undefined,
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  const j = await r.json();
  if (expected === 200) assert.ok(r.ok, `${p}: ${j.error}`);
  else assert.equal(r.status, expected, j.error);
  return j.data;
}
const test = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log("✓ " + name);
    });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 200; i++) {
    const r = await fn();
    if (r) return r;
    await sleep(20);
  }
  throw Error("condition timed out");
}
let project, base, profile;
try {
  await startServer();
  await test("首次登录必须修改密码；匿名 API 被拒绝", async () => {
    await req("GET", "/api/projects", null, 401);
    assert.equal(
      (
        await req("POST", "/api/auth", {
          username: "centdeck",
          password: "centdeck",
        })
      ).mustChange,
      true,
    );
    await req("GET", "/api/projects", null, 403);
    await req("PUT", "/api/auth", {
      username: "test-user",
      password: "test-only-password",
    });
    assert.equal((await req("GET", "/api/auth")).mustChange, false);
  });
  await test("跨站调用被拒绝", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      headers: { Cookie: cookie, Origin: "https://untrusted.example" },
    });
    assert.equal(r.status, 403);
  });
  await test("自定义提供商、发现模型与密钥脱敏", async () => {
    const settings = await req("PUT", "/api/settings", {
      providers: [
        {
          id: "fixture",
          name: "Local fixture",
          baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
          apiKey: "test-only-key-1234",
          enabled: true,
          models: ["local-fixture"],
        },
      ],
      defaultModel: "fixture:local-fixture",
    });
    assert.ok(!JSON.stringify(settings).includes("test-only-key"));
    assert.equal(
      (await req("GET", "/api/providers/fixture/models")).models.length,
      2,
    );
  });
  profile = {
    id: "main",
    name: "主助手",
    role: "自定义总览专家",
    responsibility: "负责整体网站",
    model: "auto",
    avatar: "centdeck",
    skills: [],
    think: "mid",
  };
  await test("自定义角色和职责持久化", async () => {
    await req("PUT", "/api/assistants", [
      profile,
      { ...profile, id: "helper", name: "执行者" },
    ]);
    assert.equal((await req("GET", "/api/assistants"))[0].role, profile.role);
  });
  await test('用户技能接口隐藏基础技能，禁止停用；自建技能仍可管理',async()=>{
    assert.deepEqual(await req('GET','/api/skills'),[]);
    assert.deepEqual((await req('GET','/api/extensions')).skills,[]);
    await req('PUT','/api/skills',{id:'platform-guide',enabled:false},403);
    await req('PUT','/api/skills',{id:'page-edit',action:'remove'},403);
    await req('PUT','/api/skills',{id:'official-inspector--review',enabled:false},403);
    const custom=await req('PUT','/api/skills',{id:'my-skill',name:'My skill',content:'---\nname: my-skill\ndescription: Custom style preferences\n---\nKeep spacing consistent.'});
    assert.deepEqual(custom.map(s=>s.id),['my-skill']);
    const disabled=await req('PUT','/api/skills',{id:'my-skill',enabled:false});assert.equal(disabled[0].enabled,false);
    await req('PUT','/api/skills',{id:'my-skill',action:'remove'});
  });
  project = await req("POST", "/api/import", {
    name: "runtime-test",
    files: [
      {
        path: "index.html",
        dataBase64: Buffer.from("<h1>Original</h1>").toString("base64"),
      },
      {
        path: "second.html",
        dataBase64: Buffer.from("<h1>Second</h1>").toString("base64"),
      },
    ],
  });
  base = "/api/projects/" + project.id;
  const start = async (text, more = {}) =>
    req("POST", base + "/tasks", {
      assistantId: "main",
      mode: "create",
      text,
      scope: "all",
      ...more,
    });
  const getTask = async (t) =>
    (await req("GET", base + "/tasks")).find((x) => x.id === t.id);
  const settled = async (t) =>
    until(async () => {
      const x = await getTask(t);
      return [
        "completed",
        "failed",
        "conflict",
        "cancelled",
        "waiting_user",
        "waiting_authorization",
        "paused",
      ].includes(x.status)
        ? x
        : null;
    });
  const source = async () =>
    (await req("GET", base + "/file?path=index.html")).content;
  await test("六档思考强度持久化并原样发送到模型接口", async () => {
    for (const think of ["low", "medium", "high", "xhigh", "max", "ultra"]) {
      const saved = await req("PUT", "/api/assistants", [
        { ...profile, think }, { ...profile, id: "helper", name: "执行者" },
      ]);
      assert.equal(saved[0].think, think);
      const t = await settled(await start("EFFORT", { think }));
      assert.equal(t.status, "completed");
      assert.equal(seenEfforts.at(-1), think);
    }
    await req("POST", base + "/tasks", { assistantId: "main", text: "INVALID", think: "fake" }, 400);
    await req("PUT", "/api/assistants", [profile, { ...profile, id: "helper", name: "执行者" }]);
    assert.equal((await req("GET", "/api/assistants"))[0].think, "medium");
  });
  await test("运行中更新强度在下一次模型请求生效", async () => {
    const t = await start("SLOW", { think: "low" });
    await until(() => pendingSlow);
    assert.equal(seenEfforts.at(-1), "low");
    const changed = await req("POST", base + "/tasks/" + t.id, { action: "think", think: "ultra" });
    assert.equal(changed.think, "ultra");
    await req("POST", base + "/tasks/" + t.id, { action: "think", think: "fake" }, 400);
    pendingSlow();
    assert.equal((await settled(t)).status, "completed");
    assert.equal(seenEfforts.at(-1), "ultra");
    await req("POST", base + "/tasks/" + t.id, { action: "undo" });
  });
  await test("计划模式拒绝未暴露的写入工具", async () => {
    const t = await settled(await start("ILLEGAL", { mode: "plan" }));
    assert.equal(t.status, "conflict");
    assert.equal(await source(), "<h1>Original</h1>");
  });
  await test("主助手独立读文件、修改、保留真实提交记录", async () => {
    const t = await settled(await start("WRITE"));
    assert.equal(t.status, "completed");
    assert.equal(t.commits.length, 1);
    assert.equal(await source(), "<h1>Changed index.html</h1>");
    await req("POST", base + "/tasks/" + t.id, { action: "undo" });
    assert.equal(await source(), "<h1>Original</h1>");
  });
  await test("运行任务固定模型，不随默认模型修改而切换", async () => {
    const t = await start("SLOW");
    await until(() => pendingSlow);
    assert.equal(t.model, "fixture:local-fixture");
    await req("PUT", "/api/settings", {
      providers: [
        { id: "fixture", models: ["local-fixture", "local-fixture-vision"] },
      ],
      defaultModel: "fixture:local-fixture-vision",
    });
    pendingSlow();
    assert.equal((await settled(t)).status, "completed");
    assert.equal(seenModels.at(-1), "local-fixture");
    await req("POST", base + "/tasks/" + t.id, { action: "undo" });
    await req("PUT", "/api/settings", {
      providers: [],
      defaultModel: "fixture:local-fixture",
    });
  });
  await test("迟到结果在停止后不能写回", async () => {
    const t = await start("SLOW");
    await until(() => pendingSlow);
    await req("POST", base + "/tasks/" + t.id, { action: "cancel" });
    pendingSlow();
    await sleep(100);
    assert.equal(await source(), "<h1>Original</h1>");
    assert.equal((await getTask(t)).status, "cancelled");
  });
  await test("切换到计划使旧运行写权限失效", async () => {
    const t = await start("SLOW");
    await until(() => pendingSlow);
    await req("POST", base + "/tasks/" + t.id, {
      action: "mode",
      mode: "plan",
    });
    pendingSlow();
    await sleep(100);
    assert.equal(await source(), "<h1>Original</h1>");
    assert.equal((await getTask(t)).mode, "plan");
  });
  await test("用户手改后旧模型提案不覆盖", async () => {
    const t = await start("SLOW");
    await until(() => pendingSlow);
    await req("PUT", base + "/file", {
      path: "index.html",
      content: "<h1>User edit</h1>",
    });
    pendingSlow();
    const done = await settled(t);
    assert.equal(await source(), "<h1>User edit</h1>");
    assert.equal(done.commits.length, 0);
  });
  await test("结构化问题保存并可继续", async () => {
    const t = await settled(await start("QUESTION"));
    assert.equal(t.status, "waiting_user");
    await req("POST", base + "/tasks/" + t.id, {
      action: "answer",
      answer: "明亮",
    });
    const done = await settled(t);
    assert.equal(done.status, "completed");
    assert.equal(done.answers[0].answer, "明亮");
  });
  await test("协作关闭时模型不能绕过调度器", async () => {
    const t = await settled(await start("DELEGATE", { collaboration: "off" }));
    assert.ok(t.events.some((e) => e.type === "tool_error"));
    assert.equal(
      (await req("GET", base + "/tasks")).filter((x) => x.parent === t.id)
        .length,
      0,
    );
  });
  await test("协作前确认，回答后仅派发一个任务", async () => {
    const t = await settled(
      await start("DELEGATE", { collaboration: "confirm" }),
    );
    assert.equal(t.status, "waiting_authorization");
    await req("POST", base + "/tasks/" + t.id, {
      action: "answer",
      answer: "允许本次分工",
    });
    await settled(t);
    const children = (await req("GET", base + "/tasks")).filter(
      (x) => x.parent === t.id,
    );
    assert.equal(children.length, 1);
    await settled(children[0]);
  });
  await test("独立页面并行，两份结果均保留", async () => {
    const [a, b] = await Promise.all([
      start("WRITE", { scope: ["index.html"] }),
      start("WRITE SECOND", { assistantId: "helper", scope: ["second.html"] }),
    ]);
    await Promise.all([settled(a), settled(b)]);
    assert.match(await source(), /Changed/);
    assert.match(
      (await req("GET", base + "/file?path=second.html")).content,
      /Changed/,
    );
  });
  await test("重复请求不会产生重复任务", async () => {
    const a = await start("READ ONLY", { requestId: "idempotent-test" }),
      b = await start("READ ONLY", { requestId: "idempotent-test" });
    assert.equal(a.id, b.id);
    await settled(a);
  });
  await test("新方案落在独立目录并关联设计规范卡", async () => {
    const t = await settled(await start("VARIANT"));
    assert.equal(t.status, "completed");
    const p = await req("GET", base);
    assert.equal(p.designGroups.length, 1);
    assert.match(p.designGroups[0].pages[0], /^variants\//);
    assert.ok(p.pages.some((pg) => pg.file === p.designGroups[0].pages[0]));
    const generated = p.designGroups[0].pages[0];
    await req("POST", base + "/tasks/" + t.id, { action: "undo" });
    const undone = await req("GET", base);
    assert.equal(undone.designGroups.length, 0);
    assert.ok(!undone.pages.some((pg) => pg.file === generated));
    await req(
      "GET",
      base + "/file?path=" + encodeURIComponent(generated),
      null,
      404,
    );
  });
  await test("用户编辑过的新方案不可撤销删除", async () => {
    const t = await settled(await start("VARIANT"));
    const p = await req("GET", base),
      generated = p.designGroups[0].pages[0];
    await req("PUT", base + "/file", {
      path: generated,
      content: "<h1>User variant edit</h1>",
    });
    await req("POST", base + "/tasks/" + t.id, { action: "undo" }, 409);
    assert.equal(
      (await req("GET", base + "/file?path=" + encodeURIComponent(generated)))
        .content,
      "<h1>User variant edit</h1>",
    );
  });
  await test("页面范围、锁和任务预算由服务端执行", async () => {
    let t = await settled(
      await start("WRITE SECOND", { scope: ["index.html"] }),
    );
    assert.equal(t.commits.length, 0);
    const p = await req("GET", base),
      before = await source();
    await req("PUT", base, {
      ...p,
      locks: { pages: ["index.html"], elements: [] },
    });
    t = await settled(await start("WRITE"));
    assert.equal(t.commits.length, 0);
    assert.equal(await source(), before);
    await req("PUT", base, { ...p, locks: { pages: [], elements: [] } });
    const count = requests;
    t = await settled(await start("READ ONLY", { budget: 1000 }));
    assert.equal(t.status, "failed");
    assert.equal(requests, count);
  });
  await test('同批和跨多次模型请求的工具调用均受一轮总上限约束',async()=>{
    const t=await start('BATCH LIMIT',{maxSteps:2});
    const paused=await until(async()=>{const x=await getTask(t);return x.status==='paused'?x:null;});
    assert.equal(paused.toolCalls,2);assert.equal(paused.roundToolCalls,2);assert.equal(paused.steps,1);
    await req('POST',base+'/tasks/'+t.id,{action:'resume'});
    const done=await settled(t);assert.equal(done.status,'completed');assert.equal(done.toolCalls,4);assert.equal(done.roundToolCalls,2);
    const cycle=await start('LOOP LIMIT',{maxSteps:2});
    const stopped=await until(async()=>{const x=await getTask(cycle);return x.status==='paused'?x:null;});
    assert.equal(stopped.toolCalls,2);assert.equal(stopped.steps,3);
    const final=await settled(await start('LIMIT FINAL',{maxSteps:2}));assert.equal(final.status,'completed');assert.equal(final.toolCalls,2);
  });
  await test('模型截断保留结果并暂停，继续后可以完成',async()=>{
    const t=await start('TRUNCATE');const paused=await until(async()=>{const x=await getTask(t);return x.status==='paused'?x:null;});assert.equal(paused.truncated,true);assert.equal(paused.commits.length,0);
    await req('POST',base+'/tasks/'+t.id,{action:'resume'});assert.equal((await settled(t)).status,'completed');
  });
  await test("多文件提交失败不留下部分改动", async () => {
    const before = await source();
    const result = await fetch(`http://127.0.0.1:${port}${base}/changes`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-CentDeck": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: [
          {
            path: "index.html",
            content: "<h1>partial</h1>",
            baseHash: createHash("sha256").update(before).digest("hex"),
          },
          { path: "second.html", content: "<h1>stale</h1>", baseHash: "bad" },
        ],
      }),
    });
    assert.equal(result.status, 409);
    assert.equal(await source(), before);
  });
  await test("浏览器放映是原始页面加两个控制按钮", async () => {
    const r = await fetch(
      `http://127.0.0.1:${port}/show/${project.id}/index.html`,
      { headers: { Cookie: cookie } },
    );
    const html = await r.text();
    assert.ok(!html.includes("pv-browser"));
    assert.ok(html.includes("centdeck-presentation-controls"));
    assert.ok(!html.includes("<iframe"));
  });
  await test("重启后任务和回答仍可读取", async () => {
    await new Promise((r) => {
      srv.once("exit", r);
      srv.kill();
    });
    await startServer();
    await req("POST", "/api/auth", {
      username: "test-user",
      password: "test-only-password",
    });
    const ts = await req("GET", base + "/tasks");
    assert.ok(ts.some((t) => t.answers.some((a) => a.answer === "明亮")));
  });
  console.log(`Agent 集成：${passed} 组通过`);
} finally {
  pendingSlow?.();
  if (srv?.exitCode === null)
    await new Promise((r) => {
      srv.once("exit", r);
      srv.kill();
    });
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  if (
    path.dirname(tmp) === os.tmpdir() &&
    path.basename(tmp).startsWith("centdeck-runtime-")
  )
    fs.rmSync(tmp, { recursive: true, force: true });
}
