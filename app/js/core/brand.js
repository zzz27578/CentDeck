export function mark(size = 32) {
  return `<svg class="cd-mark" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path class="mark-outer" d="M45 17H28a15 15 0 0 0 0 30h6"/><path class="mark-inner" d="M44 27H31a5 5 0 0 0 0 10h14"/><path class="mark-tip" d="m40 42 6 5-6 5"/></g></svg>`;
}
export function theme() {
  return document.documentElement.dataset.theme || "light";
}
export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("cd.theme", t);
}
export function toggleTheme() {
  setTheme(theme() === "dark" ? "light" : "dark");
}
