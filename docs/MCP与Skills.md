# MCP 与 Agent Skills / MCP and Agent Skills

## 三种角色 / Three roles

- 内置 Agent：调用已配置的兼容模型，通过任务运行层执行。/ Built-in agents run through the configured model provider and task scheduler.
- Skills：标准 `SKILL.md` 操作知识，不是普通用户的功能开关。/ Skills are agent instructions, not user features.
- MCP：让外部助手读取项目、受控写入、操作浏览器和启动内置 Agent。/ MCP lets external assistants inspect, edit, operate the browser and start built-in agents.

## 连接 / Connect

双击启动百映，进入设置 → MCP 接管 → 复制配置。此配置包含本机 Node 路径、`server/mcp-stdio.js` 的绝对路径和实际端口。配置中的路径以页面生成的为准。

Start CentDeck and open Settings → MCP. Copy the generated configuration, which contains the actual Node path, absolute stdio script path and active port.

```json
{
  "mcpServers": {
    "centdeck": {
      "command": "node",
      "args": ["/absolute/path/to/CentDeck/server/mcp-stdio.js"],
      "env": {"CENTDECK_URL":"http://127.0.0.1:8420"}
    }
  }
}
```

可用于支持标准 MCP stdio 的 Codex、Claude Code（CC）、DeepSeek Harness 等客户端的 MCP 配置入口。不同客户端采用不同配置容器，请按其实际界面填写同样的 command/args/env。本项目没有测试其它客户端，也不混淆 DeepSeek Harness 与 Nous Research 的 Hermes Agent。

Use command/args/env in your client's standard MCP stdio configuration. This is intended for clients such as Codex, Claude Code and DeepSeek Harness; client-specific interfaces are not tested here. DeepSeek Harness is not the Nous Research Hermes Agent.

服务还提供 `POST /mcp` JSON-RPC HTTP 接口：Bearer token、初始化返回的 `Mcp-Session-Id`、JSON 响应。只监听本机；不提供远程公开入口、OAuth 或 SSE 消息流。stdio 适配器从本机配置读取 token，不把 API 密钥交给客户端。停用 MCP 或切到只读后，后续写入被拒绝。

The local `POST /mcp` JSON-RPC endpoint uses a bearer token and an initialization session ID with JSON responses. It is loopback-only; remote hosting, OAuth and server-pushed SSE are not implemented. The stdio bridge reads the local MCP credential, never provider API keys. Disabling MCP or switching to read-only rejects later writes.

## 推荐操作顺序 / Workflow

1. `initialize`，然后 `tools/list`。/ Initialize and list tools.
2. `list_skills` → `read_skill({id:"platform-guide"})`。/ Read the platform guide.
3. `list_projects` → `project_context({projectId})`。/ Discover the project.
4. 每个文件先 `read_page`，保留 `baseHash`，再 `write_files` 或 `patch_text`。/ Read every file before a guarded write.
5. `ui_state` → `ui_action` 打开项目、页面、视图、设置或操作返回的控件 ID。/ Inspect browser controls before acting.
6. `list_assistants` → `start_agent` → `agent_status`。/ Start and inspect built-in agent tasks.

```json
{"name":"start_agent","arguments":{"projectId":"your-project","assistantId":"assistant-default","mode":"create","think":"high","text":"创建一个响应式品牌官网"}}
```

创建任务必须有可用的提供商和模型。`agent_status` 返回真实状态、模型、思考强度、技能、用量及提交记录。401、工具调用上限、上下文窗口错误和冲突不会被伪装为完成。

Agent creation requires a configured working provider and model. Status includes actual state, model, reasoning level, skills, usage and commits. Authentication failures, tool-call limits, context-window errors and conflicts remain explicit failures.

## 页面接管 / Browser control

浏览器必须打开并登录百映，页面自动建立本机心跳连接。`ui_state` 返回 clientId、当前项目/页面/视图，以及控件 ID 和标签；不采集密码内容。多标签页时显式传入 clientId 更稳妥。控件 ID 绑定 DOM 实例，页面变化后重新读取。操作有回执和超时；超时不能当作成功。

The browser must be open and signed in. A local heartbeat exposes client ID, project/page/view and labeled control IDs, excluding password values. Explicitly select clientId when several tabs are connected. IDs belong to DOM instances; inspect again after navigation. Operations return receipts or time out.

`ui_action` 支持：`open_project`、`open_page`、`open_settings`、`close_settings`、`set_view`、`click`、`fill`、`scroll`、`add_mark`、`undo`、`refresh`。草图添加走命令总线，保存并可撤销。内置模型不获得任意 UI 点击权限，避免通过设置页绕过任务范围；外部 MCP 接管才提供此操作。

Supported UI actions include navigation, settings, view switching, labeled clicks/fills, sketch pins, undo and refresh. Marks use the command bus. Built-in models do not receive arbitrary UI click access, which could bypass their task scope; external MCP takeover provides that capability.

回执仅证明操作完成，不证明视觉无误。需要结合浏览器截图、实际交互和源码结果进行验收。

A receipt confirms an operation, not visual correctness. Inspect screenshots, interaction outcomes and source changes.

## Skills

