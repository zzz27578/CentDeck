/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { parse } from "../app/js/engine/parse.js";
import { applyEdit, parseStyle } from "../app/js/engine/writeback.js";
import { offsetTranslation } from "../app/js/engine/css.js";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "centdeck-reliability-"));
process.env.CENTDECK_CONFIG_DIR = path.join(temp, "config");
process.env.CENTDECK_PROJECTS_DIR = path.join(temp, "projects");
const require = createRequire(import.meta.url),
  store = require("../server/store"),
  changes = require("../server/changes");

const p = store.createProject({ blank: true, name: "history" });
store.addPage(p.id, {
  file: "index.html",
  title: "Original title",
  content: "<h1>A</h1>",
});
const first = store.writeProjectFile(p.id, {
  path: "index.html",
  content: "<h1>B</h1>",
});
const restored = store.restoreHistory(p.id, first.hid);
assert.equal(store.readProjectFile(p.id, "index.html"), "<h1>A</h1>");
assert(
  store
    .listHistory(p.id)
    .some(
      (h) =>
        fs.readFileSync(
          path.join(store.projectDir(p.id), ".centdeck/history", h.hid, h.file),
          "utf8",
        ) === "<h1>B</h1>",
    ),
);
changes.undo(p.id, restored.changeId);
assert.equal(store.readProjectFile(p.id, "index.html"), "<h1>B</h1>");
store.removePage(p.id, "index.html");
const deleted = store
  .listHistory(p.id)
  .find(
    (h) =>
      h.page?.title === "Original title" &&
      fs.readFileSync(
        path.join(store.projectDir(p.id), ".centdeck/history", h.hid, h.file),
        "utf8",
      ) === "<h1>B</h1>",
  );
store.restoreHistory(p.id, deleted.hid);
assert.equal(store.getProject(p.id).pages[0].title, "Original title");
for (let n = 0; n < 25; n++)
  store.writeProjectFile(p.id, {
    path: "index.html",
    content: "<h1>Version " + n + "</h1>",
  });
const oldest = store.listHistory(p.id).at(-1);
const oldContent = fs.readFileSync(
  path.join(
    store.projectDir(p.id),
    ".centdeck/history",
    oldest.hid,
    oldest.file,
  ),
  "utf8",
);
store.restoreHistory(p.id, oldest.hid);
assert.equal(store.readProjectFile(p.id, "index.html"), oldContent);
assert(store.listHistory(p.id).length <= 20);

const src = `<!doctype html><div style="background-image:url(data:image/svg+xml;base64,PHN2Zy8+);--Label:'A;B:C';--Payload:{x:y;z:w};font-family:&quot;A;B&quot;,serif;color:red">Card</div>`;
const edit = applyEdit(src, {
  kind: "style",
  target: 0,
  props: { "font-size": "20px" },
});
const pairs = Object.fromEntries(
  parseStyle(parse(edit.newSource).elements[0].style),
);
assert.equal(
  pairs["background-image"],
  "url(data:image/svg+xml;base64,PHN2Zy8+)",
);
assert.equal(pairs["--Label"], "'A;B:C'");
assert.equal(pairs["--Payload"], "{x:y;z:w}");
assert.equal(pairs["font-family"], '"A;B",serif');
const bare = applyEdit("<div style=color:red>Card</div>", {
  kind: "style",
  target: 0,
  props: { color: "blue" },
});
assert.equal(parse(bare.newSource).elements[0].style, "color: blue;");
const shared =
  '<style>@media(max-width:600px){.card{color:red}}.card{color:blue}</style><p class="card">A</p><p class="card">B</p>';
const result = applyEdit(shared, {
  kind: "style",
  target: 0,
  scope: "class",
  props: { color: "green" },
});
assert(result.newSource.includes("@media(max-width:600px){.card{color:red}}"));
assert(result.newSource.includes(".card{ color: green; }"));
const mobileShared = applyEdit(shared, {
  kind: "style",
  target: 0,
  scope: "class",
  media: 767,
  props: { color: "pink" },
});
assert(mobileShared.newSource.includes(".card { color: pink !important; }"));
assert(mobileShared.newSource.includes(".card{color:blue}"));
assert.equal(
  applyEdit("<style>h1{translate:100px}</style><h1>Title</h1>", {
    kind: "move",
    target: 0,
    dx: 10,
    dy: 0,
  }).light,
  "red",
);
assert.equal(offsetTranslation("50% 0", 10, 0), "calc(50% + 10px) 0px");
assert.equal(
  offsetTranslation("calc(50% - 12px) 2rem", 10, -4),
  "calc(calc(50% - 12px) + 10px) calc(2rem - 4px)",
);
const moved = applyEdit("<h1>Title</h1>", {
  kind: "move",
  target: 0,
  baseTranslate: "100px 20px",
  dx: 10,
  dy: 0,
});
assert.equal(
  parse(moved.newSource).elements[0].style,
  "translate: 110px 20px;",
);

// Abort a pending model request before deleting its project; the scheduler survives.
const providers = require("../server/providers"),
  resolve = providers.resolve,
  complete = providers.complete;
let entered;
const started = new Promise((r) => (entered = r));
providers.resolve = () => ({
  provider: { id: "fixture", enabled: true, tools: true },
  model: "test",
});
providers.complete = async (_model, _messages, _tools, _think, signal) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(new Error("Request cancelled")),
      { once: true },
    );
    entered();
  });
const tasks = require("../server/tasks");
try {
  const project = store.createProject({ blank: true, name: "delete-running" });
  tasks.start(project.id, {
    assistantId: "assistant-default",
    model: "fixture:test",
    mode: "create",
    text: "Inspect the project",
  });
  await started;
  const target = path.resolve(store.projectDir(project.id));
  assert(target.startsWith(path.resolve(temp) + path.sep));
  await store.deleteProject(project.id);
  assert(!fs.existsSync(target));
  const replacement = store.createProject({
    blank: true,
    name: "delete-running",
  });
  assert.equal(replacement.id, project.id);
  providers.complete = async () => ({
    message: { role: "assistant", content: "OK" },
  });
  const next = tasks.start(replacement.id, {
    assistantId: "assistant-default",
    model: "fixture:test",
    mode: "create",
    text: "Inspect the replacement",
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(
    tasks.list(replacement.id).find((t) => t.id === next.id).status,
    "completed",
  );
} finally {
  providers.resolve = resolve;
  providers.complete = complete;
}
console.log(
  "Reliability: reversible history/deleted-page recovery, history eviction, CSS grammar/media targeting, translation units and active-project deletion passed",
);
