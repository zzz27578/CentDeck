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

创建任务必须有可用的提供商和模型。`agent_status` 返回真实状态、模型、思考强度、技能、用量及提交记录。401、预算耗尽、冲突等错误不会被伪装为完成。

Agent creation requires a configured working provider and model. Status includes actual state, model, reasoning level, skills, usage and commits. Authentication failures, budget limits and conflicts remain explicit failures.

## 页面接管 / Browser control

浏览器必须打开并登录百映，页面自动建立本机心跳连接。`ui_state` 返回 clientId、当前项目/页面/视图，以及控件 ID 和标签；不采集密码内容。多标签页时显式传入 clientId 更稳妥。控件 ID 绑定 DOM 实例，页面变化后重新读取。操作有回执和超时；超时不能当作成功。

The browser must be open and signed in. A local heartbeat exposes client ID, project/page/view and labeled control IDs, excluding password values. Explicitly select clientId when several tabs are connected. IDs belong to DOM instances; inspect again after navigation. Operations return receipts or time out.

`ui_action` 支持：`open_project`、`open_page`、`open_settings`、`close_settings`、`set_view`、`click`、`fill`、`add_mark`、`undo`、`refresh`。草图添加走命令总线，保存并可撤销。内置模型不获得任意 UI 点击权限，避免通过设置页绕过任务范围；外部 MCP 接管才提供此操作。

Supported UI actions include navigation, settings, view switching, labeled clicks/fills, sketch pins, undo and refresh. Marks use the command bus. Built-in models do not receive arbitrary UI click access, which could bypass their task scope; external MCP takeover provides that capability.

回执仅证明操作完成，不证明视觉无误。需要结合浏览器截图、实际交互和源码结果进行验收。

A receipt confirms an operation, not visual correctness. Inspect screenshots, interaction outcomes and source changes.

## Skills

内置指南自动加载；其他技能通过助手配置、任务选择或 `read_skill` 按需加载。技能页支持查看全文、启停、导入和编辑自建技能；插件也可贡献技能。标准 Markdown frontmatter 示例：

The platform guide loads automatically; other skills load via assistant/task selection or `read_skill`. Manage built-in, local and plugin-contributed skills in Settings.

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
