/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
'use strict';

// server.js —— 端口监听、静态文件、API、自动打开浏览器、终端退出（零 npm 依赖）
// Local HTTP entry point for the build-free workbench.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const store = require('./store');
const auth = require('./auth');
const tasks = require('./tasks');
const providers = require('./providers');
const system = require('./system');

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
  if(pathname === '/mcp') {
    const conf=require('./extensions').mcpConfig();
    const host=req.headers.host||'';
    if(!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || (req.headers.origin && req.headers.origin!==`http://${host}`)) throw new ApiError(403,'MCP 仅允许本机同源访问');
    const token=(req.headers.authorization||'').replace(/^Bearer /,'');
    const hash=v=>require('node:crypto').createHash('sha256').update(v).digest();
    if(!require('node:crypto').timingSafeEqual(hash(token),hash(conf.token)))throw new ApiError(401,'MCP token 无效');
    if(method!=='POST'){res.writeHead(405,{Allow:'POST'});res.end();return;}
    const b=await readJsonBody(req);
    try {
      if(b.jsonrpc!=='2.0'||typeof b.method!=='string')throw new ApiError(400,'Invalid JSON-RPC request');
      const r=await require('./mcp').dispatch(b,req.headers['mcp-session-id']);
      if(r.notification || b.id===undefined){res.writeHead(202);res.end();return;}
      res.writeHead(200,{'Content-Type':'application/json',...(r.sid?{'Mcp-Session-Id':r.sid}:{})});
      res.end(JSON.stringify({jsonrpc:'2.0',id:b.id,...(r.error?{error:r.error}:{result:r.result})}));
    }catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:b.id??null,error:{code:-32000,message:e.message}}));}
    return;
  }
  auth.checkOrigin(req);
  if (pathname === '/api/auth') {
    if(method==='GET'){sendData(res,auth.publicSession(auth.session(req)));return;}
    if(method==='POST'){sendData(res,auth.login(req,res,await readJsonBody(req)));return;}
    if(method==='PUT'){sendData(res,auth.update(req,res,await readJsonBody(req)));return;}
    if(method==='DELETE'){sendData(res,auth.logout(req,res));return;}
  }
  if(pathname==='/api/appearance'&&method==='GET') {const ext=require('./extensions');sendData(res,{plugins:ext.plugins().filter(p=>p.enabled).map(p=>({manifest:{id:p.manifest.id,name:p.manifest.name,themes:p.manifest.themes||[]},files:p.files})),styleEnabled:ext.plugins().some(p=>p.manifest.id==='official-styles'&&p.enabled)});return;}
  if(pathname.startsWith('/api/'))auth.requireSession(req);
  const ext=require('./extensions');
  if(pathname==='/api/extensions') {
    if(method==='GET')sendData(res,{plugins:ext.plugins(),skills:ext.userSkills(),preferences:ext.preferences()});
    else if(method==='POST')sendData(res,ext.install(await readJsonBody(req)));
    else throw new ApiError(405,'不支持的方法');return;
  }
  if(pathname==='/api/plugins/action'&&method==='POST'){const b=await readJsonBody(req);sendData(res,ext.updatePlugin(b.id,b.action,b.settings));return;}
  if(pathname==='/api/skills'){sendData(res,method==='PUT'?ext.updateSkill(await readJsonBody(req)):ext.userSkills());return;}
  if(pathname==='/api/preferences'){sendData(res,ext.preferences(method==='PUT'?await readJsonBody(req):null));return;}
  if(pathname==='/api/design-presets'){sendData(res,ext.designPresets(method==='PUT'?await readJsonBody(req):null));return;}
  if(pathname==='/api/tools'&&method==='GET'){sendData(res,[...require('./tools').list(),...tasks.toolsFor({mode:'create',collaboration:'auto'}).filter(t=>!require('./tools').has(t.function.name)).map(t=>({name:t.function.name,description:t.function.description+'（内置 Agent 任务专用）',inputSchema:t.function.parameters,annotations:{readOnlyHint:t.function.name==='request_input'}}))]);return;}
  if(pathname==='/api/mcp/config'){const config=ext.mcpConfig(method==='PUT'?await readJsonBody(req):null);sendData(res,{...config,command:process.execPath,args:[path.join(ROOT,'server','mcp-stdio.js')],env:{CENTDECK_URL:`http://127.0.0.1:${req.socket.localPort}`,...(process.env.CENTDECK_CONFIG_DIR?{CENTDECK_CONFIG_DIR:store.CONFIG_DIR}:{})},endpoint:`http://127.0.0.1:${req.socket.localPort}/mcp`});return;}
  if(pathname==='/api/ui/heartbeat'&&method==='POST'){sendData(res,require('./ui-bridge').heartbeat(await readJsonBody(req)));return;}
  if(pathname==='/api/ui/result'&&method==='POST'){sendData(res,require('./ui-bridge').complete(await readJsonBody(req)));return;}

  if(pathname==='/api/system'&&method==='GET'){sendData(res,await system.info());return;}
  if(pathname==='/api/system/updates'&&method==='GET'){try{sendData(res,await system.updates());}catch{throw new ApiError(502,'暂时无法连接 GitHub 检查更新');}return;}
  if(pathname==='/api/system/restart'&&method==='POST'){
    sendData(res,{restarting:true});
    setTimeout(()=>{const port=activeServer.address().port;const child=spawn(process.execPath,['-e',`setTimeout(()=>require(${JSON.stringify(__filename)}),700)`],{cwd:ROOT,env:{...process.env,PORT:String(port),CENTDECK_NO_OPEN:'1'},detached:true,stdio:'ignore',windowsHide:true});child.unref();shutdown();},200);return;
  }
  const exportMatch=pathname.match(/^\/api\/projects\/([^/]+)\/export$/);
  if(exportMatch&&method==='GET'){const buffer=require('./export').exportProject(decodeURIComponent(exportMatch[1]));res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="centdeck-project.zip"','Content-Length':buffer.length});res.end(buffer);return;}
  if(pathname==='/api/providers/discover'&&method==='POST'){sendData(res,await require('./providers').discoverDraft(await readJsonBody(req)));return;}
  if(pathname==='/api/providers/test'&&method==='POST'){sendData(res,await providers.testModel(await readJsonBody(req)));return;}
  if(pathname==='/api/chat/compact'&&method==='POST'){sendData(res,await require('./conversation-context').compact(await readJsonBody(req)));return;}
  if(pathname==='/api/conversations'&&method==='GET'){
    const {conversations,hasMessages,tasksForConversation}=await import('../app/js/agent/conversations.js');
    sendData(res,store.listProjects().map(summary=>{
      const p=store.getProject(summary.id);
      const records=conversations(p),runs=tasks.list(p.id);
      for(const c of records)for(const t of tasksForConversation(runs,c))if(t.output){
        const message=c.msgs.find(m=>m.role==='assistant'&&m.taskId===t.id);
        if(message)message.text=t.output;else c.msgs.push({role:'assistant',taskId:t.id,text:t.output});
        if(t.updatedAt>c.updatedAt)c.updatedAt=t.updatedAt;
      }
      return {id:p.id,name:p.name,conversations:conversations(p).filter(hasMessages).map(c=>({id:c.id,assistantId:c.assistantId,title:c.title,updatedAt:c.updatedAt,preview:c.msgs.at(-1)?.text?.slice(0,180)||'',search:c.msgs.map(m=>m.text||'').join(' ').slice(0,30000)}))};
    }));return;
  }
  const pm=pathname.match(/^\/api\/providers\/([\w-]+)\/models$/);
  if(pm&&method==='GET'){sendData(res,await providers.discover(pm[1]));return;}
  const tm=pathname.match(/^\/api\/projects\/([^/]+)\/tasks(?:\/([^/]+))?$/);
  if(tm){const id=decodeURIComponent(tm[1]);if(method==='GET'){sendData(res,tasks.list(id));return;}if(method==='POST'){const b=await readJsonBody(req);sendData(res,tm[2]?tasks.action(id,tm[2],b):tasks.start(id,b));return;}throw new ApiError(405,'任务接口只支持 GET / POST');}
  const cm=pathname.match(/^\/api\/projects\/([^/]+)\/changes$/);
  if(cm&&method==='POST'){const b=await readJsonBody(req);sendData(res,require('./changes').commit(decodeURIComponent(cm[1]),b.files));return;}
  const em=pathname.match(/^\/api\/projects\/([^/]+)\/events$/);
  if(em&&method==='GET'){
    const id=decodeURIComponent(em[1]);store.projectDir(id);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});
    const send=()=>res.write('data: '+JSON.stringify(tasks.list(id))+'\n\n');send();const off=tasks.subscribe(p=>{if(p===id)send();});const heart=setInterval(()=>res.write(': alive\n\n'),25000);req.on('close',()=>{off();clearInterval(heart);});return;
  }

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
  if (pathname === '/api/assistants') {
    if (method === 'GET') { sendData(res, store.getAssistants()); return; }
    if (method === 'PUT') { sendData(res, store.saveAssistants(await readJsonBody(req))); return; }
    throw new ApiError(405, '助手接口只支持 GET / PUT');
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

  m = pathname.match(/^\/show\/([^/]+)\/(.+)$/);
  if(m&&method==='GET'){
    if(!auth.session(req)||auth.session(req).mustChange){res.writeHead(302,{Location:'/?project='+encodeURIComponent(decodeURIComponent(m[1]))});res.end();return;}
    const id=decodeURIComponent(m[1]),rel=decodeURIComponent(m[2]);
    const html=require('./presentation').render(id,rel,url);
    if(html!=null){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);}
    else serveStatic(res,store.projectDir(id),m[2],'预览资源',{denyMeta:true});return;
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
  server.listen(port, '127.0.0.1', () => {
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

auth.account();
listen(requestedPort(), MAX_PORT_ATTEMPTS);
