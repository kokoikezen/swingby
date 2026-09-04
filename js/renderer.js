const ZOOM_MIN_FACTOR = 140;
const ZOOM_MAX_PP = 3e8;

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cam = { cx: 0, cy: 0, ppAU: 200 };
    this.stars = [];
    this.w = 100;
    this.h = 100;
    this.dpr = 1;
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(80, rect.width);
    this.h = Math.max(80, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this._genStars();
  }

  _genStars() {
    const count = Math.min(420, Math.max(120, Math.round(this.w * this.h / 4200)));
    this.stars = [];
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        s: 0.4 + Math.random() * 1.4,
        a: 0.2 + Math.random() * 0.75
      });
    }
  }

  minDim() {
    return Math.min(this.w, this.h);
  }

  setView(cx, cy, extentAU) {
    this.cam.cx = cx;
    this.cam.cy = cy;
    this.cam.ppAU = this.minDim() / (2 * extentAU);
  }

  zoomAt(sx, sy, f) {
    const before = this.screenToWorld(sx, sy);
    this.cam.ppAU = Math.min(ZOOM_MAX_PP, Math.max(this.minDim() / ZOOM_MIN_FACTOR, this.cam.ppAU * f));
    const after = this.screenToWorld(sx, sy);
    this.cam.cx += before.x - after.x;
    this.cam.cy += before.y - after.y;
  }

  panBy(dxPx, dyPx) {
    this.cam.cx -= dxPx / this.cam.ppAU;
    this.cam.cy += dyPx / this.cam.ppAU;
  }

  followTo(x, y, k) {
    this.cam.cx += (x - this.cam.cx) * k;
    this.cam.cy += (y - this.cam.cy) * k;
  }

  screenToWorld(sx, sy) {
    return {
      x: this.cam.cx + (sx - this.w / 2) / this.cam.ppAU,
      y: this.cam.cy - (sy - this.h / 2) / this.cam.ppAU
    };
  }

  toScreen(x, y) {
    const pp = this.cam.ppAU;
    return [this.w / 2 + (x - this.cam.cx) * pp, this.h / 2 - (y - this.cam.cy) * pp];
  }

  draw(sim, opts) {
    opts = opts || {};
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#04060d";
    ctx.fillRect(0, 0, this.w, this.h);

    for (const st of this.stars) {
      ctx.globalAlpha = st.a;
      ctx.fillStyle = "#cfd8ff";
      ctx.fillRect(st.x, st.y, st.s, st.s);
    }
    ctx.globalAlpha = 1;

    const pp = this.cam.ppAU;
    const sunP = this.toScreen(0, 0);

    if (opts.showOrbits !== false) {
      for (const p of sim.planets) {
        const r = p.def.a * pp;
        if (r < 12 || r > Math.max(this.w, this.h) * 40) continue;
        ctx.beginPath();
        const swept = p.sweptAngle || 0;
        if (Math.abs(swept) >= Math.PI * 2 - 1e-6) {
          // 한 바퀴 이상 돈 행성은 그냥 전체 원으로 표시
          ctx.arc(sunP[0], sunP[1], r, 0, Math.PI * 2);
        } else {
          // 캔버스 각도(φ)는 화면 y축이 뒤집혀 있어 월드 각도(θ)와 부호가 반대다: φ = -θ
          const theta0 = p.startAngleRad || 0;
          const theta1 = theta0 + swept;
          ctx.arc(sunP[0], sunP[1], r, -theta0, -theta1, true);
        }
        ctx.strokeStyle = p.color ? hexToRgba(p.color, 0.55) : "rgba(255,255,255,0.10)";
        ctx.lineWidth = 1.4;
        ctx.stroke();
        // 지금까지 지나온 궤적의 '끝점'에 행성이 있으므로 별도 마커는 아래 행성 렌더링에서 그린다.
      }
    }

    for (const p of sim.planets) {
      const sp = this.toScreen(p.x, p.y);
      const sr = p.soi * pp;
      if (sr > 14 && sr < Math.max(this.w, this.h) * 10) {
        ctx.save();
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.arc(sp[0], sp[1], sr, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }

    this._drawTrail(sim);

    if (opts.predPts && opts.predPts.length >= 3) {
      this._drawPrediction(opts.predPts);
    }

    this._drawSun(ctx, sim.engine.bodies[0], sunP, pp);

    for (const p of sim.planets) {
      const sp = this.toScreen(p.x, p.y);
      const pr = Math.max(2.8, p.radiusAU * pp);
      if (sp[0] < -60 || sp[0] > this.w + 60 || sp[1] < -60 || sp[1] > this.h + 60) continue;
      ctx.beginPath();
      ctx.arc(sp[0], sp[1], pr, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();

      ctx.font = "600 12px 'Segoe UI', sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(p.def.name, sp[0] + pr + 6, sp[1] - 6);
    }

    this._drawCraft(sim, pp);
    if (opts.aim) this._drawAim(opts.aim);
    this._drawScaleBar(pp);
  }

  _drawTrail(sim) {
    const t = sim.trail;
    if (t.length < 2) return;
    const ctx = this.ctx;

    ctx.beginPath();
    for (let i = 0; i < t.length; i++) {
      const s = this.toScreen(t[i].x, t[i].y);
      if (i === 0) ctx.moveTo(s[0], s[1]);
      else ctx.lineTo(s[0], s[1]);
    }
    ctx.strokeStyle = "rgba(125,249,255,0.45)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const tailStart = Math.max(0, t.length - 240);
    ctx.beginPath();
    for (let i = tailStart; i < t.length; i++) {
      const s = this.toScreen(t[i].x, t[i].y);
      if (i === tailStart) ctx.moveTo(s[0], s[1]);
      else ctx.lineTo(s[0], s[1]);
    }
    ctx.strokeStyle = "rgba(190,252,255,0.8)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  _drawPrediction(pts) {
    const ctx = this.ctx;
    const n = pts.length / 3;

    ctx.save();
    ctx.setLineDash([7, 9]);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const s = this.toScreen(pts[i * 3], pts[i * 3 + 1]);
      if (!started) { ctx.moveTo(s[0], s[1]); started = true; }
      else ctx.lineTo(s[0], s[1]);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    let runStarted = false;
    for (let i = 0; i < n; i++) {
      const flag = pts[i * 3 + 2] > 0.5;
      const s = this.toScreen(pts[i * 3], pts[i * 3 + 1]);
      if (flag) {
        if (!runStarted) { ctx.moveTo(s[0], s[1]); runStarted = true; }
        else ctx.lineTo(s[0], s[1]);
      } else {
        runStarted = false;
      }
    }
    ctx.strokeStyle = "rgba(255,171,94,0.9)";
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  _drawSun(ctx, sun, sp, pp) {
    const coreR = Math.max(7, sun.radiusAU * pp);
    const glowR = coreR * 5;
    const g = ctx.createRadialGradient(sp[0], sp[1], coreR * 0.4, sp[0], sp[1], glowR);
    g.addColorStop(0, "rgba(255,210,122,0.55)");
    g.addColorStop(0.35, "rgba(255,180,80,0.16)");
    g.addColorStop(1, "rgba(255,160,60,0)");
    ctx.beginPath();
    ctx.arc(sp[0], sp[1], glowR, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(sp[0], sp[1], coreR, 0, Math.PI * 2);
    ctx.fillStyle = "#ffdf8a";
    ctx.fill();
  }

  _drawCraft(sim, pp) {
    const cr = sim.craftBody();
    const ctx = this.ctx;
    if (!cr) return;
    const sp = this.toScreen(cr.x, cr.y);
    const speed = Math.hypot(cr.vx, cr.vy);

    if (sim.crashed) {
      ctx.strokeStyle = "#ff5555";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(sp[0] - 7, sp[1] - 7);
      ctx.lineTo(sp[0] + 7, sp[1] + 7);
      ctx.moveTo(sp[0] + 7, sp[1] - 7);
      ctx.lineTo(sp[0] - 7, sp[1] + 7);
      ctx.stroke();
      return;
    }

    const ang = Math.atan2(-cr.vy, cr.vx);
    ctx.save();
    ctx.translate(sp[0], sp[1]);
    ctx.rotate(ang);
    ctx.shadowColor = "#7df9ff";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-7, 5.5);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-7, -5.5);
    ctx.closePath();
    ctx.fillStyle = "#7df9ff";
    ctx.fill();
    ctx.restore();

    if (speed > 1e-9) {
      const kms = speed * AUDAY_KMS;
      const len = Math.min(90, Math.max(14, kms * 2.4));
      const ex = sp[0] + Math.cos(ang) * len;
      const ey = sp[1] + Math.sin(ang) * len;
      ctx.beginPath();
      ctx.moveTo(sp[0], sp[1]);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = "rgba(191,251,255,0.75)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      this._arrowHead(ex, ey, ang, 7, "rgba(191,251,255,0.75)");
    }
  }

  _drawAim(aim) {
    const ctx = this.ctx;
    const a = this.toScreen(aim.p.x, aim.p.y);
    const b = this.toScreen(aim.wx, aim.wy);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);

    ctx.save();
    ctx.setLineDash([9, 7]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = "#ffab5e";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    this._arrowHead(b[0], b[1], ang, 10, "#ffab5e");

    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    ctx.font = "700 13px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#ffab5e";
    ctx.fillText(`${aim.vinfKms.toFixed(1)} km/s · ${Math.round(aim.angleDeg)}°`, mx + 12, my - 10);
  }

  _arrowHead(x, y, ang, size, color) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(ang - 0.42) * size, y - Math.sin(ang - 0.42) * size);
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(ang + 0.42) * size, y - Math.sin(ang + 0.42) * size);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _drawScaleBar(pp) {
    const ladder = [1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
    let chosen = ladder[ladder.length - 1];
    for (let i = ladder.length - 1; i >= 0; i--) {
      if (ladder[i] * pp <= 150) { chosen = ladder[i]; break; }
      if (i === 0) chosen = ladder[0];
    }
    const px = chosen * pp;
    const margin = 18;
    const y = this.h - margin;
    const x1 = this.w - margin - px;
    const x2 = this.w - margin;

    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.moveTo(x1, y - 5);
    ctx.lineTo(x1, y + 5);
    ctx.moveTo(x2, y - 5);
    ctx.lineTo(x2, y + 5);
    ctx.stroke();
    ctx.font = "11px 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.textAlign = "center";
    ctx.fillText(fmtDist(chosen), (x1 + x2) / 2, y - 9);
    ctx.textAlign = "left";
  }
}