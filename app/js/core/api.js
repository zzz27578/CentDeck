// api.js —— 封装全部服务端调用（合同 §3）
// 统一约定：服务端返回 { ok: true, data } 或 { ok: false, error: "中文错误" }；
// 本模块把 data 直接解出来；出错时抛出 ApiError（message 为服务端中文错误）。
// toast 提示由 main.js 注入（参数 withError 中的 toast），避免本模块依赖界面。

const BASE = '';
const bases=new Map();
function remember(p){const copy=structuredClone(p);delete copy.tokens;bases.set(p.id,copy);return p;}
async function sha(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text||''));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let defaultOnError = null;
export function setApiErrorHandler(fn) { defaultOnError = fn; }

async function request(method, url, body, opts = {}) {
  if (opts.toast !== false && !opts.withError && defaultOnError) opts = { ...opts, withError: defaultOnError };
  let res;
  try {
    res = await fetch(BASE + url, {
      method,
      headers: { 'X-CentDeck': '1', ...(body != null ? { 'Content-Type': 'application/json' } : {}) },
      body: body != null ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch (e) {
    const err = new ApiError('连不上本地服务：请确认 CentDeck 服务正在运行');
    if (opts.toast !== false && opts.withError) opts.withError(err);
    throw err;
  }
  let payload = null;
  try { payload = await res.json(); } catch { /* 非 JSON 响应按失败处理 */ }
  if (!payload || payload.ok !== true) {
    const msg = payload && payload.error ? payload.error : `请求失败（${res.status}）`;
    const err = new ApiError(msg, res.status);
    if (opts.toast !== false && opts.withError) opts.withError(err);
    throw err;
  }
  return payload.data;
}

// 所有方法接受可选 opts：{ toast: false 关闭自动错误提示, withError: 错误处理回调 }
export const api = {
  extension: (url, body, method) => request(method || (body ? 'POST' : 'GET'), '/api/' + url, body),
  auth: () => request('GET','/api/auth',null,{toast:false}),
  login: body => request('POST','/api/auth',body,{toast:false}),
  account: body => request('PUT','/api/auth',body,{toast:false}),
  logout: () => request('DELETE','/api/auth'),
  system: () => request('GET','/api/system'),
  updates: () => request('GET','/api/system/updates'),
  restart: () => request('POST','/api/system/restart',{}),
  models: id => request('GET',`/api/providers/${encodeURIComponent(id)}/models`),
  tasks: id => request('GET',`/api/projects/${encodeURIComponent(id)}/tasks`),
  startTask: (id,body) => request('POST',`/api/projects/${encodeURIComponent(id)}/tasks`,body),
  taskAction: (id,tid,body) => request('POST',`/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(tid)}`,body),
  listTemplates: (opts) => request('GET', '/api/templates', null, opts),
  listProjects: (opts) => request('GET', '/api/projects', null, opts),
  createProject: (template, name, opts) => request('POST', '/api/projects', { template, name }, opts),
  createBlank: (name, opts) => request('POST', '/api/projects', { blank: true, name }, opts),
  importProject: (name, files, opts) => request('POST', '/api/import', { name, files }, opts),
  addPage: (id, page, opts) => request('POST', `/api/projects/${encodeURIComponent(id)}/pages`, page, opts),
  removePage: (id, file, opts) => request('DELETE', `/api/projects/${encodeURIComponent(id)}/pages?file=${encodeURIComponent(file)}`, null, opts),
  getSettings: (opts) => request('GET', '/api/settings', null, opts),
  saveSettings: (s, opts) => request('PUT', '/api/settings', s, opts),
  getAssistants: (opts) => request('GET', '/api/assistants', null, opts),
  saveAssistants: (list, opts) => request('PUT', '/api/assistants', list, opts),
  getProject: (id, opts) => request('GET', `/api/projects/${encodeURIComponent(id)}`, null, opts).then(remember),
  saveProject: (id, proj, opts) => request('PUT', `/api/projects/${encodeURIComponent(id)}`, {...proj,_base:bases.get(id)}, opts).then(remember),
  readFile: (id, path, opts) =>
    request('GET', `/api/projects/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`, null, opts)
      .then((d) => d.content),
  writeFile: async (id, path, content, opts={}) =>
    request('PUT', `/api/projects/${encodeURIComponent(id)}/file`, { path, content, ...(opts.expectedContent!==undefined?{baseHash:await sha(opts.expectedContent)}:{}) }, opts),
  commitFiles: async (id, files) => request('POST',`/api/projects/${encodeURIComponent(id)}/changes`,{files:await Promise.all(files.map(async f=>({path:f.path,content:f.content,baseHash:await sha(f.before)})))}),
  listHistory: (id, opts) => request('GET', `/api/projects/${encodeURIComponent(id)}/history`, null, opts),
  restoreHistory: (id, hid, opts) =>
    request('POST', `/api/projects/${encodeURIComponent(id)}/history/${encodeURIComponent(hid)}/restore`, {}, opts),
  resetProject: (id, opts) => request('POST', `/api/projects/${encodeURIComponent(id)}/reset`, {}, opts),
  deleteProject: (id, opts) => request('DELETE', `/api/projects/${encodeURIComponent(id)}`, null, opts),
  listAssets: (id, opts) => request('GET', `/api/projects/${encodeURIComponent(id)}/assets`, null, opts),
  saveAsset: (id, filename, dataBase64, opts) =>
    request('POST', `/api/projects/${encodeURIComponent(id)}/assets`, { filename, dataBase64 }, opts),
};
