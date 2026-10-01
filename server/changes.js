/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const store = require("./store");
const { ApiError } = store;
const hash = (s) =>
  crypto
    .createHash("sha256")
    .update(s ?? "")
    .digest("hex");
function read(id, file) {
  try {
    return store.readProjectFile(id, file);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}
function target(id, file) {
  if (
    typeof file !== "string" ||
    file.includes("\\") ||
    file.includes(":") ||
    file.startsWith(".") ||
    file.split("/").some((x) => x === ".." || x === "." || !x) ||
    !/\.(html?|css|js|json|svg|md)$/i.test(file) ||
    file === "project.json"
  )
    throw new ApiError(400, "仅能修改项目内的网页、样式、脚本、SVG、JSON 和 Markdown 说明");
  const base = store.projectDir(id),
    full = store.safeJoin(base, file);
  let p = path.dirname(full);
  while (p !== base) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink())
      throw new ApiError(400, "不能写入符号链接目录");
    p = path.dirname(p);
  }
  if (fs.existsSync(full) && fs.lstatSync(full).isSymbolicLink())
    throw new ApiError(400, "不能写入符号链接");
  return full;
}
function commit(
  id,
  changes,
  {
    scope = "all",
    task,
    guard = () => {},
    group = null,
    allowDelete = false,
  } = {},
) {
  guard();
  if (!Array.isArray(changes) || !changes.length || changes.length > 20)
    throw new ApiError(400, "一次提交需要 1–20 个文件");
  const project = store.getProject(id),
    seen = new Set();
  const prepared = changes.map((c) => {
    const full = target(id, c.path);
    if (seen.has(full.toLowerCase())) throw new ApiError(400, "文件路径重复");
    seen.add(full.toLowerCase());
    if (scope !== "all" && !scope.includes(c.path))
      throw new ApiError(403, "修改超出任务范围：" + c.path);
    if (
      project.locks?.pages?.includes(c.path) ||
      project.locks?.elements?.some((x) => x.page === c.path) ||
      (!/\.html?$/i.test(c.path) &&
        (project.locks?.pages?.length || 0) +
          (project.locks?.elements?.length || 0) >
          0)
    )
      throw new ApiError(423, "目标或其依赖存在锁定：" + c.path);
    const before = read(id, c.path);
    const page=project.pages.find(p=>p.file===c.path);
    if(c.title!==undefined&&(typeof c.title!=='string'||!c.title.trim()||c.title.length>120||!/\.html?$/i.test(c.path)))throw new ApiError(400,'页面标题需要 1–120 个字符，且仅适用于 HTML');
    if(page && ((c.title!==undefined&&c.baseTitle!==page.title)||(c.baseTitle!==undefined&&c.baseTitle!==page.title)))throw new ApiError(409,'页面标题已变化，请重新读取：'+c.path);
    if (c.baseHash !== hash(before))
      throw new ApiError(409, "文件已变化，请重新读取：" + c.path);
    const remove = allowDelete && c.content === null;
    if (
      !remove &&
      (typeof c.content !== "string" || c.content.length > 1500000)
    )
      throw new ApiError(400, "文件内容无效或过大");
    if (!remove && /\.json$/i.test(c.path)) {
      try {
        JSON.parse(c.content);
      } catch {
        throw new ApiError(400, "JSON 格式不正确");
      }
    }
    if (
      !remove &&
      /\.html?$/i.test(c.path) &&
      !/<[a-z][\s\S]*>/i.test(c.content)
    )
      throw new ApiError(400, "页面缺少 HTML 元素");
    return { ...c, full, before, remove, beforeTitle:page?.title, afterTitle:/\.html?$/i.test(c.path)?c.title?.trim()||page?.title||c.path.replace(/\.html?$/i,''):undefined, afterHash: hash(c.content) };
  });
  guard();
  const dir = store.projectDir(id),
    txid = crypto.randomUUID(),
    txfile = path.join(dir, ".centdeck", "changes", txid + ".json");
  const metaPath = path.join(dir, "project.json"),
    beforeMeta = fs.readFileSync(metaPath, "utf8");
  const journal = {
    id: txid,
    task: task || null,
    state: "prepared",
    beforeMeta,
    changes: prepared.map(({ full, ...c }) => c),
    at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(txfile), { recursive: true });
  fs.writeFileSync(txfile, JSON.stringify(journal));
  try {
    for (const c of prepared) {
      if (c.remove) {
        if (fs.existsSync(c.full)) fs.unlinkSync(c.full);
      } else
        store.writeProjectFile(id, {
          path: c.path,
          content: c.content,
          baseHash: c.baseHash,
        });
    }
    const removed = new Set(
      prepared.filter((c) => c.remove).map((c) => c.path),
    );
    if (removed.size) {
      project.pages = project.pages.filter((p) => !removed.has(p.file));
      for (const f of removed) if (project.canvas) delete project.canvas[f];
      if (project.selectedPages)
        project.selectedPages = project.selectedPages.filter(
          (f) => !removed.has(f),
        );
      if (project.designGroups)
        project.designGroups = project.designGroups.flatMap((g) => {
          if (!g.pages.some((f) => removed.has(f))) return [g];
          const pages = g.pages.filter((f) => !removed.has(f));
          return pages.length ? [{ ...g, pages }] : [];
        });
      if (
        project.selectedDesignGroup &&
        !project.designGroups?.some((g) => g.id === project.selectedDesignGroup)
      )
        delete project.selectedDesignGroup;
    }
    for (const c of prepared) {
      if(c.remove||!/\.html?$/i.test(c.path))continue;
      const page=project.pages.find(p=>p.file===c.path);
      if(page){if(c.title!==undefined)page.title=c.title.trim();}
      else project.pages.push({file:c.path,title:c.title?.trim()||c.path.replace(/\.html?$/i,'')});
    }
    if (group) {
      project.designGroups = project.designGroups || [];
      const old = project.designGroups.find((g) => g.id === group.id);
      if (old) Object.assign(old, group);
      else {
        group.x = -1280;
        group.y = project.designGroups.length * 2200;
        project.designGroups.push(group);
        project.canvas = project.canvas || {};
        group.pages.forEach(
          (f, i) => (project.canvas[f] = { x: i * 2250, y: group.y }),
        );
      }
    }
    delete project.tokens;
    store.saveProject(id, project);
    journal.state = "committed";
    fs.writeFileSync(txfile, JSON.stringify(journal));
  } catch (e) {
    for (const c of prepared) {
      if (c.before === null) {
        if (fs.existsSync(c.full)) fs.unlinkSync(c.full);
      } else fs.writeFileSync(c.full, c.before);
    }
    fs.writeFileSync(metaPath, beforeMeta);
    journal.state = "rolledback";
    fs.writeFileSync(txfile, JSON.stringify(journal));
    throw e;
  }
  return {
    id: txid,
    files: prepared.map((c) => ({
      path: c.path,
      hash: c.afterHash,
      ...(c.remove ? { deleted: true } : {}),
      ...(c.title!==undefined ? { title:c.title.trim() } : {}),
    })),
    check: "格式与版本校验通过",
  };
}
function recover(id) {
  const dir = store.projectDir(id),
    root = path.join(dir, ".centdeck", "changes");
  if (!fs.existsSync(root)) return;
  for (const n of fs.readdirSync(root)) {
    if (!n.endsWith(".json")) continue;
    const f = path.join(root, n),
      j = JSON.parse(fs.readFileSync(f, "utf8"));
    if (j.state !== "prepared") continue;
    for (const c of j.changes) {
      const dest = target(id, c.path);
      if (c.before === null) {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
      } else fs.writeFileSync(dest, c.before);
    }
    fs.writeFileSync(path.join(dir, "project.json"), j.beforeMeta);
    j.state = "rolledback";
    fs.writeFileSync(f, JSON.stringify(j));
  }
}
function undo(id, txid) {
  store.assertValidId(txid, "变更编号");
  const f = path.join(
    store.projectDir(id),
    ".centdeck",
    "changes",
    txid + ".json",
  );
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  if (j.state !== "committed") throw new ApiError(409, "此变更已撤回");
  // Validate all versions before removing generated files; the journal retains
  // their content so both a failed transaction and crash recovery can restore it.
  const result = commit(
    id,
    j.changes.map((c) => ({
      path: c.path,
      content: c.before,
      baseHash: c.afterHash,
      ...(c.beforeTitle!==undefined?{title:c.beforeTitle}:{}),
      ...(c.afterTitle!==undefined?{baseTitle:c.afterTitle}:{}),
    })),
    { allowDelete: true },
  );
  j.state = "undone";
  fs.writeFileSync(f, JSON.stringify(j));
  return result;
}
module.exports = { hash, read, commit, recover, undo };
