/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import { text as i18nText, template as i18nTpl } from './i18n.js';
// bus.js —— 命令总线 + 内置插件骨架（内核）
//
// 两条铁律：
//  1. 一切修改都是命令对象 { label, page, beforeSource, afterSource, apply(), revert() }，
//     入栈即自动 PUT 保存；撤销/重做 = 恢复源码 + 重新渲染（apply/revert 由命令创建方闭包实现）。
//  2. 引擎（engine/）本身无状态，撤销栈由本层维护。
//
// 插件骨架：面板 / 命令 / 工具栏按钮都向本模块注册，main.js 只读注册表渲染，
// sketch / notes / assets / tokens / layers / history 均以"内置插件"方式接入，不写死进内核。

export function createBus(deps) {
  const { api, onError, onSaveState } = deps;

  // ---------- 事件 ----------
  const listeners = new Map(); // evt -> Set<fn>
  function on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt).delete(fn);
  }
  function emit(evt, ...args) {
    (listeners.get(evt) || []).forEach((fn) => { try { fn(...args); } catch (e) { console.error('[bus]', e); } });
  }

  // ---------- 保存状态 ----------
  let saveState = 'saved'; // saved | saving | dirty | error
  function setSaveState(s) {
    if (saveState === s) return;
    saveState = s;
    if (onSaveState) onSaveState(s);
    emit('savestate', s);
  }

  // ---------- 项目元数据保存（project.json：标记/便签/锁定/画布布局） ----------
  let metaTimer = 0;
  let metaSaving = null; // 进行中的保存 Promise
  let getProject = () => null;
  let afterMetaSaved = null;
  let savedTokens = 'null';

  async function flushMeta() {
    clearTimeout(metaTimer);
    if (metaSaving) { try { await metaSaving; } catch { /* 本次保存仍可重试 */ } }
    const proj = getProject();
    if (!proj) return;
    setSaveState('saving');
    // 提交前剥掉 tokens（tokens 由 design/tokens.json 承载，GET 时合并进来，PUT 时不应写进 project.json）
    const body = structuredClone(proj);
    delete body.tokens;
    try {
      const tokenData = JSON.stringify(proj.tokens || null);
      metaSaving = (async () => {
        if (tokenData !== savedTokens) { await api.writeFile(proj.id, 'design/tokens.json', tokenData + '\n', {toast:false}); savedTokens = tokenData; }
        return api.saveProject(proj.id, body, { toast: false });
      })();
      const saved=await metaSaving;
      if(saved){for(const key of new Set([...Object.keys(body),...Object.keys(saved)])){if(key==='tokens'||JSON.stringify(saved[key])===JSON.stringify(body[key]))continue;if(JSON.stringify(proj[key])===JSON.stringify(body[key])){if(saved[key]===undefined)delete proj[key];else proj[key]=saved[key];}}}
      metaSaving = null;
      setSaveState('saved');
      if (afterMetaSaved) afterMetaSaved();
      return true;
    } catch (e) {
      metaSaving = null;
      setSaveState('error');
      if (onError) onError(e);
      return false;
    }
  }
  // 元数据保存做 400ms 防抖（连续打勾、拖画布不刷爆接口）
  function saveMeta() {
    setSaveState('dirty');
    clearTimeout(metaTimer);
    metaTimer = setTimeout(flushMeta, 400);
    return Promise.resolve();
  }

  // ---------- 撤销 / 重做栈 ----------
  const undoStack = [];
  const redoStack = [];
  const STACK_LIMIT = 100;

  function stackChanged() { emit('stack'); }

  // 执行一条命令：apply() 里完成 PUT 保存与重渲染；失败则不入栈
  async function do_(cmd) {
    if (!cmd || typeof cmd.apply !== 'function') throw new Error(i18nText('命令缺少 apply()'));
    setSaveState('saving');
    try {
      await cmd.apply();
    } catch (e) {
      setSaveState('error');
      if (onError) onError(e);
      throw e;
    }
    undoStack.push(cmd);
    if (undoStack.length > STACK_LIMIT) undoStack.shift();
    redoStack.length = 0; // 新命令清空重做栈
    setSaveState('saved');
    stackChanged();
    return cmd;
  }

  async function undo() {
    const cmd = undoStack.pop();
    if (!cmd) return false;
    setSaveState('saving');
    try {
      await cmd.revert();
    } catch (e) {
      undoStack.push(cmd); // 恢复失败，命令放回去
      setSaveState('error');
      if (onError) onError(e);
      return false;
    }
    redoStack.push(cmd);
    setSaveState('saved');
    stackChanged();
    return true;
  }

  async function redo() {
    const cmd = redoStack.pop();
    if (!cmd) return false;
    setSaveState('saving');
    try {
      await cmd.apply();
    } catch (e) {
      redoStack.push(cmd);
      setSaveState('error');
      if (onError) onError(e);
      return false;
    }
    undoStack.push(cmd);
    setSaveState('saved');
    stackChanged();
    return true;
  }

  // 可撤销的元数据修改（便签、标记、锁定等）：apply/revert 直接改 project 对象
  async function doMeta({ label, apply, revert }) {
    const proj = getProject();
    if (!proj) return;
    const cmd = {
      label: label || i18nText('修改项目设置'),
      page: null,
      apply: async () => { apply(proj); if (await flushMeta() === false) { revert(proj); emit('stack'); throw new Error(i18nText('项目保存失败，修改已撤回')); } },
      revert: async () => { revert(proj); if (await flushMeta() === false) { apply(proj); emit('stack'); throw new Error(i18nText('撤销保存失败')); } },
    };
    return do_(cmd);
  }

  // ---------- 插件注册表 ----------
  const panels = []; // { id, title, icon, side:'left'|'right', render(host, ctx), onShow?(ctx), onHide?() }
  const commands = new Map(); // name -> fn(ctx, ...args)
  const toolbarActions = []; // { id, title, icon, when?(ctx), onClick(ctx) }

  function registerPanel(p) {
    if (!p || !p.id || typeof p.render !== 'function') throw new Error(i18nText('registerPanel 需要 { id, render }'));
    if (panels.some((x) => x.id === p.id)) throw new Error(i18nText('面板 id 重复：') + p.id);
    panels.push({ side: 'left', icon: '▦', ...p });
    emit('panels');
    return p;
  }
  function registerCommand(name, fn) {
    if (commands.has(name)) throw new Error(i18nText('命令重复注册：') + name);
    commands.set(name, fn);
  }
  function runCommand(name, ctx, ...args) {
    const fn = commands.get(name);
    if (!fn) throw new Error(i18nText('命令未注册：') + name);
    return fn(ctx, ...args);
  }
  function registerToolbarAction(a) {
    if (!a || !a.id || typeof a.onClick !== 'function') throw new Error(i18nText('registerToolbarAction 需要 { id, onClick }'));
    if (toolbarActions.some((x) => x.id === a.id)) throw new Error(i18nText('工具栏按钮 id 重复：') + a.id);
    toolbarActions.push(a);
    emit('toolbar');
    return a;
  }

  return {
    on, emit,
    // 保存状态
    get saveState() { return saveState; },
    setSaveState, saveMeta, flushMeta,
    bindProject(getter, afterSave) { getProject = getter; savedTokens = JSON.stringify(getter()?.tokens || null); afterMetaSaved = afterSave || null; },
    // 命令栈
    do: do_, undo, redo, doMeta,
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get undoStack() { return undoStack; },
    clearStacks() { undoStack.length = 0; redoStack.length = 0; stackChanged(); },
    peekUndo() { return undoStack[undoStack.length - 1] || null; },
    // 插件骨架
    registerPanel, registerCommand, runCommand, registerToolbarAction,
    panels: () => panels.slice(),
    toolbarActions: () => toolbarActions.slice(),
  };
}
