"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { CONFIG_DIR, ApiError } = require("./store");
const file = path.join(CONFIG_DIR, "settings.json");
const presets = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  {
    id: "qwen",
    name: "阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    noKey: true,
  },
];
function raw() {
  if (!fs.existsSync(file))
    return { providers: {}, roles: {}, defaultModel: "" };
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new ApiError(500, "模型配置文件格式错误");
  }
}
function listRaw() {
  const r = raw();
  return Object.entries(r.providers || {}).map(([id, p]) => ({
    ...presets.find((x) => x.id === id),
    ...p,
    id,
    models: p.models || [],
    protocol:
      p.protocol ||
      (id === "anthropic" || id === "gemini" ? "unsupported" : "openai"),
  }));
}
function getSettings() {
  const r = raw();
  return {
    providers: listRaw().map(({ apiKey, ...p }) => ({
      ...p,
      hasKey: !!apiKey,
      keyHint: apiKey ? "••••" + apiKey.slice(-4) : "",
    })),
    roles: r.roles || {},
    defaultModel: r.defaultModel || r.roles?.expert || "",
    presets,
  };
}
function baseUrl(value) {
  let u;
  try {
    u = new URL(String(value));
  } catch {
    throw new ApiError(400, "接口地址必须是完整的 http(s) URL");
  }
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw new ApiError(400, "接口地址格式不正确");
  return u.href.replace(/\/$/, "");
}
function saveSettings(body) {
  const r = raw();
  r.providers = r.providers || {};
  if (!body || !Array.isArray(body.providers))
    throw new ApiError(400, "缺少提供商列表");
  for (const p of body.providers) {
    if (!p || !/^[\w-]{1,80}$/.test(p.id))
      throw new ApiError(400, "提供商编号不合法");
    if (p.deleted) {
      delete r.providers[p.id];
      continue;
    }
    const old = r.providers[p.id] || {},
      cur = { ...presets.find((x) => x.id === p.id), ...old };
    for (const k of [
      "name",
      "enabled",
      "noKey",
      "reasoning",
      "vision",
      "tools",
    ])
      if (p[k] != null) cur[k] = p[k];
    cur.name = String(cur.name || p.id).slice(0, 80);
    if(p.protocol!=null&&!['openai','gemini'].includes(p.protocol))throw new ApiError(400,'不支持的接口格式');
    cur.protocol = p.protocol || cur.protocol || 'openai';
    cur.format = p.format || cur.protocol;
    if(p.modelCapabilities){cur.modelCapabilities={};for(const [name,c] of Object.entries(p.modelCapabilities).slice(0,500)){cur.modelCapabilities[name]={text:true,vision:!!c.vision,audio:!!c.audio,tools:c.tools!==false};}}
    if (p.baseUrl != null) cur.baseUrl = baseUrl(p.baseUrl);
    if (!cur.baseUrl) throw new ApiError(400, "请填写接口地址");
    if (p.apiKey === null) delete cur.apiKey;
    else if (typeof p.apiKey === "string" && p.apiKey.trim())
      cur.apiKey = p.apiKey.trim();
    if (Array.isArray(p.models))
      cur.models = [
        ...new Set(
          p.models
            .map(String)
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ].slice(0, 500);
    r.providers[p.id] = cur;
  }
  if (typeof body.defaultModel === "string") r.defaultModel = body.defaultModel;
  if (body.roles) r.roles = body.roles;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(file + ".tmp", JSON.stringify(r, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.renameSync(file + ".tmp", file);
  return getSettings();
}
function resolve(model) {
  const r = raw();
  model = model === "auto" ? r.defaultModel || r.roles?.expert : model;
  if (model === "mcp:external") {
    const c = require('./extensions').mcpConfig();
    if (!c.enabled || c.mode !== 'create') throw new ApiError(400, '请先在 MCP 设置中启用创作模式并连接外部助手');
    return {provider:{id:'mcp', vision:false, tools:true}, model:'external'};
  }
  const split = String(model || "").indexOf(":");
  const id = String(model || "").slice(0, split),
    name = String(model || "").slice(split + 1);
  const p = listRaw().find((p) => p.id === id);
  if (!p || !p.enabled || !name || !p.models.includes(name))
    throw new ApiError(400, "请在 Agent 工作台配置并选择模型");
  if (!['openai','gemini'].includes(p.protocol))
    throw new ApiError(400, "请选择受支持的接口格式");
  if (!p.noKey && !p.apiKey)
    throw new ApiError(400, "此提供商尚未配置 API Key");
  return { provider: {...p,...p.modelCapabilities?.[name]}, model: name };
}
async function call(p, endpoint, body, signal) {
  const controller = AbortSignal.timeout(180000);
  const signals = signal ? AbortSignal.any([controller, signal]) : controller;
  let res;
  try {
    res = await fetch(baseUrl(p.baseUrl) + "/" + endpoint, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(p.apiKey ? (p.protocol==='gemini'?{'x-goog-api-key':p.apiKey}:{ Authorization: "Bearer " + p.apiKey }) : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: signals,
      redirect: "error",
    });
  } catch (e) {
    throw new ApiError(
      502,
      signal?.aborted
        ? "请求已停止"
        : e.name === "TimeoutError"
          ? "模型请求超时"
          : "无法连接模型接口",
    );
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new ApiError(
      502,
      body?.reasoning_effort && [400, 422].includes(res.status)
        ? `模型接口拒绝请求（${res.status}），请检查模型是否支持 ${body.reasoning_effort} 思考强度及当前请求参数；未自动降低强度`
        : `模型接口返回 ${res.status}，请检查地址、密钥和模型权限`,
    );
  }
  let text = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    text += decoder.decode(chunk, { stream: true });
    if (text.length > 8 * 1024 * 1024) throw new ApiError(502, "模型响应过大");
  }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(502, "模型接口没有返回有效 JSON");
  }
}
async function discover(id) {
  const p = listRaw().find((x) => x.id === id);
  if (!p) throw new ApiError(404, "提供商不存在");
  return discoverProvider(p);
}
async function discoverDraft(draft) {
  const saved=listRaw().find(p=>p.id===draft.id)||{};
  const p={...saved,...draft,apiKey:draft.apiKey?.trim()||saved.apiKey};
  if(!['openai','gemini'].includes(p.protocol||'openai'))throw new ApiError(400,'不支持的接口格式');
  return discoverProvider(p);
}
async function discoverProvider(p) {
  const start = Date.now();
  const j = await call(p, "models");
  if(p.protocol==='gemini'){
    if(!Array.isArray(j.models))throw new ApiError(502,'接口没有返回 models 列表');
    return {models:j.models.filter(m=>m.supportedGenerationMethods?.includes('generateContent')).map(m=>m.name.replace(/^models\//,'')).sort(),latency:Date.now()-start};
  }
  if (!Array.isArray(j.data))
    throw new ApiError(502, "接口没有返回 data 模型列表");
  return {
    models: [
      ...new Set(j.data.map((x) => x.id).filter((x) => typeof x === "string")),
    ].sort(),
    latency: Date.now() - start,
  };
}
async function complete(
  selected,
  messages,
  tools,
  think,
  signal,
  maxTokens = 8192,
  context = {},
) {
  const { provider: p, model } = resolve(selected);
  if (p.id === 'mcp') return require('./external-agent').enqueue({messages,tools:tools || [],think:require('./reasoning').normalizeThink(think),maxTokens,context}, signal);
  if(p.protocol==='gemini')return require('./gemini').complete({p,model,messages,tools,think,signal,maxTokens,call});
  const b = {
    model,
    messages,
    stream: false,
    max_tokens: Math.max(1, Math.min(16384, maxTokens)),
  };
  if (tools?.length && p.tools !== false) b.tools = tools;
  b.reasoning_effort = require("./reasoning").normalizeThink(think);
  const j = await call(p, "chat/completions", b, signal);
  if (!j.choices?.[0]?.message)
    throw new ApiError(502, "模型响应缺少 choices.message");
  return { message: j.choices[0].message, usage: j.usage || null, finishReason:j.choices[0].finish_reason };
}
module.exports = { getSettings, saveSettings, resolve, discover, discoverDraft, complete };
