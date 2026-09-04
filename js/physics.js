const SOFT2 = 1e-16;
const DT_MAX = 1.0;
const DT_MIN = 2e-7;
const TAU_FACTOR = 0.04;
const LINEAR_FACTOR = 0.03;

function derivState(n, mu, isTest, isStatic, S, O) {
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    O[o] = S[o + 2];
    O[o + 1] = S[o + 3];
    if (isStatic[i]) {
      O[o + 2] = 0;
      O[o + 3] = 0;
      continue;
    }
    let ax = 0, ay = 0;
    const xi = S[o], yi = S[o + 1];
    for (let j = 0; j < n; j++) {
      if (j === i || isTest[j]) continue;
      const c = j * 4;
      const dx = S[c] - xi;
      const dy = S[c + 1] - yi;
      const r2 = dx * dx + dy * dy + SOFT2;
      const w = mu[j] / (r2 * Math.sqrt(r2));
      ax += dx * w;
      ay += dy * w;
    }
    O[o + 2] = ax;
    O[o + 3] = ay;
  }
}

function makeScratch(n) {
  return {
    K1: new Float64Array(n * 4),
    K2: new Float64Array(n * 4),
    K3: new Float64Array(n * 4),
    K4: new Float64Array(n * 4),
    T1: new Float64Array(n * 4),
    T2: new Float64Array(n * 4),
    T3: new Float64Array(n * 4)
  };
}

function rk4StepState(n, mu, isTest, isStatic, scratch, S, dt) {
  const n4 = n * 4;
  const h = dt, h2 = dt / 2, h6 = dt / 6;
  const { K1, K2, K3, K4, T1, T2, T3 } = scratch;

  derivState(n, mu, isTest, isStatic, S, K1);
  for (let k = 0; k < n4; k++) T1[k] = S[k] + K1[k] * h2;

  derivState(n, mu, isTest, isStatic, T1, K2);
  for (let k = 0; k < n4; k++) T2[k] = S[k] + K2[k] * h2;

  derivState(n, mu, isTest, isStatic, T2, K3);
  for (let k = 0; k < n4; k++) T3[k] = S[k] + K3[k] * h;

  derivState(n, mu, isTest, isStatic, T3, K4);
  for (let k = 0; k < n4; k++) {
    S[k] += h6 * (K1[k] + 2 * (K2[k] + K3[k]) + K4[k]);
  }
}

function chooseDtState(n, mu, isTest, S, craftIdx) {
  if (craftIdx < 0) return DT_MAX;
  const c = craftIdx * 4;
  const cx = S[c], cy = S[c + 1], cvx = S[c + 2], cvy = S[c + 3];
  let dt = DT_MAX;
  for (let j = 0; j < n; j++) {
    if (isTest[j]) continue;
    const o = j * 4;
    const dx = S[o] - cx, dy = S[o + 1] - cy;
    const d = Math.sqrt(dx * dx + dy * dy) + 1e-12;
    const tau = Math.sqrt(d * d * d / Math.max(mu[j], 1e-18));
    let cand = TAU_FACTOR * tau;
    const rvx = S[o + 2] - cvx, rvy = S[o + 3] - cvy;
    const vr = Math.hypot(rvx, rvy) + 1e-12;
    cand = Math.min(cand, LINEAR_FACTOR * d / vr);
    if (cand < dt) dt = cand;
  }
  return Math.min(DT_MAX, Math.max(DT_MIN, dt));
}

class NBodyEngine {
  constructor() {
    this.bodies = [];
    this.n = 0;
  }

  addBody(def) {
    const b = Object.assign({
      x: 0, y: 0, vx: 0, vy: 0,
      mu: 0,
      radiusAU: 0,
      isTest: false,
      isStatic: false,
      soi: Infinity
    }, def);
    this.bodies.push(b);
    this._rebuild();
    return this.bodies.length - 1;
  }

  removeLastIfTest() {
    const last = this.bodies[this.bodies.length - 1];
    if (last && last.isTest) {
      this.bodies.pop();
      this._rebuild();
      return true;
    }
    return false;
  }

  _rebuild() {
    this.n = this.bodies.length;
    const n = this.n;
    this.S = new Float64Array(n * 4);
    this.mu = new Float64Array(n);
    this.isTest = new Uint8Array(n);
    this.isStatic = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const b = this.bodies[i];
      this.S[i * 4] = b.x;
      this.S[i * 4 + 1] = b.y;
      this.S[i * 4 + 2] = b.vx;
      this.S[i * 4 + 3] = b.vy;
      this.mu[i] = b.mu;
      this.isTest[i] = b.isTest ? 1 : 0;
      this.isStatic[i] = b.isStatic ? 1 : 0;
    }
    Object.assign(this, makeScratch(n));
  }

  step(dt) {
    rk4StepState(this.n, this.mu, this.isTest, this.isStatic, this, this.S, dt);
  }

  syncFromState() {
    for (let i = 0; i < this.n; i++) {
      const b = this.bodies[i], o = i * 4;
      b.x = this.S[o];
      b.y = this.S[o + 1];
      b.vx = this.S[o + 2];
      b.vy = this.S[o + 3];
    }
  }

  chooseDt(craftIdx) {
    return chooseDtState(this.n, this.mu, this.isTest, this.S, craftIdx);
  }
}
