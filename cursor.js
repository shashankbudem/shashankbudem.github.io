(() => {
  // Site-wide "techie" reticle cursor. Skipped on touch devices, when the
  // user prefers reduced motion, or without canvas support.
  const capable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!capable || reduceMotion) return;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "9999",
  });
  document.body.appendChild(canvas);
  document.documentElement.classList.add("has-custom-cursor");

  const CYAN = "54, 217, 255";
  const AMBER = "229, 167, 60";
  const INTERACTIVE = "a, button, [role='button'], input, textarea, select, summary, label";

  const pointer = { x: -100, y: -100, active: false, speed: 0 };
  const reticle = { x: -100, y: -100, seeded: false };
  const rings = [];
  let press = 0;
  let hoverT = 0;
  let hovering = false;
  let vis = 0;
  let width = 0;
  let height = 0;
  let rafId = 0;
  let running = false;
  let lastTime = 0;
  let lastActivity = 0;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawReticle(t) {
    const energy = Math.min(1, pointer.speed / 900);
    const lock = hoverT;
    const base = (17 + energy * 9 + press * 8) * (1 + lock * 0.45);

    ctx.save();
    ctx.globalAlpha = vis;
    ctx.translate(reticle.x, reticle.y);

    // Outer rotating arc segments; they slow and lengthen when locked on
    ctx.strokeStyle = `rgba(${CYAN}, ${0.9 - press * 0.25})`;
    ctx.lineWidth = 1.6 + lock * 0.5;
    const spin = t * (1.1 + energy * 2.4) * (1 - lock * 0.75);
    const arcLen = Math.PI / 2.6 + lock * (Math.PI / 4);
    for (let s = 0; s < 3; s += 1) {
      const start = spin + (s * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(0, 0, base, start, start + arcLen);
      ctx.stroke();
    }
    // Inner steady ring fades out as the reticle locks onto a target
    if (lock < 0.9) {
      ctx.strokeStyle = `rgba(${CYAN}, ${0.5 * (1 - lock)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, base * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Crosshair ticks turn amber and reach inward on lock
    ctx.strokeStyle = `rgba(${AMBER}, 0.95)`;
    ctx.lineWidth = 1.4;
    const tick = base + 7 - lock * 3;
    const len = 6 + lock * 4;
    ctx.beginPath();
    ctx.moveTo(-tick, 0);
    ctx.lineTo(-tick + len, 0);
    ctx.moveTo(tick - len, 0);
    ctx.lineTo(tick, 0);
    ctx.moveTo(0, -tick);
    ctx.lineTo(0, -tick + len);
    ctx.moveTo(0, tick - len);
    ctx.lineTo(0, tick);
    ctx.stroke();
    // Center dot
    ctx.fillStyle = `rgba(${AMBER}, 1)`;
    ctx.beginPath();
    ctx.arc(0, 0, 2.2 + press * 1.6 + lock * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function frame(now) {
    rafId = 0;
    const t = now / 1000;
    const dt = Math.min(0.05, lastTime ? Math.max(0, t - lastTime) : 0.016);
    lastTime = t;

    reticle.x += (pointer.x - reticle.x) * Math.min(1, dt * 14);
    reticle.y += (pointer.y - reticle.y) * Math.min(1, dt * 14);
    pointer.speed *= Math.max(0, 1 - dt * 6);
    press = Math.max(0, press - dt * 4);
    hoverT += ((hovering ? 1 : 0) - hoverT) * Math.min(1, dt * 12);
    vis += ((pointer.active ? 1 : 0) - vis) * Math.min(1, dt * 10);

    ctx.clearRect(0, 0, width, height);

    for (let i = rings.length - 1; i >= 0; i -= 1) {
      const ring = rings[i];
      ring.r += dt * 620;
      ring.life -= dt * 2.4;
      if (ring.life <= 0) {
        rings.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `rgba(${AMBER}, ${(ring.life * 0.5).toFixed(3)})`;
      ctx.lineWidth = 1.8 * ring.life + 0.3;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (vis > 0.01) drawReticle(t);

    // Sleep once everything has settled and the pointer has been idle a while
    const settled = rings.length === 0 && press <= 0 && (vis < 0.01 || t - lastActivity > 4);
    if (running && !settled) {
      rafId = requestAnimationFrame(frame);
    } else {
      running = false;
    }
  }

  function wake() {
    lastActivity = performance.now() / 1000;
    if (running || document.hidden) return;
    running = true;
    lastTime = 0;
    rafId = requestAnimationFrame(frame);
  }

  function sleep() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  window.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      const { clientX: x, clientY: y } = event;
      if (pointer.active) {
        pointer.speed = Math.min(3000, pointer.speed + Math.hypot(x - pointer.x, y - pointer.y) * 14);
      }
      if (!reticle.seeded) {
        reticle.x = x;
        reticle.y = y;
        reticle.seeded = true;
      }
      pointer.x = x;
      pointer.y = y;
      pointer.active = true;
      wake();
    },
    { passive: true }
  );

  window.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      press = 1;
      rings.push({ x: event.clientX, y: event.clientY, r: 6, life: 1 });
      if (rings.length > 4) rings.shift();
      wake();
    },
    { passive: true }
  );

  window.addEventListener("pointerover", (event) => {
    hovering = !!(event.target instanceof Element && event.target.closest(INTERACTIVE));
    wake();
  });

  document.documentElement.addEventListener("mouseleave", () => {
    pointer.active = false;
    wake();
  });
  window.addEventListener("blur", () => {
    pointer.active = false;
    wake();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) sleep();
    else wake();
  });

  window.addEventListener("resize", resize);
  resize();
})();
