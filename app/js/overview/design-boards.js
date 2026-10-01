/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
import { el, esc, uid, showMenu, openModal, toast } from "../core/ui.js";
import { icon } from "../core/icons.js";
import { PRESETS, DEFAULT_PRESET_NAME } from "../panels/style-presets.js";
const W = 1120,
  H = 760;
export function createStyleCard(app, c) {
  let nodes = [],
    lines = null,
    cleanup = () => {};
  function groups() {
    return app.project()?.designGroups || [];
  }
  function ensure() {
    const p = app.project();
    if (!p.designGroupsInitialized && !p.designGroups?.length && p.pages.length) {
      const first = c.cards().find((x) => !x.popup);
      p.designGroups = [
        {
          id: "original",
          name: i18nText("原始方案"),
          pages: p.pages.map((x) => x.file),
          tokens: structuredClone(
            p.tokens || {
              colors: {},
              fontSizes: ["12px", "16px", "24px", "40px", "64px"],
              radius: ["4px", "12px", "24px"],
            },
          ),
          x: (first?.x || 0) - W - 160,
          y: first?.y || 0,
        },
      ];
      p.designGroupsInitialized=true;
      app.bus.saveMeta();
    }
    for (const [i, g] of groups().entries()) {
      if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) {
        const first = c.cards().find((x) => g.pages.includes(x.file));
        g.x = (first?.x || 0) - W - 160;
        g.y = first?.y ?? i * (H + 150);
      }
    }
  }
  function drawLinks() {
    if (!lines) return;
    lines.innerHTML = "";
    for (const { node, g } of nodes) {
      node.style.left = g.x + "px";
      node.style.top = g.y + "px";
      for (const p of c
        .cards()
        .filter((p) => !p.popup && g.pages.includes(p.file))) {
        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setAttribute(
          "d",
          `M${g.x + W} ${g.y + H / 2} C${g.x + W + 130} ${g.y + H / 2},${p.x - 130} ${p.y + 80},${p.x} ${p.y + 80}`,
        );
        path.setAttribute("class", "ov-link style-link");
        lines.appendChild(path);
      }
    }
  }
  async function mutate(g, patch, label) {
    const old = structuredClone(g);
    await app.bus.doMeta({
      label,
      apply: () => Object.assign(g, patch),
      revert: () => {
        Object.keys(g).forEach((k) => delete g[k]);
        Object.assign(g, old);
      },
    });
    refresh();
  }
  function edit(g) {
    const t = g.tokens || {};
    const body = el(
      i18nTpl`<form class="board-edit"><label>方案名称<input class="ipt" name="name" value="${esc(g.name)}" required></label><label>字体<input class="ipt" name="font" value="${esc(t.fontFamily || "system-ui")}"></label><label>字号阶梯<input class="ipt" name="sizes" value="${esc((t.fontSizes || []).join(", "))}"></label><label>圆角<input class="ipt" name="radius" value="${esc((t.radius || []).join(", "))}"></label><div class="board-color-fields">${["brand", "accent", "bg", "text"].map((k) => `<label>${{ brand: i18nText("主色"), accent: i18nText("辅色"), bg: i18nText("背景"), text: i18nText("文字") }[k]}<input name="${k}" class="ipt" value="${esc(t.colors?.[k] || "")}" placeholder="#rrggbb"></label>`).join("")}</div></form>`,
    );
    openModal({
      title: i18nText("设计规范"),
      body,
      width: 500,
      actions: [
        { label: i18nText("取消") },
        {
          label: i18nText("保存"),
          kind: "primary",
          onClick: async (close) => {
            const f = new FormData(body),
              colors = { ...t.colors };
            for (const k of ["brand", "accent", "bg", "text"]) {
              const v = String(f.get(k) || "").trim();
              if (v && !/^#[0-9a-f]{3,8}$/i.test(v)) {
                toast(i18nText("颜色请使用十六进制值"), "err");
                return;
              }
              if (v) colors[k] = v;
            }
            const units = (key) =>
              String(f.get(key))
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => (/^\d+(\.\d+)?$/.test(s) ? s + "px" : s))
                .filter((s) => /^\d+(\.\d+)?(px|rem|em)$/.test(s));
            await mutate(
              g,
              {
                name: String(f.get("name") || g.name).slice(0, 100),
                tokens: {
                  ...t,
                  colors,
                  fontFamily: String(f.get("font")).replace(/[;{}<>]/g, ""),
                  fontSizes: units("sizes"),
                  radius: units("radius"),
                },
              },
              i18nText("编辑方案规范"),
            );
            close();
          },
        },
      ],
    });
  }
  function render(g) {
    const t = g.tokens || {},
      colors = t.colors || {},
      known = Object.keys(colors).length;
    const node = el(
      i18nTpl`<section class="ov-style-card design-board" data-group="${esc(g.id)}"><header>${icon("palette", 40)}<b>${esc(g.name)}</b><button data-menu aria-label="方案操作">${icon("more", 26)}</button><button data-delete aria-label="删除风格卡片">${icon("trash",24)}</button></header><div class="design-board-grid"><div class="board-colors">${Object.entries(
        colors,
      )
        .slice(0, 4)
        .map(
          ([k, v]) =>
            `<div class="board-color"><div style="background:${/^#[\da-f]{3,8}$/i.test(v) ? v : "#777"}"><span>${esc(k)}</span><small>${esc(v)}</small></div><div class="board-tones">${[15, 35, 55, 75, 95].map((n) => `<i style="background:color-mix(in srgb,${/^#[\da-f]{3,8}$/i.test(v) ? v : "#777"} ${n}%,white)"></i>`).join("")}</div></div>`,
        )
        .join(
          "",
        )}${!known ? i18nText('<div class="board-unknown">配色待提取<button data-extract>从页面提取 ↗</button></div>') : ""}</div><div class="board-type"><div><small>DISPLAY</small><span>Aa</span><p>${esc(t.fontFamily || i18nText("页面字体"))}</p></div><div><small>BODY</small><span>百映 Aa</span><p>${esc((t.fontSizes || []).join(" / "))}</p></div></div><div class="board-components"><div class="board-buttons"><span style="background:${colors.brand || "#52663d"}">Primary</span><span>Secondary</span></div><div class="board-lines"><i style="background:${colors.brand || "#52663d"}"></i><i style="background:${colors.accent || "#778b8a"}"></i><i></i></div><div class="board-example"><span style="border-radius:${(t.radius || [])[1] || "12px"}">${icon("centdeck", 44)}</span><p>Design with intention.</p></div></div></div><footer><span>${g.pages.length} 个关联页面</span><button data-edit>编辑规范</button><button data-apply>应用规范</button><button data-choose class="${app.project().selectedDesignGroup === g.id ? "chosen" : ""}">${app.project().selectedDesignGroup === g.id ? i18nText("已选方案") : i18nText("选用方案")} ↗</button></footer></section>`,
    );
    node.style.cssText = `left:${g.x}px;top:${g.y}px;`;
    c.world.appendChild(node);
    nodes.push({ node, g });
    node.querySelector("[data-delete]").onclick = () => remove(g);
    node.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();showMenu([{label:i18nText("保存为我的预设"),icon:"plus",onClick:()=>app.tokens.savePreset(g.tokens,g.name)},{label:i18nText("删除风格卡片"),icon:"trash",danger:true,onClick:()=>remove(g)}],e.clientX,e.clientY);};
    node.querySelector("[data-edit]").onclick = () => edit(g);
    node.querySelector("[data-apply]").onclick = () =>
      app.tokens.applyToSite({ tokens: g.tokens, files: g.pages });
    node.querySelector("[data-choose]").onclick = async () => {
      const p = app.project(),
        old = {
          selectedDesignGroup: p.selectedDesignGroup,
          selectedPages: p.selectedPages,
        };
      await app.bus.doMeta({
        label: i18nText("选择设计方案"),
        apply: () => {
          p.selectedDesignGroup = g.id;
          p.selectedPages = g.pages.slice();
        },
        revert: () => Object.assign(p, old),
      });
      refresh();
    };
    node
      .querySelector("[data-extract]")
      ?.addEventListener("click", () => extract(g));
    node.querySelector("[data-menu]").onclick = (e) =>
      showMenu(
        [
          { label: i18nText("关联页面"), icon: "layers", onClick: () => assign(g) },
          {label:i18nText("保存为我的预设"),icon:"plus",onClick:()=>app.tokens.savePreset(g.tokens,g.name)},
          {label:i18nText("删除风格卡片"),icon:"trash",danger:true,onClick:()=>remove(g)},
          ...Object.keys(PRESETS).map((name) => ({
            label: name,
            icon: "palette",
            onClick: () =>
              mutate(
                g,
                { tokens: structuredClone(PRESETS[name]), name },
                i18nText("选择风格"),
              ),
          })),
        ],
        0,
        0,
        { anchor: e.currentTarget },
      );
    node.onpointerdown = (e) => {
      if (e.button || e.target.closest("button,input,textarea,select,a")) return;
      e.preventDefault();
      e.stopPropagation();
      const start = c.toWorld(e.clientX, e.clientY),
        old = { x: g.x, y: g.y };
      const move = (ev) => {
        const p = c.toWorld(ev.clientX, ev.clientY);
        g.x = old.x + p.x - start.x;
        g.y = old.y + p.y - start.y;
        drawLinks();
      };
      const end = () => {
        cleanup();
        const next = { x: g.x, y: g.y };
        Object.assign(g, old);
        mutate(g, next, i18nText("移动设计规范"));
      };
      const cancel = () => {
        cleanup();
        Object.assign(g, old);
        drawLinks();
      };
      cleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", cancel);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", cancel);
    };
  }
  function extract(g) {
    const p = app.project().pages.find((p) => g.pages.includes(p.file));
    if (!p) return;
    const iframe = [...c.world.querySelectorAll(".ov-card")]
      .find((n) => n.dataset.file === p.file)
      ?.querySelector("iframe");
    try {
      const w = iframe.contentWindow,
        d = iframe.contentDocument,
        s = w.getComputedStyle(d.body);
      const hex = (value) => {
        const nums = value.match(/\d+/g);
        return nums
          ? "#" +
              nums
                .slice(0, 3)
                .map((n) => (+n).toString(16).padStart(2, "0"))
                .join("")
          : "#ffffff";
      };
      const button = d.querySelector("button,.btn,a"),
        bs = button ? w.getComputedStyle(button) : s;
      mutate(
        g,
        {
          tokens: {
            ...g.tokens,
            fontFamily: s.fontFamily,
            colors: {
              brand: hex(
                bs.backgroundColor === "rgba(0, 0, 0, 0)"
                  ? bs.color
                  : bs.backgroundColor,
              ),
              bg: hex(s.backgroundColor),
              text: hex(s.color),
              accent: hex(bs.color),
            },
          },
        },
        i18nText("从页面提取规范"),
      );
    } catch {
      toast(i18nText("页面仍在加载，请稍后提取"));
    }
  }
  function assign(g) {
    const body = el(
      `<div class="board-assignment">${app
        .project()
        .pages.map(
          (p) =>
            `<label><input type="checkbox" value="${esc(p.file)}" ${g.pages.includes(p.file) ? "checked" : ""}>${esc(p.title)}</label>`,
        )
        .join("")}</div>`,
    );
    openModal({
      title: i18nText("关联页面"),
      body,
      actions: [
        { label: i18nText("取消") },
        {
          label: i18nText("保存"),
          kind: "primary",
          onClick: async (close) => {
            await mutate(
              g,
              {
                pages: [...body.querySelectorAll("input:checked")].map(
                  (i) => i.value,
                ),
              },
              i18nText("关联设计方案"),
            );
            close();
          },
        },
      ],
    });
  }
  function refresh() {
    if (!c.world?.isConnected) return;
    nodes.forEach((x) => x.node.remove());
    nodes = [];
    lines?.remove();
    ensure();
    lines = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    lines.setAttribute("class", "ov-svg osc-lines");
    c.world.appendChild(lines);
    groups().forEach(render);
    drawLinks();
    c.world
      .querySelectorAll(".ov-card")
      .forEach((n) =>
        n.classList.toggle(
          "chosen-page",
          !!app.project().selectedPages?.includes(n.dataset.file),
        ),
      );
  }
  async function remove(g) {
    const p=app.project(),old={designGroups:p.designGroups.slice(),selectedDesignGroup:p.selectedDesignGroup,selectedPages:p.selectedPages,designGroupsInitialized:p.designGroupsInitialized};
    await app.bus.doMeta({label:i18nText('删除设计规范卡片'),apply:()=>{p.designGroups=p.designGroups.filter(x=>x.id!==g.id);p.designGroupsInitialized=true;if(p.selectedDesignGroup===g.id){p.selectedDesignGroup=null;p.selectedPages=[];}},revert:()=>Object.assign(p,old)});refresh();
  }
  async function show(tokens=PRESETS[DEFAULT_PRESET_NAME],name=i18nText('新风格方案')) {
    const p = app.project(),
      point = c.toWorld(
        c.host.getBoundingClientRect().left + 80,
        c.host.getBoundingClientRect().top + 100,
      ),
      g = {
        id: uid("style"),
        name,
        pages: [],
        tokens: structuredClone(tokens),
        ...point,
      };
    if (!p.designGroups) p.designGroups = [];
    await app.bus.doMeta({
      label: i18nText("添加设计规范"),
      apply: () => p.designGroups.push(g),
      revert: () =>
        (p.designGroups = p.designGroups.filter((x) => x.id !== g.id)),
    });
    refresh();
  }
  return {
    mount: refresh,
    refresh,
    show,
    drawLinks,
    bounds: () => groups().map((g) => ({ x: g.x, y: g.y, w: W, h: H })),
    unmount() {
      cleanup();
      nodes = [];
      lines = null;
    },
  };
}
