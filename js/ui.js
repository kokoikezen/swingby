const GAIN_KMS_PER_AU = 14;
const RETRY_DELAY_S = 1.6;
const RETRY_STEP_DEG = 10;
const RETRY_MAX = 18;
const RETRY_TIMEOUT_YEARS = 10;

class UI {
  constructor(sim, renderer) {
    this.sim = sim;
    this.r = renderer;
    this.pendingAim = null;
    this.predPts = null;
    this.predDirty = true;
    this.lastPredCalc = 0;
    this.panLast = null;
    this.autoRetry = null;
    this._endSeen = false;
    this._els = {};
    ["selPlanet", "rngVinf", "rngAng", "outVinf", "outAng", "btnLaunch",
      "preMars", "preVenusGain", "preVenusLoss", "preVoyager", "btnReset",
      "btnPlay", "btnHome", "rngSpeed", "outSpeed",
      "chkPred", "chkFollow", "chkOrbits",
      "tTime", "tSpeed", "tDist", "tA", "tE", "tNear", "tStatus", "tDv", "log",
      "btnPanelToggle"
    ].forEach(id => { this._els[id] = document.getElementById(id); });

    const sel = this._els.selPlanet;
    for (const def of PLANET_DEFS) {
      const opt = document.createElement("option");
      opt.value = def.name;
      opt.textContent = def.name + (def.name === "지구" ? " (기본)" : "");
      if (def.name === "지구") opt.selected = true;
      sel.appendChild(opt);
    }

    sim.onEvent = ev => this.log(ev.text, ev.kind);
    this._bind();
    this.log("시뮬레이션 준비 완료 — 발사 설정 후 🚀 버튼을 누르세요", "info");
    this.log("행성을 클릭한 채 드래그하면 방향과 속도를 정해 발사할 수 있습니다", "info");
  }

  _bind() {
    const E = this._els;
    const cv = this.r.canvas;

    E.rngVinf.addEventListener("input", () => {
      E.outVinf.textContent = (+E.rngVinf.value).toFixed(1) + " km/s";
      this.predDirty = true;
    });
    E.rngAng.addEventListener("input", () => {
      E.outAng.textContent = E.rngAng.value + "°";
      this.predDirty = true;
    });
    E.selPlanet.addEventListener("change", () => { this.predDirty = true; });
    E.chkPred.addEventListener("change", () => { this.predDirty = true; });

    E.btnPanelToggle.addEventListener("click", () => {
      document.getElementById("app").classList.toggle("panel-hidden");
      // 패널이 사라지면서 #stage 폭이 바뀌므로 캔버스를 다시 맞춘다.
      requestAnimationFrame(() => this.r.resize());
    });

    E.btnLaunch.addEventListener("click", () => this.launchFromPanel());
    E.btnPlay.addEventListener("click", () => this.setRunning(!this.sim.running));
    E.btnHome.addEventListener("click", () => this.r.setView(0, 0, 2.0));
    E.btnReset.addEventListener("click", () => {
      this.autoRetry = null;
      this.sim.reset();
      this.setRunning(false);
      this.r.setView(0, 0, 2.0);
      this.predPts = null;
      this.predDirty = true;
      this._els.log.innerHTML = "";
      this.log("시뮬레이션 초기화 — 임무 시각 0일부터 다시 시작", "info");
    });

    E.preMars.addEventListener("click", () => this.applyPreset(() => this.sim.presetHohmann("화성")));
    E.preVenusGain.addEventListener("click", () => this.applyPreset(() => this.sim.presetFlyby("금성", true)));
    E.preVenusLoss.addEventListener("click", () => this.applyPreset(() => this.sim.presetFlyby("금성", false)));
    E.preVoyager.addEventListener("click", () => this.applyPreset(() => this.sim.presetVoyager()));

    cv.addEventListener("pointerdown", e => this._onDown(e));
    cv.addEventListener("pointermove", e => this._onMove(e));
    cv.addEventListener("pointerup", e => this._onUp(e));
    cv.addEventListener("wheel", e => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const f = Math.exp(-e.deltaY * 0.0013);
      this.r.zoomAt(e.clientX - rect.left, e.clientY - rect.top, f);
    }, { passive: false });

