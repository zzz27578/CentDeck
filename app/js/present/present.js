// 放映：像 PPT 放映一样进入全屏，网页按 100% 真实比例铺满屏幕，没有任何工具条，
// 就像访客真的在浏览器里打开它；页面里的链接、按钮、弹窗都是真的。按 Esc 退出。
import { el, toast } from '../core/ui.js';
import { attachDoc, bindKey } from '../core/keys.js';

export function createPresent(app) {
  let host = null, frame = null, back = 'overview', leaving = false;
  const url = (f) => `/preview/${encodeURIComponent(app.project().id)}/${f}`;

  function onFsChange() {
    if (!document.fullscreenElement && host && !leaving) exit();
  }
  function onLoad() {
    try { attachDoc(frame.contentDocument); } catch { /* 跳到了外部网站：跨域，忽略 */ }
  }

  function enter(wrap) {
    const pages = app.project().pages;
    if (!pages.length) { toast('还没有页面可以放映', 'err'); setTimeout(() => app.setView(back), 0); return; }
    back = app.state.lastView && app.state.lastView !== 'present' ? app.state.lastView : 'overview';
    leaving = false;
    host = el('<div class="present-host"><iframe class="pv-full" title="放映"></iframe></div>');
    frame = host.firstElementChild;
    frame.addEventListener('load', onLoad);
    wrap.appendChild(host);
    document.body.classList.add('presenting');
    frame.src = url(app.state.presentFrom && pages.some((p) => p.file === app.state.presentFrom) ? app.state.presentFrom : pages[0].file);
    document.addEventListener('fullscreenchange', onFsChange);
    const req = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    if (req && req.catch) req.catch(() => toast('浏览器没有允许全屏，已铺满窗口放映 · 按 Esc 退出', '', 3200));
    setTimeout(() => { try { frame.focus(); } catch { /* 忽略 */ } }, 80);
  }
  function leave() {
    leaving = true;
    document.removeEventListener('fullscreenchange', onFsChange);
    document.body.classList.remove('presenting');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    host = frame = null;
  }
  function exit() { app.setView(back); }
  app.bus.on('view', (v) => { if (v !== 'present') app.state.lastView = v; });
  bindKey('Esc', { hidden: true, priority: 90, field: true, when: () => app.state.view === 'present' && !!host, run: exit });
  return { enter, leave };
}
