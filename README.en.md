<div align="center">

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/centdeck-dark.svg"><img src="docs/assets/centdeck-light.svg" width="760" alt="CentDeck"></picture>

[简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md)

[![CI](https://github.com/zzz27578/CentDeck/actions/workflows/ci.yml/badge.svg)](https://github.com/zzz27578/CentDeck/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-43853d?logo=node.js&logoColor=white)](https://nodejs.org/)
[![No build](https://img.shields.io/badge/Build-Not_required-315bff)](#quick-start)
[![License](https://img.shields.io/badge/License-CentDeck_Source_1.0-315bff)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/zzz27578/CentDeck?style=flat&color=315bff)](https://github.com/zzz27578/CentDeck/stargazers)

**Build with agents. Refine your frontend like a presentation.**

Built-in API connections · Infinite canvas · Visual editing · Zero model tokens for manual edits

</div>

CentDeck is a local frontend workbench for people who build with AI. Connect your own model API, let an agent create the pages, compare design directions on an infinite canvas, then finish the details with direct manipulation.

**Moving a heading, changing a font size or rewriting a sentence should not need another prompt.** Supported visual edits write back to real HTML/CSS without calling a model or spending model tokens.

![CentDeck home](docs/assets/screenshots/home.png)

## One workspace, from idea to finished frontend

| Capability | What you can do |
|---|---|
| **Built-in agents and API connections** | Use OpenAI-compatible, Gemini or local compatible endpoints. Manage models, assistants, Skills and separate conversations. |
| **Infinite canvas** | Explore pages, dialogs and design systems together. Zoom, pan and arrange your work to find the right direction. |
| **Presentation-like editing** | Edit text, drag elements, resize and refine typography, colors and spacing, with snapping, locks, undo and version history. |
| **Zero-token manual refinement** | Use your mouse and keyboard for small edits. Save model usage for generation, structural changes and complex work. |
| **Precise visual feedback** | Give agents colored notes, sketches, reference images and @ references tied to the right location. |
| **MCP and multiple assistants** | Connect MCP-compatible AI apps and organize assistants in docked or floating windows. |
| **Real source, portable output** | Import existing HTML, preview desktop and mobile layouts, and export your source and assets as a ZIP. |

## Choose a direction. Then make it yours.

### See the whole design on an infinite canvas

Keep pages, dialogs and design systems in view. Compare presets or agent-generated directions before opening a page for detailed work.

![Overview and infinite canvas](docs/assets/screenshots/overview.png)

### Finish the details by hand

Click, drag and double-click to edit, much like arranging a slide. Elements that map to source can be changed directly; annotate structural changes for an agent.

![Drag-and-drop visual editing](docs/assets/screenshots/visual-editing.png)

### Give each assistant a role

Create assistants for different jobs and keep conversations organized by project. Dock, float or collapse their windows. Edit and resend messages, stop or retry responses, and compact context when needed.

![Multiple assistants and floating windows](docs/assets/screenshots/multi-agent.png)

<a id="quick-start"></a>
## Quick start

Requires **Node.js 22 or later**. No npm install and no build step.

~~~bash
git clone https://github.com/zzz27578/CentDeck.git
cd CentDeck
~~~

- **Windows:** double-click `CentDeck.bat`.
- **macOS / Linux:** run `bash start.sh`.
- Or run `node server/server.js` directly.

Open `http://localhost:8420`. Sign in with `centdeck / centdeck` on first launch, then set your own password.

1. Add your endpoint, API key and model in **Settings → Providers**.
2. Create a blank project, choose a template or import an existing website.
3. Let agents generate content and handle structure; refine the details directly on the canvas.
4. Preview desktop and mobile layouts, then export the project.

The interface supports **Simplified Chinese and English**. Change it under **Settings → Language**, below Appearance.

## Connect AI your way

- **Bring your own key:** built-in connection management, model discovery, single-model tests, capability settings and custom request parameters. Your provider bills model usage.
- **External MCP assistants:** copy the configuration from **MCP connections** into an MCP-compatible AI app. Paths are generated from your actual installation.
- **Local project files:** source stays in `projects/`; accounts and keys stay in Git-ignored `config.local/`. Your output is ordinary frontend code.

## Templates and extensions

Start with multipage hospitality, homeware or English architecture templates. Add personal design presets, custom Skills and plugins to shape your workspace.

[MCP and Skills](docs/MCP与Skills.md) · [Plugin development](docs/插件开发规范.md) · [Contributing](CONTRIBUTING.md) · [Report an issue](https://github.com/zzz27578/CentDeck/issues)

## License

Licensed under the [CentDeck Source License 1.0](LICENSE). Use, modification and compliant collaborative forks are permitted. Redistribution must retain attribution, the license and provenance; false authorship and rebranded replicas are prohibited. Independently created websites are not covered merely because they were made with CentDeck. Third-party components retain [their own licenses](THIRD_PARTY_NOTICES.md).

If CentDeck improves your workflow, give it a **Star**. Contributions, issues and examples of what you build are welcome.

---

AI agents · Infinite canvas · Visual website editor · Drag and drop · MCP · BYOK · Vibe coding · HTML / CSS / JavaScript

<!-- CentDeck documentation. Licensing: LICENSE and THIRD_PARTY_NOTICES.md. -->
