/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { parse, instrument } from "./parse.js";
import { withBase, afterPaint, collateral } from "./frame.js";
import { createPreview, safeSnapshot } from "./preview.js";

export function createFrame(
  host,
  { baseHref = "/", onNavigate, onReady, onExitInteraction } = {},
) {
  const frames = [0, 1].map(() => {
    const frame = document.createElement("iframe");
    frame.className = "pf";
    frame.title = "Page";
    frame.setAttribute("sandbox", "allow-same-origin");
    host.appendChild(frame);
    return frame;
  });
  let active = 0,
    generation = 0,
    destroyed = false,
    source = "",
    parsed = parse(""),
    duplicateLocs = new Set();
  let pending = null,
    runtime = null,
    interactive = false;
  const disposers = [];
  const current = () => frames[active];
  function readyDocument() {
    const doc = current().contentDocument,
      seen = new Set();
    duplicateLocs = new Set();
    doc.querySelectorAll("[data-cd-loc]").forEach((node) => {
      const loc = +node.getAttribute("data-cd-loc");
      if (seen.has(loc)) duplicateLocs.add(loc);
      seen.add(loc);
    });
    onReady?.(api);
  }
  function cancelPending() {
    if (pending) {
      const request = pending;
      pending = null;
      request.cancel();
    }
  }

  function render(src, { keepScroll = true, scroll = null } = {}) {
    if (destroyed) return Promise.resolve(false);
    const token = ++generation;
    cancelPending();
    const nextSource = String(src),
      nextParsed = parse(nextSource),
      back = frames[1 - active];
    const win = current().contentWindow;
    const position =
      scroll ||
      (keepScroll && win ? { x: win.scrollX, y: win.scrollY } : { x: 0, y: 0 });
    return new Promise((resolve, reject) => {
      let settled = false;
      const candidate = createPreview(host, {
        baseHref,
        onNavigate,
        onExit: onExitInteraction,
      });
      const timer = setTimeout(
        () => finish(false, Error("Page render timed out")),
        20000,
      );
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (pending?.token === token) pending = null;
        if (!value) {
          back.onload = null;
          candidate.destroy();
        }
        error ? reject(error) : resolve(value);
      };
      pending = { token, cancel: () => finish(false) };
      candidate
        .render(instrument(nextSource, nextParsed), { scroll: position })
        .then((snapshot) => {
          if (settled || destroyed || token !== generation) return;
          back.onload = () =>
            afterPaint(() => {
              if (settled || destroyed || token !== generation) return;
              try {
                const doc = back.contentDocument;
                if (!doc?.body) throw Error("Page document unavailable");
                back.contentWindow.scrollTo(position.x, position.y);
                const old = current();
                old.classList.remove("on");
                old.onload = null;
                if (document.activeElement === old) old.blur();
                active = 1 - active;
                back.classList.add("on");
                source = nextSource;
                parsed = nextParsed;
                runtime?.destroy();
                runtime = candidate;
                runtime.show(interactive);
                // Clear immediately before this buffer can be reused by another render.
                old.srcdoc = "<!doctype html><title></title>";
                readyDocument();
                finish(true);
              } catch (error) {
                finish(false, error);
              }
            });
          back.srcdoc = safeSnapshot(snapshot.html);
        })
        .catch((error) => {
          if (!settled) finish(false, error);
        });
    });
  }

  async function setInteractive(on) {
    interactive = on;
    const activeRuntime = runtime;
    if (!activeRuntime) return;
    activeRuntime.show(on);
    if (on) return;
    const token = generation;
    const snapshot = await activeRuntime.snapshot();
    if (
      destroyed ||
      token !== generation ||
      activeRuntime !== runtime ||
      interactive
    )
      return;
    const frame = current();
    frame.onload = () => {
      if (destroyed || token !== generation) return;
      frame.contentWindow.scrollTo(snapshot.scroll.x, snapshot.scroll.y);
      readyDocument();
    };
    frame.srcdoc = safeSnapshot(snapshot.html);
  }

  const api = {
    get source() {
      return source;
    },
    get parsed() {
      return parsed;
    },
    get doc() {
      return current().contentDocument;
    },
    get win() {
      return current().contentWindow;
    },
    get iframe() {
      return current();
    },
    get runtime() {
      return runtime;
    },
    render,
    setInteractive,
    elByLoc(loc) {
      return api.doc?.querySelector('[data-cd-loc="' + loc + '"]') || null;
    },
    isDup(loc) {
      return duplicateLocs.has(loc);
    },
    owner(node) {
      for (let n = node; n?.nodeType === 1; n = n.parentElement) {
        if (n.hasAttribute("data-cd-loc")) return n;
        if (n.tagName === "BODY") break;
      }
      return null;
    },
    locOf(node) {
      return node?.hasAttribute("data-cd-loc")
        ? +node.getAttribute("data-cd-loc")
        : null;
    },
    snapRects() {
      const out = {},
        win = api.win;
      api.doc?.querySelectorAll("[data-cd-loc]").forEach((node) => {
        if (node.getAnimations?.().some((a) => a.playState === "running"))
          return;
        const r = node.getBoundingClientRect();
        out[node.getAttribute("data-cd-loc")] = {
          x: r.x + win.scrollX,
          y: r.y + win.scrollY,
          w: r.width,
          h: r.height,
          tag: node.tagName.toLowerCase(),
        };
      });
      return out;
    },
    makeMeasure(getSize) {
      let frame = null,
        cache = { src: null, map: null };
      function snap(html) {
        const doc = frame.contentDocument;
        doc.open();
        doc.write(withBase(safeSnapshot(html), baseHref));
        doc.close();
        const out = {};
        doc.querySelectorAll("[data-cd-loc]").forEach((node) => {
          const r = node.getBoundingClientRect();
          out[node.getAttribute("data-cd-loc")] = {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            tag: node.tagName.toLowerCase(),
          };
        });
        return out;
      }
      return (context) => {
        if (!frame) {
          frame = document.createElement("iframe");
          frame.setAttribute("sandbox", "allow-same-origin");
          frame.setAttribute("aria-hidden", "true");
          frame.style.cssText =
            "position:fixed;left:-30000px;top:0;visibility:hidden";
          document.body.appendChild(frame);
          disposers.push(() => frame.remove());
        }
        const size = getSize();
        frame.style.width = size.w + "px";
        frame.style.height = size.h + "px";
        if (cache.src !== context.source)
          cache = {
            src: context.source,
            map: snap(instrument(context.source)),
          };
        const next = parse(context.newSource);
        return collateral(
          cache.map,
          snap(instrument(context.newSource, next)),
          context.target.loc,
          next,
        );
      };
    },
    destroy() {
      destroyed = true;
      generation++;
      cancelPending();
      runtime?.destroy();
      frames.forEach((frame) => {
        frame.onload = null;
        frame.remove();
      });
      disposers.forEach((dispose) => dispose());
    },
  };
  return api;
}
