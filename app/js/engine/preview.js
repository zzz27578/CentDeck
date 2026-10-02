/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
const origins = new Map();
export async function previewOrigin(baseHref) {
  const path = new URL(baseHref, location.href).pathname;
  const key = path.split("/").slice(0, 3).join("/");
  if (!origins.has(key))
    origins.set(
      key,
      fetch("/api/preview?base=" + encodeURIComponent(path), {
        headers: { "X-CentDeck": "1" },
      })
        .then((r) => r.json())
        .then((result) => {
          if (!result.ok) throw Error(result.error);
          return result.data.origin;
        })
        .finally(() => origins.delete(key)),
    );
  return origins.get(key);
}
export function safeSnapshot(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("script,meta[http-equiv],iframe,object,embed")
    .forEach((node) => node.remove());
  for (const node of doc.querySelectorAll("*"))
    for (const attr of [...node.attributes])
      if (/^on/i.test(attr.name) || attr.name === "srcdoc")
        node.removeAttribute(attr.name);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
export function createPreview(
  host,
  { baseHref, onSnapshot, onNavigate, onExit } = {},
) {
  const iframe = document.createElement("iframe");
  iframe.className = "pf-runtime";
  iframe.title = "Interactive preview";
  iframe.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-forms allow-downloads",
  );
  iframe.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;border:0;opacity:0;pointer-events:none";
  host.appendChild(iframe);
  let origin = "",
    destroyed = false,
    sequence = 0,
    state = null,
    resolveReady,
    rejectReady;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {});
  const readyTimer = setTimeout(
    () => rejectReady(Error("Preview startup timed out")),
    15000,
  );
  function receive(event) {
    if (
      event.source !== iframe.contentWindow ||
      event.origin !== origin ||
      event.data?.channel !== "centdeck-preview"
    )
      return;
    const data = event.data;
    if (data.event === "ready") {
      clearTimeout(readyTimer);
      resolveReady();
      return;
    }
    if (data.state) {
      state = data.state;
      onSnapshot?.(data);
    }
    if (data.event === "navigate") {
      onNavigate?.(data.href);
      return;
    }
    if (data.event === "exit-interaction") {
      onExit?.();
      return;
    }
    if (data.id && pending.has(data.id)) {
      const request = pending.get(data.id);
      pending.delete(data.id);
      clearTimeout(request.timer);
      data.error ? request.reject(Error(data.error)) : request.resolve(data);
    }
  }
  addEventListener("message", receive);
  previewOrigin(baseHref)
    .then((value) => {
      if (destroyed) return;
      origin = value;
      iframe.src =
        origin + "/runtime?parent=" + encodeURIComponent(location.origin);
    })
    .catch((error) => {
      clearTimeout(readyTimer);
      rejectReady(error);
    });
  async function request(type, data = {}) {
    await ready;
    if (destroyed) throw Error("Preview destroyed");
    return new Promise((resolve, reject) => {
      const id = ++sequence,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("Preview request timed out"));
        }, 15000);
      pending.set(id, { resolve, reject, timer });
      iframe.contentWindow.postMessage(
        { channel: "centdeck-preview", id, type, ...data },
        origin,
      );
    });
  }
  return {
    iframe,
    get state() {
      return state;
    },
    get origin() {
      return origin;
    },
    async render(html, options = {}) {
      await ready;
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("base").forEach((node) => node.remove());
      const base = doc.createElement("base");
      base.href = new URL(
        new URL(baseHref, location.href).pathname,
        origin + "/",
      ).href;
      doc.head.prepend(base);
      return request("render", {
        html: "<!doctype html>" + doc.documentElement.outerHTML,
        ...options,
      });
    },
    snapshot: () => request("snapshot"),
    action: (command) => request("action", command),
    show(on) {
      iframe.style.opacity = on ? "1" : "0";
      iframe.style.pointerEvents = on ? "auto" : "none";
      iframe.style.zIndex = on ? "1" : "-1";
    },
    destroy() {
      destroyed = true;
      clearTimeout(readyTimer);
      rejectReady(Error("Preview destroyed"));
      removeEventListener("message", receive);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(Error("Preview destroyed"));
      }
      pending.clear();
      iframe.remove();
    },
  };
}

// Overview and import checks receive a DOM snapshot with scripting disabled.
export async function renderSafePreview(iframe, html, baseHref, options = {}) {
  iframe.setAttribute("sandbox", "allow-same-origin");
  const holder = document.createElement("div");
  holder.style.cssText = `position:fixed;left:-30000px;top:0;width:${options.width || 1440}px;height:${options.height || 900}px`;
  document.body.appendChild(holder);
  const runtime = createPreview(holder, { baseHref });
  try {
    const result = await runtime.render(html, options);
    if (iframe.isConnected) {
      iframe.srcdoc = safeSnapshot(result.html);
      return result;
    }
  } finally {
    runtime.destroy();
    holder.remove();
  }
}
