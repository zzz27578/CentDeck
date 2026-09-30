import { renderExtensions } from './extensions-page.js';
import { THINK, normalizeThink } from "../core/reasoning.js";
import { el, esc, uid, toast, confirmDlg } from "../core/ui.js";
import { icon } from "../core/icons.js";
import { mark, theme, setTheme } from "../core/brand.js";
export const ROLES = [
  "通用",
  "总览设计",
  "视觉设计师",
  "前端工程师",
  "交互设计师",
  "移动适配",
  "审查员",
  "品牌设计",
  "无障碍检查",
];
const states = {
  queued: "排队中",
  running: "执行中",
  checking: "检查中",
  waiting_user: "等待回答",
  waiting_authorization: "等待协作授权",
  waiting_dependency: "等待依赖",
  completed: "完成",
  failed: "失败",
  paused: "已暂停",
  cancelled: "已停止",
  conflict: "版本冲突",
};
export const taskStatus = (t) => states[t.status] || t.status;
export function avatar(a, size = 28) {
  return a.avatar?.startsWith("data:image/")
    ? `<img src="${esc(a.avatar)}" alt="${esc(a.name)}" width="${size}" height="${size}">`
    : mark(size);
}
let closeOpened = null;
export async function openStudio(app, section = "assistants") {
  closeOpened?.();
  await app.agent.ready;
  const mgr = app.agent.manager;
  let settings = await app.api.getSettings(),
    current = section || "assistants",
    off = () => {};
  const host = el(
    `<section class="studio" role="dialog" aria-modal="true" aria-label="Agent 工作台"><aside class="studio-nav"><div class="wordmark">${mark(38)}<b>CentDeck</b></div><div class="studio-nav-main"><button data-tab="assistants">${icon("centdeck", 20)}助手</button><button data-tab="providers">${icon("layers", 20)}模型提供商</button><button data-tab="tasks">${icon("check", 20)}任务</button><button data-tab="plugins">${icon("layers",20)}插件</button><button data-tab="skills">${icon("book",20)}Skills</button><button data-tab="tools">${icon("code",20)}工具注册</button><button data-tab="mcp">${icon("link",20)}MCP 接管</button></div><button data-tab="general">${icon("settings", 20)}设置</button><a href="https://github.com/zzz27578/CentDeck" target="_blank" rel="noopener">GitHub ↗</a></aside><main class="studio-main"><header><div><span class="studio-overline">AGENT STUDIO</span><h1></h1></div><button class="icon-btn" data-close aria-label="关闭 Agent 工作台">${icon("close", 22)}</button></header><div class="studio-content"></div></main></section>`,
  );
  document.body.appendChild(host);
  const content = host.querySelector(".studio-content");
  const previousFocus = document.activeElement,
    previousInert = [...document.body.children]
      .filter((n) => n !== host && !n.classList.contains("toast-host"))
      .map((n) => [n, n.inert]);
  previousInert.forEach(([n]) => (n.inert = true));
  const close = () => {
    off();
    host.remove();
    closeOpened = null;
    previousInert.forEach(([n, v]) => (n.inert = v));
    previousFocus?.focus();
  };
  closeOpened = close;
  host.querySelector("[data-close]").onclick = close;
  host.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
    if (e.key === "Tab") {
      const all = [
          ...host.querySelectorAll("button,input,textarea,select,a[href]"),
        ].filter((n) => !n.disabled && n.offsetParent),
        first = all[0],
        last = all.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  });
  const models = () =>
    settings.providers
      .filter((p) => p.enabled)
      .flatMap((p) =>
        p.models.map((m) => ({ id: p.id + ":" + m, name: p.name + " / " + m })),
      );
  const modelOptions = (value) =>
    `<option value="auto">默认模型</option>${models()
      .map(
        (m) =>
          `<option value="${esc(m.id)}" ${m.id === value ? "selected" : ""}>${esc(m.name)}</option>`,
      )
      .join("")}`;
  function nav() {
    off();
    off = () => {};
    host
      .querySelectorAll("[data-tab]")
      .forEach((b) => b.classList.toggle("on", b.dataset.tab === current));
    host.querySelector("h1").textContent = {
      assistants: "你的创作团队",
      providers: "连接你的模型",
      tasks: "正在发生",
      general: "偏好设置", plugins: "插件管理", skills: "Agent 技能", tools: "工具注册表", mcp: "MCP 与外部助手",
    }[current];
    content.innerHTML = "";
    if (current === "assistants") assistants();
    if (current === "providers") providers();
    if (current === "tasks") tasks();
    if (current === "general") general();
    if(['plugins','skills','tools','mcp'].includes(current)){const slot=el('<div class="extension-slot"></div>');content.append(slot);renderExtensions(app,slot,current).catch(e=>toast(e.message,'error'));}
  }
  host.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        current = b.dataset.tab;
        nav();
      }),
  );
  function assistants() {
    content.innerHTML = `<div class="studio-toolbar"><span>${mgr.sessions().length} 位助手</span><button class="btn primary" data-new>${icon("plus", 16)}新建助手</button></div><div class="assistant-grid"></div>`;
    content.querySelector("[data-new]").onclick = () => editAssistant(null);
    for (const a of mgr.sessions()) {
      const card = el(
        `<button class="assistant-tile"><span class="studio-avatar" style="--assistant-color:${a.color}">${avatar(a, 44)}</span><h2>${esc(a.name)}</h2><p>${esc(a.role || "通用")}</p><span class="tile-duty">${esc(a.responsibility || "")}</span><footer><span>${esc(mgr.modelLabel(a.model))}</span><span>↗</span></footer></button>`,
      );
      card.onclick = () => editAssistant(a);
      content.querySelector(".assistant-grid").appendChild(card);
    }
  }
  function editAssistant(existing) {
    const a = {
      id: uid("ag"),
      name: "新助手",
      role: "通用",
      avatar: "centdeck",
      color: "#65784e",
      prompt: "",
      responsibility: "",
      skills: [],
      model: "auto",
      think: "medium",
      ...existing,
    };
    content.innerHTML = `<button class="text-back">← 所有助手</button><form class="studio-form"><div class="assistant-profile"><button type="button" class="studio-avatar upload-avatar" aria-label="上传助手头像">${avatar(a, 62)}<span>上传</span></button><input type="file" accept="image/png,image/jpeg,image/webp" hidden><div><label>名字<input name="name" required maxlength="60" value="${esc(a.name)}"></label><label>角色<input name="role" list="role-presets" maxlength="80" value="${esc(a.role)}"></label><datalist id="role-presets">${ROLES.map((r) => `<option value="${r}">`).join("")}</datalist></div></div><label>任务定位<input name="responsibility" value="${esc(a.responsibility || "")}" maxlength="4000" placeholder="例如：只处理红色标记"></label><div class="studio-two"><label>模型<select name="model">${modelOptions(a.model)}</select></label><label>思考强度<select name="think">${THINK.map(t => [t.id, t.label])
      .map(
        ([id, n]) =>
          `<option value="${id}" ${normalizeThink(a.think) === id ? "selected" : ""}>${n}</option>`,
      )
      .join(
        "",
      )}</select></label></div><label>默认提示词<textarea name="prompt" rows="5" maxlength="16000">${esc(a.prompt)}</textarea></label><fieldset><legend>Skills</legend><div class="skill-grid">${mgr
      .skills()
      .map(
        (s) =>
          `<label><input type="checkbox" name="skills" value="${s.id}" ${a.skills.includes(s.id) ? "checked" : ""}>${esc(s.name)}</label>`,
      )
      .join(
        "",
      )}</div></fieldset><div class="studio-form-actions"><button type="submit" class="btn primary">保存助手</button>${existing && app.project() ? '<button type="button" class="btn" data-window>打开对话</button>' : ""}${existing ? '<button type="button" class="btn ghost danger" data-delete>删除</button>' : ""}</div></form>`;
    content.querySelector(".text-back").onclick = assistants;
    const form = content.querySelector("form"),
      ipt = form.querySelector("[type=file]");
    form.querySelector(".upload-avatar").onclick = () => ipt.click();
    ipt.onchange = async () => {
      const f = ipt.files[0];
      if (!f) return;
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
        f.size > 5 * 1024 * 1024
      ) {
        toast("请选择 5 MB 以内的 PNG、JPG 或 WebP", "err");
        return;
      }
      let url;
      try {
        url = URL.createObjectURL(f);
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 256;
        const ctx = canvas.getContext("2d"),
          n = Math.min(img.width, img.height);
        ctx.drawImage(
          img,
          (img.width - n) / 2,
          (img.height - n) / 2,
          n,
          n,
          0,
          0,
          256,
          256,
        );
        a.avatar = canvas.toDataURL("image/webp", 0.85);
        form.querySelector(".upload-avatar").innerHTML =
          avatar(a, 62) + "<span>更换</span>";
      } catch {
        toast("头像无法读取", "err");
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      for (const k of [
        "name",
        "role",
        "responsibility",
        "model",
        "think",
        "prompt",
      ])
        a[k] = data.get(k);
      a.skills = data.getAll("skills");
      const btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        if (existing) {
          const before = { ...existing };
          Object.assign(existing, a);
          try {
            await mgr.saveProfiles();
          } catch (e) {
            Object.assign(existing, before);
            throw e;
          }
          existing.paintPickers();
        } else await mgr.createProfile(a);
        toast("助手已保存", "ok");
        assistants();
      } finally {
        btn.disabled = false;
      }
    };
    form.querySelector("[data-window]")?.addEventListener("click", () => {
      close();
      mgr.show(existing);
    });
    form.querySelector("[data-delete]")?.addEventListener("click", async () => {
      if (
        await confirmDlg({
          title: "删除助手",
          body: `删除「${esc(existing.name)}」的配置？项目任务记录仍保留。`,
          danger: true,
        })
      ) {
        await mgr.remove(existing);
        assistants();
      }
    });
  }
  function providers() {
    content.innerHTML = `<div class="studio-toolbar"><label class="default-model">默认模型<select>${modelOptions(settings.defaultModel)}</select></label><button class="btn primary" data-new>${icon("plus", 16)}添加提供商</button></div><div class="provider-list"></div>`;
    const sel = content.querySelector("select");
    sel.value = settings.defaultModel || "auto";
    sel.onchange = async () => {
      settings = await app.api.saveSettings({
        providers: [],
        defaultModel: sel.value === "auto" ? "" : sel.value,
      });
      app.bus.emit("settings");
    };
    content.querySelector("[data-new]").onclick = () => editProvider(null);
    if (!settings.providers.length)
      content.querySelector(".provider-list").innerHTML =
        '<div class="studio-empty">' +
        mark(74) +
        "<h2>连接一个模型，开始创作。</h2></div>";
    for (const p of settings.providers) {
      const row = el(
        `<button class="provider-row"><span class="provider-symbol">${icon("layers", 24)}</span><span><b>${esc(p.name)}</b><small>${esc(p.baseUrl || "")}</small></span><span class="provider-count">${p.models.length} 个模型</span><span class="status-dot ${p.enabled ? "active" : ""}"></span>${icon("chevRight", 18)}</button>`,
      );
      row.onclick = () => editProvider(p);
      content.querySelector(".provider-list").appendChild(row);
    }
  }
  function editProvider(existing) {
    let p = {
      id: uid("provider"),
      name: "自定义提供商",
      baseUrl: "",
      enabled: true,
      noKey: false,
      models: [],
      reasoning: false,
      tools: true,
      ...existing,
    };
    let discovered = p.models.slice();
    content.innerHTML = `<button class="text-back">← 所有提供商</button><form class="studio-form"><div class="provider-presets">${settings.presets.map((x) => `<button type="button" data-preset="${x.id}">${esc(x.name)}</button>`).join("")}</div><div class="studio-two"><label>名称<input name="name" required value="${esc(p.name)}" maxlength="80"></label><label>协议<select disabled><option>OpenAI 兼容 /v1</option></select></label></div><label>API 地址<input name="baseUrl" type="url" required placeholder="https://api.example.com/v1" value="${esc(p.baseUrl)}"></label><label>API Key<input name="apiKey" type="password" autocomplete="off" placeholder="${p.hasKey ? "已保存 " + esc(p.keyHint) + "，留空保留" : "sk-…"}"></label><div class="provider-options"><label><input type="checkbox" name="enabled" ${p.enabled ? "checked" : ""}>启用</label><label><input type="checkbox" name="noKey" ${p.noKey ? "checked" : ""}>无需密钥</label><label><input type="checkbox" name="tools" ${p.tools !== false ? "checked" : ""}>工具调用</label></div><label class="provider-vision"><input type="checkbox" name="vision" ${p.vision ? "checked" : ""}> 图片能力</label><div class="model-heading"><h2>模型</h2><button class="btn" type="button" data-fetch>${icon("refresh", 15)}获取模型</button></div><div class="model-add"><input placeholder="模型 ID" aria-label="模型 ID"><button type="button" class="btn" data-add>添加</button></div><input class="model-search" placeholder="搜索模型" aria-label="搜索模型"><div class="model-checklist"></div><p class="provider-result" role="status"></p><div class="studio-form-actions"><button class="btn primary" type="submit">保存提供商</button>${existing ? '<button type="button" class="btn ghost" data-clear>清除密钥</button><button type="button" class="btn ghost danger" data-delete>删除</button>' : ""}</div></form>`;
    const form = content.querySelector("form");
    content.querySelector(".text-back").onclick = providers;
    const collect = () => {
      const f = new FormData(form);
      for (const k of ["name", "baseUrl", "apiKey"]) p[k] = f.get(k);
      for (const k of ["enabled", "noKey", "tools", "vision"])
        p[k] = f.has(k);
      return p;
    };
    const paint = () => {
      const q = form.querySelector(".model-search").value.toLowerCase();
      form.querySelector(".model-checklist").innerHTML = discovered
        .filter((m) => m.toLowerCase().includes(q))
        .map(
          (m) =>
            `<label><input type="checkbox" value="${esc(m)}" ${p.models.includes(m) ? "checked" : ""}><span>${esc(m)}</span></label>`,
        )
        .join("");
      form.querySelectorAll(".model-checklist input").forEach(
        (b) =>
          (b.onchange = () => {
            p.models = b.checked
              ? [...new Set([...p.models, b.value])]
              : p.models.filter((x) => x !== b.value);
          }),
      );
    };
    paint();
    form.querySelector(".model-search").oninput = paint;
    form.querySelectorAll("[data-preset]").forEach(
      (b) =>
        (b.onclick = () => {
          const d = settings.presets.find((x) => x.id === b.dataset.preset);
          form.elements.name.value = d.name;
          form.elements.baseUrl.value = d.baseUrl;
          form.elements.noKey.checked = !!d.noKey;
        }),
    );
    form.querySelector("[data-add]").onclick = () => {
      const i = form.querySelector(".model-add input"),
        m = i.value.trim();
      if (!m) return;
      p.models = [...new Set([...p.models, m])];
      discovered = [...new Set([...discovered, m])];
      i.value = "";
      paint();
    };
    async function save() {
      settings = await app.api.saveSettings({ providers: [collect()] });
      p = { ...p, ...settings.providers.find((x) => x.id === p.id) };
      form.elements.apiKey.value = "";
      delete p.apiKey;
      app.bus.emit("settings");
    }
    form.querySelector("[data-fetch]").onclick = async (e) => {
      if (!form.reportValidity()) return;
      const b = e.currentTarget;
      b.disabled = true;
      try {
        await save();
        const r = await app.api.models(p.id);
        discovered = [...new Set([...p.models, ...r.models])];
        paint();
        form.querySelector(".provider-result").textContent =
          `连接成功 · ${r.models.length} 个可用模型 · ${r.latency} ms`;
      } finally {
        b.disabled = false;
      }
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const b = form.querySelector("[type=submit]");
      b.disabled = true;
      try {
        await save();
        toast("提供商已保存", "ok");
        providers();
      } finally {
        b.disabled = false;
      }
    };
    form.querySelector("[data-clear]")?.addEventListener("click", async () => {
      settings = await app.api.saveSettings({
        providers: [{ ...p, apiKey: null }],
      });
      p.hasKey = false;
      p.keyHint = "";
      form.elements.apiKey.placeholder = "sk-…";
      toast("密钥已清除");
    });
    form.querySelector("[data-delete]")?.addEventListener("click", async () => {
      if (
        await confirmDlg({
          title: "删除提供商",
          body: `删除「${esc(p.name)}」及其本地密钥？`,
          danger: true,
        })
      ) {
        settings = await app.api.saveSettings({
          providers: [{ id: p.id, deleted: true }],
        });
        app.bus.emit("settings");
        providers();
      }
    });
  }
  async function tasks() {
    if (!app.project()) {
      content.innerHTML =
        '<div class="studio-empty">' +
        mark(74) +
        "<h2>在项目中查看任务。</h2></div>";
      return;
    }
    const paint = async () => {
      const list = await app.api.tasks(app.project().id);
      if (current !== "tasks" || !host.isConnected) return;
      content.innerHTML = '<div class="task-list"></div>';
      const box = content.firstChild;
      if (!list.length) {
        box.innerHTML =
          '<div class="studio-empty">' +
          mark(74) +
          "<h2>这里会记录每一次创作。</h2></div>";
        return;
      }
      for (const t of list.slice().reverse()) {
        const card = el(
          `<article class="task-card"><header><span class="task-state ${t.status}">${taskStatus(t)}</span><span>${esc(t.name)} · ${t.mode === "plan" ? "计划" : "创建"}</span><time>${new Date(t.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></header><h2>${esc(t.goal.slice(0, 160))}</h2><div class="task-facts"><span>${esc(t.model)}</span><span>思考 ${esc(t.think)}</span><span>${t.steps} / ${t.maxSteps} 步</span><span>${t.usage == null ? "用量未提供" : t.usage + " tokens"}</span><span>${t.scope === "all" ? "全站" : esc(t.scope.join("、"))}</span></div>${t.error ? `<p class="task-error">${esc(t.error)}</p>` : ""}${t.output ? `<details><summary>回复</summary><pre>${esc(t.output)}</pre></details>` : ""}<div class="task-question"></div><footer></footer></article>`,
        );
        box.appendChild(card);
        const act = async (action, extra = {}) => {
          await app.api.taskAction(t.project, t.id, { action, ...extra });
          await paint();
          if (action === "undo") app.bus.emit("ai-commit");
        };
        const button = (label, fn) => {
          const b = el(`<button class="btn small">${label}</button>`);
          b.onclick = fn;
          card.querySelector("footer").appendChild(b);
        };
        if (
          [
            "running",
            "queued",
            "waiting_dependency",
            "waiting_user",
            "waiting_authorization",
          ].includes(t.status)
        )
          button("停止", () => act("cancel"));
        if (["paused", "failed", "conflict", "cancelled"].includes(t.status))
          button("继续", () => act("resume"));
        if (t.commits.length && t.status !== "running")
          button("撤销最近提交", () => act("undo"));
        if (t.question) {
          const q = card.querySelector(".task-question");
          q.innerHTML = `<p>${esc(t.question.question)}</p><div class="question-options"></div><form><input aria-label="回答" placeholder="补充回答" required><button class="btn small" type="submit">发送</button></form>`;
          t.question.options.forEach((o) => {
            const b = el(`<button class="btn small">${esc(o)}</button>`);
            b.onclick = () => act("answer", { answer: o });
            q.querySelector(".question-options").appendChild(b);
          });
          q.querySelector("form").onsubmit = (e) => {
            e.preventDefault();
            act("answer", { answer: q.querySelector("input").value });
          };
        }
      }
    };
    await paint();
    off = app.bus.on("tasks", () => {
      if (
        !content.contains(document.activeElement) ||
        !document.activeElement.matches("input,textarea")
      )
        paint();
    });
  }
  async function general() {
    const info = await app.api.system();
    if (current !== "general") return;
    content.innerHTML = `<div class="settings-block"><h2>外观</h2><div class="theme-options"><button data-theme="light" class="${theme() === "light" ? "on" : ""}"><span class="theme-preview light"></span>亮色</button><button data-theme="dark" class="${theme() === "dark" ? "on" : ""}"><span class="theme-preview dark"></span>暗色</button></div></div><div class="settings-block settings-about"><div>${mark(54)}<h2>CentDeck 百映</h2><p>${esc(info.version)} · ${esc(info.revision)}</p></div><div><button class="btn" data-update>检查更新</button><button class="btn" data-restart>重启服务</button></div><p data-result role="status"></p><a href="${info.github}" target="_blank" rel="noopener">${info.github} ↗</a></div><div class="settings-block"><h2>账号</h2><p>${esc(app.account?.username || "")} · <code>config.local/account.json</code></p><button class="btn" data-logout>退出登录</button></div>`;
    const preferences=await app.api.extension('preferences');
    if(current!=='general')return;
    const extra=el(`<div class="settings-extra"><div class="settings-block"><h2>新任务默认值</h2><p>模型与思考强度在助手配置中单独设置。这里控制新任务的执行上限。</p><form class="extension-form" data-defaults><label>最多步骤<input name="maxSteps" type="number" min="1" max="40" value="${preferences.maxSteps}"></label><label>Token 预算<input name="budget" type="number" min="1000" max="500000" step="1000" value="${preferences.budget}"></label><label>协作方式<select name="collaboration"><option value="off">关闭协作</option><option value="confirm">每次确认</option><option value="auto">范围内自动协作</option></select></label><button class="btn primary">保存默认值</button></form></div><div class="settings-block"><h2>修改账号</h2><form class="extension-form" data-account><label>用户名<input name="username" value="${esc(app.account?.username||'')}" autocomplete="username" required></label><label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>新密码<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><button class="btn">更新账号</button><p role="status"></p></form></div><div class="settings-block"><h2>扩展与数据</h2><p>项目保存在 projects/，配置保存在 config.local/。插件、Skills 与 MCP 可从左侧直接进入管理。</p><p>前端文件属于你自己的项目；插件的主页样式只影响百映界面。</p></div></div>`);
    content.append(extra);
    const defaults=extra.querySelector('[data-defaults]');defaults.elements.collaboration.value=preferences.collaboration;
    defaults.onsubmit=async e=>{e.preventDefault();await app.api.extension('preferences',Object.fromEntries(new FormData(defaults)),'PUT');toast('新任务默认值已保存','ok');};
    const account=extra.querySelector('[data-account]');account.onsubmit=async e=>{e.preventDefault();try{app.account=await app.api.account(Object.fromEntries(new FormData(account)));account.elements.currentPassword.value='';account.elements.password.value='';account.querySelector('[role=status]').textContent='账号已更新';}catch(error){account.querySelector('[role=status]').textContent=error.message;}};
    content.querySelectorAll("[data-theme]").forEach(
      (b) =>
        (b.onclick = () => {
          setTheme(b.dataset.theme);
          content
            .querySelectorAll("[data-theme]")
            .forEach((x) => x.classList.toggle("on", x === b));
        }),
    );
    content.querySelector("[data-update]").onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        const r = await app.api.updates();
        content.querySelector("[data-result]").textContent = r.available
          ? "GitHub 有新提交，可前往仓库查看。"
          : "已与 GitHub 最新提交一致。";
      } finally {
        content.querySelector("[data-update]").disabled = false;
      }
    };
    content.querySelector("[data-restart]").onclick = async () => {
      if (app.project() && (await app.bus.flushMeta()) === false) return;
      await app.api.restart();
      content.querySelector("[data-result]").textContent = "正在重启…";
      const poll = setInterval(async () => {
        try {
          await app.api.auth();
          clearInterval(poll);
          location.reload();
        } catch {}
      }, 1500);
      setTimeout(() => {
        clearInterval(poll);
        if (content.isConnected)
          content.querySelector("[data-result]").textContent =
            "若服务尚未恢复，请重新运行启动脚本。";
      }, 20000);
    };
    content.querySelector("[data-logout]").onclick = async () => {
      if (app.project() && (await app.bus.flushMeta()) === false) return;
      await app.api.logout();
      location.reload();
    };
  }
  nav();
  host.querySelector("[data-close]").focus();
}
