'use strict';

// server.js —— 端口监听、静态文件、API、自动打开浏览器、终端退出（零 npm 依赖）
// 约定见 docs/第一步实现约定.md 第 1~3 节。

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const store = require('./store');

const { ApiError } = store;

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const DEFAULT_PORT = 8420;
const MAX_PORT_ATTEMPTS = 10;
const BODY_LIMIT = 120 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

// ---------- 响应工具 ----------

function sendData(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ ok: true, data }));
}

function sendError(res, err) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const status = err instanceof ApiError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ ok: false, error: message }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new ApiError(413, '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBody(req);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new ApiError(400, '请求体不是合法的 JSON');
  }
}

// ---------- 静态文件 ----------

function sendFile(res, filePath) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      sendError(res, new ApiError(404, '文件不存在'));
      return;
    }
    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.end());
    stream.pipe(res);
  });
}

// 静态目录托管：rel 为 URL 中的相对部分，防路径穿越；目录默认尝试 index.html
function serveStatic(res, baseDir, relParam, label, { denyMeta = false } = {}) {
  let rel = decodeURIComponent(relParam || '');
  rel = rel.replace(/^\/+/, '');
  const target = rel === '' ? baseDir : store.safeJoin(baseDir, rel);
  if (denyMeta) {
    const r = path.relative(baseDir, target);
    if (r === '.centdeck' || r.startsWith('.centdeck' + path.sep)) {
      throw new ApiError(400, '不允许访问 .centdeck 元数据目录');
    }
  }
  let filePath = target;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new ApiError(404, `${label || '文件'}不存在`);
  }
  sendFile(res, filePath);
}

// GET / —— app/index.html 还没有时给出友好提示，不崩溃
function serveAppIndex(res) {
  const indexPath = path.join(APP_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>CentDeck 百映</title>' +
        '<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#f5f5f4;' +
        'color:#444;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}' +
        '.card{background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:32px 40px;' +
        'max-width:520px;line-height:1.8}code{background:#f0efec;padding:2px 6px;border-radius:4px}</style>' +
        '</head><body><div class="card">' +
        '<h2 style="margin-top:0">CentDeck 百映</h2>' +
        '<p>本地服务已经启动，但工作台界面 <code>app/index.html</code> 还没有创建。</p>' +
        '<p>等界面模块就绪后，刷新本页即可进入工作台。</p>' +
        '</div></body></html>'
    );
    return;
  }
  sendFile(res, indexPath);
}

// ---------- 路由 ----------

