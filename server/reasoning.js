/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
"use strict";
const levels = ["low", "medium", "high", "xhigh", "max", "ultra"];
function normalizeThink(value) {
  if (value == null || value === "mid") return "medium";
  if (value === "off") return "low";
  if (!levels.includes(value)) {
    throw new (require("./store").ApiError)(400, "不支持的思考强度");
  }
  return value;
}
module.exports = { levels, normalizeThink };
