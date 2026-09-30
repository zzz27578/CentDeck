'use strict';

// store.js —— 模板/项目读写、快照、还原、版本历史（仅用 node: 内置模块）
// 约定见 docs/第一步实现约定.md 第 3、4 节。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const PROJECTS_DIR = process.env.CENTDECK_PROJECTS_DIR ? path.resolve(process.env.CENTDECK_PROJECTS_DIR) : path.join(ROOT, 'projects');
const HISTORY_LIMIT = 20;
const ID_RE = /^[A-Za-z0-9_-]+$/;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function assertValidId(id, label) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new ApiError(400, `${label}不合法：只允许字母、数字、中划线和下划线`);
  }
}

// 防路径穿越：返回的绝对路径必须位于 base 目录之内
function safeJoin(base, rel) {
  if (typeof rel !== 'string' || rel.trim() === '') {
    throw new ApiError(400, '缺少 path 参数或路径为空');
  }
  const resolved = path.resolve(base, rel);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new ApiError(400, '路径不合法：不允许访问项目目录之外的文件');
  }
  return resolved;
}

function readJson(file, missMsg) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new ApiError(404, missMsg);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(500, `JSON 格式错误：${path.basename(file)}`);
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(file + '.tmp', file);
}

function copyDir(src, dest, excludeName) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (excludeName && excludeName(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d, excludeName);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function projectDir(id) {
  assertValidId(id, '项目 ID');
  const dir = path.join(PROJECTS_DIR, id);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new ApiError(404, '项目不存在');
  }
  return dir;
}

// 项目内文件解析：禁止越界、禁止访问 .centdeck 元数据目录
function resolveProjectFile(dir, relPath) {
  const target = safeJoin(dir, relPath);
  const rel = path.relative(dir, target);
  if (rel === '.centdeck' || rel.startsWith('.centdeck' + path.sep)) {
    throw new ApiError(400, '不允许访问 .centdeck 元数据目录');
  }
  return target;
}

