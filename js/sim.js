const MAX_STEPS_PER_ADVANCE = 20000;
const ESCAPE_AU = 60;
const TRAIL_CAP = 12000;

class Simulation {
  constructor() {
    this.onEvent = null;
    this.viewHint = null;
    this.reset();
  }

  reset() {
    const eng = new NBodyEngine();
    eng.addBody({
      name: "태양", color: "#ffd27a",
      mu: MU_SUN,
      radiusAU: 696340 / AU_KM,
      isStatic: true
    });
    this.planets = PLANET_DEFS.map(def => {
      const st = this._circularState(def, def.angleDeg * Math.PI / 180);
      const idx = eng.addBody(st);
      const startAngleRad = def.angleDeg * Math.PI / 180;
      return {
        def, idx, name: def.name, color: def.color, mu: st.mu, radiusAU: st.radiusAU, soi: st.soi, a: def.a,
        x: st.x, y: st.y, vx: st.vx, vy: st.vy,
        // 렌더러가 궤도를 '지나온 부분만' 호로 그릴 수 있도록 시작각과
        // 누적 스윕각(여러 바퀴 돌아도 계속 더해짐)을 추적한다.
        startAngleRad,
        lastAngleRad: startAngleRad,
        sweptAngle: 0
      };
    });
    this.engine = eng;
    this.craftIdx = -1;
    this.timeDays = 0;
    this.running = false;
    this.crashed = false;
    this.escaped = false;
    this.trail = [];
    this.stats = { encounters: 0, totalDv: 0 };
    this.lastLaunch = null;
  }

  _circularState(def, angRad) {
    const v = circVel(def.a);
    return {
      x: Math.cos(angRad) * def.a,
      y: Math.sin(angRad) * def.a,
      vx: -Math.sin(angRad) * v,
      vy: Math.cos(angRad) * v,
      mu: MU_SUN * def.massRatio,
      radiusAU: def.radiusKm / AU_KM,
      soi: soiRadius(def.a, def.massRatio)
    };
  }

  planetByName(name) {
    return this.planets.find(p => p.def.name === name);
  }

  setPlanetCircular(p, angRad, radiusOverride) {
    const r = radiusOverride !== undefined ? radiusOverride : p.def.a;
    const v = circVel(r);
    p.x = Math.cos(angRad) * r;
    p.y = Math.sin(angRad) * r;
    p.vx = -Math.sin(angRad) * v;
    p.vy = Math.cos(angRad) * v;
    const o = p.idx * 4;
    const S = this.engine.S;
    S[o] = p.x; S[o + 1] = p.y; S[o + 2] = p.vx; S[o + 3] = p.vy;
    Object.assign(this.engine.bodies[p.idx], { x: p.x, y: p.y, vx: p.vx, vy: p.vy });
    // 프리셋이 위상각을 강제로 재배치했으므로, 궤도 호의 시작 기준도 여기서 다시 잡는다.
    p.startAngleRad = angRad;
    p.lastAngleRad = angRad;
    p.sweptAngle = 0;
  }

  _craftInitialState(planet, vinfKms, angleDeg) {
    const pv = planet;
    const puLen = Math.hypot(pv.vx, pv.vy);
    const pux = pv.vx / puLen, puy = pv.vy / puLen;
    const th = angleDeg * Math.PI / 180;
    const c = Math.cos(th), s = Math.sin(th);
    const dx = pux * c - puy * s;
    const dy = pux * s + puy * c;

    const r0 = Math.max(pv.radiusAU * 3, 1.2e-4);
    const vinf = vinfKms / AUDAY_KMS;
    const vmag = Math.sqrt(vinf * vinf + 2 * pv.mu / r0);

    // During escape the geocentric hyperbola bends the velocity by
    // delta/2 (half the total turn, since we start at periapsis).
    // Pre-rotate so the outgoing asymptote matches the chosen angle.
    const eDep = 1 + r0 * vinf * vinf / pv.mu;
    const halfTurn = Math.asin(Math.min(1, 1 / eDep));
    const thEff = th + halfTurn;
    const ce = Math.cos(thEff), se = Math.sin(thEff);
    const dxE = pux * ce - puy * se;
    const dyE = pux * se + puy * ce;

    return {
      x: pv.x + (-dyE) * r0,
      y: pv.y + (dxE) * r0,
      vx: pv.vx + dxE * vmag,
      vy: pv.vy + dyE * vmag
    };
  }

