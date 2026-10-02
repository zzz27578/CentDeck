/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { browser } from "./browser-driver.mjs";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "centdeck-isolation-"));
const config = path.join(temp, "config"),
  projects = path.join(temp, "projects");
fs.mkdirSync(config);
fs.mkdirSync(projects);
const account = {
  username: "audit",
  password: "audit-fixture-password",
  mustChange: false,
};
fs.writeFileSync(path.join(config, "account.json"), JSON.stringify(account));
let server, ui;
try {
  server = spawn(process.execPath, ["server/server.js"], {
    env: {
      ...process.env,
      PORT: "8488",
      CENTDECK_NO_OPEN: "1",
      CENTDECK_CONFIG_DIR: config,
      CENTDECK_PROJECTS_DIR: projects,
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Server startup timed out")),
      10000,
    );
    server.stdout.on("data", (data) => {
      const match = String(data).match(/localhost:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(+match[1]);
      }
    });
  });
  const origin = "http://127.0.0.1:" + port;
  const login = await fetch(origin + "/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CentDeck": "1" },
    body: JSON.stringify(account),
  });
  assert(login.ok);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  async function request(method, url, body) {
    const response = await fetch(origin + url, {
      method,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-CentDeck": "1",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    assert(response.ok, result.error);
    return result.data;
  }
  const victim = await request("POST", "/api/projects", {
    blank: true,
    name: "isolated-victim",
  });
  await request("POST", "/api/projects/" + victim.id + "/pages", {
    file: "index.html",
    title: "Protected",
    content: "<h1>UNCHANGED</h1>",
  });
  const project = await request("POST", "/api/projects", {
    blank: true,
    name: "isolated-runtime",
  });
  await request("POST", "/api/projects/" + project.id + "/pages", {
    file: "index.html",
    title: "Runtime",
    content:
      "<!doctype html><h1>Runtime</h1><button onclick=\"this.textContent='Wire clicked'\">Wire button</button><label>Wire name<input oninput=\"document.querySelector('output').textContent=this.value\"></label><output></output>",
  });
  ui = await browser(path.join(temp, "browser"));
  const split = cookie.indexOf("=");
  await ui.call("Network.setCookie", {
    url: origin,
    name: cookie.slice(0, split),
    value: cookie.slice(split + 1),
  });
  await ui.call("Page.navigate", {
    url: origin + "/?project=" + project.id + "&view=edit&page=index.html",
  });
  await ui.until(
    "!!document.querySelector('.pf.on')?.contentDocument?.querySelector('h1')",
  );
  const attack = `<!doctype html><html><body><p id="status">Starting</p><button id="counter" onclick="this.textContent='Count 1'">Count 0</button><label>Name<input id="name"></label><output id="result"></output><script>
    document.getElementById('status').textContent='Scripts executed';
    document.getElementById('name').oninput=e=>document.getElementById('result').textContent=e.target.value;
    try {top.document.body.dataset.compromised='yes';}catch{}
    fetch(${JSON.stringify(origin + "/api/projects/" + victim.id + "/file")},{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json','X-CentDeck':'1'},body:JSON.stringify({path:'index.html',content:'<h1>COMPROMISED</h1>'})}).catch(()=>{});
    </script></body></html>`;
  const base = "/preview/" + project.id + "/";
  await ui.evaluate(
    `(async()=>{const {createFrame}=await import('/app/js/engine/frame.js');const host=document.createElement('div');host.className='device';host.style.cssText='position:fixed;left:-20000px;top:0;width:800px;height:600px';document.body.append(host);window.auditHost=host;window.auditFrame=createFrame(host,{baseHref:${JSON.stringify(base)}});await auditFrame.render(${JSON.stringify(attack)});})()`,
  );
  assert.equal(
    await ui.evaluate("auditFrame.doc.querySelector('#status').textContent"),
    "Scripts executed",
  );
  assert.equal(
    await ui.evaluate("document.body.dataset.compromised || ''"),
    "",
  );
  assert.equal(
    (
      await request(
        "GET",
        "/api/projects/" + victim.id + "/file?path=index.html",
      )
    ).content,
    "<h1>UNCHANGED</h1>",
  );
  assert.equal(
    await ui.evaluate("auditFrame.iframe.getAttribute('sandbox')"),
    "allow-same-origin",
  );
  const runtimeOrigin = await ui.evaluate("auditFrame.runtime.origin");
  assert.notEqual(runtimeOrigin, origin);
  const otherOrigin = (
    await request(
      "GET",
      "/api/preview?base=" + encodeURIComponent("/preview/" + victim.id + "/"),
    )
  ).origin;
  assert.notEqual(runtimeOrigin, otherOrigin);
  assert.equal(
    (await fetch(runtimeOrigin + "/preview/" + victim.id + "/index.html"))
      .status,
    404,
  );
  const action = await ui.evaluate(
    `(async()=>{const runtime=auditFrame.runtime;const button=runtime.state.controls.find(c=>c.label==='Count 0');await runtime.action({action:'click',target:button.id});const input=runtime.state.controls.find(c=>c.tag==='input');await runtime.action({action:'fill',target:input.id,value:'Safe interaction'});return runtime.state;})()`,
  );
  assert(action.text.includes("Count 1"));
  assert(action.text.includes("Safe interaction"));
  await ui.evaluate("auditFrame.setInteractive(false)");
  await ui.until(
    "auditFrame.doc.querySelector('#counter')?.textContent==='Count 1'",
  );
  const concurrent = await ui.evaluate(
    "(async()=>{const first=auditFrame.render('<h1>First</h1>');const second=auditFrame.render('<h1>Second</h1>');return Promise.all([first,second]);})()",
  );
  assert.deepEqual(concurrent, [false, true]);
  assert.equal(
    await ui.evaluate("auditFrame.doc.querySelector('h1').textContent"),
    "Second",
  );
  const samples = ["<h1>A</h1>", "<h1>B</h1>", "<h1>C</h1>"];
  for (const html of samples) {
    assert(await ui.evaluate(`auditFrame.render(${JSON.stringify(html)})`));
    assert.equal(
      await ui.evaluate(
        "auditFrame.doc.querySelector('h1').outerHTML.includes('>'+" +
          JSON.stringify(html.slice(4, 5)) +
          "+'</h1>')",
      ),
      true,
    );
  }
  const styleSource =
    '<style>body{margin:0}#title{translate:100px 20px;margin:0}</style><h1 id="title" style="background-image:url(data:image/svg+xml;base64,PHN2Zy8+)">Title</h1>';
  const translated = await ui.evaluate(
    `(async()=>{await auditFrame.render(${JSON.stringify(styleSource)});const {applyEdit}=await import('/app/js/engine/writeback.js');const e=auditFrame.doc.querySelector('h1'),before=e.getBoundingClientRect().x;const edit=applyEdit(auditFrame.source,{kind:'move',target:0,dx:10,dy:0,baseTranslate:auditFrame.win.getComputedStyle(e).translate});await auditFrame.render(edit.newSource);return {before,after:auditFrame.doc.querySelector('h1').getBoundingClientRect().x,background:auditFrame.doc.querySelector('h1').style.backgroundImage};})()`,
  );
  assert.equal(translated.before, 100);
  assert.equal(translated.after, 110);
  assert(translated.background.includes(";base64,"));
  assert.equal(
    await ui.evaluate(
      "(()=>{const pending=auditFrame.render('<h1>Destroyed</h1>');auditFrame.destroy();auditHost.remove();return pending;})()",
    ),
    false,
  );
  const connection = await request("PUT", "/api/mcp/config", {
    enabled: true,
    mode: "create",
  });
  let session = "",
    rpcId = 0;
  async function rpc(method, params = {}) {
    const response = await fetch(origin + "/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + connection.token,
        ...(session ? { "Mcp-Session-Id": session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    session = response.headers.get("mcp-session-id") || session;
    const payload = await response.json();
    assert(!payload.error, JSON.stringify(payload.error));
    return payload.result;
  }
  await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "isolated-preview-test", version: "1" },
  });
  async function tool(name, args) {
    const result = await rpc("tools/call", { name, arguments: args });
    assert(!result.isError, result.content[0].text);
    return JSON.parse(result.content[0].text);
  }
  const states = await tool("ui_state", { projectId: project.id });
  const client = states.find((state) =>
    state.preview?.controls.some((control) => control.label === "Wire button"),
  );
  assert(client, "Isolated preview controls are published to MCP");
  let wire = await tool("ui_action", {
    projectId: project.id,
    clientId: client.clientId,
    action: "click",
    target: client.preview.controls.find(
      (control) => control.label === "Wire button",
    ).id,
  });
  assert(wire.preview.text.includes("Wire clicked"));
  wire = await tool("ui_action", {
    projectId: project.id,
    clientId: client.clientId,
    action: "fill",
    target: wire.preview.controls.find((control) => control.tag === "input").id,
    value: "Filled over MCP",
  });
  assert(wire.preview.text.includes("Filled over MCP"));
  const shots = path.resolve("artifacts/screenshots/reliability");
  fs.mkdirSync(shots, { recursive: true });
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["narrow", 393, 852],
  ]) {
    await ui.call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await ui
      .call("Page.captureScreenshot", { format: "png" })
      .then((r) =>
        fs.writeFileSync(
          path.join(shots, name + ".png"),
          Buffer.from(r.data, "base64"),
        ),
      );
  }
  assert.equal(ui.errors.length, 0, ui.errors.join("\n"));
  console.log(
    "Browser reliability: isolated script execution, denied cross-project writes/DOM access, interactive controls, scriptless snapshots, render cancellation/destroy and CSS drag fidelity passed",
  );
} finally {
  if (ui) await ui.close();
  if (server?.exitCode === null) server.kill();
}
