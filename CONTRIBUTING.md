# 欢迎贡献 / Contributing

欢迎 PR 和 Issues，包括 Bug 修复、交互改进、文档、Skills、插件和前端案例。

PRs and issues are welcome: bug fixes, interaction improvements, documentation, skills, plugins and frontend examples.

## 开始 / Start

1. Fork 并创建分支；运行 `node server/server.js`。/ Fork, create a branch and run the local server.
2. 保持免构建、双击打开的交付方式。/ Preserve the build-free, double-click workflow.
3. 不提交 `config.local/`、真实密钥、私人项目、测试账号或运行日志。/ Never commit secrets, personal projects or local runtime data.
4. 页面修改请附桌面和窄屏截图；修复逻辑问题请添加有意义的回归测试。/ Include desktop/mobile evidence for UI changes and meaningful regression tests for logic fixes.
5. 按修改范围运行 README 中的测试。/ Run the relevant tests listed in the README.

## Issue

请提供：操作系统、Node 版本、复现步骤、期望结果、实际结果；涉及模型时提供协议/模型名和脱敏错误，不贴 API key。涉及页面内容时先去除私人信息。

Include OS, Node version, reproduction steps, expected and actual behavior. For model issues, provide protocol/model information and redacted errors, never API keys.

## Pull request

说明解决的问题、修改后的行为、验证方式和限制。保持一条 PR 聚焦一个问题。工具写入必须走统一版本/范围/锁定检查；插件必须遵守 [API v1](docs/插件开发规范.md)。不要通过删除锁定或清空标记让测试通过。

Explain the problem, resulting behavior, validation and limitations. Keep each PR focused. Managed writes must retain scope, version and lock checks. Follow the plugin API; never remove locks or marks merely to make validation pass.

提交代码意味着你有权提交，并愿意按本项目 [LICENSE](LICENSE) 授权该贡献。第三方代码必须标明来源并保留其许可。

By contributing, you confirm that you can license your contribution under this project's license. Preserve attribution and licenses for third-party code.
