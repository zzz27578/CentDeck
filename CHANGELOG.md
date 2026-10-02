# Changelog

## 0.4.0 — 2026-10-02

This release improves the reliability of source editing, history recovery and task cleanup, and separates project scripts from the workbench's authenticated origin.

### Fixed

- Preserve the current file when restoring an older snapshot, and make the restore transaction reversible.
- Restore deleted HTML pages to the page list, including their saved display titles.
- Keep history snapshots in creation order, including multiple saves within one second.
- Cancel and finish active tasks before deleting a project. A failed cleanup can no longer terminate the scheduler's process through an unhandled rejection.
- Preserve CSS data URLs, quoted semicolons, custom-property case and unquoted style attributes when editing a declaration.
- Select the last matching top-level shared CSS rule instead of accidentally editing a rule inside a mobile media query.
- Use the same translation baseline for drag previews and saved changes. Preserve percentage and `calc()` offsets, including keyboard nudges.
- Settle superseded and destroyed frame renders, and remove delayed buffer cleanup that could clear a reused iframe.

### Security

- Execute each project's scripts on a separate, read-only local origin with no workbench API routes.
- Render editor, overview and import-analysis snapshots with scripts disabled. Interactive preview continues to execute the original page in its isolated origin.
- Route MCP preview interactions through a scoped message bridge with document-specific control IDs and existing private-field filtering.
- Isolate presentation and thumbnail URLs as well as editing previews; deny cross-project resources on each preview server.

### Maintenance

- Share the application version between the About screen and MCP server metadata.
- Add regression coverage for data recovery, CSS editing, project deletion, preview boundaries and render lifecycle behavior.
- Ignore local video material in addition to credentials, private projects, reports and unreviewed screenshots.
- Keep editor navigation readable and its tool dock scrollable on narrow screens.

No npm installation or build step is required. Existing project files remain in place. Interactive preview storage is scoped to the project's preview origin; it is separate from workbench storage and may reset when the local service restarts.

See [Preview isolation](docs/preview-isolation.md) for the execution model and current limitations.
