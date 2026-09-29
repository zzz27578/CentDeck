'use strict';

// store.js —— 模板/项目读写、快照、还原、版本历史（仅用 node: 内置模块）
// 约定见 docs/第一步实现约定.md 第 3、4 节。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const PROJECTS_DIR = path.join(ROOT, 'projects');
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
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
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
      const meta = readJson(path.join(PROJECTS_DIR, entry.name, 'project.json'), '项目缺少 project.json');
      out.push({
        id: entry.name,
        name: meta.name || entry.name,
        template: meta.template || '',
        createdAt: meta.createdAt || '',
        pages: Array.isArray(meta.pages) ? meta.pages : [],
      });
    } catch {
      // 跳过无效项目目录
    }
  }
  return out;
}

// ---------- 项目 ----------

function createProject(body) {
  const template = body && body.template;
  assertValidId(template, '模板 ID');
  const tDir = path.join(TEMPLATES_DIR, template);
  if (!fs.existsSync(tDir) || !fs.statSync(tDir).isDirectory()) {
    throw new ApiError(404, `模板不存在：${template}`);
  }
  const tMeta = readJson(path.join(tDir, 'project.json'), '模板缺少 project.json');

  let name = body && typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) name = tMeta.name || template;

  const base = slugify(name) || slugify(template) || 'project';
  let id = base;
  for (let n = 2; fs.existsSync(path.join(PROJECTS_DIR, id)); n += 1) {
    id = `${base}-${n}`;
  }

  const dir = path.join(PROJECTS_DIR, id);
  const excludeMeta = (nm) => nm === '.centdeck';
  copyDir(tDir, dir, excludeMeta);
  // 原始快照：完整复制模板，供一键还原使用
  copyDir(tDir, path.join(dir, '.centdeck', 'pristine'), excludeMeta);

  const proj = {
    id,
    name,
    template,
    type: tMeta.type || '',
    description: tMeta.description || '',
    createdAt: new Date().toISOString(),
    pages: Array.isArray(tMeta.pages) ? tMeta.pages : [],
    marks: [],
    notes: [],
    locks: { pages: [], elements: [] },
  };
  writeJson(path.join(dir, 'project.json'), proj);
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
  writeJson(path.join(dir, 'project.json'), { ...body, id });
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
  // 恢复全部页面
  const pristinePages = path.join(pristine, 'pages');
  if (fs.existsSync(pristinePages)) {
    fs.rmSync(path.join(dir, 'pages'), { recursive: true, force: true });
    copyDir(pristinePages, path.join(dir, 'pages'));
  }
  // 恢复设计规范
  const pristineTokens = path.join(pristine, 'design', 'tokens.json');
  if (fs.existsSync(pristineTokens)) {
    fs.mkdirSync(path.join(dir, 'design'), { recursive: true });
    fs.copyFileSync(pristineTokens, path.join(dir, 'design', 'tokens.json'));
  }
  // 清空标记/便签/锁定
  const projPath = path.join(dir, 'project.json');
  const proj = readJson(projPath, '项目缺少 project.json');
  proj.marks = [];
  proj.notes = [];
  proj.locks = { pages: [], elements: [] };
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

// 删除项目：目录自包含（.centdeck 快照/历史都在里面），整体移除
function deleteProject(id) {
  const dir = projectDir(id);
  fs.rmSync(dir, { recursive: true, force: true });
  return { deleted: id };
}

module.exports = {
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
