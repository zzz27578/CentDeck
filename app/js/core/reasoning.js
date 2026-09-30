export const THINK = ["low", "medium", "high", "xhigh", "max", "ultra"].map(id => ({ id, label: id }));
export const normalizeThink = value => value === "mid" ? "medium" : value === "off" ? "low" : THINK.some(t => t.id === value) ? value : "medium";
