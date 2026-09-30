import { mark, toggleTheme } from "../core/brand.js";
import { esc } from "../core/ui.js";
export async function requireLogin(app) {
  let state = await app.api.auth();
  if (state.authenticated && !state.mustChange) {
    app.account = state;
    return;
  }
  document.body.className = "entry-page";
  const root = document.getElementById("app");
  root.innerHTML = `<main class="welcome"><section class="login-under"><button class="login-back" aria-label="返回首页">←</button><form class="login-form"><div class="login-monogram">${mark(54)}</div><h1>欢迎回来</h1><label>用户名<input name="username" autocomplete="username" value="centdeck" required maxlength="60"></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><p class="login-error" role="alert"></p><button type="submit" class="btn primary">进入工作台 <span>↗</span></button><p class="first-account">首次使用：centdeck / centdeck</p></form></section><section class="landing-cover"><header><a class="wordmark" href="/">${mark(36)}<span>CentDeck<span class="wordmark-sub">百映</span></span></a><nav><button data-theme aria-label="切换亮色与暗色模式">◐</button><a href="https://github.com/zzz27578/CentDeck" target="_blank" rel="noopener">GitHub ↗</a><button class="btn" data-login>登录 ↗</button></nav></header><div class="landing-copy"><div class="landing-overline">THE SPACE BETWEEN IDEA & REALITY</div><h1>让灵感，<br><span>映成现实。</span></h1><p>从一个想法，到一整个网站。</p><button class="landing-cta" data-login>开始设计 <span>↗</span></button></div><div class="brand-sculpture" aria-hidden="true"><div class="sculpture-orbit"></div><div class="sculpture-face">${mark(350)}</div><span class="sculpture-caption">一百种可能 · 你的那一种</span></div><footer><span>DESIGN WITH INTENTION.</span><span>CentDeck / 01</span></footer></section></main>`;
  const welcome = root.querySelector(".welcome"),
    form = root.querySelector("form");
  const reveal = () => {
    welcome.classList.add("login-open");
    root.querySelector(".landing-cover").inert = true;
    root.querySelector(".login-under").inert = false;
    setTimeout(() => form.elements.username.focus(), 350);
  };
  root.querySelector(".login-under").inert = true;
  root.querySelectorAll("[data-login]").forEach((b) => (b.onclick = reveal));
  root.querySelector("[data-theme]").onclick = toggleTheme;
  root.querySelector(".login-back").onclick = () => {
    if (state.mustChange) return;
    welcome.classList.remove("login-open");
    root.querySelector(".landing-cover").inert = false;
    root.querySelector(".login-under").inert = true;
    root.querySelector("[data-login]").focus();
  };
  function setup() {
    reveal();
    form.querySelector("h1").textContent = "设定你的账号";
    form.elements.username.value = state.username;
    form.elements.password.value = "";
    form.elements.password.autocomplete = "new-password";
    form.elements.password.minLength = 8;
    form.querySelector("label:nth-of-type(2)").firstChild.textContent =
      "新密码";
    form.querySelector("button[type=submit]").innerHTML =
      "保存并进入 <span>↗</span>";
    form.querySelector(".first-account").textContent =
      "新密码至少 8 位 · 用户名可保留";
    root.querySelector(".login-back").hidden = true;
    form.insertBefore(
      Object.assign(document.createElement("p"), {
        className: "account-path",
        textContent: "账号文件：config.local/account.json",
      }),
      form.querySelector(".first-account"),
    );
  }
  if (state.mustChange) setup();
  return new Promise((resolve) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const b = form.querySelector("button[type=submit]"),
        err = form.querySelector(".login-error");
      b.disabled = true;
      err.textContent = "";
      try {
        const data = {
          username: form.elements.username.value,
          password: form.elements.password.value,
        };
        state = state.mustChange
          ? await app.api.account(data)
          : await app.api.login(data);
        if (state.mustChange) {
          setup();
          return;
        }
        app.account = state;
        welcome.classList.add("entry-complete");
        setTimeout(resolve, 220);
      } catch (e) {
        err.textContent = e.message;
      } finally {
        b.disabled = false;
      }
    };
  });
}