function makeHid() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}-${crypto.randomBytes(2).toString('hex')}`;
}

// ---------- 列表 ----------

function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  const out = [];
  for (const entry of fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const meta = readJson(path.join(TEMPLATES_DIR, entry.name, 'project.json'), '模板缺少 project.json');
      out.push({
        id: entry.name,
        name: meta.name || entry.name,
        type: meta.type || '',
        description: meta.description || '',
        pages: Array.isArray(meta.pages) ? meta.pages : [],
      });
    } catch {
      // 跳过无效模板目录
    }
  }
  return out;
}

function listProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const out = [];
  for (const entry of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const pdir = path.join(PROJECTS_DIR, entry.name);
      const meta = readJson(path.join(pdir, 'project.json'), '项目缺少 project.json');
      const pages = Array.isArray(meta.pages) ? meta.pages : [];
      let updated = fs.statSync(path.join(pdir, 'project.json')).mtimeMs;
      pages.forEach((p) => { try { updated = Math.max(updated, fs.statSync(path.join(pdir, p.file)).mtimeMs); } catch { /* 文件缺失时忽略 */ } });
      out.push({
        id: entry.name,
        name: meta.name || entry.name,
        template: meta.template || '',
        kind: meta.kind || (meta.template ? 'template' : 'blank'),
        createdAt: meta.createdAt || '',
        updatedAt: new Date(updated).toISOString(),
        marks: Array.isArray(meta.marks) ? meta.marks.filter((m) => !m.done).length : 0,
        pages,
      });
    } catch {
      // 跳过无效项目目录
    }
  }
  return out;
}

// ---------- 项目 ----------

// 项目 ID：英文名直接转成短横线格式；中文名用时间戳，避免都叫 project
function newProjectId(name) {
  const base = slugify(name) || 'p' + Date.now().toString(36);
  let id = base;
  for (let n = 2; fs.existsSync(path.join(PROJECTS_DIR, id)); n += 1) id = `${base}-${n}`;
  return id;
}

function baseProject(id, name, extra) {
  return {
    id, name, template: '', type: '', description: '', createdAt: new Date().toISOString(),
    pages: [], marks: [], notes: [], locks: { pages: [], elements: [] }, ...extra,
  };
}

function createBlankProject(body) {
  const name = String((body && body.name) || '').trim() || '未命名项目';
  const id = newProjectId(name);
  const dir = path.join(PROJECTS_DIR, id);
  fs.mkdirSync(path.join(dir, '.centdeck', 'pristine'), { recursive: true });
  const proj = baseProject(id, name, { kind: 'blank' });
  writeJson(path.join(dir, 'project.json'), proj);
  require('./project-guides').ensure(dir);
  writeJson(path.join(dir, '.centdeck', 'pristine', 'project.json'), { pages: [] });
  return proj;
}

function createProject(body) {
  if (body && body.blank) return createBlankProject(body);
  const template = body && body.template;
  assertValidId(template, '模板 ID');
  const tDir = path.join(TEMPLATES_DIR, template);
  if (!fs.existsSync(tDir) || !fs.statSync(tDir).isDirectory()) {
    throw new ApiError(404, `模板不存在：${template}`);
  }
  const tMeta = readJson(path.join(tDir, 'project.json'), '模板缺少 project.json');

  let name = body && typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) name = tMeta.name || template;

  const id = newProjectId(slugify(name) ? name : template);
  const dir = path.join(PROJECTS_DIR, id);
  const excludeMeta = (nm) => nm === '.centdeck';
  copyDir(tDir, dir, excludeMeta);
  // 原始快照：完整复制模板，供一键还原使用
  copyDir(tDir, path.join(dir, '.centdeck', 'pristine'), excludeMeta);

  const proj = baseProject(id, name, {
    kind: 'template', template, type: tMeta.type || '', description: tMeta.description || '',
    pages: Array.isArray(tMeta.pages) ? tMeta.pages : [],
  });
  writeJson(path.join(dir, 'project.json'), proj);
  require('./project-guides').ensure(dir);
  return proj;
}

function getProject(id) {
  const dir = projectDir(id);
  const proj = readJson(path.join(dir, 'project.json'), '项目缺少 project.json');
  const tokensPath = path.join(dir, 'design', 'tokens.json');
  const tokens = fs.existsSync(tokensPath)
    ? readJson(tokensPath, 'design/tokens.json 读取失败')
    : null;
  return { ...proj, tokens };
}

function saveProject(id, body) {
  const dir = projectDir(id);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'project.json 必须是一个 JSON 对象');
  }
  const { _base, tokens, ...incoming }=body;
  let next=incoming;
  if(_base&&typeof _base==='object'){
    const current=readJson(path.join(dir,'project.json'),'项目缺失');next={...current};
    for(const k of new Set([...Object.keys(_base),...Object.keys(incoming)])){
      if(['tokens','_base','id'].includes(k))continue;
      if(JSON.stringify(incoming[k])===JSON.stringify(_base[k]))continue;
      if(JSON.stringify(current[k])!==JSON.stringify(_base[k])&&JSON.stringify(current[k])!==JSON.stringify(incoming[k]))throw new ApiError(409,'项目设置已变化，请刷新后重试：'+k);
      if(incoming[k]===undefined)delete next[k];else next[k]=incoming[k];
    }
  }
  writeJson(path.join(dir, 'project.json'), { ...next, id });
  return getProject(id);
}

// ---------- 页面文件 ----------

function readProjectFile(id, relPath) {
  const dir = projectDir(id);
  const target = resolveProjectFile(dir, relPath);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new ApiError(404, '文件不存在');
  }
  return fs.readFileSync(target, 'utf8');
}

function writeProjectFile(id, body) {
  const dir = projectDir(id);
  const relPath = body && body.path;
  const content = body && body.content;
  if (typeof relPath !== 'string' || relPath.trim() === '') {
    throw new ApiError(400, '缺少 path 参数');
  }
  if (typeof content !== 'string') {
    throw new ApiError(400, '缺少 content 参数或 content 不是字符串');
  }
  const target = resolveProjectFile(dir, relPath);
  if (body.baseHash != null) {
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (crypto.createHash('sha256').update(existing).digest('hex') !== body.baseHash) throw new ApiError(409, '文件已被其他编辑修改，请刷新后重试');
  }
  let hid = null;
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isFile()) throw new ApiError(400, '目标路径不是文件');
    // 写回前先把旧内容存进历史快照
    hid = saveHistory(dir, relPath, fs.readFileSync(target, 'utf8'));
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  fs.writeFileSync(target, content, 'utf8');
  return { path: relPath, hid };
}

// ---------- 历史快照 ----------

function saveHistory(dir, relPath, oldContent) {
  const hid = makeHid();
  const hdir = path.join(dir, '.centdeck', 'history', hid);
  const snapFile = path.join(hdir, relPath);
  fs.mkdirSync(path.dirname(snapFile), { recursive: true });
  fs.writeFileSync(snapFile, oldContent, 'utf8');
  writeJson(path.join(hdir, 'meta.json'), {
    hid,
    time: new Date().toISOString(),
    file: relPath,
    note: `修改前自动备份：${relPath}`,
  });
  evictHistory(dir);
  return hid;
}

function evictHistory(dir) {
  const hRoot = path.join(dir, '.centdeck', 'history');
  if (!fs.existsSync(hRoot)) return;
  const entries = fs.readdirSync(hRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(); // hid 以时间戳开头，名字序即时间序
  while (entries.length > HISTORY_LIMIT) {
    fs.rmSync(path.join(hRoot, entries.shift()), { recursive: true, force: true });
  }
}

function listHistory(id) {
  const dir = projectDir(id);
  const hRoot = path.join(dir, '.centdeck', 'history');
  if (!fs.existsSync(hRoot)) return [];
  const out = [];
  for (const name of fs.readdirSync(hRoot)) {
    const metaPath = path.join(hRoot, name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(metaPath, 'utf8')));
    } catch {
      // 跳过损坏的快照记录
    }
  }
  out.sort((a, b) => (a.hid < b.hid ? 1 : -1)); // 新的在前
  return out;
}

function restoreHistory(id, hid) {
  const dir = projectDir(id);
  assertValidId(hid, '历史快照 ID');
  const hdir = path.join(dir, '.centdeck', 'history', hid);
  const metaPath = path.join(hdir, 'meta.json');
  if (!fs.existsSync(metaPath)) throw new ApiError(404, '历史快照不存在');
  const meta = readJson(metaPath, '历史快照信息损坏');
  const snapFile = safeJoin(hdir, meta.file);
  if (!fs.existsSync(snapFile) || !fs.statSync(snapFile).isFile()) {
    throw new ApiError(404, '历史快照内容缺失');
  }
  const target = resolveProjectFile(dir, meta.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(snapFile, target);
  return meta;
}

// ---------- 一键还原 ----------

function resetProject(id) {
  const dir = projectDir(id);
  const pristine = path.join(dir, '.centdeck', 'pristine');
  if (!fs.existsSync(pristine)) {
    throw new ApiError(404, '原始快照缺失，无法一键还原');
  }
  // 除元数据外全部清掉，再从原始快照复制回来（模板、空白、导入三种项目通用）
  const projPath = path.join(dir, 'project.json');
  const proj = readJson(projPath, '项目缺少 project.json');
  const pristineMetaPath = path.join(pristine, 'project.json');
  const pristineMeta = fs.existsSync(pristineMetaPath) ? readJson(pristineMetaPath, '原始快照信息损坏') : { pages: proj.pages };
  for (const name of fs.readdirSync(dir)) {
    if (name !== '.centdeck' && name !== 'project.json') fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
  copyDir(pristine, dir, (nm) => nm === 'project.json');
  proj.pages = Array.isArray(pristineMeta.pages) ? pristineMeta.pages : [];
  proj.marks = [];
  proj.notes = [];
  proj.locks = { pages: [], elements: [] };
  delete proj.canvas;
  writeJson(projPath, proj);
  // 删除全部历史
  fs.rmSync(path.join(dir, '.centdeck', 'history'), { recursive: true, force: true });
  return getProject(id);
}

// ---------- 素材 ----------

function listAssets(id) {
  const dir = projectDir(id);
  const assetsDir = path.join(dir, 'assets');
  if (!fs.existsSync(assetsDir)) return [];
  return fs.readdirSync(assetsDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const st = fs.statSync(path.join(assetsDir, e.name));
      return {
        filename: e.name,
        size: st.size,
        updatedAt: st.mtime.toISOString(),
        url: `/preview/${id}/assets/${encodeURIComponent(e.name)}`,
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

function saveAsset(id, body) {
  const dir = projectDir(id);
  const filename = body && body.filename;
  const dataBase64 = body && body.dataBase64;
  if (typeof filename !== 'string' || !filename.trim()) {
    throw new ApiError(400, '缺少 filename 参数');
  }
  if (filename !== path.basename(filename) || /[\\/]/.test(filename)) {
    throw new ApiError(400, '文件名不合法：不能包含路径');
  }
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
    throw new ApiError(400, '缺少 dataBase64 数据');
  }
  const buf = Buffer.from(dataBase64, 'base64');
  if (buf.length === 0) throw new ApiError(400, 'dataBase64 解码后为空');
  const assetsDir = path.join(dir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, filename), buf);
  return {
    filename,
    size: buf.length,
    url: `/preview/${id}/assets/${encodeURIComponent(filename)}`,
  };
}

// ---------- 导入网页（单个 HTML、多个文件或整个文件夹） ----------
const SKIP_RE = /(^|\/)(node_modules|\.git|\.centdeck|\.svn|__MACOSX)(\/|$)|(^|\/)\.[^/]*$/;
const htmlTitle = (buf) => {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(buf.toString('utf8'));
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 40) : '';
};

function importProject(body) {
  const files = body && Array.isArray(body.files) ? body.files : [];
  if (!files.length) throw new ApiError(400, '没有收到文件');
  let items = files.map((f) => ({
    rel: String(f.path || f.name || '').replace(/\\/g, '/').replace(/^\/+/, ''),
    data: typeof f.dataBase64 === 'string' ? f.dataBase64 : '',
  })).filter((f) => f.rel && !SKIP_RE.test(f.rel));
  for (const f of items) {
    if (f.rel.split('/').some((s) => s === '..' || s.includes(':'))) throw new ApiError(400, `文件路径不合法：${f.rel}`);
  }
  // 整个文件夹上传时路径都带着同一个外层文件夹名，去掉它
  const firsts = new Set(items.map((f) => (f.rel.includes('/') ? f.rel.split('/')[0] : '')));
  if (firsts.size === 1 && !firsts.has('')) items = items.map((f) => ({ ...f, rel: f.rel.slice(f.rel.indexOf('/') + 1) }));
  const html = items.filter((f) => /\.html?$/i.test(f.rel));
  if (!html.length) throw new ApiError(400, '里面没有 .html 网页文件');
  const name = String((body && body.name) || '').trim() || html[0].rel.replace(/\.html?$/i, '');
  const id = newProjectId(name);
  const dir = path.join(PROJECTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const titles = {};
  for (const f of items) {
    const target = safeJoin(dir, f.rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const buf = Buffer.from(f.data, 'base64');
    fs.writeFileSync(target, buf);
    if (/\.html?$/i.test(f.rel)) titles[f.rel] = htmlTitle(buf);
  }
  const rank = (p) => (/^(index|home|default)\.html?$/i.test(p) ? 0 : /^[^/]+$/.test(p) ? 1 : 2);
  const pages = html.map((f) => f.rel).sort((a, b) => rank(a) - rank(b) || a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, 80).map((file) => ({ file, title: titles[file] || file.split('/').pop().replace(/\.html?$/i, '') }));
  const proj = baseProject(id, name, { kind: 'import', pages, description: `导入的网页（${items.length} 个文件）` });
  writeJson(path.join(dir, 'project.json'), proj);
  require('./project-guides').ensure(dir);
  copyDir(dir, path.join(dir, '.centdeck', 'pristine'), (nm) => nm === '.centdeck');
  return proj;
}

// ---------- 页面增删 ----------
const BLANK_PAGE = (title) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title.replace(/[<>&]/g, '')}</title>
  <style>
    body { margin: 0; font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; color: #1f2430; background: #fff; }
    main { max-width: 960px; margin: 0 auto; padding: 72px 24px; }
    h1 { font-size: 40px; margin: 0 0 16px; }
    p { color: #5b6275; line-height: 1.8; }
  </style>
</head>
<body>
  <main>
    <h1>${title.replace(/[<>&]/g, '')}</h1>
    <p>这是一个空白页面。可以让助手按你的描述生成内容，也可以用文字工具直接改这段话。</p>
  </main>
</body>
</html>
`;