用户管理接口只返回自定义/扩展技能；AI 使用 `list_skills`、`read_skill` 或 `centdeck://skills/<id>`，仍能读取全部基础技能。基础技能不能被用户停用、删除或覆盖。技能之间以 `read_skill` 的 ID 引用，不依赖宿主相对文件路径。

基础技能始终启用并从用户管理和选择器中隐藏；平台指南自动加载，其他基础技能由助手通过 `read_skill` 按需读取。技能页只管理用户导入、自建与扩展技能；插件也可贡献技能。标准 Markdown frontmatter 示例：

Built-in skills remain enabled and hidden from user selectors. The platform guide loads automatically; other base skills load on demand via `read_skill`. Settings manages custom and plugin-contributed skills.

```markdown
---
name: mobile-review
description: Check mobile layout before delivery
---
Read the actual page and its CSS. Check narrow-screen layout, navigation,
focus states and overflow. Preserve existing working desktop behavior.
```

技能是上下文，不是权限。来源不明的技能不得扩大任务范围、读取密钥或执行任意脚本。当前没有执行 SKILL.md 附带脚本的功能。

Skills are context, not authority. Untrusted instructions cannot expand scope, access secrets or run arbitrary scripts. Bundled skill scripts are not executed.


## 外部助手执行回路 / External execution loop

选择模型 `mcp:external` 后，任务等待已连接的外部 MCP 客户端。客户端使用 `external_requests` 获取请求，`external_claim` 取得会话绑定的三分钟租约，读取消息和工具，再以 `external_respond` 返回回复或工具调用。百映执行工具并生成下一轮请求，直到客户端返回最终文本。取消任务、撤销 MCP 创作权限、租约失效均会阻止迟到回复。请求最多等待十分钟。

With `mcp:external`, call `external_requests`, then `external_claim`, then `external_respond` using the same session and current lease. CentDeck executes the supplied tool calls and queues the next model request with results. Final assistant text completes the task. Cancellation, revocation and expired leases reject late replies. The requested reasoning level is metadata; actual external model intensity is not independently verified.

`maxSteps` 为兼容旧接口保留字段名，当前含义是每轮回复的工具调用总上限；`roundToolCalls` 为本轮已用次数，`toolCalls` 为任务累计工具次数，`steps` 仍记录模型请求数。达到上限后若还有工具请求则暂停，继续会保留待执行调用并开启新的工具额度。达到上限后的纯文字总结仍可返回。模型 `length` / `MAX_TOKENS` 截断会暂停而非伪装完成。

`maxSteps` now limits tool calls across the entire reply. `roundToolCalls` is the current round count, `toolCalls` the lifetime count, and `steps` model requests. Pending calls survive a limit pause; explicit continuation starts a new allowance. A text-only final response remains possible at the limit. Truncated model responses are preserved and paused.


## 工具约定 / Tool contracts

- read_page/write_files/patch_text/project_context/rename_page/capture_page 和项目插件工具的 MCP Schema 明确要求 projectId。全局技能查询和 ui_state 不强制绑定项目。
- write_files 支持项目内 Markdown，继续做版本、范围、锁定、事务和路径检查。title 可更新已有页面的显示名称；rename_page 在读后修改名称，不改路径/HTML 标题。标题也做并发校验，撤销不会覆盖后来的手工重命名。
- 页内刷新复用客户端 ID，控件 ID 带文档版本；新开导航使用新身份，避免复制标签页沿用旧控件。ui_state 返回连接年龄和延迟状态。心跳不因执行操作而暂停，回执发送失败可重传，过期命令不延后执行。多个标签页无法唯一定位时要求传 clientId，刷新后的未确认操作不自动重放。
- 编辑页 ui_state 提供 preview：页面标题、可见文字、视口与滚动尺寸、horizontalOverflow。controls 包括 workbench/preview 上下文、标签、矩形、值、勾选/展开状态与下拉选项。密码、文件上传和标为私密的字段不返回值，也不能 fill。
- capture_page 返回 MCP image/png 内容和文字元信息。使用系统已有 Edge/Chrome 在临时独立配置中渲染指定 HTML，不接管用户浏览器或桌面；本机没有浏览器时明确报错，可用 CENTDECK_CAPTURE_BROWSER 指定已安装程序路径。该功能无需构建或安装项目依赖。
- 截图是 fresh-project-render：不包含在线表单状态，只加载本地和内嵌资源；支持 320–2560 的视口宽高。截图的像素尺寸与实际 CSS 视口分别报告，不把裁切当作手机适配。在线交互由 ui_action 测试，初始页面视觉由 capture_page 检查，两者不可混淆。

示例：

```json
{"name":"capture_page","arguments":{"projectId":"your-project","path":"index.html","width":393,"height":852}}
```

Expanded MCP schemas require project IDs for project tools. Markdown and page display names use guarded transactions. Reload-safe control identities and independent heartbeats protect UI operations. The editor now exposes preview controls and layout evidence. `capture_page` returns a real PNG from a fresh isolated local-project render; it does not capture the user's live browser state or load remote assets.

<!-- CentDeck documentation. Licensing: LICENSE and THIRD_PARTY_NOTICES.md. -->