async function handle(req, res) {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname;

  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    serveAppIndex(res);
    return;
  }
  if (method === 'GET' && (pathname === '/app' || pathname.startsWith('/app/'))) {
    serveStatic(res, APP_DIR, pathname.slice(4), '工作台文件');
    return;
  }

  if (pathname === '/api/templates') {
    if (method !== 'GET') throw new ApiError(405, '模板列表只支持 GET');
    sendData(res, store.listTemplates());
    return;
  }
  if (pathname === '/api/projects') {
    if (method === 'GET') {
      sendData(res, store.listProjects());
      return;
    }
    if (method === 'POST') {
      sendData(res, store.createProject(await readJsonBody(req)), 201);
      return;
    }
    throw new ApiError(405, '项目列表只支持 GET / POST');
  }

  let m = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === 'GET') {
      sendData(res, store.getProject(id));
      return;
    }
    if (method === 'PUT') {
      sendData(res, store.saveProject(id, await readJsonBody(req)));
      return;
    }
    if (method === 'DELETE') {
      sendData(res, store.deleteProject(id));
      return;
    }
    throw new ApiError(405, '项目接口只支持 GET / PUT / DELETE');
  }

  if (pathname === '/api/import') {
    if (method !== 'POST') throw new ApiError(405, '导入只支持 POST');
    sendData(res, store.importProject(await readJsonBody(req)), 201);
    return;
  }
  if (pathname === '/api/settings') {
    if (method === 'GET') { sendData(res, store.getSettings()); return; }
    if (method === 'PUT') { sendData(res, store.saveSettings(await readJsonBody(req))); return; }
    throw new ApiError(405, '设置接口只支持 GET / PUT');
  }

  m = pathname.match(/^\/api\/projects\/([^/]+)\/pages$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === 'POST') { sendData(res, store.addPage(id, await readJsonBody(req)), 201); return; }
    if (method === 'DELETE') { sendData(res, store.removePage(id, url.searchParams.get('file'))); return; }
    throw new ApiError(405, '页面接口只支持 POST / DELETE');
  }

  m = pathname.match(/^\/api\/projects\/([^/]+)\/file$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === 'GET') {
      const p = url.searchParams.get('path');
      const content = store.readProjectFile(id, p);
      sendData(res, { path: p, content });
      return;
    }
    if (method === 'PUT') {
      sendData(res, store.writeProjectFile(id, await readJsonBody(req)));
      return;
    }
    throw new ApiError(405, '文件接口只支持 GET / PUT');
  }

  m = pathname.match(/^\/api\/projects\/([^/]+)\/history$/);
  if (m) {
    if (method !== 'GET') throw new ApiError(405, '历史列表只支持 GET');
    sendData(res, store.listHistory(decodeURIComponent(m[1])));
    return;
  }

  m = pathname.match(/^\/api\/projects\/([^/]+)\/history\/([^/]+)\/restore$/);
  if (m) {
    if (method !== 'POST') throw new ApiError(405, '历史恢复只支持 POST');
    sendData(res, store.restoreHistory(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
    return;
  }

  m = pathname.match(/^\/api\/projects\/([^/]+)\/reset$/);
  if (m) {
    if (method !== 'POST') throw new ApiError(405, '一键还原只支持 POST');
    sendData(res, store.resetProject(decodeURIComponent(m[1])));
    return;
  }

  m = pathname.match(/^\/api\/projects\/([^/]+)\/assets$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === 'GET') {
      sendData(res, store.listAssets(id));
      return;
    }
    if (method === 'POST') {
      sendData(res, store.saveAsset(id, await readJsonBody(req)), 201);
      return;
    }
    throw new ApiError(405, '素材接口只支持 GET / POST');
  }

  m = pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
  if (m) {
    if (method !== 'GET') throw new ApiError(405, '预览只支持 GET');
    const dir = store.projectDir(decodeURIComponent(m[1]));
    serveStatic(res, dir, m[2] || '', '预览文件', { denyMeta: true });
    return;
  }

  m = pathname.match(/^\/tpl\/([^/]+)(\/.*)?$/);
  if (m) {
    if (method !== 'GET') throw new ApiError(405, '模板预览只支持 GET');
    const tid = decodeURIComponent(m[1]);
    store.assertValidId(tid, '模板 ID');
    serveStatic(res, path.join(store.TEMPLATES_DIR, tid), m[2] || '', '模板文件');
    return;
  }

  if (pathname.startsWith('/api/')) throw new ApiError(404, '接口不存在');
  throw new ApiError(404, '页面不存在');
}

// ---------- 启动 / 退出 ----------

let activeServer = null;
let shuttingDown = false;

function createHttpServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!(err instanceof ApiError)) {
        console.error('[CentDeck] 服务内部错误：', err);
      }
      sendError(res, err);
    });
  });
}

function printBanner(port) {
  console.log('');
  console.log('  ==========================================');
  console.log('    CentDeck 百映 · 本地服务已启动');
  console.log(`    地址：http://localhost:${port}`);
  console.log('    退出：输入 exit / quit / q 回车，或按 Ctrl+C');
  console.log('  ==========================================');
  console.log('');
}

function openBrowser(url) {
  let cmd;
  let args;
  if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => console.log(`请手动打开浏览器访问：${url}`));
    child.unref();
  } catch {
    console.log(`请手动打开浏览器访问：${url}`);
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (activeServer) activeServer.close();
  } catch {
    // 忽略关闭过程中的异常
  }
  console.log('CentDeck 已停止监听');
  process.exit(0);
}

function setupExit() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const cmd = line.trim().toLowerCase();
    if (cmd === 'exit' || cmd === 'quit' || cmd === 'q') shutdown();
  });
  // 标准输入异常（如管道/后台运行）不应影响服务本身
  rl.on('error', () => {});
  process.stdin.on('error', () => {});
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function listen(port, attemptsLeft) {
  const server = createHttpServer();
  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && attemptsLeft > 1) {
      console.log(`端口 ${port} 被占用，尝试 ${port + 1} ……`);
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(`启动失败：${err && err.message ? err.message : err}`);
    process.exit(1);
  });
  server.listen(port, () => {
    activeServer = server;
    printBanner(port);
    // 自测/无头环境可用 CENTDECK_NO_OPEN=1 跳过自动打开浏览器
    if (!process.env.CENTDECK_NO_OPEN) {
      openBrowser(`http://localhost:${port}`);
    }
    setupExit();
  });
}

function requestedPort() {
  const raw = process.env.PORT;
  if (!raw) return DEFAULT_PORT;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

listen(requestedPort(), MAX_PORT_ATTEMPTS);
