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
