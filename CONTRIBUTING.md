# Contributing to CentDeck

Bug fixes, interaction improvements, documentation, Skills, plugins and frontend examples are welcome.

## Development

1. Fork the repository and create a focused branch.
2. Install Node.js 22 or later and run `node server/server.js`.
3. Keep the native JavaScript, build-free launch workflow.
4. Keep credentials, private projects and local configuration out of commits.

Run the relevant checks before opening a pull request:

```sh
node tests/run-checks.mjs
node tests/run-checks.mjs --browser
```

Browser checks use an installed Edge or Chrome with an isolated profile and temporary projects. They do not require a paid model API.

Generated browser screenshots stay in the ignored `artifacts/screenshots/` directory. Only reviewed product images belong in `docs/assets/`. Keep local reports, conversation exports, `.env` files and credentials out of commits. Use your GitHub noreply email if you do not want a personal address in commit metadata.

CI checks tracked files and scans the full Git history with Gitleaks. To run the same secret check locally with Gitleaks 8.30.1, use `gitleaks git --redact=100 --log-opts="--all" .`. The only scanner exception is one exact, nonfunctional test key.

## Interface text

Application-owned copy uses `text()` and the `template` tag from `app/js/core/i18n.js`. Add English translations to `app/js/core/locales/en.js`. Interpolated project names, message text and other user data must remain unchanged. Do not translate the DOM or project source wholesale.

Include desktop and narrow-layout evidence for UI changes. Managed edits must retain source-version, scope and lock checks. Plugins follow the [plugin contract](docs/插件开发规范.md).

## Issues and pull requests

Provide the operating system, browser, Node version, reproduction steps, expected behavior and actual result. Remove API keys and private data from screenshots and logs.

Use an English commit title that describes the change. Explain the user-facing result and relevant validation in the pull request. Keep unrelated work separate.

## Licensing

By contributing, you confirm that you have the right to submit the work and agree to license it under the [GNU Affero General Public License v3.0](LICENSE), including the CentDeck attribution and trademark terms. Retain third-party attribution and licenses.

<!-- CentDeck documentation. Licensing: LICENSE and THIRD_PARTY_NOTICES.md. -->
