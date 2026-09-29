// api.js —— 封装全部服务端调用（合同 §3）
// 统一约定：服务端返回 { ok: true, data } 或 { ok: false, error: "中文错误" }；
// 本模块把 data 直接解出来；出错时抛出 ApiError（message 为服务端中文错误）。
// toast 提示由 main.js 注入（参数 withError 中的 toast），避免本模块依赖界面。

const BASE = '';

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
      headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
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
  listTemplates: (opts) => request('GET', '/api/templates', null, opts),
  listProjects: (opts) => request('GET', '/api/projects', null, opts),
  createProject: (template, name, opts) => request('POST', '/api/projects', { template, name }, opts),
  createBlank: (name, opts) => request('POST', '/api/projects', { blank: true, name }, opts),
  importProject: (name, files, opts) => request('POST', '/api/import', { name, files }, opts),
  addPage: (id, page, opts) => request('POST', `/api/projects/${encodeURIComponent(id)}/pages`, page, opts),
  removePage: (id, file, opts) => request('DELETE', `/api/projects/${encodeURIComponent(id)}/pages?file=${encodeURIComponent(file)}`, null, opts),
  getSettings: (opts) => request('GET', '/api/settings', null, opts),
  saveSettings: (s, opts) => request('PUT', '/api/settings', s, opts),
  getProject: (id, opts) => request('GET', `/api/projects/${encodeURIComponent(id)}`, null, opts),
  saveProject: (id, proj, opts) => request('PUT', `/api/projects/${encodeURIComponent(id)}`, proj, opts),
  readFile: (id, path, opts) =>
    request('GET', `/api/projects/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`, null, opts)
      .then((d) => d.content),
  writeFile: (id, path, content, opts) =>
    request('PUT', `/api/projects/${encodeURIComponent(id)}/file`, { path, content }, opts),
  listHistory: (id, opts) => request('GET', `/api/projects/${encodeURIComponent(id)}/history`, null, opts),
  restoreHistory: (id, hid, opts) =>
    request('POST', `/api/projects/${encodeURIComponent(id)}/history/${encodeURIComponent(hid)}/restore`, {}, opts),
  resetProject: (id, opts) => request('POST', `/api/projects/${encodeURIComponent(id)}/reset`, {}, opts),
  deleteProject: (id, opts) => request('DELETE', `/api/projects/${encodeURIComponent(id)}`, null, opts),
  listAssets: (id, opts) => request('GET', `/api/projects/${encodeURIComponent(id)}/assets`, null, opts),
  saveAsset: (id, filename, dataBase64, opts) =>
    request('POST', `/api/projects/${encodeURIComponent(id)}/assets`, { filename, dataBase64 }, opts),
};
