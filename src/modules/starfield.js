const STAR_COLORS = [
  [184, 222, 235],
  [121, 176, 194],
  [222, 205, 172],
  [105, 145, 160],
];

export function createStarfield(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let stars = [];
  let dust = [];
  let meteors = [];
  let width = 0;
  let height = 0;
  let animationFrame = 0;
  let pointerX = 0.5;
  let pointerY = 0.5;
  let easedPointerX = 0.5;
  let easedPointerY = 0.5;
  let lastTime = performance.now();
  let nextMeteorAt = lastTime + 4500 + Math.random() * 9000;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const count = Math.min(420, Math.floor((width * height) / 3900));
    stars = Array.from({ length: count }, (_, index) => {
      const depth = Math.random() ** 1.6;
      const color = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        radius: .18 + depth * 1.15,
        alpha: .12 + Math.random() * .55,
        depth: .12 + depth * .88,
        phase: Math.random() * Math.PI * 2,
        twinkleSpeed: .00025 + Math.random() * .00155,
        color,
        flare: index % 79 === 0 && depth > .48,
        drift: (Math.random() - .5) * .002,
      };
    });

    dust = Array.from({ length: Math.min(72, Math.floor(width / 17)) }, () => ({
      x: Math.random() * width,
      y: Math.random() * Math.min(height, 520),
      radius: .3 + Math.random() * 1.2,
      alpha: .012 + Math.random() * .035,
      speed: .003 + Math.random() * .009,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function spawnMeteor(time) {
    const fromLeft = Math.random() > .36;
    const x = fromLeft ? width * (.04 + Math.random() * .42) : width * (.62 + Math.random() * .28);
    const y = 28 + Math.random() * Math.min(250, height * .28);
    meteors.push({
      x,
      y,
      vx: fromLeft ? 9 + Math.random() * 6 : -(9 + Math.random() * 6),
      vy: 2.8 + Math.random() * 3.6,
      life: 0,
      maxLife: 42 + Math.random() * 34,
      alpha: .18 + Math.random() * .18,
    });
    nextMeteorAt = time + 8000 + Math.random() * 17000;
  }

  function drawStar(star, time) {
    const irregular = Math.sin(time * star.twinkleSpeed + star.phase)
      + Math.sin(time * star.twinkleSpeed * .37 + star.phase * 1.9) * .42;
    const twinkle = Math.max(.22, .72 + irregular * .18);
    const offsetX = (easedPointerX - .5) * star.depth * 12;
    const offsetY = (easedPointerY - .5) * star.depth * 8;
    const x = star.x + offsetX;
    const y = star.y + offsetY;
    const [r, g, b] = star.color;

    ctx.beginPath();
    ctx.fillStyle = `rgba(${r},${g},${b},${star.alpha * twinkle})`;
    ctx.arc(x, y, star.radius, 0, Math.PI * 2);
    ctx.fill();

    if (star.flare && twinkle > .78) {
      const flareAlpha = star.alpha * (twinkle - .72) * .34;
      ctx.strokeStyle = `rgba(${r},${g},${b},${flareAlpha})`;
      ctx.lineWidth = .45;
      ctx.beginPath();
      ctx.moveTo(x - 5 * star.depth, y);
      ctx.lineTo(x + 5 * star.depth, y);
      ctx.moveTo(x, y - 3 * star.depth);
      ctx.lineTo(x, y + 3 * star.depth);
      ctx.stroke();
    }
  }

  function drawMeteor(meteor) {
    const progress = meteor.life / meteor.maxLife;
    const fade = Math.sin(Math.min(1, progress) * Math.PI);
    const tail = 45 + Math.abs(meteor.vx) * 2.4;
    const magnitude = Math.hypot(meteor.vx, meteor.vy);
    const nx = meteor.vx / magnitude;
    const ny = meteor.vy / magnitude;
    const gradient = ctx.createLinearGradient(
      meteor.x,
      meteor.y,
      meteor.x - nx * tail,
      meteor.y - ny * tail,
    );
    gradient.addColorStop(0, `rgba(209,235,238,${meteor.alpha * fade})`);
    gradient.addColorStop(.18, `rgba(88,194,207,${meteor.alpha * fade * .55})`);
    gradient.addColorStop(1, 'rgba(25,92,105,0)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = .7;
    ctx.beginPath();
    ctx.moveTo(meteor.x, meteor.y);
    ctx.lineTo(meteor.x - nx * tail, meteor.y - ny * tail);
    ctx.stroke();
  }

  function draw(time) {
    const delta = Math.min(2.5, Math.max(.2, (time - lastTime) / 16.67));
    lastTime = time;
    ctx.clearRect(0, 0, width, height);

    easedPointerX += (pointerX - easedPointerX) * .025;
    easedPointerY += (pointerY - easedPointerY) * .025;

    for (const mote of dust) {
      mote.x += mote.speed * delta;
      mote.y += Math.sin(time * .00008 + mote.phase) * .003 * delta;
      if (mote.x > width + 3) mote.x = -3;
      ctx.beginPath();
      ctx.fillStyle = `rgba(169,203,208,${mote.alpha})`;
      ctx.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const star of stars) {
      star.x += star.drift * delta;
      if (star.x < -4) star.x = width + 4;
      if (star.x > width + 4) star.x = -4;
      drawStar(star, time);
    }

    if (!reduceMotion.matches && time > nextMeteorAt && meteors.length === 0) spawnMeteor(time);
    meteors = meteors.filter((meteor) => {
      meteor.life += delta;
      meteor.x += meteor.vx * delta;
      meteor.y += meteor.vy * delta;
      drawMeteor(meteor);
      return meteor.life < meteor.maxLife;
    });

    animationFrame = requestAnimationFrame(draw);
  }

  const onPointer = (event) => {
    pointerX = event.clientX / Math.max(1, width);
    pointerY = event.clientY / Math.max(1, height);
    document.documentElement.style.setProperty('--sky-x', pointerX.toFixed(3));
    document.documentElement.style.setProperty('--sky-y', pointerY.toFixed(3));
  };

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onPointer, { passive: true });
  resize();
  animationFrame = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(animationFrame);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', onPointer);
  };
}
