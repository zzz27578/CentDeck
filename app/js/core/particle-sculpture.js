/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from './i18n.js';
export function particleSculpture() {
  return i18nTpl`<section class="noir-particles" aria-label="可交互粒子主视觉">
    <button type="button" class="particle-surface" aria-label="粒子特效：单击打散，双击换形，拖动轻晃；回车换形，空格打散">
      <canvas aria-hidden="true"></canvas>
    </button>
  </section>`;
}

export function mountParticleSculpture(root) {
  const host = root.querySelector('.noir-particles');
  if (!host) return () => {};
  const surface = host.querySelector('.particle-surface');
  const canvas = surface.querySelector('canvas');
  const context = canvas.getContext('2d');
  if (!context) return () => {};
  const welcome = root.querySelector('.welcome');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController();
  const { signal } = abort;
  const count = 4800;
  const tau = Math.PI * 2;
  const shapeCount = 4;
  const random = i => {
    const value = Math.sin(i * 127.1 + 311.7) * 43758.5453123;
    return value - Math.floor(value);
  };
  const particles = Array.from({ length: count }, (_, i) => ({
    seed: random(i + 1), x: 0, y: 0, z: 0, sx: 0, sy: 0, dx: 0, dy: 0,
    vx: 0, vy: 0, heat: 0, opacity: 1, size: 1, order: i,
  }));
  const rendered = [...particles];
  const dust = Array.from({ length: 140 }, (_, i) => ({ x: random(i + 5200), y: random(i + 6200), speed: random(i + 7200), phase: random(i + 8200) * tau }));
  const pointer = { x: -9999, y: -9999, active: false };
  let width = 0, height = 0, frame = 0, last = 0, time = 0, shape = 0;
  let active = false, visible = true, disposed = false, paused = reduced.matches;
  const tilt = { x: 0, y: 0 }, targetTilt = { ...tilt };
  let drag = null, dragged = false, pressStarted = 0, wave = null, transitionStart = 0, transition = false;
  let lastTap = null;
  let from = null, targets = null;

  // Sample the existing CentDeck mark, preserving its actual brand geometry.
  function brandPoints() {
    const mask = document.createElement('canvas');
    mask.width = mask.height = 256;
    const ctx = mask.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    ctx.scale(4, 4);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke(new Path2D('M45 17H28a15 15 0 0 0 0 30h6 M44 27H31a5 5 0 0 0 0 10h14 M40 42l6 5-6 5'));
    const data = ctx.getImageData(0, 0, 256, 256).data;
    const points = [];
    for (let y = 0; y < 256; y += 2) for (let x = 0; x < 256; x += 2) {
      if (data[(y * 256 + x) * 4 + 3] > 180) points.push({ x: (x / 4 - 30) / 16.5, y: (y / 4 - 33.5) / 16.5 });
    }
    return points;
  }
  const mark = brandPoints();

  function positions(index) {
    return particles.map((p, i) => {
      const r = p.seed, s = random(i + 4100), t = random(i + 8100);
      if (index === 0 && mark.length) {
        const point = mark[Math.floor(r * mark.length)];
        return { x: point.x + (s - 0.5) * 0.027, y: point.y + (t - 0.5) * 0.027, z: (random(i + 1100) - 0.5) * 0.32 };
      }
      if (index === 3) {
        // A dense nucleus and two continuous, tapered spiral arms.
        const core = i % 5 === 0;
        const radius = core ? Math.sqrt(r) * 0.25 : Math.pow(r, 0.7) * 1.32;
        const spread = (s - 0.5) * (0.55 - radius * 0.24);
        const angle = core ? s * tau : (i % 2) * Math.PI + radius * 4.5 + spread;
        return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: (t - 0.5) * 0.10 };
      }
      if (index === 2) {
        const bridge = i % 10 < 3;
        const height = (r - 0.5) * 2.6;
        const y = bridge ? Math.round(height * 10) / 10 : height;
        const angle = y * 4.3 + (bridge ? 0 : (i % 2) * Math.PI);
        const radius = bridge ? (s - 0.5) * 1.24 : 0.62 + (s - 0.5) * 0.09;
        return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius + (t - 0.5) * 0.04 };
      }
      // Three precise orbital rings with light travelling along their paths.
      const ring = i % 3;
      const angle = r * tau;
      const radius = 1.19 + ring * 0.06 + (s - 0.5) * 0.055;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: (t - 0.5) * 0.045 };
    });
  }
  const forms = Array.from({ length: shapeCount }, (_, index) => positions(index));

  // Animate geometry before morphing, keeping the camera square to the page.
  // The logo pivots in 3D around its fixed centre, the galaxy turns clockwise, and DNA twists
  // around a fixed vertical axis. No form inherits another form's rotation.
  function pose(point, index, i) {
    const { x, y, z } = point;
    if (index === 0) {
      const yaw = -0.10 + Math.sin(time * 0.58) * 0.22 + tilt.y;
      const pitch = Math.sin(time * 0.43) * 0.11 + tilt.x;
      const rx = x * Math.cos(yaw) + z * Math.sin(yaw);
      const rz = -x * Math.sin(yaw) + z * Math.cos(yaw);
      const ry = y * Math.cos(pitch) - rz * Math.sin(pitch);
      const depth = y * Math.sin(pitch) + rz * Math.cos(pitch);
      const perspective = 5 / (5 + depth);
      return { x: rx * perspective, y: ry * perspective, z: depth };
    }
    if (index === 3) {
      const angle = time * 0.30;
      return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle), z };
    }
    if (index === 2) {
      const phase = time * 0.58;
      return { x: x * Math.cos(phase) + z * Math.sin(phase), y, z: -x * Math.sin(phase) + z * Math.cos(phase) };
    }
    const ring = i % 3, phase = time * (0.20 + ring * 0.055);
    const along = x * Math.cos(phase) - y * Math.sin(phase);
    const across = x * Math.sin(phase) + y * Math.cos(phase);
    const angle = ring * Math.PI / 3 + Math.PI / 6;
    return { x: along * Math.cos(angle) - across * 0.38 * Math.sin(angle),
      y: along * Math.sin(angle) + across * 0.38 * Math.cos(angle), z: across * 0.8 + z };
  }

  function setShape(immediate = false) {
    from = particles.map(p => ({ x: p.x, y: p.y, z: p.z }));
    targets = forms[shape];
    transitionStart = performance.now();
    transition = !immediate && !paused;
    host.dataset.shape = String(shape);
    host.classList.toggle('is-reforming', transition);
    if (!transition) particles.forEach((p, i) => Object.assign(p, pose(targets[i], shape, i)));
    pointer.active = false;
    wake();
  }

  function render(now) {
    if (!width || !height) return;
    const dt = last ? Math.min((now - last) / 16.667, 2.5) : 1;
    last = now;
    if (!paused) time += dt / 60;
    context.clearRect(0, 0, width, height);
    const scale = Math.min(width / 3.0, height / 3.0);
    tilt.x += (targetTilt.x - tilt.x) * 0.09 * dt;
    tilt.y += (targetTilt.y - tilt.y) * 0.09 * dt;
    const centerX = width / 2, centerY = height / 2;
    const elapsed = now - transitionStart;
    let morphing = false;

    // A low intensity halo gives the individual silver and blue points depth.
    const halo = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, scale * 1.6);
    halo.addColorStop(0, 'rgba(40,78,220,0.07)'); halo.addColorStop(0.7, 'rgba(32,70,200,0.025)'); halo.addColorStop(1, 'rgba(32,70,200,0)');
    context.fillStyle = halo; context.fillRect(0, 0, width, height);
    for (const d of dust) {
      const x = ((d.x + time * 0.004 * (0.3 + d.speed)) % 1) * width;
      const y = d.y * height + Math.sin(time * 0.3 + d.phase) * 7;
      const alpha = 0.1 + 0.16 * (0.5 + Math.sin(time * 0.7 + d.phase) * 0.5);
      context.fillStyle = `rgba(115,153,255,${alpha})`;
      context.fillRect(x, y, d.speed > 0.8 ? 2 : 1, d.speed > 0.8 ? 2 : 1);
    }
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const target = pose(targets[i], shape, i);
      if (transition) {
        const progress = Math.min(1, Math.max(0, (elapsed - p.seed * 170) / 1450));
        const ease = progress * progress * (3 - 2 * progress);
        const scatter = Math.sin(progress * Math.PI) * 0.7;
        p.x = from[i].x + (target.x - from[i].x) * ease + Math.cos(p.seed * tau * 3) * scatter;
        p.y = from[i].y + (target.y - from[i].y) * ease + Math.sin(p.seed * tau * 3) * scatter;
        p.z = from[i].z + (target.z - from[i].z) * ease + (p.seed - 0.5) * scatter * 1.6;
        if (progress < 1) morphing = true;
      } else Object.assign(p, target);
      // Orthographic projection keeps DNA's endpoints and axis stationary.
      const depth = p.z, perspective = 4.8 / (4.8 + depth);
      const tx = centerX + p.x * scale, ty = centerY + p.y * scale;
      let forceX = 0, forceY = 0, heat = 0;
      const px = tx - pointer.x, py = ty - pointer.y, distance = Math.hypot(px, py);
      if (pointer.active && !paused && !drag) {
        heat = Math.max(0, 1 - distance / 105);
        const force = heat * heat * 68;
        forceX = px / (distance || 1) * force; forceY = py / (distance || 1) * force;
      }
      if (wave && !paused) {
        const age = (now - wave.start) / 1000;
        const wx = tx - wave.x, wy = ty - wave.y, d = Math.hypot(wx, wy);
        const energy = Math.max(0, 1 - Math.abs(d - age * 460) / 90) * Math.max(0, 1 - age / 1.4);
        forceX += wx / (d || 1) * energy * 120; forceY += wy / (d || 1) * energy * 120;
        heat = Math.max(heat, energy);
      }
      if (!paused) {
        const damping = Math.pow(0.77, dt);
        p.vx = (p.vx + (forceX - p.dx) * 0.075 * dt) * damping;
        p.vy = (p.vy + (forceY - p.dy) * 0.075 * dt) * damping;
        p.dx += p.vx * dt; p.dy += p.vy * dt;
        p.heat = Math.max(heat, p.heat * Math.pow(0.92, dt));
      }
      p.sx = tx + p.dx; p.sy = ty + p.dy; p.depth = depth;
      p.size = (0.95 + p.seed * 1.15 + p.heat * 1.1) * perspective;
      p.opacity = Math.max(0.24, Math.min(0.98, 0.75 - depth * 0.17 + p.heat * 0.25));
    }
    if (transition && !morphing) { transition = false; host.classList.remove('is-reforming'); }
    if (wave && now - wave.start > 1450) wave = null;
    rendered.sort((a, b) => b.depth - a.depth);
    for (const p of rendered) {
      const silver = p.seed > 0.73;
      const tint = silver ? '204,222,255' : p.seed > 0.35 ? '88,133,255' : '45,88,255';
      context.fillStyle = `rgba(${tint},${p.opacity})`;
      context.fillRect(p.sx - p.size / 2, p.sy - p.size / 2, p.size, p.size);
      if (p.heat > 0.2 || (silver && p.seed > 0.94)) {
        context.fillStyle = `rgba(85,129,255,${0.045 + p.heat * 0.06})`;
        context.fillRect(p.sx - 3.5, p.sy - 3.5, 7, 7);
      }
    }
  }

  function tick(now) {
    frame = 0;
    if (!host.isConnected) { dispose(); return; }
    if (!active || !visible || document.hidden) return;
    render(now);
    if (!paused) frame = requestAnimationFrame(tick);
  }
  function wake() {
    if (!disposed && active && visible && !document.hidden && !frame) frame = requestAnimationFrame(tick);
  }
  function resize() {
    if (!active || disposed) return;
    const box = surface.getBoundingClientRect();
    width = box.width; height = box.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    wake();
  }
  function sync() {
    if (!host.isConnected) { dispose(); return; }
    active = document.documentElement.dataset.style === 'noir' && !welcome?.classList.contains('login-open');
    host.inert = !active;
    if (!active || document.hidden) { cancelAnimationFrame(frame); frame = 0; last = 0; lastTap = null; }
    else { resize(); wake(); }
  }
  function locate(event) {
    const box = surface.getBoundingClientRect();
    pointer.x = event.clientX - box.left; pointer.y = event.clientY - box.top;
    pointer.active = true;
  }
  function burst(x = width / 2, y = height / 2) {
    if (paused) return;
    wave = { x, y, start: performance.now() }; wake();
  }
  function nextShape() {
    shape = (shape + 1) % shapeCount;
    setShape();
  }
  surface.addEventListener('pointermove', event => {
    locate(event);
    if (drag) {
      const x = event.clientX - drag.x, y = event.clientY - drag.y;
      dragged ||= Math.hypot(x, y) > 5;
      if (dragged) lastTap = null;
      targetTilt.y = Math.max(-0.18, Math.min(0.18, drag.ry + x * 0.002));
      targetTilt.x = Math.max(-0.12, Math.min(0.12, drag.rx - y * 0.002));
    }
    wake();
  }, { signal, passive: true });
  surface.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    locate(event); dragged = false;pressStarted = performance.now();
    drag = { x: event.clientX, y: event.clientY, rx: targetTilt.x, ry: targetTilt.y };
    surface.setPointerCapture(event.pointerId); host.classList.add('is-dragging');
  }, { signal });
  const release = event => {
    if (event.type === 'pointercancel') { dragged = true;lastTap = null; }
    drag = null; host.classList.remove('is-dragging');
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    if (event.pointerType !== 'mouse') pointer.active = false;
  };
  surface.addEventListener('pointerup', release, { signal });
  surface.addEventListener('pointercancel', release, { signal });
  surface.addEventListener('lostpointercapture', () => { drag = null;host.classList.remove('is-dragging'); }, { signal });
  surface.addEventListener('pointerleave', () => { if (!drag) pointer.active = false; }, { signal });
  surface.addEventListener('click', event => {
    if (!event.detail) { burst();return; }
    if (dragged) { dragged = false;lastTap = null;return; }
    const now = performance.now();
    if (now - pressStarted > 400) { lastTap = null;return; }
    locate(event);
    // Detect a pair here so mouse double-click and touch double-tap share one
    // path. The first click gives immediate scatter feedback, without a delay.
    const double = lastTap && now - lastTap.time < 400 && Math.hypot(pointer.x - lastTap.x, pointer.y - lastTap.y) < 22;
    if (double) { lastTap = null;nextShape(); }
    else { lastTap = { time: now, x: pointer.x, y: pointer.y };burst(pointer.x, pointer.y); }
  }, { signal });
  surface.addEventListener('dblclick', event => event.preventDefault(), { signal });
  surface.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault();if (!event.repeat) nextShape(); }
  }, { signal });
  reduced.addEventListener('change', event => {
    paused = event.matches;
    if (paused) { transition = false;host.classList.remove('is-reforming'); }
    wake();
  }, { signal });
  document.addEventListener('visibilitychange', sync, { signal });
  const sizeObserver = new ResizeObserver(resize); sizeObserver.observe(surface);
  const visibilityObserver = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;last = 0;
    if (visible) wake();else { cancelAnimationFrame(frame);frame = 0; }
  });
  visibilityObserver.observe(host);
  const stateObserver = new MutationObserver(sync);
  stateObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-style'] });
  if (welcome) stateObserver.observe(welcome, { attributes: true, attributeFilter: ['class'] });
  const lifeObserver = new MutationObserver(() => { if (!host.isConnected) dispose(); });
  lifeObserver.observe(root, { childList: true });
  function dispose() {
    if (disposed) return;
    disposed = true;cancelAnimationFrame(frame);abort.abort();
    sizeObserver.disconnect();visibilityObserver.disconnect();stateObserver.disconnect();lifeObserver.disconnect();
  }
  setShape(true);sync();
  return dispose;
}
