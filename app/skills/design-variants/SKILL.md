---
name: design-variants
description: 用户要新建网页或比较独立设计方案时，生成可在总览比较的真实页面和关联规范卡；不用于替换已选定方案的局部编辑。
---

# 出几版方案

未加载平台规范时先 `read_skill({"id":"platform-guide"})`。读 `project_context` 确认目标、既有方案、选中方案和 scope。按用户要求的数量生成；未要求比稿时先做一套，不自动扩张成多套方案。计划模式仅提供方案说明。

仅当工具清单提供 `publish_variant`、当前为创建模式且 scope 为 all 时发布。每次调用发布一套独立方案，由平台创建 `variants/<生成ID>/` 和关联设计规范卡；以工具返回的实际路径为准，不猜 ID。

参数示意（发布前用完整可用页面替换 html 示例）：

```json
{"name":"简洁品牌站","colors":{"brand":"#245f49","accent":"#dca64a","bg":"#f6f8f4","text":"#16271e"},"fontFamily":"system-ui, sans-serif","pages":[{"file":"index.html","title":"首页","html":"<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>首页</title></head><body><main>完整页面内容</main></body></html>"}]}
```

`pages` 只接受 HTML 文件，file 使用相对文件名如 index.html、about.html，不含 variants 前缀。同套页面用相对链接互通。样式/脚本可内联；需要独立 CSS/JS 时，在获知实际目录后先 `read_page` 新路径，再用 `write_files` 写入，更新引用。不要在 HTML 中引用不存在的资源。

多套方案在结构、视觉方向上形成实质区别，保留已选方案；只改已有网页时改用 page-edit。target=app 按手机 H5 排版并兼容桌面。返回实际保存的路径、关联卡片和检查结果，不把示例、草案或成功提交描述为已视觉验收。
