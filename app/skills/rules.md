# CentDeck 页面写法规范（所有技能共用）

写出来的页面要让用户在 CentDeck 里直接改字、拖动、调大小，所以请遵守下面几条。它们也都是主流前端的正常写法。

## 文件
- 每个页面一个独立的 `.html` 文件，页面之间用普通的 `<a href="xxx.html">` 相互链接。
- 开头必须有 `<!DOCTYPE html>`，`<head>` 里有 `<meta charset="utf-8">` 和 `<meta name="viewport" content="width=device-width, initial-scale=1">`。
- 样式写在 `<head>` 的 `<style>` 里，脚本写在 `</body>` 前的 `<script>` 里；不要换成 React / Vue 等需要打包的框架。
- 不引用网上的资源（CDN 字体、图片）。图片用内联 SVG、data URI，或放进项目的 `assets/` 文件夹。

## 写法
- 按层级缩进；加粗、链接、强调这类行内元素贴着文字写：`<p>每周节省 <strong>6 小时</strong></p>`。
- 不要写 `<div />` 这类自闭合写法（HTML 里它不会关闭）；每个标签都正常闭合。
- 页面上看得到的文字直接写在 HTML 里；只有真正的数据列表才用脚本生成。
- 同一种组件用同一个 class（例如所有主按钮都是 `.btn.btn-primary`）。

## 设计规范
- 颜色、字号、间距、圆角用 CSS 变量，统一写在 `<style id="cd-tokens">:root{ ... }</style>` 里：
  `--brand --brand-deep --accent --bg --text --muted --card --border`、
  `--fs-s --fs-m --fs-body --fs-h3 --fs-h2 --fs-h1`、`--sp-1 … --sp-5`、`--radius-s --radius --radius-l`。
- 按钮默认用 `--radius-s` 做圆角。

## 手机适配
- 先按电脑写，再用 `@media (max-width: 767px) { ... }` 调整手机版（多列变单列、字号缩小）。
- 不要改动 `<style id="cd-responsive">` 里的内容：那是用户在手机模式下亲手调的，保留它。

## 弹窗
- 弹窗用 `<div class="modal" id="xxx" hidden>` 或 `<dialog>`，打开它的按钮写 `data-open="xxx"`，这样总览能画出"哪个按钮打开哪个弹窗"。
