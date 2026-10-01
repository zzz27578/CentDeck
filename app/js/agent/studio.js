/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
import { language, changeLanguage } from '../core/i18n.js';
import { mountProviders } from './provider-panel.js';
import { mountHistory } from './history-panel.js';
import { renderExtensions } from './extensions-page.js';
import { THINK, normalizeThink } from "../core/reasoning.js";
import { el, esc, uid, toast, confirmDlg } from "../core/ui.js";
import { icon } from "../core/icons.js";
import { mark, theme, setTheme } from "../core/brand.js";
export const ROLES = [
  i18nText("通用"),
  i18nText("总览设计"),
  i18nText("视觉设计师"),
  i18nText("前端工程师"),
  i18nText("交互设计师"),
  i18nText("移动适配"),
  i18nText("审查员"),
  i18nText("品牌设计"),
  i18nText("无障碍检查"),
];
const states = {
  queued: i18nText("排队中"),
  running: i18nText("执行中"),
  checking: i18nText("检查中"),
  waiting_user: i18nText("等待回答"),
  waiting_authorization: i18nText("等待协作授权"),
  waiting_dependency: i18nText("等待依赖"),
  completed: i18nText("完成"),
  failed: i18nText("失败"),
  paused: i18nText("已暂停"),
  cancelled: i18nText("已停止"),
  conflict: i18nText("版本冲突"),
};
export const taskStatus = (t) => states[t.status] || t.status;
export function avatar(a, size = 28) {
  return a.avatar?.startsWith("data:image/")
    ? `<img src="${esc(a.avatar)}" alt="${esc(a.name)}" width="${size}" height="${size}">`
    : mark(size);
}
let closeOpened = null;
export async function openStudio(app, section = "assistants") {
  if(closeOpened && await closeOpened()===false)return;
  await app.agent.ready;
  const mgr = app.agent.manager;
  let settings = await app.api.getSettings(),
    current = section === "tasks" ? "history" : section || "assistants",
    off = () => {};
  const host = el(
    i18nTpl`<section class="studio" role="dialog" aria-modal="true" aria-label="Agent 工作台"><aside class="studio-nav"><div class="wordmark">${mark(38)}<b>CentDeck</b></div><div class="studio-nav-main"><button data-tab="assistants">${icon("centdeck", 20)}助手</button><button data-tab="providers">${icon("layers", 20)}模型提供商</button><button data-tab="history">${icon("history", 20)}对话历史</button><button data-tab="plugins">${icon("layers",20)}插件</button><button data-tab="skills">${icon("book",20)}Skills</button><button data-tab="tools">${icon("code",20)}工具注册</button><button data-tab="mcp">${icon("link",20)}MCP 接管</button></div><button data-tab="general">${icon("settings", 20)}设置</button><a href="https://github.com/zzz27578/CentDeck" target="_blank" rel="noopener" class="github-entry">${icon("github",24)}<span><b>GitHub</b><small>源码与更新</small></span>${icon("arrow",16)}</a></aside><main class="studio-main"><header><div><span class="studio-overline">AGENT STUDIO</span><h1></h1></div><button class="btn studio-exit" data-close aria-label="返回进入前的页面">${icon("back", 18)}${app.project()?i18nText("返回工作台"):i18nText("返回首页")}</button></header><div class="studio-content"></div></main></section>`,
  );
  document.body.appendChild(host);
  const content = host.querySelector(".studio-content");
  const previousFocus = document.activeElement,
    previousInert = [...document.body.children]
      .filter((n) => n !== host && !n.classList.contains("toast-host"))
      .map((n) => [n, n.inert]);
  previousInert.forEach(([n]) => (n.inert = true));
  let dirty=false;
  const markDirty=()=>{dirty=true;};
  function watchForm(form){dirty=false;form.addEventListener('input',markDirty);form.addEventListener('change',markDirty);}
  async function canLeave(){if(!dirty)return true;const yes=await confirmDlg({title:i18nText('尚未保存'),body:i18nText('当前修改尚未保存，确定离开并放弃修改？'),okLabel:i18nText('放弃修改')});if(yes)dirty=false;return yes;}
  const close = async () => {
    if(!await canLeave())return false;
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
    i18nTpl`<option value="auto">默认模型</option><option value="mcp:external" ${value === 'mcp:external' ? 'selected' : ''}>外部 MCP 助手（需连接接管）</option>${models()
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
      assistants: i18nText("你的创作团队"),
      providers: i18nText("连接你的模型"),
      history: i18nText("项目对话历史"),
      general: i18nText("偏好设置"), plugins: i18nText("插件管理"), skills: i18nText("Agent 技能"), tools: i18nText("工具注册表"), mcp: i18nText("MCP 与外部助手"),
    }[current];
    content.innerHTML = "";
    if (current === "assistants") assistants();
    if (current === "providers") providers();
    if (current === "history") chatHistory();
    if (current === "general") general();
    if(['plugins','skills','tools','mcp'].includes(current)){const slot=el('<div class="extension-slot"></div>');content.append(slot);renderExtensions(app,slot,current).catch(e=>toast(e.message,'error'));}
  }
  host.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = async () => {
        if(!await canLeave())return;
        current = b.dataset.tab;
        nav();
      }),
  );
  function assistants() {
    dirty=false;
    content.innerHTML = i18nTpl`<div class="studio-toolbar"><span>${mgr.sessions().length} 位助手</span><button class="btn primary" data-new>${icon("plus", 16)}新建助手</button></div><div class="assistant-grid"></div>`;
    content.querySelector("[data-new]").onclick = () => editAssistant(null);
    for (const a of mgr.sessions()) {
      const card = el(
        `<button class="assistant-tile"><span class="studio-avatar" style="--assistant-color:${a.color}">${avatar(a, 44)}</span><h2>${esc(a.name)}</h2><p>${esc(a.role || i18nText("通用"))}</p><span class="tile-duty">${esc(a.responsibility || "")}</span><footer><span>${esc(mgr.modelLabel(a.model))}</span><span>↗</span></footer></button>`,
      );
      card.onclick = () => editAssistant(a);
      content.querySelector(".assistant-grid").appendChild(card);
    }
  }
  function editAssistant(existing) {
    const a = {
      id: uid("ag"),
      name: i18nText("新助手"),
      role: i18nText("通用"),
      avatar: "centdeck",
      color: "#65784e",
      prompt: "",
      responsibility: "",
      skills: [],
      model: "auto",
      think: "medium",
      ...existing,
    };
    content.innerHTML = i18nTpl`<button class="text-back">${icon("back",17)}返回所有助手</button><form class="studio-form"><div class="assistant-profile"><button type="button" class="studio-avatar upload-avatar" aria-label="上传助手头像">${avatar(a, 62)}<span>上传</span></button><input type="file" accept="image/png,image/jpeg,image/webp" hidden><div><label>名字<input name="name" required maxlength="60" value="${esc(a.name)}"></label><label>角色<input name="role" list="role-presets" maxlength="80" value="${esc(a.role)}"></label><datalist id="role-presets">${ROLES.map((r) => `<option value="${r}">`).join("")}</datalist></div></div><label>任务定位<input name="responsibility" value="${esc(a.responsibility || "")}" maxlength="4000" placeholder="例如：只处理红色标记"></label><div class="studio-two"><label>模型<select name="model">${modelOptions(a.model)}</select></label><label>思考强度<select name="think">${THINK.map(t => [t.id, t.label])
      .map(
        ([id, n]) =>
          `<option value="${id}" ${normalizeThink(a.think) === id ? "selected" : ""}>${n}</option>`,
      )
      .join(
        "",
      )}</select></label></div><label>默认提示词<textarea name="prompt" rows="5" maxlength="16000">${esc(a.prompt)}</textarea></label><fieldset><legend>我的技能</legend><div class="skill-grid">${mgr
      .skills()
      .map(
        (s) =>
          `<label><input type="checkbox" name="skills" value="${s.id}" ${a.skills.includes(s.id) ? "checked" : ""}>${esc(s.name)}</label>`,
      )
      .join(
        "",
      )}</div></fieldset><div class="studio-form-actions"><button type="submit" class="btn primary">保存助手</button>${existing && app.project() ? i18nText('<button type="button" class="btn" data-window>打开对话</button>') : ""}${existing ? i18nText('<button type="button" class="btn ghost danger" data-delete>删除</button>') : ""}</div></form>`;
    content.querySelector(".text-back").onclick = async()=>{if(await canLeave())assistants();};
    const form = content.querySelector("form"),
      ipt = form.querySelector("[type=file]");
    watchForm(form);
    form.querySelector('fieldset').hidden=!mgr.skills().length;
    form.querySelector(".upload-avatar").onclick = () => ipt.click();
    ipt.onchange = async () => {
      const f = ipt.files[0];
      if (!f) return;
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
        f.size > 5 * 1024 * 1024
      ) {
        toast(i18nText("请选择 5 MB 以内的 PNG、JPG 或 WebP"), "err");
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
          avatar(a, 62) + i18nText("<span>更换</span>");
      } catch {
        toast(i18nText("头像无法读取"), "err");
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
        toast(i18nText("助手已保存"), "ok");
        assistants();
      } finally {
        btn.disabled = false;
      }
    };
    form.querySelector("[data-window]")?.addEventListener("click", async () => {
      if(await close()===false)return;
      mgr.show(existing);
    });
    form.querySelector("[data-delete]")?.addEventListener("click", async () => {
      if (
        await confirmDlg({
          title: i18nText("删除助手"),
          body: i18nTpl`删除「${esc(existing.name)}」的配置？项目任务记录仍保留。`,
          danger: true,
        })
      ) {
        await mgr.remove(existing);
        assistants();
      }
    });
  }
  function providers() {
    dirty=false;
    off=mountProviders(app,content,{settings,onDirty:value=>{dirty=value;},canLeave,onSaved:value=>{settings=value;}});
  }
  function chatHistory() { off=mountHistory(app,content,close); }
  async function general() {
    const info = await app.api.system();
    if (current !== "general") return;
    content.innerHTML = i18nTpl`<div class="settings-block"><h2>外观</h2><div class="theme-options"><button data-theme="light" class="${theme() === "light" ? "on" : ""}"><span class="theme-preview light"></span>亮色</button><button data-theme="dark" class="${theme() === "dark" ? "on" : ""}"><span class="theme-preview dark"></span>暗色</button></div></div><div class="settings-block settings-about"><div>${mark(54)}<h2>CentDeck 百映</h2><p>${esc(info.version)} · ${esc(info.revision)}</p></div><div><button class="btn" data-update>检查更新</button><button class="btn" data-restart>重启服务</button></div><p data-result role="status"></p><a href="${info.github}" target="_blank" rel="noopener">${info.github} ↗</a></div><div class="settings-block"><h2>账号</h2><p>${esc(app.account?.username || "")} · <code>config.local/account.json</code></p><button class="btn" data-logout>退出登录</button></div>`;
    const languagePanel=el(i18nTpl`<div class="settings-block language-settings"><h2>语言</h2><label>界面语言<select data-language aria-label="界面语言"><option value="zh-CN">简体中文</option><option value="en">English</option></select></label><p>切换语言后将重新加载界面，已保存的项目和聊天记录会保留。</p></div>`);
    content.querySelector('.settings-block').after(languagePanel);
    languagePanel.querySelector('select').value=language();
    languagePanel.querySelector('select').onchange=async event=>{if(await changeLanguage(event.target.value,app)===false)event.target.value=language();};
    const preferences=await app.api.extension('preferences');
    if(current!=='general')return;
    const extra=el(i18nTpl`<div class="settings-extra"><div class="settings-block"><h2>新任务默认值</h2><p>模型与思考强度在助手配置中单独设置。这里控制新任务的执行上限。</p><form class="extension-form" data-defaults><label>每轮工具调用上限<input name="maxSteps" type="number" min="1" max="40" value="${preferences.maxSteps}"></label><p class="form-hint">一次回复中累计的工具调用总数。达到上限会暂停并保留结果，继续后开始下一轮，防止无限循环。</p><button class="btn primary">保存默认值</button></form></div><div class="settings-block"><h2>修改账号</h2><form class="extension-form" data-account><label>用户名<input name="username" value="${esc(app.account?.username||'')}" autocomplete="username" required></label><label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>新密码<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><button class="btn">更新账号</button><p role="status"></p></form></div><div class="settings-block"><h2>扩展与数据</h2><p>项目保存在 projects/，配置保存在 config.local/。插件、Skills 与 MCP 可从左侧直接进入管理。</p><p>前端文件属于你自己的项目；插件的主页样式只影响百映界面。</p></div></div>`);
    content.append(extra);
    const defaults=extra.querySelector('[data-defaults]');
    defaults.onsubmit=async e=>{e.preventDefault();await app.api.extension('preferences',Object.fromEntries(new FormData(defaults)),'PUT');toast(i18nText('新任务默认值已保存'),'ok');};
    const account=extra.querySelector('[data-account]');account.onsubmit=async e=>{e.preventDefault();try{app.account=await app.api.account(Object.fromEntries(new FormData(account)));account.elements.currentPassword.value='';account.elements.password.value='';account.querySelector('[role=status]').textContent=i18nText('账号已更新');}catch(error){account.querySelector('[role=status]').textContent=error.message;}};
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
          ? i18nText("GitHub 有新提交，可前往仓库查看。")
          : i18nText("已与 GitHub 最新提交一致。");
      } finally {
        content.querySelector("[data-update]").disabled = false;
      }
    };
    content.querySelector("[data-restart]").onclick = async () => {
      if (app.project() && (await app.bus.flushMeta()) === false) return;
      await app.api.restart();
      content.querySelector("[data-result]").textContent = i18nText("正在重启…");
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
            i18nText("若服务尚未恢复，请重新运行启动脚本。");
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
