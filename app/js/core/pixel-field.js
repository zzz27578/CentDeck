/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
// A decorative pixel wake. It never captures input, runs only after interaction,
// and disposes itself when the containing screen is replaced.
export function pixelField() {
  return '<div class="noir-field" aria-hidden="true"><canvas></canvas></div>';
}

export function mountPixelField(root) {
  const field = root.querySelector('.noir-field');
  if (!field) return () => {};
  const host = field.parentElement;
  const canvas = field.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const welcome = root.querySelector('.welcome');
  const controller = new AbortController();
  const { signal } = controller;
  const pointer = { x: -1000, y: -1000, active: false };
  let width = 0, height = 0, pixels = [], waves = [];
  let frame = 0, last = 0, until = 0, visible = true, active = false, disposed = false;
  let dark = false;

  function draw(now, animate = false) {
    if (!width || !height) return;
    const step = last ? Math.min((now - last) / 16.67, 3) : 1;
    last = now;
    ctx.clearRect(0, 0, width, height);
    const fade = Math.pow(0.88, step);
    waves = waves.filter(wave => now - wave.start < 1150);
    for (const pixel of pixels) {
      const dx = pixel.x - pointer.x, dy = pixel.y - pointer.y;
      const distance = Math.hypot(dx, dy);
      const proximity = animate && pointer.active ? Math.max(0, 1 - distance / 105) : 0;
      let energy = proximity * proximity;
      for (const wave of waves) {
        const age = (now - wave.start) / 1150;
        const ring = Math.abs(Math.hypot(pixel.x - wave.x, pixel.y - wave.y) - age * 470);
        energy = Math.max(energy, Math.max(0, 1 - ring / 32) * (1 - age));
      }
      pixel.heat = animate ? Math.max(energy, pixel.heat * fade) : 0;
      const heat = pixel.heat;
      const size = heat > 0.04 ? 1.4 + heat * 2.5 : 1.1;
      const nudge = animate ? heat * 5 : 0;
      const x = pixel.x + dx / (distance || 1) * nudge;
      const y = pixel.y + dy / (distance || 1) * nudge;
      ctx.fillStyle = heat > 0.04
        ? `rgba(${dark ? '100,140,255' : '49,91,255'},${0.18 + heat * 0.66})`
        : `rgba(${dark ? '160,183,235' : '72,93,137'},${dark ? 0.14 : 0.14})`;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      if (heat > 0.35) {
        ctx.fillStyle = `rgba(49,91,255,${heat * 0.055})`;
        ctx.fillRect(x - 6, y - 6, 12, 12);
      }
    }
  }

  function tick(now) {
    frame = 0;
    if (!field.isConnected) { dispose(); return; }
    if (!active || !visible || document.hidden || reduced.matches) return;
    const moving = now < until;
    draw(now, moving);
    if (moving) frame = requestAnimationFrame(tick);
  }

  function wake() {
    if (!active || !visible || document.hidden || reduced.matches || disposed) return;
    until = performance.now() + 1400;
    if (!frame) { last = 0; frame = requestAnimationFrame(tick); }
  }

  function resize() {
    if (disposed || !active) return;
    const box = canvas.getBoundingClientRect();
    width = box.width; height = box.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pixels = [];
    const spacing = width < 600 ? 24 : 28;
    for (let y = 14; y < height; y += spacing) {
      for (let x = 14; x < width; x += spacing) pixels.push({ x, y, heat: 0 });
    }
    draw(performance.now());
  }

  function sync() {
    if (!field.isConnected) { dispose(); return; }
    active = document.documentElement.dataset.style === 'noir' && !welcome?.classList.contains('login-open');
    dark = host.classList.contains('landing-cover') || document.documentElement.dataset.theme === 'dark';
    cancelAnimationFrame(frame); frame = 0; waves = []; pointer.active = false;
    if (active) resize();
  }

  function locate(event) {
    const box = canvas.getBoundingClientRect();
    pointer.x = event.clientX - box.left;
    pointer.y = event.clientY - box.top;
    pointer.active = pointer.x >= 0 && pointer.x <= width && pointer.y >= 0 && pointer.y <= height;
  }

  host.addEventListener('pointermove', event => {
    if (!active || reduced.matches) return;
    locate(event);
    if (!pointer.active) return;
    wake();
  }, { signal, passive: true });
  host.addEventListener('pointerleave', () => {
    pointer.active = false;
    wake();
  }, { signal, passive: true });
  host.addEventListener('pointerdown', event => {
    if (!active || reduced.matches || event.button !== 0 || event.target.closest('button, a, input, textarea, select, [role="button"]')) return;
    locate(event);
    if (!pointer.active) return;
    waves.push({ x: pointer.x, y: pointer.y, start: performance.now() });
    waves = waves.slice(-3);
    wake();
  }, { signal, passive: true });
  const releaseTouch = event => {
    if (event.pointerType !== 'mouse') { pointer.active = false; wake(); }
  };
  host.addEventListener('pointerup', releaseTouch, { signal, passive: true });
  host.addEventListener('pointercancel', releaseTouch, { signal, passive: true });

  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(field);
  const screenObserver = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (!visible) { cancelAnimationFrame(frame); frame = 0; }
    else if (active) draw(performance.now());
  });
  screenObserver.observe(field);
  const styleObserver = new MutationObserver(sync);
  styleObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-style', 'data-theme'] });
  if (welcome) styleObserver.observe(welcome, { attributes: true, attributeFilter: ['class'] });
  // #app is reused by login, home and the workbench. A removed background must
  // release its observers even when no animation frame is pending.
  const lifeObserver = new MutationObserver(() => { if (!field.isConnected) dispose(); });
  lifeObserver.observe(root, { childList: true });
  document.addEventListener('visibilitychange', sync, { signal });
  reduced.addEventListener('change', sync, { signal });

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    controller.abort();
    sizeObserver.disconnect(); screenObserver.disconnect();
    styleObserver.disconnect(); lifeObserver.disconnect();
  }
  sync();
  return dispose;
}