function addPage(id, body) {
  const dir = projectDir(id);
  const projPath = path.join(dir, 'project.json');
  const proj = readJson(projPath, '项目缺少 project.json');
  proj.pages = Array.isArray(proj.pages) ? proj.pages : [];
  const title = String((body && body.title) || '').trim() || `新页面 ${proj.pages.length + 1}`;
  const folder = proj.pages.length && !proj.pages.every((p) => p.file.startsWith('pages/')) ? '' : 'pages/';
  let file = body && body.file ? String(body.file) : '';
  if (!file) {
    const slug = slugify(title) || 'page';
    file = `${folder}${slug}.html`;
    for (let n = 2; fs.existsSync(path.join(dir, file)); n += 1) file = `${folder}${slug}-${n}.html`;
  }
  const target = resolveProjectFile(dir, file);
  if (fs.existsSync(target)) throw new ApiError(400, '同名文件已经存在');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof body.content === 'string' ? body.content : BLANK_PAGE(title), 'utf8');
  proj.pages.push({ file, title });
  writeJson(projPath, proj);
  return getProject(id);
}

function removePage(id, file) {
  const dir = projectDir(id);
  const projPath = path.join(dir, 'project.json');
  const proj = readJson(projPath, '项目缺少 project.json');
  const i = (proj.pages || []).findIndex((p) => p.file === file);
  if (i < 0) throw new ApiError(404, '页面不存在');
  const target = resolveProjectFile(dir, file);
  if (fs.existsSync(target)) {
    saveHistory(dir, file, fs.readFileSync(target, 'utf8'));
    fs.rmSync(target, { force: true });
  }
  proj.pages.splice(i, 1);
  writeJson(projPath, proj);
  return getProject(id);
}

