/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
// Runs only on the project's isolated origin, never on the workbench origin.
import {
  collectControls,
  fillControl,
  previewText,
  activeScope,
  visibleControl,
} from "../core/mcp-dom.js";
const parentOrigin = new URL(location.href).searchParams.get("parent");
const documentId = crypto.randomUUID();
const frame = document.createElement("iframe");
frame.setAttribute(
  "sandbox",
  "allow-scripts allow-same-origin allow-forms allow-downloads",
);
frame.title = "Interactive preview";
document.body.appendChild(frame);
let generation = 0,
  observer = null,
  timer = 0,
  controlSequence = 0,
  pending = null;
const ids = new WeakMap(),
  controls = new Map();
const send = (data) =>
  parent.postMessage({ channel: "centdeck-preview", ...data }, parentOrigin);

function snapshot() {
  const doc = frame.contentDocument,
    win = frame.contentWindow;
  if (!doc?.body) throw Error("Preview document unavailable");
  controls.clear();
  const list = collectControls(doc, "preview", (node) => {
    if (!ids.has(node))
      ids.set(
        node,
        "preview-" + documentId + "-" + generation + "-" + ++controlSequence,
      );
    const id = ids.get(node);
    controls.set(id, node);
    return id;
  });
  const copy = doc.documentElement.cloneNode(true);
  const originals = [...doc.querySelectorAll("*")],
    clones = [...copy.querySelectorAll("*")];
  // documentElement itself is excluded in both lists below.
  const sourceNodes = originals.slice(1);
  sourceNodes.forEach((node, index) => {
    const clone = clones[index];
    if (!clone) return;
    const id = ids.get(node);
    if (id) clone.setAttribute("data-cd-control", id);
    if (node.matches("input:not([type=password]):not([type=file])")) {
      clone.setAttribute("value", node.value);
      clone.toggleAttribute("checked", node.checked);
    } else if (node.matches("textarea")) clone.textContent = node.value;
    else if (node.matches("option"))
      clone.toggleAttribute("selected", node.selected);
    else if (node.matches("canvas")) {
      try {
        const image = doc.createElement("img");
        for (const a of node.attributes) image.setAttribute(a.name, a.value);
        image.src = node.toDataURL();
        image.width = node.width;
        image.height = node.height;
        clone.replaceWith(image);
      } catch {}
    }
  });
  const d = doc.documentElement;
  return {
    html: "<!doctype html>" + copy.outerHTML,
    scroll: { x: win.scrollX, y: win.scrollY },
    state: {
      title: doc.title,
      viewport: {
        width: win.innerWidth,
        height: win.innerHeight,
        scrollX: win.scrollX,
        scrollY: win.scrollY,
        scrollWidth: d.scrollWidth,
        scrollHeight: d.scrollHeight,
        horizontalOverflow: d.scrollWidth > win.innerWidth + 1,
      },
      text: previewText(doc),
      controls: list,
    },
  };
}
function update() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      send({ event: "snapshot", ...snapshot() });
    } catch {}
  }, 80);
}
function attach() {
  observer?.disconnect();
  const doc = frame.contentDocument,
    win = frame.contentWindow;
  if (!doc?.body) return;
  observer = new MutationObserver(update);
  observer.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  for (const event of ["click", "input", "change", "scroll"])
    doc.addEventListener(event, update, true);
  win.addEventListener("keydown", (event) => {
    if (
      (event.key === "Escape" || event.key.toLowerCase() === "r") &&
      !event.target.closest("input,textarea,[contenteditable]")
    )
      send({ event: "exit-interaction" });
  });
}
frame.onload = () => {
  const current = pending;
  try {
    if (!current) {
      send({ event: "navigate", href: frame.contentWindow.location.href });
      return;
    }
    attach();
    setTimeout(() => {
      if (pending !== current) return;
      try {
        const win = frame.contentWindow,
          doc = frame.contentDocument;
        if (current.scroll) win.scrollTo(current.scroll.x, current.scroll.y);
        if (current.openLoc != null) {
          const el = doc.querySelector(
            '[data-cd-loc="' + current.openLoc + '"]',
          );
          if (el) {
            el.hidden = false;
            el.classList.add("open", "show", "active", "visible");
            if (el.tagName === "DIALOG") el.setAttribute("open", "");
            el.style.visibility = "visible";
          }
        }
        pending = null;
        send({ id: current.id, ...snapshot() });
      } catch (error) {
        pending = null;
        send({ id: current.id, error: error.message });
      }
    }, 90);
  } catch (error) {
    if (current) {
      pending = null;
      send({ id: current.id, error: error.message });
    }
  }
};
addEventListener("message", async (event) => {
  if (
    event.source !== parent ||
    event.origin !== parentOrigin ||
    event.data?.channel !== "centdeck-preview"
  )
    return;
  const command = event.data;
  try {
    if (command.type === "render") {
      generation++;
      observer?.disconnect();
      clearTimeout(timer);
      if (pending) send({ id: pending.id, error: "Preview render superseded" });
      pending = command;
      frame.srcdoc = command.html;
      return;
    }
    if (command.type === "action") {
      const { action, target, value, x, y } = command;
      const node = controls.get(target),
        doc = frame.contentDocument;
      if (target && (!node || !visibleControl(node) || node.disabled))
        throw Error("STALE_CONTROL: refresh the preview state");
      if (node) {
        const scope = activeScope(doc);
        if (scope !== doc && !scope.contains(node))
          throw Error("Control is covered by a dialog");
      }
      if (action === "click") node.click();
      else if (action === "fill") fillControl(node, value);
      else if (action === "scroll") {
        if (node) node.scrollIntoView({ block: "center" });
        else
          frame.contentWindow.scrollTo({
            left: x,
            top: y,
            behavior: "instant",
          });
      } else throw Error("Unsupported preview action");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    send({ id: command.id, ...snapshot() });
  } catch (error) {
    send({ id: command.id, error: error.message });
  }
});
send({ event: "ready" });
