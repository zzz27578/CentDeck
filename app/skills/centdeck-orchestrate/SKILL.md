---
name: centdeck-orchestrate
description: 用户要求多个助手协作，或已授权协作且任务有独立可分工作时，按真实能力、范围和依赖分派；简单任务默认独立完成。
---

# 任务统筹

未加载平台规范时先 `read_skill({"id":"platform-guide"})`。读 `project_context` 的 tasks，结合系统提供的助手清单、mode、scope 和 collaboration 选择是否分工；角色名称只是说明，不代表能力或权限。

内置主任务仅在 `delegate` 出现在当前工具列表时可分派。协作关闭时自己完成；子任务不能继续嵌套分派。示例：`delegate({"assistantId":"实际助手ID","text":"具体页面、要求及验收依据","scope":["about.html"],"dependencies":[]})`。依赖值必须是返回的真实任务 ID；子任务 scope 不得扩大父任务范围。用户已明确授权的分工不重复询问，运行层的授权等待也不能由模型伪造用户答案。

共享 CSS、导航或规范变更要指定单一负责人，依赖它的工作放在后续任务，避免多个助手同时覆盖同一文件。独立页面可以并行，不为简单任务强制建立固定多角色流水线。

delegate 返回任务记录不代表子任务完成。依赖任务由调度器等待；内置主任务没有额外的 wait 工具，不反复调用 project_context 忙轮询。派发后可汇报任务 ID 与等待状态，不能宣称最终交付；恢复或汇总时读取实际状态、提交记录和文件。

外部 MCP 的 start_agent/agent_status/agent_action 属于另一套入口，只在当前清单提供时使用。start_agent 返回排队任务，不能假设它拥有 delegate 的参数或能力。

冲突时重新读取当前版本，不能通过解除锁定、换模式或扩大 scope 消除问题。涉及需求选择时调用 request_input 并等待；普通问题在当前权限内修复。达到工具/时间上限或输出截断时保留结果，等待用户继续，不循环派发新的同目标任务。

<!-- CentDeck documentation. Licensing: LICENSE and THIRD_PARTY_NOTICES.md. -->