// ---------- 模型与接口设置（存在本机 config.local/，被 .gitignore 忽略；密钥永远不完整返回给浏览器） ----------
const CONFIG_DIR = process.env.CENTDECK_CONFIG_DIR ? path.resolve(process.env.CENTDECK_CONFIG_DIR) : path.join(ROOT, 'config.local');
const ASSISTANTS_FILE = path.join(CONFIG_DIR, 'assistants.json');
function getAssistants() {
  if (!fs.existsSync(ASSISTANTS_FILE)) return [{ id: 'assistant-default', name: 'Cent', role: '通用', avatar: 'centdeck', color: '#65784e', prompt: '', responsibility:'', skills: [], model: 'auto', think: 'medium' }];
  return readJson(ASSISTANTS_FILE, '助手配置读取失败');
}
function saveAssistants(body) {
  if (!Array.isArray(body) || body.length > 100) throw new ApiError(400, '助手列表格式不正确（最多 100 个）');
  const ids = new Set();
  const list = body.map(a => {
    if (!a || typeof a.id !== 'string' || !/^[\w-]{1,100}$/.test(a.id) || ids.has(a.id)) throw new ApiError(400, '助手编号无效或重复');
    ids.add(a.id);
    if (typeof a.name !== 'string' || !a.name.trim()) throw new ApiError(400, '助手名字不能为空');
    return { id: a.id, name: a.name.trim().slice(0, 60), role: String(a.role || '通用').slice(0,80), responsibility: String(a.responsibility || '').slice(0,4000),
      avatar: (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(a.avatar) && a.avatar.length < 800000) || ['centdeck','sparkle', 'palette', 'edit', 'check', 'brain', 'book'].includes(a.avatar) ? a.avatar : 'centdeck',
      color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : '#65784e', prompt: String(a.prompt || '').slice(0, 16000),
      skills: Array.isArray(a.skills) ? [...new Set(a.skills.filter(s => typeof s === 'string' && /^[\w-]{1,100}$/.test(s)))].slice(0, 50) : [],
      model: String(a.model || 'auto').slice(0, 200), think: require('./reasoning').normalizeThink(a.think) };
  });
  writeJson(ASSISTANTS_FILE, list);
  return list;
}
// 删除项目：目录自包含（.centdeck 快照/历史都在里面），整体移除
function deleteProject(id) {
  const dir = projectDir(id);
  fs.rmSync(dir, { recursive: true, force: true });
  return { deleted: id };
}

module.exports = {
  CONFIG_DIR,
  ROOT,
  TEMPLATES_DIR,
  PROJECTS_DIR,
  HISTORY_LIMIT,
  ApiError,
  assertValidId,
  safeJoin,
  projectDir,
  listTemplates,
  listProjects,
  createProject,
  importProject,
  addPage,
  removePage,
  getSettings: () => require('./providers').getSettings(),
  saveSettings: body => require('./providers').saveSettings(body),
  getAssistants,
  saveAssistants,
  getProject,
  saveProject,
  deleteProject,
  readProjectFile,
  writeProjectFile,
  listHistory,
  restoreHistory,
  resetProject,
  listAssets,
  saveAsset,
};
