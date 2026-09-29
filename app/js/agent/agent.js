// 助手管理：右侧停靠的主窗口 + 任意多个悬浮窗口（多助手协作的壳）。
// 拖标题栏就能把停靠的助手拽出来变成悬浮窗；把悬浮窗拖到屏幕最右边松手就停靠回去。
// 右键 @、框选、导入体检等处的引用和提示词，会送到你最近用过的那个助手窗口。
import { el, showMenu } from '../core/ui.js';
import { createSession } from './session.js';

export function createAgent(app) {
  let dockHost = null, dockInner = null, docked = null, active = null;
  let open = localStorage.getItem('cd.agentOpen') === '1';
  let width = +localStorage.getItem('cd.agentW') || 400;
  let skills = [], settings = null, seq = 1;
  const floats = new Map(); // session → 窗口元素
  const sessions = [];

  fetch('/app/skills/index.json').then((r) => r.json()).then((j) => { skills = j; }).catch(() => {});
  const loadSettings = () => app.api.getSettings({ toast: false }).then((x) => { settings = x; sessions.forEach((s) => s.paintPickers()); }).catch(() => {});
  loadSettings();
  app.bus.on('settings', loadSettings);

  function newSession(name) {
    const s = createSession(app, mgr, { name: name || (seq === 1 ? '助手' : `助手 ${seq}`) });
    seq++;
    sessions.push(s);
    return s;
  }

  // ---------- 停靠区 ----------
  function mount(host) {
    dockHost = host;
    host.style.setProperty('--agent-w', width + 'px');
    host.innerHTML = '<div class="agent-inner"><div class="agent-resize" data-tip="拖动改宽度" data-tip-place="left"></div></div>';
    dockInner = host.firstElementChild;
    dockInner.firstElementChild.addEventListener('pointerdown', resizeDock);
    if (!docked && !floats.size) docked = newSession();
    if (docked) dockInner.appendChild(docked.root);
    floats.forEach((w) => document.body.appendChild(w));
    setOpen(open && !!docked, false);
  }
  function resizeDock(e) {
    e.preventDefault();
    const sx = e.clientX, w0 = width;
    dockHost.classList.add('resizing');
    const mv = (ev) => { width = Math.max(320, Math.min(760, w0 + sx - ev.clientX)); dockHost.style.setProperty('--agent-w', width + 'px'); };
    const up = () => { dockHost.classList.remove('resizing'); localStorage.setItem('cd.agentW', width); window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); };
    window.addEventListener('pointermove', mv, true);
    window.addEventListener('pointerup', up, true);
  }
  function setOpen(v, save = true) {
    open = v;
    if (dockHost) dockHost.classList.toggle('open', v);
    const b = document.getElementById('tb-agent');
    if (b) b.classList.toggle('on', v || [...floats.values()].some((w) => !w.hidden));
    if (save) localStorage.setItem('cd.agentOpen', v ? '1' : '0');
    if (v && docked) docked.focus();
    else if (docked) docked.blur();
  }

  // ---------- 悬浮窗 ----------
  function floatWin(s, r) {
    const w = el(`<div class="agent-float"><div class="af-body"></div><i class="af-resize" data-tip="拖动改大小"></i></div>`);
    const box = r || { x: innerWidth - width - 60, y: 90, w: width, h: Math.min(640, innerHeight - 170) };
    Object.assign(w.style, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' });
    w.firstElementChild.appendChild(s.root);
    w.querySelector('.af-resize').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, w0 = w.offsetWidth, h0 = w.offsetHeight;
      const mv = (ev) => { w.style.width = Math.max(320, w0 + ev.clientX - sx) + 'px'; w.style.height = Math.max(300, h0 + ev.clientY - sy) + 'px'; };
      const up = () => { window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); };
      window.addEventListener('pointermove', mv, true);
      window.addEventListener('pointerup', up, true);
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
    if (w) { w.remove(); floats.delete(s); }
    if (docked && docked !== s) { const prev = docked; docked = null; floatWin(prev, r && { x: r.left, y: r.top, w: r.width, h: r.height }); prev.paintPickers(); }
    docked = s;
    dockInner.appendChild(s.root);
    s.paintPickers();
    setOpen(true);
  }

  // 拖标题栏：停靠的拽出来变悬浮；悬浮的拖到最右边停靠
  document.addEventListener('pointerdown', (e) => {
    const head = e.target.closest && e.target.closest('.ag-head');
    if (!head || e.button !== 0 || e.target.closest('button')) return;
    const s = sessions.find((x) => x.root.contains(head));
    if (!s) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let w = floats.get(s), ox = w ? w.offsetLeft : 0, oy = w ? w.offsetTop : 0, hint = null;
    const mv = (ev) => {
      if (!w) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 24) return;
        undock(s, { x: ev.clientX - 120, y: ev.clientY - 20, w: Math.min(width, 440), h: Math.min(620, innerHeight - 160) });
        w = floats.get(s);
        ox = w.offsetLeft; oy = w.offsetTop;
      }
      w.style.left = Math.max(0, Math.min(innerWidth - 120, ox + ev.clientX - sx)) + 'px';
      w.style.top = Math.max(0, Math.min(innerHeight - 40, oy + ev.clientY - sy)) + 'px';
      const near = ev.clientX > innerWidth - 40 && !!app.state.project;
      if (near && !hint) { hint = el('<div class="agent-dock-hint"><span>松手停靠到右侧</span></div>'); document.body.appendChild(hint); }
      if (!near && hint) { hint.remove(); hint = null; }
    };
    const up = () => {
      window.removeEventListener('pointermove', mv, true);
      window.removeEventListener('pointerup', up, true);
      if (hint) { hint.remove(); dock(s); }
    };
    window.addEventListener('pointermove', mv, true);
    window.addEventListener('pointerup', up, true);
  });

  // ---------- 给会话用的接口 ----------
  const target = () => (active && sessions.includes(active) ? active : docked || sessions[0]);
  function show(s) {
    if (s === docked) setOpen(true);
    else { const w = floats.get(s); if (w) w.hidden = false; }
  }
  const mgr = {
    setActive(s) { active = s; sessions.forEach((x) => x.root.classList.toggle('active', x === s && sessions.length > 1)); },
    isDocked: (s) => s === docked,
    toggleDock: (s) => (s === docked ? undock(s) : dock(s)),
    newWindow() {
      const s = newSession();
      const n = floats.size;
      floatWin(s, { x: Math.max(20, innerWidth - width - 100 - n * 28), y: 110 + n * 28, w: Math.min(width, 440), h: Math.min(600, innerHeight - 200) });
      mgr.setActive(s);
      s.focus();
    },
    close(s) {
      if (s === docked) { setOpen(false); return; }
      const w = floats.get(s);
      if (w) { w.remove(); floats.delete(s); }
      sessions.splice(sessions.indexOf(s), 1);
      if (!sessions.length) { docked = newSession(); dockInner.appendChild(docked.root); }
      if (active === s) active = null;
    },
    skills: () => skills,
    skill: (id) => skills.find((k) => k.id === id) || { id, name: id, icon: 'book' },
    modelLabel(id) {
      if (id === 'auto') return '自动分档';
      const [pid, model] = String(id).split(':');
      return model || pid;
    },
    modelMenu(anchor, cur, pick) {
      const items = [{ title: '推荐' }, { label: '自动分档', hint: '小改用经济档，出方案用专家档', checked: cur === 'auto', onClick: () => pick('auto') }];
      const on = settings ? settings.providers.filter((p) => p.enabled && p.models.length) : [];
      on.forEach((p) => { items.push({ title: p.name }); p.models.forEach((m) => items.push({ label: m, checked: cur === `${p.id}:${m}`, onClick: () => pick(`${p.id}:${m}`) })); });
      if (!on.length) items.push({ title: '还没有启用任何模型' });
      items.push('-', { label: '模型与接口设置…', icon: 'settings', onClick: () => app.openSettings() });
      showMenu(items, 0, 0, { anchor, minWidth: 260 });
    },
  };

  // ---------- 对外 ----------
  function toggle(force) {
    if (docked) { setOpen(force == null ? !open : !!force); return; }
    const anyShown = [...floats.values()].some((w) => !w.hidden);
    const want = force == null ? !anyShown : !!force;
    floats.forEach((w) => { w.hidden = !want; });
    setOpen(false, false);
  }
  app.bus.on('project', () => sessions.forEach((s) => s.reset()));
  return {
    mount, toggle,
    addRef(r) { const s = target(); show(s); s.addRef(r); },
    prefill(text, o) { const s = target(); show(s); s.prefill(text, o); },
    newWindow: () => mgr.newWindow(),
  };
}
