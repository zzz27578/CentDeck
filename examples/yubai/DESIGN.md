# 余白 YUBAI · 设计规范

## 方向

独立设计工作室的编辑式作品集。米白纸感、深灰正文、靛蓝主色；自然灰绿用于茶品牌，陶土色用于数字案例。使用留白和字号层级组织内容，不以大面积装饰代替信息。

## 字体与布局

正文使用 Arial / Microsoft YaHei / 系统无衬线；重点短语使用 Georgia / Songti SC 衬线字体。桌面内容最大 1400px、宽度 90%；手机宽度 88%。760px 以下切换单列和可展开导航。正文 14–17px，移动输入框至少 16px。分隔线、间距和少量动效保持三页一致。

## 交互

首页提供真实的作品分类；作品链接分别到 case.html 和 case.html#digital。三页均支持咨询弹窗与本地摘要，表单不联网、不保存数据。导航支持键盘与 Escape 收起。尊重 prefers-reduced-motion。服务页 FAQ 使用原生 details/summary。

## 源码与规范

实际样式在 style.css，规范元数据在 design/tokens.json。页面使用 --brand / --bg / --text 等变量；--blue / --paper / --ink 为兼容别名。修改已有页面先读取当前版本，保留用户局部修改。手动规范文件变更不等于所有硬编码布局已自动更新。

<!-- CentDeck documentation. Licensing: LICENSE and THIRD_PARTY_NOTICES.md. -->
