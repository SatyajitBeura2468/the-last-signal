export function createStarfield(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  let stars = [];
  let width = 0;
  let height = 0;
  let animationFrame = 0;
  let pointerX = 0.5;
  let pointerY = 0.5;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.min(340, Math.floor((width * height) / 5200));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 1.25 + 0.18,
      alpha: Math.random() * 0.65 + 0.15,
      depth: Math.random() * 0.8 + 0.2,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    for (const star of stars) {
      const twinkle = 0.67 + Math.sin(time * 0.0012 + star.phase) * 0.25;
      const offsetX = (pointerX - 0.5) * star.depth * 10;
      const offsetY = (pointerY - 0.5) * star.depth * 7;
      ctx.beginPath();
      ctx.fillStyle = `rgba(${star.depth > 0.72 ? '188,229,255' : '117,177,210'},${star.alpha * twinkle})`;
      ctx.arc(star.x + offsetX, star.y + offsetY, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    animationFrame = requestAnimationFrame(draw);
  }

  const onPointer = (event) => {
    pointerX = event.clientX / Math.max(1, width);
    pointerY = event.clientY / Math.max(1, height);
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
