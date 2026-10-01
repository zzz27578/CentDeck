/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
export const THINK = ["low", "medium", "high", "xhigh", "max", "ultra"].map(id => ({ id, label: id }));
export const normalizeThink = value => value === "mid" ? "medium" : value === "off" ? "low" : THINK.some(t => t.id === value) ? value : "medium";
