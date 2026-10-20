// Road speed from power, the way it would be outside: the rider's watts
// push against gravity on the current grade, rolling resistance and air
// drag, carrying the rider's and the bike's weight. With inertia, so a
// heavier rider is slower up a climb and slower to get up to speed, and
// stopping pedalling coasts down instead of dropping to zero.
//
// The trainer's own speed is a guess from its flywheel and the same for
// everyone; this replaces it on the ride screen, in the recording and for
// distance.

export const PHYSICS = {
  g: 9.81, // m/s²
  airDensity: 1.225, // kg/m³, sea level at 15 °C
  cda: 0.32, // m², drag area on the hoods of a road bike
  crr: 0.004, // rolling resistance, road tyres on smooth tarmac
  drivetrain: 0.97, // share of the measured watts that reach the road
};

const DEFAULT_RIDER_KG = 75;
const DEFAULT_BIKE_KG = 9;
const STEP_S = 0.05; // integration step
const MAX_GAP_S = 2; // a longer gap between readings counts as 2 s

// Resistive force (N) at speed v (m/s) on a grade (%), for a total mass.
function resistance(v, massKg, gradePct) {
  const theta = Math.atan(gradePct / 100);
  const gravity = massKg * PHYSICS.g * Math.sin(theta);
  const rolling = massKg * PHYSICS.g * PHYSICS.crr * Math.cos(theta);
  const drag = 0.5 * PHYSICS.airDensity * PHYSICS.cda * v * v;
  return gravity + rolling + drag;
}

// The speed (km/h) a steady effort settles at: where the power going in
// equals the power the road takes. Solved by bisection; 0 if the power
// can't hold the bike up the grade.
export function steadySpeedKmh(powerW, massKg, gradePct = 0) {
  const power = Math.max(0, powerW) * PHYSICS.drivetrain;
  const need = (v) => v * resistance(v, massKg, gradePct);
  let lo = 0;
  let hi = 40; // m/s, 144 km/h
  if (need(hi) < power) return hi * 3.6;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (need(mid) < power) lo = mid;
    else hi = mid;
  }
  return lo * 3.6;
}

export class VirtualSpeed {
  constructor({ riderKg = DEFAULT_RIDER_KG, bikeKg = DEFAULT_BIKE_KG } = {}) {
    this.configure({ riderKg, bikeKg });
    this.reset();
  }

  // Missing or nonsense weights fall back to a typical rider and bike.
  configure({ riderKg, bikeKg } = {}) {
    if (riderKg !== undefined) this.riderKg = riderKg > 20 && riderKg < 300 ? riderKg : DEFAULT_RIDER_KG;
    if (bikeKg !== undefined) this.bikeKg = bikeKg > 0 && bikeKg < 50 ? bikeKg : DEFAULT_BIKE_KG;
  }

  get massKg() {
    return this.riderKg + this.bikeKg;
  }

  get speedKmh() {
    return this.v * 3.6;
  }

  // Advances to nowMs under the given power (W) and grade (%). Returns
  // the speed in km/h.
  update(powerW, gradePct, nowMs) {
    if (this.lastMs != null) {
      let remaining = Math.min(MAX_GAP_S, Math.max(0, (nowMs - this.lastMs) / 1000));
      const power = Math.max(0, powerW ?? 0) * PHYSICS.drivetrain;
      const mass = this.massKg;
      while (remaining > 1e-9) {
        const dt = Math.min(STEP_S, remaining);
        // Power over speed is force; below walking pace it would be
        // near-infinite, so the push is taken at 1 m/s at most.
        const push = power / Math.max(this.v, 1);
        const net = push - resistance(this.v, mass, gradePct ?? 0);
        // Rolling resistance and drag stop a bike; they don't roll it back.
        this.v = Math.max(0, this.v + (net / mass) * dt);
        remaining -= dt;
      }
    }
    this.lastMs = nowMs;
    return this.speedKmh;
  }

  // After a pause: carry on from a standstill, without counting the gap.
  resume() {
    this.v = 0;
    this.lastMs = null;
  }

  reset() {
    this.v = 0;
    this.lastMs = null;
  }
}
