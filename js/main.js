window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("space");
  const renderer = new Renderer(canvas);
  const sim = new Simulation();
  const ui = new UI(sim, renderer);

  renderer.setView(0, 0, 2.0);

  window.addEventListener("resize", () => renderer.resize());

  let lastTs = performance.now();
  function loop(ts) {
    const dtSec = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    ui.frame(dtSec);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
});