  spawnLaunch({ planet, vinfKms, angleDeg }) {
    this.removeCraft();
    const st = this._craftInitialState(planet, vinfKms, angleDeg);
    this._addCraftBody(st.x, st.y, st.vx, st.vy);
    for (const p of this.planets) {
      const d = Math.hypot(st.x - p.x, st.y - p.y);
      p.inSOI = d < p.soi;
      p.suppressExit = p === planet;
      p.minEnc = Infinity;
      p.vInHelio = null;
    }
    this.lastLaunch = { planetName: planet.def.name, vinfKms, angleDeg };
    this.emit("info", `${planet.def.name}에서 발사 · v∞ ${vinfKms.toFixed(1)} km/s · 방향 ${angleDeg}°`, "info");
  }

  spawnCraftState(x, y, vx, vy) {
    this.removeCraft();
    this._addCraftBody(x, y, vx, vy);
    for (const p of this.planets) {
      const d = Math.hypot(x - p.x, y - p.y);
      p.inSOI = d < p.soi;
      p.suppressExit = false;
      p.minEnc = Infinity;
      p.vInHelio = null;
    }
  }

  _addCraftBody(x, y, vx, vy) {
    this.craftIdx = this.engine.addBody({
      name: "우주선", color: "#7df9ff",
      mu: 0, radiusAU: 1e-9, isTest: true,
      x, y, vx, vy
    });
    this.crashed = false;
    this.escaped = false;
    this.trail = [{ x, y }];
    this.timeDays = 0;
    this.stats = { encounters: 0, totalDv: 0 };
  }

  removeCraft() {
    if (this.engine.removeLastIfTest()) {
      this.craftIdx = -1;
    }
  }

  hasCraft() {
    return this.craftIdx >= 0 && !this.crashed && !this.escaped;
  }

  craftBody() {
    return this.craftIdx >= 0 ? this.engine.bodies[this.craftIdx] : null;
  }

  emit(type, text, kind) {
    if (this.onEvent) this.onEvent({ type, text, kind });
  }

