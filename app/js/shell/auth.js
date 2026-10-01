import { pixelField, mountPixelField } from "../core/pixel-field.js";
import { particleSculpture, mountParticleSculpture } from "../core/particle-sculpture.js";
import { mark, toggleTheme, styleSwitch, bindStyleSwitch, moveSculpture } from "../core/brand.js";
export async function requireLogin(app) {
  let state = await app.api.auth();
  if (state.authenticated && !state.mustChange) {
    app.account = state;
    return;
  }
  document.body.className = "entry-page";
  const root = document.getElementById("app");
  root.innerHTML = `<main class="welcome"><section class="login-under"><button class="login-back" aria-label="返回首页">←</button><form class="login-form"><div class="login-monogram">${mark(54)}</div><span class="login-step">01 / 开始创作</span><h1>欢迎回来</h1><p class="login-intro">登录你的设计空间</p><label>用户名<input name="username" autocomplete="username" value="centdeck" required maxlength="60"></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><p class="login-error" role="alert"></p><button type="submit" class="btn primary">进入工作台 <span>↗</span></button><p class="first-account">首次使用：centdeck / centdeck</p></form></section><section class="landing-cover">${pixelField()}<header><a class="wordmark" href="/">${mark(36)}<span>CentDeck<span class="wordmark-sub">百映</span></span></a><nav>${styleSwitch()}<button data-theme aria-label="切换亮色与暗色模式">◐</button><a href="https://github.com/zzz27578/CentDeck" target="_blank" rel="noopener">GitHub ↗</a><button class="btn" data-login>登录 ↗</button></nav></header><div class="landing-copy"><div class="landing-overline">THE SPACE BETWEEN IDEA & REALITY</div><h1>让灵感<br><span>映成现实</span></h1><p>从一个想法，到一整个网站。</p><button class="landing-cta" data-login>开始设计 <span>↗</span></button></div>${particleSculpture()}<div class="brand-sculpture" aria-hidden="true"><div class="sculpture-face">${mark(350)}</div><span class="sculpture-caption">一百种可能 · 你的那一种</span></div><div class="login-art" aria-hidden="true"><span>IDEA / IN MOTION</span><div class="login-art-mark">${mark(240, { draw: true })}</div><strong>每一个想法<br>都有新的可能</strong><small>YOUR SPACE TO CREATE</small></div><footer><span>DESIGN WITH INTENTION.</span><span>CentDeck / 01</span></footer></section></main>`;
  bindStyleSwitch(root);
  moveSculpture(root);
  mountPixelField(root);
  mountParticleSculpture(root);
  const welcome = root.querySelector(".welcome"),
    form = root.querySelector("form");
  let focusTimer;
  const reveal = () => {
    clearTimeout(focusTimer);
    welcome.classList.add("login-open");
    root.querySelector(".landing-cover").inert = true;
    root.querySelector(".login-under").inert = false;
    focusTimer=setTimeout(() => (state.mustChange ? form.elements.password : form.elements.username).focus(), 350);
  };
  root.querySelector(".login-under").inert = true;
  root.querySelectorAll("[data-login]").forEach((b) => (b.onclick = reveal));
  root.querySelector("[data-theme]").onclick = toggleTheme;
  root.querySelector(".login-back").onclick = () => {
    if (state.mustChange) return;
    clearTimeout(focusTimer);
    welcome.classList.remove("login-open");
    root.querySelector(".landing-cover").inert = false;
    root.querySelector(".login-under").inert = true;
    root.querySelector("[data-login]").focus();
  };
  function setup() {
    reveal();
    form.querySelector("h1").textContent = "请修改初始密码";
    form.querySelector(".login-step").textContent = "02 / 设置新密码";
    form.querySelector(".login-intro").textContent = "首次登录，请设置你的专属密码后进入工作台";
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
