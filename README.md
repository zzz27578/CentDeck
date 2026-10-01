<div align="center">

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/centdeck-dark.svg"><img src="docs/assets/centdeck-light.svg" width="760" alt="CentDeck"></picture>

[简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md)

[![CI](https://github.com/zzz27578/CentDeck/actions/workflows/ci.yml/badge.svg)](https://github.com/zzz27578/CentDeck/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-43853d?logo=node.js&logoColor=white)](https://nodejs.org/)
[![No build](https://img.shields.io/badge/Build-Not_required-315bff)](#quick-start)
[![License](https://img.shields.io/badge/License-AGPL--3.0-315bff)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/zzz27578/CentDeck?style=flat&color=315bff)](https://github.com/zzz27578/CentDeck/stargazers)

**让 Agent 搭建前端，让你像做 PPT 一样完成设计。**

内置模型 API 连接 · 无限画布 · 可视化精修 · 手动编辑零模型 Token

</div>

CentDeck（百映）是一款面向 AI 使用者的本地前端工作台。接入自己的模型 API，让 Agent 生成页面；在无限画布上比较风格与页面关系，再用拖拽、改字和属性面板完成精细调整。

**移动标题、调整字号、修改文案，不必再发一次提示词。** 可直接编辑的元素会写回真实 HTML/CSS，手动操作不调用模型，也不消耗模型额度。

![CentDeck 首页](docs/assets/screenshots/home.png)

## 从想法到成品，留在同一个工作台

| 能力 | 你可以做什么 |
|---|---|
| **内置 Agent 与 API 连接** | 接入 OpenAI Compatible、Gemini 或本地兼容服务，管理模型、助手、Skills 和独立对话。 |
| **无限画布** | 同时查看页面、弹窗和设计规范，缩放、平移、拖动排布，快速确定整体方向。 |
| **像 PPT 一样精修** | 直接改文字，拖动元素，调整大小、字号、颜色和间距；支持吸附、锁定、撤销与版本历史。 |
| **手动编辑零模型 Token** | 把简单调整交给鼠标和键盘，把 AI 额度留给生成、结构调整和复杂工作。 |
| **便签与精确引用** | 用彩色便签、草图、参考图和 @ 引用，把修改位置清楚地交给 Agent。 |
| **MCP 与多助手** | 连接支持 MCP 的外部 AI 应用，在停靠或悬浮窗口中组织多个助手。 |
| **真实源码交付** | 导入已有 HTML，预览桌面与手机效果，导出包含源码和素材的项目 ZIP。 |

## 先定方向，再打磨细节

### 在无限画布上看全局

把页面、弹窗与设计规范放在一起。比较预设或 Agent 生成的方案，选择方向后再进入单页编辑。

![无限画布与设计总览](docs/assets/screenshots/overview.png)

### 用鼠标完成最后一毫米

点选、拖动、双击改字，像整理一页 PPT。对能映射到源码的元素直接写回；需要结构性修改时，添加标记交给 Agent。

![拖动与可视化精修](docs/assets/screenshots/visual-editing.png)

### 让助手各司其职

创建适合不同工作的助手，按项目管理对话。窗口可停靠、悬浮或折叠；支持编辑重发、停止、重试与上下文压缩。

![多助手与悬浮工作台](docs/assets/screenshots/multi-agent.png)

<a id="quick-start"></a>
## 快速开始

需要 **Node.js 22 或更新版本**，无需 npm 安装或构建。

~~~bash
git clone https://github.com/zzz27578/CentDeck.git
cd CentDeck
~~~

- **Windows**：双击 `CentDeck.bat`。
- **macOS / Linux**：运行 `bash start.sh`。
- 也可直接运行 `node server/server.js`。

浏览器默认打开 `http://localhost:8420`。首次使用以 `centdeck / centdeck` 登录，并设置自己的密码。

1. 在 **设置 → 模型提供商** 中添加 API 地址、密钥和模型。
2. 创建空白项目、使用模板，或导入已有网页。
3. 让 Agent 生成与调整结构，在画布里直接完成细节修改。
4. 预览桌面和手机效果，然后导出项目。

界面支持 **简体中文与 English**，可在 **设置 → 外观下方的语言选项** 中切换。

## 按你的方式连接 AI

- **自带 API（BYOK）**：内置连接管理，支持模型发现、单模型测试、能力设置与自定义请求参数。模型调用费用由你的服务商计费。
- **外部 MCP 助手**：在 **MCP 接管** 中复制连接配置，添加到支持 MCP 的 AI 应用。配置按实际安装目录自动生成。
- **本地项目**：源码保存在 `projects/`，账号与密钥保存在不入库的 `config.local/`。生成结果是普通前端文件。

## 模板与扩展

内置山野旅宿、生活器物、英文建筑事务所等多页模板。风格画廊、个人设计预设、自建 Skills 和插件可按需扩展工作台。

[MCP 与 Skills](docs/MCP与Skills.md) · [插件开发](docs/插件开发规范.md) · [贡献指南](CONTRIBUTING.md) · [问题反馈](https://github.com/zzz27578/CentDeck/issues)

## 许可

采用 [GNU Affero General Public License v3.0](LICENSE)，并包含 CentDeck 的署名、来源和商标附加条款。二次开发和网络部署必须保留 CentDeck 版权与许可声明，明确标注基于 CentDeck 并说明主要修改，不得冒充官方项目或暗示官方背书。独立创作的网站不因使用本工具而受此许可约束。第三方组件遵循[各自许可](THIRD_PARTY_NOTICES.md)。

如果 CentDeck 让你的前端工作流更顺手，欢迎点亮 **Star**，也欢迎分享作品、提交 Issue 与 Pull Request。

---

AI agents · Infinite canvas · Visual website editor · Drag and drop · MCP · BYOK · Vibe coding · HTML / CSS / JavaScript

<!-- CentDeck documentation. Licensing: LICENSE and THIRD_PARTY_NOTICES.md. -->