    window.addEventListener("keydown", e => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      if (e.code === "Space") { e.preventDefault(); this.setRunning(!this.sim.running); }
      if (e.code === "Escape" && this.pendingAim) { this.pendingAim = null; this.predPts = null; }
    });
  }

  launchFromPanel() {
    const E = this._els;
    const planet = this.sim.planetByName(E.selPlanet.value);
    if (!planet) return;
    this.autoRetry = null;
    this.sim.spawnLaunch({
      planet,
      vinfKms: +E.rngVinf.value,
      angleDeg: +E.rngAng.value
    });
    this.setRunning(true);
    this.predPts = null;
  }

  applyPreset(fn) {
    this.autoRetry = null;
    const res = fn();
    this.setRunning(true);
    this.predPts = null;
    this.predDirty = true;
    if (res) {
      this._els.selPlanet.value = res.planetName || this._els.selPlanet.value;
      if (res.vinfKms != null) {
        this._els.rngVinf.value = Math.min(15, Math.max(0.2, res.vinfKms));
        this._els.outVinf.textContent = (+this._els.rngVinf.value).toFixed(1) + " km/s";
      }
      if (res.angleDeg != null) {
        this._els.rngAng.value = Math.round(res.angleDeg / 5) * 5;
        this._els.outAng.textContent = this._els.rngAng.value + "°";
      }
    }
    if (this.sim.viewHint) {
      this.r.setView(this.sim.viewHint.cx, this.sim.viewHint.cy, this.sim.viewHint.extentAU);
      this.sim.viewHint = null;
    }
  }

  setRunning(v) {
    if (this.sim.crashed || this.sim.escaped) v = false;
    this.sim.running = !!v;
    this._els.btnPlay.textContent = this.sim.running ? "⏸ 일시정지" : "▶ 재생";
  }

  daysPerSec() {
    const t = +this._els.rngSpeed.value / 100;
    const lo = Math.log(1.5), hi = Math.log(900);
    return Math.round(Math.exp(lo + t * (hi - lo)));
  }

  sliderParams() {
    const E = this._els;
    const planet = this.sim.planetByName(E.selPlanet.value) || this.sim.planets[2];
    return { planet, vinfKms: +E.rngVinf.value, angleDeg: +E.rngAng.value };
  }

  syncSliders(name, vinfKms, angleDeg) {
    const E = this._els;
    E.selPlanet.value = name;
    E.rngVinf.value = Math.min(15, Math.max(0.2, vinfKms));
    E.outVinf.textContent = (+E.rngVinf.value).toFixed(1) + " km/s";
    let a = ((angleDeg % 360) + 540) % 360 - 180;
    a = Math.round(a / 5) * 5;
    E.rngAng.value = a;
    E.outAng.textContent = a + "°";
  }

  _onDown(e) {
    if (e.button !== 0) return;
    const rect = this.r.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const hit = this._hitPlanet(sx, sy);
    if (hit) {
      const w = this.r.screenToWorld(sx, sy);
      this.pendingAim = { p: hit, wx: w.x, wy: w.y, moved: false, startSX: sx, startSY: sy };
      this.r.canvas.setPointerCapture(e.pointerId);
    } else {
      this.panLast = { x: e.clientX, y: e.clientY };
      this.r.canvas.setPointerCapture(e.pointerId);
    }
  }

  _hitPlanet(sx, sy) {
    let best = null;
    for (const p of this.sim.planets) {
      const sp = this.r.toScreen(p.x, p.y);
      const pr = Math.max(2.8, p.radiusAU * this.r.cam.ppAU);
      const d = Math.hypot(sx - sp[0], sy - sp[1]);
      if (d <= Math.max(18, pr + 10)) {
        if (!best || d < best.d) best = { p, d };
      }
    }
    return best ? best.p : null;
  }

  _onMove(e) {
    if (this.pendingAim) {
      const rect = this.r.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (!this.pendingAim.moved && Math.hypot(sx - this.pendingAim.startSX, sy - this.pendingAim.startSY) > 6) {
        this.pendingAim.moved = true;
      }
      if (!this.pendingAim.moved) return;
      const w = this.r.screenToWorld(sx, sy);
      const dx = w.x - this.pendingAim.p.x;
      const dy = w.y - this.pendingAim.p.y;
      const kms = Math.min(25, Math.max(0.2, Math.hypot(dx, dy) * GAIN_KMS_PER_AU));

      const pv = this.pendingAim.p;
      const puLen = Math.hypot(pv.vx, pv.vy);
      const pux = pv.vx / puLen, puy = pv.vy / puLen;
      const len = Math.hypot(dx, dy) || 1;
      const cross = pux * (dy / len) - puy * (dx / len);
      const dot = pux * (dx / len) + puy * (dy / len);
      let angDeg = Math.atan2(cross, dot) * 180 / Math.PI;

      this.pendingAim.wx = w.x;
      this.pendingAim.wy = w.y;
      this.pendingAim.vinfKms = kms;
      this.pendingAim.angleDeg = angDeg;
      this.predDirty = true;
      return;
    }
    if (this.panLast) {
      this.r.panBy(e.clientX - this.panLast.x, e.clientY - this.panLast.y);
      this.panLast = { x: e.clientX, y: e.clientY };
    }
  }

  _onUp() {
    if (this.pendingAim && this.pendingAim.moved) {
      const aim = this.pendingAim;
      this.autoRetry = null;
      this.sim.spawnLaunch({ planet: aim.p, vinfKms: aim.vinfKms, angleDeg: aim.angleDeg });
      this.syncSliders(aim.p.def.name, aim.vinfKms, aim.angleDeg);
      this.setRunning(true);
      this.predPts = null;
    } else {
      if (this.pendingAim) this.predDirty = true;
    }
    this.pendingAim = null;
    this.panLast = null;
  }

  frame(dtSec) {
    const sim = this.sim;
    if (sim.running) {
      sim.advance(Math.min(dtSec, 0.05) * this.daysPerSec());
    }

    const ended = sim.crashed || sim.escaped;
    const timeoutDue = !ended && sim.hasCraft() && sim.running &&
      sim.stats.encounters < 1 && sim.timeDays >= RETRY_TIMEOUT_YEARS * DAYS_PER_YEAR;

    if (ended || timeoutDue) {
      if (!this._endSeen) {
        this._endSeen = true;
        if (sim.stats.encounters < 1 && sim.lastLaunch) {
          if (timeoutDue) this.setRunning(false);
          this.log(timeoutDue
            ? `${RETRY_TIMEOUT_YEARS}년 경과 · 스윙바이 미달성 — 발사각을 바꿔 자동 재시도합니다`
            : "스윙바이 없이 임무 종료 — 발사각을 바꿔 자동 재시도합니다", "warn");
          if (!this.autoRetry) {
            const L = sim.lastLaunch;
            this.autoRetry = { planetName: L.planetName, vinfKms: L.vinfKms, baseAngle: L.angleDeg, lastAngle: L.angleDeg, attempt: 0 };
          }
          this.autoRetry.tLeft = RETRY_DELAY_S;
        }
      }
    } else {
      this._endSeen = false;
    }
    if (this.autoRetry && this.autoRetry.tLeft != null) {
      this.autoRetry.tLeft -= dtSec;
      if (this.autoRetry.tLeft <= 0) this._doAutoRetry();
    }

    const cr = sim.craftBody();
    if (this._els.chkFollow.checked && cr && !this.pendingAim) {
      const k = 1 - Math.exp(-6 * dtSec);
      this.r.followTo(cr.x, cr.y, k);
    }

    const now = performance.now();
    if (this.predDirty && now - this.lastPredCalc > 140) {
      this.lastPredCalc = now;
      this.predDirty = false;
      if (this._els.chkPred.checked && !sim.hasCraft()) {
        const params = this.pendingAim && this.pendingAim.moved
          ? { planet: this.pendingAim.p, vinfKms: this.pendingAim.vinfKms, angleDeg: this.pendingAim.angleDeg }
          : this.sliderParams();
        const res = sim.predict(params);
        this.predPts = res ? res.pts : null;
      }
    }

    const opts = {
      predPts: (!sim.hasCraft() && this._els.chkPred.checked) ? this.predPts : null,
      aim: this.pendingAim && this.pendingAim.moved ? this.pendingAim : null,
      showOrbits: this._els.chkOrbits.checked
    };
    this.r.draw(sim, opts);
    this._updateTelemetry();
  }

  _doAutoRetry() {
    const c = this.autoRetry;
    c.tLeft = null;
    c.attempt++;
    const planet = this.sim.planetByName(c.planetName);
    if (c.attempt > RETRY_MAX || !planet) {
      this.log(`자동 재시도 ${RETRY_MAX}회 한도 초과 — 발사 설정을 바꿔 수동 발사해 주세요`, "bad");
      this.autoRetry = null;
      return;
    }
    const sign = c.attempt % 2 === 1 ? 1 : -1;
    let ang = c.baseAngle + sign * Math.ceil(c.attempt / 2) * RETRY_STEP_DEG;
    ang = Math.round((((ang % 360) + 540) % 360 - 180) / 5) * 5;
    this.log(`자동 재시도 ${c.attempt}/${RETRY_MAX} · 발사각 ${Math.round(c.lastAngle)}° → ${ang}°`, "warn");
    c.lastAngle = ang;
    this.sim.spawnLaunch({ planet, vinfKms: c.vinfKms, angleDeg: ang });
    this.syncSliders(c.planetName, c.vinfKms, ang);
    this.setRunning(true);
    this.predPts = null;
  }

  _updateTelemetry() {
    const E = this._els;
    const t = this.sim.telemetry();
    E.tTime.textContent = fmtTime(t.timeDays);

    if (t.osc) {
      E.tSpeed.textContent = fmtSpeed(t.osc.speed);
      E.tDist.textContent = fmtDist(t.osc.r);
      E.tA.textContent = t.osc.bound ? t.osc.a.toFixed(3) + " AU" : "쌍곡선 궤도";
      E.tE.textContent = t.osc.e.toFixed(3);
    } else {
      E.tSpeed.textContent = "—";
      E.tDist.textContent = "—";
      E.tA.textContent = "—";
      E.tE.textContent = "—";
    }

    if (t.near) {
      const n = t.near;
      E.tNear.textContent = `${n.p.def.name} · ${fmtDist(n.d)}${n.inside ? " · 영향권 내" : ""}`;
    } else {
      E.tNear.textContent = "—";
    }

    E.tDv.textContent =
      (t.stats.totalDv >= 0 ? "+" : "") + (t.stats.totalDv * AUDAY_KMS).toFixed(2) +
      ` km/s (${t.stats.encounters}회)`;

    const chip = E.tStatus;
    if (!t.exists && !t.crashed && !t.escaped) {
      chip.textContent = "대기 중";
      chip.className = "v chip idle";
    } else if (t.crashed) {
      chip.textContent = "충돌";
      chip.className = "v chip bad";
    } else if (t.escaped) {
      chip.textContent = "태양계 이탈";
      chip.className = "v chip idle";
    } else if (t.near && t.near.inside) {
      chip.textContent = `${t.near.p.def.name} 스윙바이 중`;
      chip.className = "v chip active";
    } else if (t.running) {
      chip.textContent = "비행 중";
      chip.className = "v chip active";
    } else {
      chip.textContent = "일시정지";
      chip.className = "v chip idle";
    }
  }

  log(text, kind) {
    const li = document.createElement("li");
    li.className = kind || "info";
    const time = document.createElement("span");
    time.className = "lt";
    time.textContent = `[${fmtTime(this.sim.timeDays)}] `;
    li.appendChild(time);
    li.appendChild(document.createTextNode(text));
    const list = this._els.log;
    list.insertBefore(li, list.firstChild);
    while (list.children.length > 60) list.removeChild(list.lastChild);
  }
}