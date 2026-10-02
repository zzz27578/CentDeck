/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
// Scan CSS tokens without splitting inside strings, URLs, functions or comments.
export function tokens(source) {
  const out = [];
  let quote = "",
    comment = false,
    parens = 0,
    brackets = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i],
      next = source[i + 1];
    if (comment) {
      if (ch === "*" && next === "/") {
        comment = false;
        i++;
      }
      continue;
    }
    if (ch === "\\") {
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "/" && next === "*") {
      comment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(") parens++;
    else if (ch === ")") parens = Math.max(0, parens - 1);
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets = Math.max(0, brackets - 1);
    else if (!parens && !brackets && "{};:".includes(ch))
      out.push({ at: i, ch });
  }
  return out;
}

export function declarations(source = "") {
  const result = [];
  let start = 0,
    colon = -1,
    braces = 0;
  const finish = (end) => {
    if (colon >= start) {
      const key = source
        .slice(start, colon)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim();
      if (/^(--[\w-]+|[-\w]+)$/.test(key))
        result.push([
          key.startsWith("--") ? key : key.toLowerCase(),
          source.slice(colon + 1, end).trim(),
        ]);
    }
    start = end + 1;
    colon = -1;
  };
  for (const token of tokens(source)) {
    if (token.ch === "{") braces++;
    else if (token.ch === "}") braces--;
    else if (!braces && token.ch === ":" && colon < start) colon = token.at;
    else if (!braces && token.ch === ";") finish(token.at);
  }
  finish(source.length);
  return result;
}

// Return outermost rules only. A desktop edit must not select a nested @media.
export function rules(source) {
  const result = [];
  let start = 0,
    open = -1,
    depth = 0;
  for (const token of tokens(source)) {
    if (token.ch === "{") {
      if (depth++ === 0) open = token.at;
    } else if (token.ch === "}" && --depth === 0) {
      result.push({
        selector: source
          .slice(start, open)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .trim(),
        open,
        close: token.at,
      });
      start = token.at + 1;
    } else if (token.ch === ";" && depth === 0) start = token.at + 1;
  }
  return result;
}

export function translation(value = "none") {
  if (!value || value === "none") return ["0px", "0px"];
  const parts = [];
  let start = 0,
    depth = 0;
  for (let i = 0; i <= value.length; i++) {
    if (value[i] === "(") depth++;
    if (value[i] === ")") depth--;
    if (i === value.length || (!depth && /\s/.test(value[i]))) {
      const part = value.slice(start, i).trim();
      if (part) parts.push(part);
      start = i + 1;
    }
  }
  return [parts[0] || "0px", parts[1] || "0px"];
}

export function offsetTranslation(value, dx, dy) {
  return translation(value)
    .map((part, index) => {
      const delta = Math.round(index ? dy : dx);
      if (/^[+-]?(?:\d*\.)?\d+(?:px)?$/.test(part))
        return `${Math.round(parseFloat(part) + delta)}px`;
      return delta
        ? `calc(${part} ${delta < 0 ? "-" : "+"} ${Math.abs(delta)}px)`
        : part;
    })
    .join(" ");
}
