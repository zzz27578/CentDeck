---
name: design-system
description: 用户要确定或修改项目配色、字体、字号、间距、圆角或按钮规范时使用；区分规范建议、保存 tokens 和实际应用到页面。
---

# 配色与按钮样式

未加载平台规范时先 `read_skill({"id":"platform-guide"})`。读取 `project_context` 的 tokens、designGroups、选中方案及相关页面源码，尊重现有品牌和用户例外。用户只要建议时不改文件。

项目规范保存于 `design/tokens.json`。先 `read_page`，使用实际 baseHash 写回，保留无关键。支持 colors 对象、fontFamily 字符串，以及包含 CSS 单位的 fontSizes/spacing/radius 数组，例如：

```json
{"colors":{"brand":"#245f49","accent":"#dca64a","bg":"#f6f8f4","text":"#16271e","card":"#ffffff","border":"#dce5dc"},"fontFamily":"system-ui, sans-serif","fontSizes":["12px","14px","16px","24px","36px","52px"],"spacing":["8px","16px","24px","40px"],"radius":["4px","12px","24px"]}
```

保存 tokens 不会自动修改写死的页面样式，也不会自动更新所有方案卡。用户要求应用时，读取受影响的 HTML/CSS 并实际连接变量（如 --brand、--accent、--bg、--text、--fs-body、--radius），检查对比度、层级和手机布局；保留局部例外和锁定内容。

内置助手没有“只添加风格卡”或“保存个人预设”的独立工具。新方案且用户授权生成页面时，可加载 design-variants 用 publish_variant 同时发布页面与卡片；不要为仅保存配色而擅自生成网页。现有卡片编辑、添加个人预设，可向用户说明设计规范入口，或由具备 ui_action 的外部 MCP 客户端按 ui_state 控件操作。不要改 project.json 绕过元数据接口。

区分最终状态：建议已给出、规范文件已保存、哪些页面实际应用、哪些检查已执行。没有截图/交互证据时不声称完成视觉验收。
