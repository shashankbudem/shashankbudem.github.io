(() => {
  const canvas = document.querySelector("[data-hero-canvas]");
  const hero = document.querySelector(".hero");
  if (!canvas || !hero) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const CYAN = "54, 217, 255";
  const AMBER = "229, 167, 60";
  const BG = "#080c0f";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---------- 3D wave floor ----------
  const COLS = 44;
  const ROWS = 24;
  const GRID_WIDTH = 3000;
  const GRID_NEAR = 110;
  const GRID_FAR = 2300;
  const FLOOR_Y = 340;
  const FOV = 560;

  // Per-point springy screen-space displacement: ox, oy, vx, vy
  const spring = new Float32Array(COLS * ROWS * 4);
  // Per-frame projected data: sx, sy, depthScale, glow
  const proj = new Float32Array(COLS * ROWS * 4);

  // ---------- Floating network nodes ----------
  const NODE_COUNT = 56;
  const NODE_BOX = { x: 1350, yMin: -560, yMax: -30, zMin: 130, zMax: 1750 };
  const nodes = [];
  for (let i = 0; i < NODE_COUNT; i += 1) {
    nodes.push({
      x: (Math.random() - 0.5) * NODE_BOX.x * 2,
      y: NODE_BOX.yMin + Math.random() * (NODE_BOX.yMax - NODE_BOX.yMin),
      z: NODE_BOX.zMin + Math.random() * (NODE_BOX.zMax - NODE_BOX.zMin),
      vx: (Math.random() - 0.5) * 26,
      vy: (Math.random() - 0.5) * 12,
      vz: (Math.random() - 0.5) * 26,
      r: 1.5 + Math.random() * 2.1,
      color: Math.random() < 0.3 ? AMBER : CYAN,
      pulse: Math.random() * Math.PI * 2,
      sx: 0,
      sy: 0,
      sScale: 0,
    });
  }

  // ---------- Pointer / camera / shockwaves ----------
  const pointer = { x: 0, y: 0, nx: 0.5, ny: 0.42, active: false, speed: 0 };
  const reticle = { x: 0, y: 0, seeded: false };
  const glowPos = { x: 0, y: 0 };
  const camera = { rx: 0, ry: 0 };
  const waves = [];

  let width = 0;
  let height = 0;
  let dpr = 1;
  let rafId = 0;
  let running = false;
  let inView = true;
  let lastTime = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!running) drawFrame(lastTime, 0);
  }

  const p = { x: 0, y: 0, scale: 0 };

  function project(x, y, z) {
    // Small parallax rotation: around Y (left/right), then X (up/down)
    const cy = Math.cos(camera.ry);
    const sy = Math.sin(camera.ry);
    const cx = Math.cos(camera.rx);
    const sx = Math.sin(camera.rx);
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    const y1 = y * cx - z1 * sx;
    const z2 = y * sx + z1 * cx;
    const scale = FOV / (FOV + Math.max(z2, -FOV + 40));
    p.x = width * 0.5 + x1 * scale;
    p.y = height * 0.56 + y1 * scale;
    p.scale = scale;
  }

  function waveHeight(x, z, t) {
    return (
      Math.sin(x * 0.0021 + t * 1.25) * 42 +
      Math.cos(z * 0.0017 - t * 0.85) * 54 +
      Math.sin((x + z) * 0.001 + t * 0.55) * 30
    );
  }

  function updateGrid(t, dt) {
    const pushRadius = Math.min(230, width * 0.2);
    for (let r = 0; r < ROWS; r += 1) {
      const z = GRID_NEAR + ((GRID_FAR - GRID_NEAR) * r) / (ROWS - 1);
      for (let c = 0; c < COLS; c += 1) {
        const x = -GRID_WIDTH / 2 + (GRID_WIDTH * c) / (COLS - 1);
        const y = FLOOR_Y + waveHeight(x, z, t);
        project(x, y, z);

        const i = (r * COLS + c) * 4;
        let fx = 0;
        let fy = 0;
        let glow = 0;

        if (pointer.active && dt > 0) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < pushRadius && d > 0.001) {
            const s = (1 - d / pushRadius) ** 2;
            const f = s * 3400;
            fx += (dx / d) * f;
            fy += (dy / d) * f;
            glow = Math.max(glow, s);
          }
        }

        for (let w = 0; w < waves.length; w += 1) {
          const wave = waves[w];
          const dx = p.x - wave.x;
          const dy = p.y - wave.y;
          const d = Math.hypot(dx, dy);
          const band = Math.abs(d - wave.r);
          if (band < 90 && d > 0.001) {
            const s = (1 - band / 90) * wave.life;
            fx += (dx / d) * s * 5200;
            fy += (dy / d) * s * 5200;
            glow = Math.max(glow, s);
          }
        }

        if (dt > 0) {
          spring[i + 2] += (-spring[i] * 130 - spring[i + 2] * 9) * dt + fx * dt;
          spring[i + 3] += (-spring[i + 1] * 130 - spring[i + 3] * 9) * dt + fy * dt;
          spring[i] += spring[i + 2] * dt;
          spring[i + 1] += spring[i + 3] * dt;
        }

        proj[i] = p.x + spring[i];
        proj[i + 1] = p.y + spring[i + 1];
        proj[i + 2] = p.scale;
        proj[i + 3] = glow;
      }
    }
  }

  function drawGrid() {
    // Row lines (constant depth per row -> one path per row)
    for (let r = ROWS - 1; r >= 0; r -= 1) {
      const depth = proj[r * COLS * 4 + 2];
      const alpha = Math.max(0.05, depth * depth * 0.65);
      ctx.strokeStyle = `rgba(${CYAN}, ${alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(0.6, depth * 1.2);
      ctx.beginPath();
      for (let c = 0; c < COLS; c += 1) {
        const i = (r * COLS + c) * 4;
        if (c === 0) ctx.moveTo(proj[i], proj[i + 1]);
        else ctx.lineTo(proj[i], proj[i + 1]);
      }
      ctx.stroke();
    }
    // Column segments between adjacent rows, batched per row-pair
    for (let r = 0; r < ROWS - 1; r += 1) {
      const depth = proj[r * COLS * 4 + 2];
      const alpha = Math.max(0.035, depth * depth * 0.42);
      ctx.strokeStyle = `rgba(${CYAN}, ${alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(0.6, depth);
      ctx.beginPath();
      for (let c = 0; c < COLS; c += 1) {
        const a = (r * COLS + c) * 4;
        const b = ((r + 1) * COLS + c) * 4;
        ctx.moveTo(proj[a], proj[a + 1]);
        ctx.lineTo(proj[b], proj[b + 1]);
      }
      ctx.stroke();
    }
    // Vertex dots: brighter and amber near the cursor / shockwave band
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const i = (r * COLS + c) * 4;
        const depth = proj[i + 2];
        if (depth < 0.24) continue;
        const glow = proj[i + 3];
        const size = depth * 2.2 + glow * 3.6;
        const alpha = Math.min(1, depth * 0.6 + glow * 0.9);
        ctx.fillStyle =
          glow > 0.04
            ? `rgba(${AMBER}, ${alpha.toFixed(3)})`
            : `rgba(${CYAN}, ${(alpha * 0.75).toFixed(3)})`;
        ctx.fillRect(proj[i] - size / 2, proj[i + 1] - size / 2, size, size);
      }
    }
  }

  function updateNodes(dt) {
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i];
      if (dt > 0) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        n.z += n.vz * dt;
        if (n.x < -NODE_BOX.x || n.x > NODE_BOX.x) n.vx *= -1;
        if (n.y < NODE_BOX.yMin || n.y > NODE_BOX.yMax) n.vy *= -1;
        if (n.z < NODE_BOX.zMin || n.z > NODE_BOX.zMax) n.vz *= -1;
      }
      project(n.x, n.y, n.z);
      n.sx = p.x;
      n.sy = p.y;
      n.sScale = p.scale;
    }
  }

  function drawNodes(t) {
    // Links between nearby nodes
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 340) {
          const alpha = (1 - d / 340) * 0.36 * Math.min(a.sScale, b.sScale);
          ctx.strokeStyle = `rgba(${CYAN}, ${alpha.toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
      }
    }
    // Links from nodes to the cursor: the network "plugs into" the pointer
    if (pointer.active) {
      const reach = Math.min(260, width * 0.22);
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        const d = Math.hypot(n.sx - reticle.x, n.sy - reticle.y);
        if (d < reach) {
          const alpha = (1 - d / reach) * 0.6;
          ctx.strokeStyle = `rgba(${AMBER}, ${alpha.toFixed(3)})`;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(n.sx, n.sy);
          ctx.lineTo(reticle.x, reticle.y);
          ctx.stroke();
        }
      }
    }
    // Node cores with a soft halo
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i];
      const flicker = 0.72 + Math.sin(t * 2.4 + n.pulse) * 0.28;
      const r = n.r * n.sScale * (1.5 + flicker * 0.5);
      ctx.fillStyle = `rgba(${n.color}, ${(0.12 * flicker).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, r * 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${n.color}, ${(0.9 * flicker * Math.min(1, n.sScale + 0.25)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFrame(t, dt) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

    // Ambient glow drifting after the cursor
    const gx = pointer.active ? glowPos.x : width * 0.66;
    const gy = pointer.active ? glowPos.y : height * 0.42;
    const glowR = Math.max(width, height) * 0.42;
    const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, glowR);
    grad.addColorStop(0, `rgba(${CYAN}, 0.08)`);
    grad.addColorStop(0.6, `rgba(${CYAN}, 0.025)`);
    grad.addColorStop(1, "rgba(8, 12, 15, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    updateGrid(t, dt);
    drawGrid();
    updateNodes(dt);
    drawNodes(t);
  }

  function frame(now) {
    rafId = 0;
    const t = now / 1000;
    const dt = Math.min(0.05, lastTime ? Math.max(0, t - lastTime) : 0.016);
    lastTime = t;

    // Ease camera parallax toward the pointer
    const targetRy = (pointer.nx - 0.5) * 0.22;
    const targetRx = (pointer.ny - 0.45) * 0.1;
    camera.ry += (targetRy - camera.ry) * Math.min(1, dt * 3.2);
    camera.rx += (targetRx - camera.rx) * Math.min(1, dt * 3.2);

    // Reticle trails the pointer with a springy ease
    reticle.x += (pointer.x - reticle.x) * Math.min(1, dt * 14);
    reticle.y += (pointer.y - reticle.y) * Math.min(1, dt * 14);
    glowPos.x += (pointer.x - glowPos.x) * Math.min(1, dt * 2);
    glowPos.y += (pointer.y - glowPos.y) * Math.min(1, dt * 2);
    pointer.speed *= Math.max(0, 1 - dt * 6);

    for (let i = waves.length - 1; i >= 0; i -= 1) {
      const w = waves[i];
      w.r += dt * 820;
      w.life -= dt * 0.9;
      if (w.life <= 0) waves.splice(i, 1);
    }

    drawFrame(t, dt);

    if (running) rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running || reduceMotion.matches || !inView || document.hidden) return;
    running = true;
    lastTime = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function onPointerMove(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (pointer.active) {
      pointer.speed = Math.min(3000, pointer.speed + Math.hypot(x - pointer.x, y - pointer.y) * 14);
    }
    if (!reticle.seeded) {
      reticle.x = x;
      reticle.y = y;
      glowPos.x = x;
      glowPos.y = y;
      reticle.seeded = true;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.nx = Math.min(1, Math.max(0, x / Math.max(1, rect.width)));
    pointer.ny = Math.min(1, Math.max(0, y / Math.max(1, rect.height)));
    pointer.active = true;
  }

  function onPointerDown(event) {
    onPointerMove(event);
    waves.push({ x: pointer.x, y: pointer.y, r: 10, life: 1 });
    if (waves.length > 5) waves.shift();
  }

  function onPointerLeave() {
    pointer.active = false;
  }

  resize();
  window.addEventListener("resize", resize);

  if (!reduceMotion.matches) {
    hero.addEventListener("pointermove", onPointerMove, { passive: true });
    hero.addEventListener("pointerdown", onPointerDown, { passive: true });
    hero.addEventListener("pointerleave", onPointerLeave, { passive: true });
    start();
  } else {
    drawFrame(0, 0);
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      (entries) => {
        inView = entries[0]?.isIntersecting ?? true;
        if (inView) start();
        else stop();
      },
      { threshold: 0.02 }
    ).observe(hero);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  reduceMotion.addEventListener?.("change", () => {
    if (reduceMotion.matches) {
      stop();
      drawFrame(0, 0);
    } else {
      start();
    }
  });
})();
