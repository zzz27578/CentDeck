// 模型与接口设置（第二步的壳）：服务商、接口地址、密钥、模型列表、经济档 / 专家档用哪个模型。
// 密钥只保存在本机 config.local/（不进 Git），浏览器里永远只看到末四位。
import { el, esc, toast, openModal } from '../core/ui.js';
import { icon } from '../core/icons.js';

export async function openSettings(app) {
  let s;
  try { s = await app.api.getSettings(); } catch { return; }
  const edits = {};
  let cur = s.providers[0].id;
  const body = el(`<div class="set-wrap">
    <nav class="set-nav"></nav>
    <div class="set-main"></div></div>`);
  const nav = body.querySelector('.set-nav'), main = body.querySelector('.set-main');
  const val = (p, k) => (edits[p.id] && k in edits[p.id] ? edits[p.id][k] : p[k]);
  const set = (p, k, v) => { edits[p.id] = { ...(edits[p.id] || {}), id: p.id, [k]: v }; };
  const allModels = () => s.providers.filter((p) => val(p, 'enabled')).flatMap((p) => (val(p, 'models') || []).map((m) => ({ v: `${p.id}:${m}`, label: `${p.name} · ${m}` })));

  function paintNav() {
    nav.innerHTML = '';
    s.providers.forEach((p) => {
      const b = el(`<button class="set-item ${p.id === cur ? 'on' : ''}"><span>${esc(p.name)}</span>${val(p, 'enabled') ? '<i class="on-dot"></i>' : ''}</button>`);
      b.onclick = () => { cur = p.id; paintNav(); paintMain(); };
      nav.appendChild(b);
    });
    const r = el(`<button class="set-item ${cur === '__roles' ? 'on' : ''}"><span>${icon('sliders', 14)} 分档与默认</span></button>`);
    r.onclick = () => { cur = '__roles'; paintNav(); paintMain(); };
    nav.appendChild(r);
  }
  function paintMain() {
    if (cur === '__roles') {
      const opts = (sel) => ['<option value="">（未设置）</option>', ...allModels().map((m) => `<option value="${esc(m.v)}" ${m.v === sel ? 'selected' : ''}>${esc(m.label)}</option>`)].join('');
      main.innerHTML = `<h3>分档与默认</h3>
        <p class="hint">能手动改的小地方不花钱；要 AI 时按任务大小自动分档：经济档负责改字、调样式这类小活，专家档负责出方案、改结构。</p>
        <label class="set-field">经济档（便宜、快）<select class="sel" data-r="economy">${opts(s.roles.economy)}</select></label>
        <label class="set-field">专家档（能力强）<select class="sel" data-r="expert">${opts(s.roles.expert)}</select></label>
        <p class="hint">下拉里只列出已启用的服务商的模型。</p>`;
      main.querySelectorAll('[data-r]').forEach((x) => { x.onchange = () => { s.roles[x.dataset.r] = x.value; }; });
      return;
    }
    const p = s.providers.find((x) => x.id === cur);
    main.innerHTML = `<div class="set-title"><h3>${esc(p.name)}</h3>
        <label class="switch"><input type="checkbox" ${val(p, 'enabled') ? 'checked' : ''} data-k="enabled"><span></span>启用</label></div>
      <label class="set-field">接口地址<input class="ipt" data-k="baseUrl" value="${esc(val(p, 'baseUrl') || '')}" placeholder="https://…"></label>
      ${p.noKey ? '<p class="hint">本地模型不需要密钥。</p>' : `<label class="set-field">API 密钥
        <div class="set-key"><input class="ipt" type="password" data-k="apiKey" placeholder="${p.hasKey ? '已保存 ' + esc(p.keyHint) + '，留空表示不改' : '粘贴密钥'}" autocomplete="off">
        ${p.hasKey ? '<button class="btn small" data-a="clear">清除</button>' : ''}</div></label>`}
      <label class="set-field">模型（逗号分隔）<input class="ipt" data-k="models" value="${esc((val(p, 'models') || []).join(', '))}" placeholder="例如：deepseek-chat, deepseek-reasoner"></label>
      <div class="set-foot"><button class="btn small" disabled data-tip="第二步接入模型后可用">${icon('refresh', 14)}测试连接</button><span class="hint">密钥只存在这台电脑的 config.local 文件夹里，不会上传。</span></div>`;
    main.querySelector('[data-k=enabled]').onchange = (e) => { set(p, 'enabled', e.target.checked); paintNav(); };
    main.querySelector('[data-k=baseUrl]').oninput = (e) => set(p, 'baseUrl', e.target.value);
    main.querySelector('[data-k=models]').oninput = (e) => set(p, 'models', e.target.value.split(/[,，\s]+/).filter(Boolean));
    const key = main.querySelector('[data-k=apiKey]');
    if (key) key.oninput = (e) => set(p, 'apiKey', e.target.value);
    const clr = main.querySelector('[data-a=clear]');
    if (clr) clr.onclick = () => { set(p, 'apiKey', null); p.hasKey = false; paintMain(); toast('保存后会清除这个密钥'); };
  }
  paintNav();
  paintMain();
  openModal({
    title: '模型与接口', width: 760, body, className: 'set-modal',
    actions: [{ label: '取消' }, { label: '保存', kind: 'primary', onClick: async (c) => {
      try { await app.api.saveSettings({ providers: Object.values(edits), roles: s.roles }); toast('设置已保存', 'ok'); c(); app.bus.emit('settings'); } catch { /* 已提示 */ }
    } }],
  });
}