  advance(budgetDays) {
    if (!this.running || this.crashed || this.escaped) return;
    const eng = this.engine;
    let remaining = budgetDays;
    let steps = 0;
    while (remaining > 1e-9 && steps < MAX_STEPS_PER_ADVANCE) {
      let dt = eng.chooseDt(this.craftIdx);
      if (dt > remaining) dt = remaining;
      eng.step(dt);
      eng.syncFromState();
      remaining -= dt;
      this.timeDays += dt;
      steps++;
      if (this.craftIdx >= 0) {
        this.checkEvents();
        if (this.crashed || this.escaped) break;
        this.pushTrail();
      }
    }
    this.planets.forEach(p => {
      Object.assign(p, eng.bodies[p.idx]);
      const ang = Math.atan2(p.y, p.x);
      let delta = ang - p.lastAngleRad;
      // -π..π 범위로 정규화 (한 프레임에 반 바퀴 이상 돌지는 않는다고 가정)
      delta = ((delta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      p.sweptAngle += delta;
      p.lastAngleRad = ang;
    });
  }

  pushTrail() {
    const cr = this.engine.bodies[this.craftIdx];
    const last = this.trail[this.trail.length - 1];
    const d2last = last ? (cr.x - last.x) ** 2 + (cr.y - last.y) ** 2 : Infinity;
    let thr = 4e-3;
    for (const p of this.planets) {
      if ((cr.x - p.x) ** 2 + (cr.y - p.y) ** 2 < p.soi * p.soi) {
        thr = Math.min(thr, Math.max(2e-5, p.soi * 0.002));
      }
    }
    if (d2last > thr * thr || !last) {
      this.trail.push({ x: cr.x, y: cr.y });
      if (this.trail.length > TRAIL_CAP) this.trail.shift();
    }
  }

  checkEvents() {
    const eng = this.engine;
    const cr = eng.bodies[this.craftIdx];
    const rsun = Math.hypot(cr.x, cr.y);

    for (const p of this.planets) {
      const pb = eng.bodies[p.idx];
      const d = Math.hypot(cr.x - pb.x, cr.y - pb.y);
      if (!p.inSOI) {
        if (d < p.soi) {
          p.inSOI = true;
          p.minEnc = d;
          p.vInHelio = Math.hypot(cr.vx, cr.vy);
          if (!p.suppressExit) {
            this.emit("enter", `${p.name} 영향권 진입 · ${fmtDist(d)} · ${(p.vInHelio * AUDAY_KMS).toFixed(2)} km/s`, "enter");
          }
        }
      } else {
        if (d < p.minEnc) p.minEnc = d;
        if (d > p.soi) {
          p.inSOI = false;
          const sp = Math.hypot(cr.vx, cr.vy);
          if (p.suppressExit) {
            p.suppressExit = false;
          } else if (p.vInHelio != null) {
            const dv = sp - p.vInHelio;
            this.stats.encounters++;
            this.stats.totalDv += dv;
            this.emit("exit",
              `${p.name} 스윙바이 완료 · ${(p.vInHelio * AUDAY_KMS).toFixed(2)} → ${(sp * AUDAY_KMS).toFixed(2)} km/s (${dv >= 0 ? "+" : ""}${(dv * AUDAY_KMS).toFixed(2)}) · 최근접 ${fmtDist(p.minEnc)}`,
              dv >= 0 ? "gain" : "loss");
          }
        }
      }
      if (d < pb.radiusAU * 1.02) {
        this.crashed = true;
        this.running = false;
        this.emit("crash", `${p.name} 표면 충돌 — 임무 종료`, "bad");
        return;
      }
    }

    if (rsun < this.sunRadius() * 1.05) {
      this.crashed = true;
      this.running = false;
      this.emit("crash", "태양 충돌 — 임무 종료", "bad");
      return;
    }
    if (rsun > ESCAPE_AU) {
      this.escaped = true;
      this.running = false;
      this.emit("escape", "태양계 이탈 — 심우주로 진입했습니다", "info");
    }
  }

  sunRadius() {
    return this.engine.bodies[0].radiusAU;
  }

  osculating() {
    if (!this.hasCraft()) return null;
    const cr = this.engine.bodies[this.craftIdx];
    const r = Math.hypot(cr.x, cr.y);
    const v2 = cr.vx * cr.vx + cr.vy * cr.vy;
    const eps = v2 / 2 - MU_SUN / r;
    const h = cr.x * cr.vy - cr.y * cr.vx;
    const e = Math.sqrt(Math.max(0, 1 + 2 * eps * h * h / (MU_SUN * MU_SUN)));
    const bound = eps < 0;
    const a = bound ? -MU_SUN / (2 * eps) : null;
    return { eps, e, a, r, speed: Math.sqrt(v2), bound };
  }

  nearestPlanet() {
    if (!this.hasCraft()) return null;
    const cr = this.engine.bodies[this.craftIdx];
    let best = null;
    for (const p of this.planets) {
      const pb = this.engine.bodies[p.idx];
      const d = Math.hypot(cr.x - pb.x, cr.y - pb.y);
      const rel = Math.hypot(cr.vx - pb.vx, cr.vy - pb.vy);
      if (!best || d / p.soi < best.d / best.p.soi) best = { p, d, rel };
    }
    return best;
  }

  telemetry() {
    return {
      timeDays: this.timeDays,
      exists: this.hasCraft(),
      crashed: this.crashed,
      escaped: this.escaped,
      running: this.running,
      osc: this.osculating(),
      near: this.nearestPlanet(),
      stats: this.stats
    };
  }

  predict(params, horizonYears = 12) {
    const eng = this.engine;
    const hasParams = params != null;
    if (!hasParams && this.craftIdx < 0) return null;

    let n, S, mu, isTest, isStatic, craftLocal;
    if (hasParams) {
      const st = this._craftInitialState(params.planet, params.vinfKms, params.angleDeg);
      n = eng.n + 1;
      S = new Float64Array(n * 4);
      S.set(eng.S);
      const o = eng.n * 4;
      S[o] = st.x; S[o + 1] = st.y; S[o + 2] = st.vx; S[o + 3] = st.vy;
      mu = new Float64Array(n); mu.set(eng.mu); mu[eng.n] = 0;
      isTest = new Uint8Array(n); isTest.set(eng.isTest); isTest[eng.n] = 1;
      isStatic = new Uint8Array(n); isStatic.set(eng.isStatic);
    } else {
      n = eng.n;
      S = Float64Array.from(eng.S);
      mu = Float64Array.from(eng.mu);
      isTest = Uint8Array.from(eng.isTest);
      isStatic = Uint8Array.from(eng.isStatic);
    }
    craftLocal = n - 1;

    const scratch = makeScratch(n);
    const horizonDays = horizonYears * DAYS_PER_YEAR;
    const pts = [];
    let lastX = null, lastY = null;
    let crashed = false;
    let t = 0, steps = 0;
    const sunR = eng.bodies[0].radiusAU;
    const pdata = this.planets.map(p => ({ idx: p.idx, soi: p.soi, radiusAU: p.radiusAU }));

    while (t < horizonDays && steps < 60000) {
      let dt = chooseDtState(n, mu, isTest, S, craftLocal) * 2;
      dt = Math.min(dt, horizonDays - t);
      rk4StepState(n, mu, isTest, isStatic, scratch, S, dt);
      t += dt;
      steps++;
      const c = craftLocal * 4;
      const x = S[c], y = S[c + 1];
      const rsun = Math.hypot(x, y);

      let inside = false, hit = rsun < sunR * 1.02;
      for (const pd of pdata) {
        const q = pd.idx * 4;
        const d = Math.hypot(x - S[q], y - S[q + 1]);
        if (d < pd.soi) inside = true;
        if (d < pd.radiusAU * 1.02) hit = true;
      }
      if (hit) { pts.push(x, y, 0); crashed = true; break; }
      if (rsun > 32) break;

      const res = inside ? 3e-5 : 0.01;
      if (lastX === null || (x - lastX) ** 2 + (y - lastY) ** 2 > res * res) {
        pts.push(x, y, inside ? 1 : 0);
        lastX = x; lastY = y;
      }
      if (pts.length > 18000) break;
    }

    return { pts: new Float32Array(pts), crashed };
  }

  _cloneEngineArrays() {
    const eng = this.engine;
    return {
      n: eng.n,
      S: Float64Array.from(eng.S),
      mu: Float64Array.from(eng.mu),
      isTest: Uint8Array.from(eng.isTest),
      isStatic: Uint8Array.from(eng.isStatic)
    };
  }

  // 후보 궤적을 '실제' N-body 물리(태양 + 전 행성 중력)로 미리 앞당겨
  // 적분해 targetIdx 행성까지의 진짜 최근접 거리를 측정한다.
  // presetFlyby()의 2체 근사 조준식은 접근 구간 동안의 태양 중력을
  // 무시하므로, 이 값으로 조준을 보정해야 실제 근접거리가 목표치에 맞는다.
  _shootMinDist(x, y, vx, vy, targetIdx, horizonDays) {
    const base = this._cloneEngineArrays();
    const n = base.n + 1;
    const S = new Float64Array(n * 4);
    S.set(base.S);
    const o = base.n * 4;
    S[o] = x; S[o + 1] = y; S[o + 2] = vx; S[o + 3] = vy;
    const mu = new Float64Array(n); mu.set(base.mu); mu[base.n] = 0;
    const isTest = new Uint8Array(n); isTest.set(base.isTest); isTest[base.n] = 1;
    const isStatic = new Uint8Array(n); isStatic.set(base.isStatic);
    const craftLocal = base.n;
    const scratch = makeScratch(n);

    let t = 0, steps = 0, minD = Infinity;
    const tOff = targetIdx * 4, cOff = craftLocal * 4;
    while (t < horizonDays && steps < 20000) {
      const dt = Math.min(chooseDtState(n, mu, isTest, S, craftLocal), horizonDays - t);
      rk4StepState(n, mu, isTest, isStatic, scratch, S, dt);
      t += dt; steps++;
      const dx = S[cOff] - S[tOff], dy = S[cOff + 1] - S[tOff + 1];
      const d = Math.hypot(dx, dy);
      if (d < minD) minD = d;
      else if (minD < Infinity && d > minD * 1.02) break; // 근접점을 지나 다시 멀어짐
    }
    return minD;
  }

  presetHohmann(toName) {
    this.reset();
    const from = this.planetByName("지구");
    const to = this.planetByName(toName);
    const r1 = from.def.a, r2 = to.def.a;
    const at = (r1 + r2) / 2;
    const vc1 = circVel(r1);
    const vp = Math.sqrt(MU_SUN * (2 / r1 - 1 / at));
    const dv = vp - vc1;
    const tof = Math.PI * Math.sqrt(at * at * at / MU_SUN);

    const thetaE = Math.atan2(from.y, from.x);
    const arrAng = thetaE + Math.PI;
    const n2 = Math.sqrt(MU_SUN / (r2 * r2 * r2));

    const vinfArrAuday = Math.abs(Math.sqrt(MU_SUN * (2 / r2 - 1 / at)) - circVel(r2));
    const rpT = to.radiusAU * 1.3;
    const bParam = rpT * Math.sqrt(1 + 2 * to.mu / (rpT * vinfArrAuday * vinfArrAuday));
    const phaseArc = 0.45 * to.soi;

    this.setPlanetCircular(to, arrAng - n2 * tof + phaseArc / r2, r2 + bParam);

    const vinfKms = Math.abs(dv) * AUDAY_KMS;
    const angleDeg = dv >= 0 ? 0 : 180;
    this.spawnLaunch({ planet: from, vinfKms, angleDeg });
    this.running = true;
    this.viewHint = { cx: 0, cy: 0, extentAU: Math.max(2.1, r2 * 1.25), follow: false };

    this.emit("info",
      `프리셋: 지구 → ${toName} 호만 전이 · Δv ${vinfKms.toFixed(2)} km/s · 비행 약 ${tof.toFixed(0)}일 후 ${toName} 접근 예정`,
      "info");
    return { vinfKms, angleDeg, planetName: from.def.name };
  }

  presetFlyby(planetName, wantGain) {
    this.reset();
    const p = this.planetByName(planetName);
    const muP = p.mu;
    const vinfKms = 6;
    const vinf = vinfKms / AUDAY_KMS;

    const Vlen = Math.hypot(p.vx, p.vy);
    const tx = p.vx / Vlen, ty = p.vy / Vlen;
    const sense = wantGain ? 1 : -1;
    const alpha = -45 * Math.PI / 180;

    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const dinX = tx * ca - ty * sa;
    const dinY = tx * sa + ty * ca;

    const nHatX = sense * dinY;
    const nHatY = -sense * dinX;

    // 목표 근접거리(행성 반경의 3배)와 접근 시작 거리.
    const rpTarget = p.radiusAU * 3;
    const D = p.soi * 1.15;

    // bParam(조준 오프셋)이 주어졌을 때 출발 위치/속도를 만드는 함수.
    // At D the hyperbolic speed is sqrt(vinf^2 + 2mu/D); split it into a
    // radial (inbound) part plus a transverse part fixed by angular
    // momentum h = vinf * b.
    const stateForB = (bParam) => {
      const L = Math.sqrt(Math.max(0, D * D - bParam * bParam));
      const startX = p.x + nHatX * bParam - dinX * L;
      const startY = p.y + nHatY * bParam - dinY * L;
      const urx = nHatX * bParam / D - dinX * L / D;
      const ury = nHatY * bParam / D - dinY * L / D;
      const vD2 = vinf * vinf + 2 * muP / D;
      const vt = vinf * bParam / D;
      const vr = Math.sqrt(Math.max(0, vD2 - vt * vt));
      const utx = sense * (-ury), uty = sense * urx;
      return {
        x: startX, y: startY,
        vx: p.vx - vr * urx + vt * utx,
        vy: p.vy - vr * ury + vt * uty
      };
    };

    // 2체(행성만) 근사식으로 초기 추정치 계산 — 태양 중력을 무시하므로
    // 실제로는 이보다 근접거리가 더 멀어진다.
    let bLo = 0;
    let bParam = rpTarget * Math.sqrt(1 + 2 * muP / (rpTarget * vinf * vinf));
    let bHi = bParam;

    // 실제 N-body 물리(태양 포함)로 미리 적분해 진짜 근접거리를 측정하고,
    // 목표치(rpTarget)에 수렴할 때까지 이분탐색으로 조준을 보정한다.
    const horizon = 3 * DAYS_PER_YEAR;
    let achieved = rpTarget;
    for (let it = 0; it < 7; it++) {
      const s0 = stateForB(bParam);
      achieved = this._shootMinDist(s0.x, s0.y, s0.vx, s0.vy, p.idx, horizon);
      if (Math.abs(achieved - rpTarget) < rpTarget * 0.03) break;
      if (achieved > rpTarget) { bHi = bParam; bParam = (bLo + bParam) / 2; }
      else { bLo = bParam; bParam = (bParam + bHi) / 2; }
    }

    const finalState = stateForB(bParam);
    // 최종적으로 실제로 얻게 될 꺾임각은 achieved(실측 근접거리) 기준으로 표기.
    const delta = 2 * Math.asin(Math.min(1, 1 / (1 + achieved * vinf * vinf / muP)));

    this.spawnCraftState(finalState.x, finalState.y, finalState.vx, finalState.vy);
    this.running = true;
    this.viewHint = { cx: 0, cy: 0, extentAU: 1.0, follow: false };

    const eff = wantGain ? "가속" : "감속";
    this.emit("info",
      `프리셋: ${planetName} ${eff} 스윙바이 · v∞ ${vinfKms.toFixed(1)} km/s · 꺾임각 ${(delta * 180 / Math.PI).toFixed(1)}° · ${wantGain ? "행성 뒤쪽 통과로 에너지 획득" : "행성 앞쪽 통과로 에너지 상실"} 예상`,
      "info");
    return { vinfKms, angleDeg: 0, planetName };
  }

  presetVoyager() {
    this.reset();
    // 오프라인 수치 탐색으로 찾은 위상각: 지구 발사(v∞ 9.3 km/s, −12°) 후
    // 목성(+6.4 km/s) → 토성 → 천왕성 → 해왕성 순서의 연쇄 스윙바이.
    const phases = { "목성": 347.1444917743747, "토성": 38.40822559623286, "천왕성": 83.92239743137792, "해왕성": 106.3467424817416 };
    for (const nm of Object.keys(phases)) {
      this.setPlanetCircular(this.planetByName(nm), phases[nm] * Math.PI / 180);
    }
    const earth = this.planetByName("지구");
    const vinfKms = 9.3;
    const angleDeg = -12;
    this.spawnLaunch({ planet: earth, vinfKms, angleDeg });
    this.running = true;
    this.viewHint = { cx: 0, cy: 0, extentAU: 33, follow: false };
    this.emit("info",
      "프리셋: 보이저 2호형 대탐사 · 지구 → 목성(약 2년) → 토성(4.6년) → 천왕성(10.9년) → 해왕성(19.6년) 연쇄 스윙바이",
      "info");
    return { vinfKms, angleDeg, planetName: earth.def.name };
  }
}