// 导入网页：选文件 / 选文件夹 / 直接拖进来 → 上传 → 体检 → 报告（有问题可一键把整理提示词放进助手）
import { el, esc, toast, openModal } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { checkProject, tidyPrompt } from './health.js';

const MAX_FILE = 25 * 1024 * 1024, MAX_TOTAL = 100 * 1024 * 1024;
const SKIP = /(^|\/)(node_modules|\.git|__MACOSX)(\/|$)|(^|\/)\.[^/]*$/;

export function pickFiles(folder) {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.multiple = true;
    if (folder) i.webkitdirectory = true;
    else i.accept = '.html,.htm,.css,.js,.json,.svg,.png,.jpg,.jpeg,.gif,.webp,.avif,.ico,.woff,.woff2,.ttf,.otf,.mp4,.webm';
    i.onchange = () => resolve([...i.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })));
    i.click();
  });
}

// 拖进来的可能是文件夹：逐层展开
export async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])].map((f) => ({ file: f, path: f.name }));
  const out = [];
  const readAll = (reader) => new Promise((res) => { const acc = []; const step = () => reader.readEntries((batch) => { if (!batch.length) res(acc); else { acc.push(...batch); step(); } }, () => res(acc)); step(); });
  const walk = async (entry, prefix) => {
    if (entry.isFile) { const f = await new Promise((res) => entry.file(res, () => res(null))); if (f) out.push({ file: f, path: prefix + f.name }); return; }
    if (entry.isDirectory && !SKIP.test(prefix + entry.name)) for (const ch of await readAll(entry.createReader())) await walk(ch, prefix + entry.name + '/');
  };
  for (const e of entries) await walk(e, '');
  return out;
}

const toB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('读取文件失败：' + file.name)); r.readAsDataURL(file); });

export async function runImport(app, items) {
  items = items.filter((x) => !SKIP.test(x.path));
  if (!items.some((x) => /\.html?$/i.test(x.path))) { toast('没有找到 .html 网页文件。可以选单个网页，或包含网页的整个文件夹', 'err', 4200); return null; }
  const big = items.filter((x) => x.file.size > MAX_FILE);
  items = items.filter((x) => x.file.size <= MAX_FILE);
  const total = items.reduce((s, x) => s + x.file.size, 0);
  if (total > MAX_TOTAL) { toast('文件加起来超过 100MB，请去掉视频之类的大文件再导入', 'err', 4200); return null; }
  const done = toast(`正在读取 ${items.length} 个文件…`, '', 0);
  let files;
  try { files = await Promise.all(items.map(async (x) => ({ path: x.path, dataBase64: await toB64(x.file) }))); } catch (e) { done(); toast(e.message, 'err'); return null; }
  const top = items[0].path.includes('/') ? items[0].path.split('/')[0] : '';
  const firstHtml = items.find((x) => /\.html?$/i.test(x.path));
  const name = top || firstHtml.path.split('/').pop().replace(/\.html?$/i, '');
  let proj;
  try { proj = await app.api.importProject(name, files); } catch { done(); return null; }
  done();
  const checking = toast('导入完成，正在体检每个页面…', '', 0);
  const strip = (p) => (top && p.startsWith(top + '/') ? p.slice(top.length + 1) : p);
  const report = await checkProject(app, proj, new Set(items.map((x) => strip(x.path))));
  checking();
  showReport(app, proj, report, big.map((x) => x.path));
  return proj;
}

const GRADE = { green: ['完整可改', 'green', 'check'], yellow: ['大部分能改', 'yellow', 'info'], red: ['只能查看，修改交给 AI', 'red', 'eye'] };

export function showReport(app, proj, report, skipped = []) {
  const worst = report.some((r) => r.grade === 'red') ? 'red' : report.some((r) => r.grade === 'yellow') ? 'yellow' : 'green';
  const body = el(`<div class="import-report">
    <p class="ir-lead">${worst === 'green' ? '所有页面都能直接改字、拖动、调整。' : worst === 'yellow' ? '大部分能直接改，下面几处要注意。说不清的地方可以让 AI 先把写法整理一遍。' : '有页面的内容是脚本生成的，只能查看和圈选；修改交给 AI 更稳。'}</p>
    <div class="ir-list"></div>
    ${skipped.length ? `<p class="hint">太大没有导入：${esc(skipped.join('、'))}</p>` : ''}</div>`);
  report.forEach((r) => {
    const [label, cls, ic] = GRADE[r.grade];
    const row = el(`<div class="ir-row"><div class="ir-head"><span class="chip ${cls}">${icon(ic, 12)}${label}</span><b>${esc(r.title)}</b><span class="hint">${esc(r.file)}</span></div>
      ${r.issues.length ? `<ul>${r.issues.map((i) => `<li class="${i.level}">${esc(i.text)}</li>`).join('')}</ul>` : ''}</div>`);
    body.querySelector('.ir-list').appendChild(row);
  });
  const actions = [{ label: '打开项目', kind: worst === 'green' ? 'primary' : '', onClick: (c) => { c(); app.openProject(proj.id); } }];
  if (worst !== 'green') actions.push({
    label: '让 AI 整理格式', kind: 'primary', onClick: async (c) => {
      c();
      await app.openProject(proj.id);
      app.agent.prefill(tidyPrompt(proj, report), { skill: 'tidy-import' });
      toast('整理要求已经放进助手输入框，检查一下再发送', 'ok', 4200);
    },
  });
  openModal({ title: `导入完成 · ${proj.name}`, body, width: 620, actions });
}
