// 助手管理：右侧停靠的主窗口 + 任意多个悬浮窗口（多助手协作的壳）。
// 拖标题栏就能把停靠的助手拽出来变成悬浮窗；把悬浮窗拖到屏幕最右边松手就停靠回去。
// 右键 @、框选、导入体检等处的引用和提示词，会送到你最近用过的那个助手窗口。
import { el, esc, showMenu, toast } from "../core/ui.js";
import { icon } from '../core/icons.js';
import { createSession } from "./session.js";
import { openAssistantManager } from "./manager.js";

export function createAgent(app) {
  let dockHost = null,
    dockInner = null,
    docked = null,
    active = null;
  let open = localStorage.getItem("cd.agentOpen") === "1";
  let width = +localStorage.getItem("cd.agentW") || 400;
  let skills = [],
    settings = null,
    seq = 1;
  const floats = new Map(); // session → 窗口元素
  const sessions = [];
  let closePicker=()=>{};

  const loadSkills = () => fetch('/api/skills').then(r=>r.json()).then(r=>{skills=r.data.filter(s=>s.enabled);}).catch(()=>{});
  loadSkills();
  app.bus.on('skills',loadSkills);
  const loadSettings = () =>
    app.api
      .getSettings({ toast: false })
      .then((x) => {
        settings = x;
        sessions.forEach((s) => s.paintPickers());
      })
      .catch(() => {});
  loadSettings();
  app.bus.on("settings", loadSettings);

  function newSession(opts = {}) {
    const s = createSession(app, mgr, { name: `助手 ${seq}`, ...opts });
    seq++;
    sessions.push(s);
    if (app.project()) s.restore(app.project().assistantChats?.[s.id]);
    return s;
  }

  // ---------- 停靠区 ----------
  async function mount(host) {
    await ready;
    dockHost = host;
    host.style.setProperty("--agent-w", width + "px");
    host.innerHTML =
      '<div class="agent-inner"><div class="agent-resize" data-tip="拖动改宽度" data-tip-place="left"></div></div>';
    dockInner = host.firstElementChild;
    dockInner.firstElementChild.addEventListener("pointerdown", resizeDock);
    if (!docked && !floats.size && sessions.length) docked = sessions[0];
    if (docked) dockInner.appendChild(docked.root);
    floats.forEach((w) => document.body.appendChild(w));
    setOpen(open && !!docked, false);
  }
  function resizeDock(e) {
    e.preventDefault();
    const sx = e.clientX,
      w0 = width;
    dockHost.classList.add("resizing");
    const mv = (ev) => {
      width = Math.max(320, Math.min(760, w0 + sx - ev.clientX));
      dockHost.style.setProperty("--agent-w", width + "px");
    };
    const up = () => {
      dockHost.classList.remove("resizing");
      localStorage.setItem("cd.agentW", width);
      window.removeEventListener("pointermove", mv, true);
      window.removeEventListener("pointerup", up, true);
    };
    window.addEventListener("pointermove", mv, true);
    window.addEventListener("pointerup", up, true);
  }
  function setOpen(v, save = true) {
    open = v;
    if (dockHost) dockHost.classList.toggle("open", v);
    const b = document.getElementById("tb-agent");
    if (b)
      b.classList.toggle(
        "on",
        v || [...floats.values()].some((w) => !w.hidden),
      );
    if (save) localStorage.setItem("cd.agentOpen", v ? "1" : "0");
    if (v && docked) {
      active = docked;
      docked.focus();
    } else if (docked) docked.blur();
  }

  // ---------- 悬浮窗 ----------
  function floatWin(s, r) {
    const w = el(
      `<div class="agent-float"><div class="af-body"></div><i class="af-resize" data-tip="拖动改大小"></i></div>`,
    );
    const box = r || {
      x: innerWidth - width - 60,
      y: 90,
      w: width,
      h: Math.min(640, innerHeight - 170),
    };
    Object.assign(w.style, {
      left: box.x + "px",
      top: box.y + "px",
      width: box.w + "px",
      height: box.h + "px",
    });
    w.firstElementChild.appendChild(s.root);
    w.querySelector(".af-resize").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const sx = e.clientX,
        sy = e.clientY,
        w0 = w.offsetWidth,
        h0 = w.offsetHeight;
      const mv = (ev) => {
        w.style.width = Math.max(320, w0 + ev.clientX - sx) + "px";
        w.style.height = Math.max(300, h0 + ev.clientY - sy) + "px";
      };
      const up = () => {
        window.removeEventListener("pointermove", mv, true);
        window.removeEventListener("pointerup", up, true);
      };
      window.addEventListener("pointermove", mv, true);
      window.addEventListener("pointerup", up, true);
    });
    document.body.appendChild(w);
    floats.set(s, w);
    return w;
  }
  function undock(s, at) {
    if (docked !== s) return;
    docked = null;
    setOpen(false);
    floatWin(s, at);
    s.paintPickers();
  }
  function dock(s) {
    const w = floats.get(s);
    const r = w ? w.getBoundingClientRect() : null;
    if (w) {
      w.remove();
      floats.delete(s);
    }
    if (docked && docked !== s) {
      const prev = docked;
      docked = null;
      floatWin(prev, r && { x: r.left, y: r.top, w: r.width, h: r.height });
      prev.paintPickers();
    }
    docked = s;
    dockInner.appendChild(s.root);
    s.paintPickers();
    setOpen(true);
  }

  // 拖标题栏：停靠的拽出来变悬浮；悬浮的拖到最右边停靠
  document.addEventListener("pointerdown", (e) => {
    const head = e.target.closest && e.target.closest(".ag-head");
    if (!head || e.button !== 0 || e.target.closest("button")) return;
    const s = sessions.find((x) => x.root.contains(head));
    if (!s) return;
    e.preventDefault();
    const sx = e.clientX,
      sy = e.clientY;
    let w = floats.get(s),
      ox = w ? w.offsetLeft : 0,
      oy = w ? w.offsetTop : 0,
      hint = null;
    const mv = (ev) => {
      if (!w) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 24) return;
        undock(s, {
          x: ev.clientX - 120,
          y: ev.clientY - 20,
          w: Math.min(width, 440),
          h: Math.min(620, innerHeight - 160),
        });
        w = floats.get(s);
        ox = w.offsetLeft;
        oy = w.offsetTop;
      }
      w.style.left =
        Math.max(
          0,
          Math.min(Math.max(0, innerWidth - 320), ox + ev.clientX - sx),
        ) + "px";
      w.style.top =
        Math.max(0, Math.min(innerHeight - 40, oy + ev.clientY - sy)) + "px";
      const near = ev.clientX > innerWidth - 40 && !!app.state.project;
      if (near && !hint) {
        hint = el(
          '<div class="agent-dock-hint"><span>松手停靠到右侧</span></div>',
        );
        document.body.appendChild(hint);
      }
      if (!near && hint) {
        hint.remove();
        hint = null;
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", mv, true);
      window.removeEventListener("pointerup", up, true);
      if (hint) {
        hint.remove();
        dock(s);
      }
    };
    window.addEventListener("pointermove", mv, true);
    window.addEventListener("pointerup", up, true);
  });

  // ---------- 给会话用的接口 ----------
  const target = () =>
    active && sessions.includes(active) ? active : docked || sessions[0];
  function show(s) {
    if (!s) return;
    if (s === docked) setOpen(true);
    else {
      let w = floats.get(s);
      if (!w) w = floatWin(s);
      w.hidden = false;
      w.classList.remove("collapsed");
    }
    active = s;
    s.focus();
  }
  const mgr = {
    async createProfile(profile) {
      const s = newSession(profile);
      try {
        await saveProfiles();
        return s;
      } catch (e) {
        sessions.splice(sessions.indexOf(s), 1);
        throw e;
      }
    },
    setActive(s) {
      active = s;
      sessions.forEach((x) =>
        x.root.classList.toggle("active", x === s && sessions.length > 1),
      );
    },
    isDocked: (s) => s === docked,
    toggleDock: (s) => (s === docked ? undock(s) : dock(s)),
    newWindow() {
      const s = newSession();
      saveProfiles();
      const n = floats.size;
      floatWin(s, {
        x: Math.max(20, innerWidth - width - 100 - n * 28),
        y: 110 + n * 28,
        w: Math.min(width, 440),
        h: Math.min(600, innerHeight - 200),
      });
      mgr.setActive(s);
      s.focus();
      return s;
    },
    close(s) {
      s.blur();
      if (s === docked) setOpen(false);
      else {
        const w = floats.get(s);
        if (w) w.hidden = true;
      }
      if (active === s) active = null;
    },
    fold(s) {
      if (s === docked) undock(s);
      const w = floats.get(s);
      if (!w) return;
      w.classList.toggle("collapsed");
      s.paintPickers();
      if (!w.classList.contains("collapsed")) s.focus();
    },
    pickSession(anchor, floating=false) {
      closePicker();
      const menu=el(`<div class="assistant-picker" role="dialog" aria-label="选择助手"><header>${floating?'在悬浮窗打开':'选择助手'}</header><div class="assistant-picker-list"></div><button class="btn block" data-manage>${icon('plus',15)}新建或管理助手</button></div>`);
      const choose=(s,float)=>{closePicker();if(float){if(s===docked)undock(s);show(s);}else{if(docked&&docked!==s){docked.root.remove();docked=null;}dock(s);}mgr.setActive(s);};
      for(const s of sessions){
        const row=el(`<div class="assistant-picker-row"><span><b>${esc(s.name)}</b><small>${esc(s.role)}</small></span><button class="btn small" data-switch>${s===docked?'当前':'切换'}</button><button class="icon-btn" data-float aria-label="在悬浮窗打开 ${esc(s.name)}">${icon('plus',17)}</button></div>`);
        row.querySelector('[data-switch]').onclick=()=>choose(s,false);row.querySelector('[data-float]').onclick=()=>choose(s,true);menu.querySelector('.assistant-picker-list').append(row);
      }
      menu.querySelector('[data-manage]').onclick=()=>{closePicker();mgr.manage();};document.body.append(menu);
      const r=anchor.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-320,r.left))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,r.bottom+8))+'px';
      const outside=e=>{if(!menu.contains(e.target)&&!anchor.contains(e.target))closePicker();};
      const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closePicker();anchor.focus();}};
      closePicker=()=>{menu.remove();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);};
      document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);menu.querySelector('button')?.focus();
    },
    manage: () => openAssistantManager(mgr, app),
    sessions: () => sessions,
    show,
    visible: (s) =>
      s === docked ? open : !!floats.get(s) && !floats.get(s).hidden,
    async remove(s) {
      if (
        taskList.some(
          (t) =>
            t.assistantId === s.id &&
            [
              "running",
              "queued",
              "waiting_user",
              "waiting_dependency",
            ].includes(t.status),
        )
      ) {
        toast("请先停止这个助手的任务", "err");
        return;
      }
      const i = sessions.indexOf(s);
      if (i < 0) return;
      const remaining = sessions.filter((x) => x !== s);
      await saveProfileList(remaining);
      sessions.splice(i, 1);
      floats.get(s)?.remove();
      floats.delete(s);
      if (s === docked) {
        s.root.remove();
        docked = null;
        setOpen(false);
      }
      if (active === s) active = null;
    },
    saveProfiles,
    saveConversation(s) {
      const p = app.project();
      if (!p) return;
      if (!p.assistantChats) p.assistantChats = {};
      p.assistantChats[s.id] = s.conversation();
      app.bus.saveMeta();
    },
    skills: () => skills.filter(s=>!s.internal),
    skill: (id) =>
      skills.find((k) => k.id === id) || { id, name: id, icon: "book" },
    modelLabel(id) {
      if (id === 'mcp:external' || (id === 'auto' && settings?.defaultModel === 'mcp:external')) return '外部 MCP 助手';
      if (id === "auto")
        return (
          settings?.defaultModel?.split(":").slice(1).join(":") || "默认模型"
        );
      return String(id).split(":").slice(1).join(":") || id;
    },
    modelMenu(anchor, cur, pick) {
      const items = [
        {label:'外部 MCP 助手（需连接接管）', checked:cur === 'mcp:external', onClick:() => pick('mcp:external')},
        {
          label: "默认模型",
          checked: cur === "auto",
          onClick: () => pick("auto"),
        },
      ];
      const on = settings
        ? settings.providers.filter((p) => p.enabled && p.models.length)
        : [];
      on.forEach((p) => {
        items.push({ title: p.name });
        p.models.forEach((m) =>
          items.push({
            label: m,
            checked: cur === `${p.id}:${m}`,
            onClick: () => pick(`${p.id}:${m}`),
          }),
        );
      });
      if (!on.length) items.push({ title: "还没有启用任何模型" });
      items.push("-", {
        label: "模型与接口设置…",
        icon: "settings",
        onClick: () => app.openSettings(),
      });
      showMenu(items, 0, 0, { anchor, minWidth: 260 });
    },
  };

  // ---------- 对外 ----------
  function toggle(force) {
    if (!sessions.length) {
      mgr.newWindow();
      return;
    }
    if (docked) {
      setOpen(force == null ? !open : !!force);
      return;
    }
    const anyShown = [...floats.values()].some((w) => !w.hidden);
    const want = force == null ? !anyShown : !!force;
    floats.forEach((w) => {
      w.hidden = !want;
    });
    setOpen(false, false);
  }
  let saveQueue = Promise.resolve();
  const profile = (s) =>
    Object.fromEntries(
      [
        "id",
        "name",
        "role",
        "avatar",
        "color",
        "prompt",
        "responsibility",
        "skills",
        "model",
        "think",
      ].map((k) => [k, s[k]]),
    );
  function saveProfileList(list) {
    const data = list.map(profile);
    saveQueue = saveQueue
      .catch(() => {})
      .then(() => app.api.saveAssistants(data));
    return saveQueue;
  }
  function saveProfiles() {
    const p = saveProfileList(sessions);
    p.catch(() => toast("助手配置保存失败，请在管理页重试", "err"));
    return p;
  }
  const ready = app.api
    .getAssistants()
    .then((list) => {
      list.forEach(newSession);
      docked = sessions[0] || null;
    })
    .catch(() => {
      toast("助手配置未加载，请刷新后重试", "err");
    });
  let source = null,
    sourceProject = null,
    taskList = [],
    commitKey = "";
  app.bus.on("project", () => {
    const id = app.project()?.id;
    if (id === sourceProject) return;
    source?.close();
    sourceProject = id;
    taskList = [];
    commitKey = "";
    if (!id) { setOpen(false,false);floats.forEach(w=>w.hidden=true);return; }
    source = new EventSource(`/api/projects/${encodeURIComponent(id)}/events`);
    source.onmessage = (e) => {
      if (app.project()?.id !== id) return;
      try {
        taskList = JSON.parse(e.data);
        sessions.forEach((s) => s.syncTasks?.(taskList));
        app.bus.emit("tasks", taskList);
        const next = taskList
          .map((t) => t.id + ":" + t.commits.length)
          .join("|");
        if (
          commitKey &&
          next !== commitKey &&
          taskList.some((t) => t.commits.length)
        )
          app.bus.emit("ai-commit");
        commitKey = next;
      } catch (err) {
        console.error(err);
      }
    };
  });
  app.bus.on("project", () =>
    sessions.forEach((s) => {
      s.restore(app.project()?.assistantChats?.[s.id]);
      s.syncTasks(taskList);
    }),
  );

  return {
    mount,
    toggle,
    ready,
    manager: mgr,
    taskList: () => taskList,
    manage: mgr.manage,
    addRef(r) {
      const s = target() || mgr.newWindow();
      show(s);
      s.addRef(r);
    },
    prefill(text, o) {
      const s = target() || mgr.newWindow();
      show(s);
      s.prefill(text, o);
    },
    newWindow: () => mgr.newWindow(),
  };
}
