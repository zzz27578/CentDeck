// 一个助手窗口：标题栏（可拖动、停靠 / 弹出）、对话区、输入框（+ 上传与引用、@、技能、模型、思考强度）
import { icon } from "../core/icons.js";
import { el, esc, uid, showMenu, toast } from "../core/ui.js";
import { mark } from "../core/brand.js";
import { avatar, taskStatus } from "./studio.js";
import { refLabel, refKey, mentionItems, describeRefs } from "./refs.js";

import { THINK, normalizeThink } from "../core/reasoning.js";
export { THINK };
export const ROLES = [
  "通用",
  "总览设计",
  "设计师",
  "前端工程师",
  "审查员",
  "移动适配",
];
const EXAMPLES = [
  "把首页大标题改得更有冲击力，别超过 12 个字",
  "让三张功能卡片一样高，间距统一",
  "按全部红色标记逐条修改",
  "整体看看哪里不协调，列一份修改清单",
];

export function createSession(app, mgr, opts) {
  const s = {
    id: opts.id || uid("ag"),
    name: opts.name || "助手",
    role: opts.role || "通用",
    model: opts.model || "auto",
    think: normalizeThink(opts.think),
    avatar: opts.avatar || "centdeck",
    color: opts.color || "#65784e",
    prompt: opts.prompt || "",
    responsibility: opts.responsibility || "",
    skills: opts.skills || [],
    skill: null,
    refs: [],
    msgs: [],
    root: null,
    mode: "plan",
    task: null,
    collaboration: "off",
  };
  const root = el(`<div class="ag">
    <div class="ag-head" data-drag>
      <span class="ag-avatar"></span><b class="ag-name"></b>
      <button class="ag-role" data-a="role" data-tip="这个助手负责什么（多助手协作用）"></button>
      <span class="grow"></span>
      <button class="icon-btn sm" data-a="manage" data-tip="管理所有助手">${icon("layers", 15)}</button><button class="icon-btn sm" data-a="fold" data-tip="折叠窗口">${icon("minus", 15)}</button><button class="icon-btn sm" data-a="new" data-tip="再开一个助手窗口">${icon("plus", 15)}</button>
      <button class="icon-btn sm" data-a="dock" data-tip="停靠到右侧 / 弹出成悬浮窗"></button>
      <button class="icon-btn sm" data-a="settings" data-tip="模型与接口设置">${icon("settings", 15)}</button>
      <button class="icon-btn sm" data-a="clear" data-tip="清空这段对话">${icon("refresh", 14)}</button>
      <button class="icon-btn sm" data-a="close" data-tip="收起" data-kbd="Ctrl+K">${icon("close", 14)}</button>
    </div>
    <button class="ag-summary" data-a="fold"><i></i><span>空闲</span></button><div class="ag-msgs"></div><div class="ag-task" hidden></div>
    <div class="agent-composer">
      <div class="comp-controls"><div class="seg" data-mode><button data-mode-v="plan" class="on">计划</button><button data-mode-v="create">创建</button></div><select aria-label="协作方式" data-collab><option value="off">独立执行</option><option value="confirm">协作前确认</option><option value="auto">自动协作</option></select><select aria-label="修改范围" data-scope><option value="all">全站</option><option value="page">当前页</option></select></div>
      <div class="comp-variants" hidden><label>方案版数 <select aria-label="方案版数"><option value="1">1 版</option><option value="2">2 版</option><option value="3">3 版</option><option value="4">4 版</option></select></label></div><div class="comp-chips"></div>
      <textarea rows="3" aria-label="给助手的任务" placeholder="描述你的设计…"></textarea>
      <div class="comp-bar">
        <button class="icon-btn sm" data-a="plus" data-tip="上传文件、引用页面或元素">${icon("plus", 18)}</button>
        <button class="icon-btn sm" data-a="at" data-tip="@ 引用页面、元素、标记">${icon("at", 17)}</button>
        <button class="comp-pick" data-a="skill" data-tip="选择技能">${icon("book", 14)}<span>技能</span></button>
        <button class="comp-pick" data-a="model" data-tip="选模型">${icon("brain", 14)}<span></span>${icon("chevDown", 12)}</button>
        <button class="comp-pick" data-a="think" data-tip="思考强度">${icon("sparkle", 14)}<span></span>${icon("chevDown", 12)}</button>
        <span class="grow"></span>
        <button class="comp-send" data-a="send" data-tip="发送" data-kbd="Enter">${icon("send", 17)}</button>
      </div>
      <input type="file" multiple hidden>
    </div></div>`);
  s.root = root;
  const q = (sel) => root.querySelector(sel);
  let collaborationTouched=false;
  q('[data-collab]').addEventListener('change',()=>{collaborationTouched=true;});
  app.api.extension('preferences').then(p=>{if(!collaborationTouched&&!s.msgs.length&&!s.task)q('[data-collab]').value=p.collaboration;}).catch(()=>{});
  const ta = q("textarea"),
    fileIpt = q("input[type=file]");

  const grow = () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(260, Math.max(76, ta.scrollHeight)) + "px";
  };
  ta.addEventListener("input", () => {
    grow();
    mgr.saveConversation(s);
  });
  q(".comp-variants select").onchange = () => mgr.saveConversation(s);
  q(".ag-head").ondblclick = (e) => {
    if (!e.target.closest("button")) mgr.fold(s);
  };
  ta.addEventListener("focus", () => mgr.setActive(s));
  root.addEventListener("pointerdown", () => mgr.setActive(s), true);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      ta.blur();
    }
  });
  ta.addEventListener("keyup", (e) => {
    if (e.key === "@") mention(ta);
  });

  function mention(anchor) {
    showMenu(
      mentionItems(app, (r) => addRef(r)),
      0,
      0,
      { anchor, minWidth: 280 },
    );
  }
  function addRef(r) {
    if (!s.refs.some((x) => refKey(x) === refKey(r)))
      s.refs.push({ id: uid("rf"), ...r });
    paintChips();
    mgr.saveConversation(s);
    focus();
  }
  function paintChips() {
    const host = q(".comp-chips");
    host.innerHTML = "";
    const all = [
      ...(s.skill ? [{ kind: "skill", id: "skill" }] : []),
      ...s.refs,
    ];
    host.hidden = !all.length;
    all.forEach((r) => {
      const sk = r.kind === "skill" ? mgr.skill(s.skill) : null;
      const lb = sk ? { icon: sk.icon, text: "技能：" + sk.name } : refLabel(r);
      const chip = el(
        `<span class="comp-chip ${sk ? "skill" : "ctx"}" title="${esc(lb.text)}">${r.url ? `<img src="${r.url}" alt="">` : icon(lb.icon, 13)}<span>${esc(lb.text)}</span>${lb.color ? `<i class="cc-dot" style="background:${lb.color}"></i>` : ""}<button data-tip="移除">${icon("close", 11)}</button></span>`,
      );
      chip.querySelector("button").onclick = () => {
        if (sk) s.skill = null;
        else s.refs = s.refs.filter((x) => x.id !== r.id);
        paintChips();
        mgr.saveConversation(s);
      };
      host.appendChild(chip);
    });
  }
  function paintPickers() {
    q("[data-a=model] span").textContent = mgr.modelLabel(s.model);
    q("[data-a=think] span").textContent = (
      THINK.find((t) => t.id === s.think) || THINK[1]
    ).label;
    q(".ag-name").textContent = s.name;
    q(".ag-avatar").innerHTML = avatar(s, 25);
    q(".ag-avatar").style.color = s.color;
    root.style.setProperty("--assistant-color", s.color);
    q(".comp-variants").hidden = !!app.project()?.pages.length;
    q(".ag-summary span").textContent = s.task
      ? taskStatus(s.task) + " · " + s.task.goal.slice(0, 60)
      : "空闲";
    q("[data-a=role]").textContent = s.role;
    const dk = q("[data-a=dock]");
    dk.innerHTML = icon(mgr.isDocked(s) ? "undock" : "dock", 15);
    dk.setAttribute(
      "data-tip",
      mgr.isDocked(s) ? "弹出成悬浮窗（也可以直接拖标题栏）" : "停靠到右侧",
    );
  }
  function paintMsgs() {
    const host = q(".ag-msgs");
    host.innerHTML = "";
    if (!s.msgs.length) {
      const empty = el(
        `<div class="agent-empty"><div class="ae-mark">${mark(64)}</div></div>`,
      );
      host.appendChild(empty);
      return;
    }
    s.msgs.forEach((m) => {
      const b = el(
        `<div class="msg ${m.role === "user" ? "user" : "sys"}"><div class="msg-body"></div></div>`,
      );
      b.firstChild.textContent = m.text || "";
      host.appendChild(b);
    });
    host.scrollTop = host.scrollHeight;
  }
  async function send() {
    if (
      s.task &&
      ["running", "queued", "waiting_dependency"].includes(s.task.status)
    ) {
      await app.api.taskAction(app.project().id, s.task.id, {
        action: "cancel",
      });
      return;
    }
    let text = ta.value.trim();
    if (text && !app.project()?.pages.length)
      text += `\n\n请出 ${q(".comp-variants select").value} 版方案。`;
    if (!text && !s.refs.length) return;
    const refs = describeRefs(app, s.refs);
    const skillIds = [...new Set([...s.skills, ...(s.skill ? [s.skill] : [])])];
    const request = {
      text,
      prompt: s.prompt,
      skills: skillIds,
      model: s.model,
      think: s.think,
      refs: s.refs.filter((r) => r.kind !== "file").map((r) => ({ ...r })),
    };
    q("[data-a=send]").disabled = true;
    try {
      if ((await app.bus.flushMeta()) === false) return;
      const scope =
        q("[data-scope]").value === "page" && app.state.page
          ? [app.state.page]
          : "all";
      s.task = await app.api.startTask(app.project().id, {
        requestId: uid("req"),
        assistantId: s.id,
        text: text || "请分析这些引用",
        skills: skillIds,
        model: s.model,
        think: s.think,
        refs: s.refs,
        mode: s.mode,
        collaboration: q("[data-collab]").value,
        scope,
        history: s.msgs
          .filter((m) => ["user", "assistant"].includes(m.role))
          .map((m) => ({ role: m.role, content: m.text }))
          .slice(-12),
      });
      s.msgs.push({
        role: "user",
        text: text + (refs.length ? "\n引用：" + refs.join("；") : ""),
        request,
        taskId: s.task.id,
      });
      ta.value = "";
      grow();
      s.refs = [];
      paintChips();
      paintMsgs();
      paintPickers();
      mgr.saveConversation(s);
    } finally {
      q("[data-a=send]").disabled = false;
    }
  }
  function focus() {
    setTimeout(() => ta.focus(), 40);
  }

  root.addEventListener("click", (e) => {
    const mode = e.target.closest("[data-mode-v]");
    if (mode) {
      (async () => {
        s.mode = mode.dataset.modeV;
        if (s.task && !["completed", "cancelled"].includes(s.task.status))
          await app.api.taskAction(app.project().id, s.task.id, {
            action: "mode",
            mode: s.mode,
          });
        root
          .querySelectorAll("[data-mode-v]")
          .forEach((b) => b.classList.toggle("on", b.dataset.modeV === s.mode));
        mgr.saveConversation(s);
      })();
      return;
    }
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const a = b.dataset.a;
    if (a === "send") send();
    if (a === "close") mgr.close(s);
    if (a === "manage") mgr.manage();
    if (a === "fold") mgr.fold(s);
    if (a === "new") mgr.newWindow();
    if (a === "dock") mgr.toggleDock(s);
    if (a === "settings") app.openSettings();
    if (a === "clear") {
      s.msgs = [];
      s.refs = [];
      paintChips();
      paintMsgs();
      paintPickers();
      mgr.saveConversation(s);
    }
    if (a === "at") mention(b);
    if (a === "role")
      showMenu(
        ROLES.map((r) => ({
          label: r,
          checked: r === s.role,
          onClick: () => {
            s.role = r;
            paintPickers();
            mgr.saveProfiles();
          },
        })),
        0,
        0,
        { anchor: b, minWidth: 150 },
      );
    if (a === "think")
      showMenu(
        [
          { title: "思考强度" },
          ...THINK.map((t) => ({
            label: t.label,
            hint: t.hint,
            checked: t.id === s.think,
            onClick: async () => {
              try {
                if (s.task && !["completed", "cancelled"].includes(s.task.status)) {
                  await app.api.taskAction(app.project().id, s.task.id, { action: "think", think: t.id });
                }
              } catch { return; }
              s.think = t.id;
              mgr.saveProfiles();
              paintPickers();
            },
          })),
        ],
        0,
        0,
        { anchor: b, minWidth: 220 },
      );
    if (a === "model")
      mgr.modelMenu(b, s.model, (id) => {
        s.model = id;
        mgr.saveProfiles();
        paintPickers();
      });
    if (a === "skill")
      showMenu(
        [
          { title: "技能" },
          ...mgr.skills().map((k) => ({
            label: k.name,
            hint: k.desc,
            icon: k.icon,
            checked: s.skill === k.id,
            onClick: () => {
              s.skill = s.skill === k.id ? null : k.id;
              paintChips();
              mgr.saveConversation(s);
              focus();
            },
          })),
        ],
        0,
        0,
        { anchor: b, minWidth: 300 },
      );
    if (a === "plus") {
      const info = app.view() === "edit" && app.editor.selection;
      showMenu(
        [
          {
            label: "上传文件或图片",
            icon: "upload",
            hint: "参考图、截图、文档都可以",
            onClick: () => fileIpt.click(),
          },
          {
            label: "引用当前页面",
            icon: "file",
            disabled: !app.state.page,
            onClick: () =>
              addRef({
                kind: "page",
                page: app.state.page,
                title:
                  (
                    app
                      .project()
                      .pages.find((p) => p.file === app.state.page) || {}
                  ).title || app.state.page,
              }),
          },
          {
            label: info
              ? `引用选中元素 ${app.editor.describe(info)}`
              : "引用选中元素（先在编辑里选一个）",
            icon: "target",
            disabled: !info,
            onClick: () =>
              addRef({
                kind: "element",
                page: app.state.page,
                selector: info.selector,
                line: info.line,
                title: app.editor.describe(info),
              }),
          },
          {
            label: "@ 更多（页面、标记编号、颜色）…",
            icon: "at",
            onClick: () => mention(b),
          },
        ],
        0,
        0,
        { anchor: b, minWidth: 290 },
      );
    }
  });
  async function addFile(f) {
    if (s.refs.filter((r) => r.kind === "file").length >= 4) {
      toast("一次最多 4 个参考文件", "err");
      return;
    }
    if (/^image\/(png|jpeg|webp)$/.test(f.type)) {
      if (f.size > 4 * 1024 * 1024) {
        toast("图片请控制在 4 MB 以内", "err");
        return;
      }
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(f);
      });
      addRef({ kind: "file", name: f.name, size: f.size, url: data });
    } else if (/\.(txt|md|html?|css|js|json)$/i.test(f.name) && f.size < 128000)
      addRef({
        kind: "file",
        name: f.name,
        size: f.size,
        text: await f.text(),
      });
    else toast("支持 PNG、JPG、WebP 图片或 128 KB 内的文本文件", "err");
  }
  fileIpt.onchange = async () => {
    for (const f of fileIpt.files) await addFile(f);
    fileIpt.value = "";
  };
  root.addEventListener("dragover", (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) {
      e.preventDefault();
      root.classList.add("drop");
    }
  });
  root.addEventListener("dragleave", (e) => {
    if (!root.contains(e.relatedTarget)) root.classList.remove("drop");
  });
  root.addEventListener("drop", async (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    root.classList.remove("drop");
    for (const f of e.dataTransfer.files) await addFile(f);
  });

  Object.assign(s, {
    syncTasks(tasks) {
      const own = tasks.filter((t) => t.assistantId === s.id);
      s.task = own.at(-1) || null;
      let changed = false;
      for (const t of own) {
        if (t.output) {
          let m = s.msgs.find(
            (x) => x.role === "assistant" && x.taskId === t.id,
          );
          if (!m) {
            m = { role: "assistant", taskId: t.id, text: t.output };
            s.msgs.push(m);
            changed = true;
          } else if (m.text !== t.output) {
            m.text = t.output;
            changed = true;
          }
        }
      }
      if (changed) {
        paintMsgs();
        mgr.saveConversation(s);
      }
      paintPickers();
      const t = s.task,
        box = q(".ag-task");
      box.hidden = !t;
      if (!t) return;
      box.innerHTML = `<button data-tasks><span class="task-state ${t.status}">${taskStatus(t)}</span><span>${t.steps} 步 · ${t.usage == null ? "用量未提供" : t.usage + " tokens"}</span>${icon("chevRight", 14)}</button>${t.error ? `<p>${esc(t.error)}</p>` : ""}${t.question ? `<button class="task-question-button">${esc(t.question.question)}</button>` : ""}`;
      box
        .querySelectorAll("button")
        .forEach((b) => (b.onclick = () => app.openSettings("tasks")));
      const running = ["running", "queued", "waiting_dependency"].includes(
        t.status,
      );
      q("[data-a=send]").innerHTML = icon(running ? "rect" : "send", 17);
      q("[data-a=send]").setAttribute(
        "aria-label",
        running ? "停止任务" : "发送",
      );
    },
    addRef,
    focus,
    paintPickers,
    conversation() {
      return {
        msgs: s.msgs.slice(-100),
        refs: s.refs.filter((r) => r.kind !== "file"),
        skill: s.skill,
        draft: ta.value,
        mode: s.mode,
        collaboration: q("[data-collab]").value,
        count: +q(".comp-variants select").value,
      };
    },
    restore(data = {}) {
      s.msgs = Array.isArray(data.msgs) ? data.msgs : [];
      s.refs = Array.isArray(data.refs) ? data.refs : [];
      s.skill = data.skill || null;
      s.mode = data.mode === "create" ? "create" : "plan";
      q("[data-collab]").value = data.collaboration || "off";
      root
        .querySelectorAll("[data-mode-v]")
        .forEach((b) => b.classList.toggle("on", b.dataset.modeV === s.mode));
      s.task = null;
      ta.value = data.draft || "";
      q(".comp-variants select").value = [1, 2, 3, 4].includes(data.count)
        ? data.count
        : 1;
      paintChips();
      paintMsgs();
      paintPickers();
      grow();
    },
    prefill(text, o = {}) {
      ta.value = text;
      grow();
      if (o.skill) s.skill = o.skill;
      paintChips();
      mgr.saveConversation(s);
      focus();
    },
    reset() {
      s.msgs = [];
      s.refs = [];
      s.skill = null;
      paintChips();
      paintMsgs();
    },
    blur() {
      if (root.contains(document.activeElement)) document.activeElement.blur();
    },
  });
  paintPickers();
  paintChips();
  paintMsgs();
  return s;
}
