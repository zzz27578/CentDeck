/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
// Volatile requests: task restart recovery remains owned by tasks.js.
const crypto = require('node:crypto');
const {ApiError} = require('./store');
const requests = new Map();
function allowed() {
  const c = require('./extensions').mcpConfig();
  if (!c.enabled || c.mode !== 'create') throw new ApiError(403, '外部助手需要启用 MCP 创作模式');
}
function enqueue(payload, signal) {
  allowed();
  if (signal?.aborted) return Promise.reject(new ApiError(409, '请求已停止'));
  if (requests.size >= 12) throw new ApiError(429, '外部助手等待队列已满');
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const finish = (error, value) => {
      requests.delete(id); clearTimeout(timer); clearInterval(watch);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new ApiError(409, '外部助手请求已停止'));
    const timer = setTimeout(() => finish(new ApiError(408, '等待外部 MCP 助手超时，请连接后继续任务')), 10 * 60 * 1000);
    const watch = setInterval(() => { try { allowed(); } catch(e) { finish(e); } }, 1000);
    requests.set(id, {id, createdAt:new Date().toISOString(), payload:structuredClone(payload), finish, owner:null, expires:0});
    signal?.addEventListener('abort', abort, {once:true});
  });
}
function list() {
  allowed();
  return [...requests.values()].map(r => ({id:r.id, ...r.payload.context, think:r.payload.think,
    createdAt:r.createdAt, claimed:r.expires > Date.now()}));
}
function claim(id, owner) {
  allowed();
  const r = requests.get(id);
  if (!r) throw new ApiError(404, '请求已结束或不存在');
  if (r.expires > Date.now() && r.owner !== owner) throw new ApiError(409, '请求已由其他 MCP 会话接管');
  r.owner = owner; r.lease = crypto.randomUUID(); r.expires = Date.now() + 180000;
  return {id, lease:r.lease, expiresAt:new Date(r.expires).toISOString(), ...r.payload,
    instructions:'Return an assistant message or tool_calls using only the supplied tools. The built-in runtime executes tools and queues the next request. think is requested intensity, not verified execution. Claim again to renew; use the newest lease.'};
}
function respond(a, owner) {
  allowed();
  const r = requests.get(a.id);
  if (!r) throw new ApiError(404, '请求已结束或不存在');
  if (r.owner !== owner || r.lease !== a.lease || r.expires <= Date.now()) throw new ApiError(409, '接管租约无效或过期');
  const m = a.message;
  if (!m || m.role !== 'assistant' || (m.content != null && typeof m.content !== 'string') || JSON.stringify(m).length > 1024*1024)
    throw new ApiError(400, '需要有效 assistant 消息（最多 1 MiB）');
  const calls = m.tool_calls || [];
  if (!Array.isArray(calls) || calls.length > 16 || (!m.content && !calls.length)) throw new ApiError(400, '回复需要内容或工具调用');
  const ids = new Set();
  for (const c of calls) {
    if (typeof c.id !== 'string' || !c.id || ids.has(c.id) || c.type !== 'function' ||
        !r.payload.tools.some(t => t.function.name === c.function?.name) || typeof c.function?.arguments !== 'string')
      throw new ApiError(400, '工具调用格式无效或工具未授权');
    try { const args=JSON.parse(c.function.arguments); if (!args || Array.isArray(args) || typeof args !== 'object') throw Error(); }
    catch { throw new ApiError(400, '工具参数必须是 JSON 对象'); }
    ids.add(c.id);
  }
  r.finish(null, {message:{role:'assistant', content:m.content || null, ...(calls.length ? {tool_calls:calls} : {})}, usage:null,
    external:{transport:'mcp', requestedThink:r.payload.think, verification:'external-self-reported', model:typeof a.model === 'string' ? a.model.slice(0,160) : 'unspecified'}});
  return {accepted:true};
}
module.exports = {enqueue, list, claim, respond};
