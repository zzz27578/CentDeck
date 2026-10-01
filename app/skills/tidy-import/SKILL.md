---
name: tidy-import
description: 用户要求整理导入网页、修复源码映射或让指定元素可编辑时使用；保留原有框架和交互，不默认静态化或承诺任意框架都能回写。
---

# 整理导入的网页

未加载平台规范时先 `read_skill({"id":"platform-guide"})`。读取 `project_context` 和目标页面/依赖源码，区分源码元素、脚本动态生成内容、框架组件与 iframe；不能只依据截图判断技术栈。

只处理阻碍用户目标的具体问题，例如错误的资源相对路径、重复标识或无法唯一定位的目标。CentDeck 当前可靠写回的是静态 HTML/CSS/JS；React/Vue 适配器尚未实现，不承诺通过格式化即可支持。

保留文字、布局、资源、表单、事件及导航。不以换行/缩进为可编辑前提，不为了修改一个字重新排版所有文件。用户明确要求静态化时，先说明会丢失哪些动态能力，再在授权范围内转换；普通“整理”不授权移除原框架。

使用 `read_page` 的当前版本，经 `patch_text` 或 `write_files` 提交。列出处理前后影响与仍无法直接编辑的部分；未做浏览器对比时不能声称外观完全不变。

<!-- CentDeck documentation. Licensing: LICENSE and THIRD_PARTY_NOTICES.md. -->
