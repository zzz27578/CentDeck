# Preview isolation

CentDeck 0.4.0 separates the authenticated workbench from project-authored JavaScript.

## Execution boundaries

- The workbench continues to listen on its existing loopback address.
- Each project or built-in template receives a separate local preview origin on an available loopback port. Preview servers serve only that project's public files and the preview bridge; they expose no account, model, MCP or file-write API.
- The editor inspects a script-disabled DOM snapshot. Project scripts execute in the isolated runtime, and the runtime provides the rendered snapshot without changing the original source file.
- Interaction mode displays the original runtime. Returning to selection refreshes the editable snapshot, including generated content and form state. Generated elements still require source-aware edits through an agent.
- Overview cards and import checks use script-disabled snapshots. Thumbnails and presentation pages navigate to isolated origins.
- MCP interactions use a message bridge validated against the parent window and origin. Controls use document-specific IDs; password, file and sensitive fields retain their existing privacy restrictions.

## Behavior to expect

- Animation, canvas rendering and event handlers run in interaction mode and presentation. Editing snapshots are still images of the current DOM state; animations and canvas contents do not continuously repaint in selection mode.
- Browser storage belongs to the project's preview origin. Preview ports are allocated locally and may change when CentDeck restarts, so do not rely on preview storage for permanent application data.
- Nested iframe/object/embed documents are omitted from editable snapshots. They remain part of the original page in its isolated live preview.
- Overview popup cards can display dialogs found by source analysis. CentDeck no longer automatically clicks arbitrary project buttons to guess popup relationships.
- This boundary protects the workbench's API and DOM. It does not make arbitrary downloaded JavaScript safe in every respect: project scripts can still make the network requests permitted by the browser.

Exported HTML/CSS/JavaScript is unchanged by the preview boundary. Applications still need their own deployment security and backend configuration.
