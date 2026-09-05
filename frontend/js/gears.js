// Virtual drivetrain. The Zwift Cog gives the bike one physical gear, so
// "gears" live here: the app holds a gear index and maps it to a trainer
// resistance level. The keyboard's +/- keys step the index; the resulting
// resistance is written to the trainer.
//
// Resistance mode (FTMS 0x04) holds a fixed brake level regardless of speed,
// so a higher gear feels harder at any cadence — like a taller gear on flat
// ground. The device resistance domain is 0.0–20.0 (per 0x2AD6).
export class GearModel extends EventTarget {
  // gearCount gears spread linearly from minResistance to maxResistance.
  // Gentle default range: resistance 0–8 across 12 gears (gear 7 ≈ 4.4),
  // tuned down from an initial 2–18 that made the middle gears too hard.
  // These are the two numbers to adjust for feel.
  constructor({ gearCount = 12, minResistance = 0, maxResistance = 8, startGear = 4 } = {}) {
    super();
    this.gearCount = gearCount;
    this.minResistance = minResistance;
    this.maxResistance = maxResistance;
    this.index = Math.max(0, Math.min(gearCount - 1, startGear));
  }

  get gearNumber() {
    return this.index + 1; // 1-based for display
  }

  get resistance() {
    if (this.gearCount === 1) return this.minResistance;
    const t = this.index / (this.gearCount - 1);
    return this.minResistance + t * (this.maxResistance - this.minResistance);
  }

  shiftUp() {
    return this._setIndex(this.index + 1);
  }

  shiftDown() {
    return this._setIndex(this.index - 1);
  }

  _setIndex(next) {
    const clamped = Math.max(0, Math.min(this.gearCount - 1, next));
    if (clamped === this.index) return false; // already at the end stop
    this.index = clamped;
    this.dispatchEvent(new CustomEvent('change', {
      detail: { gear: this.gearNumber, gearCount: this.gearCount, resistance: this.resistance },
    }));
    return true;
  }
}
