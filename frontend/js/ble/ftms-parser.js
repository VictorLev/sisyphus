// Parses the Bluetooth FTMS "Indoor Bike Data" characteristic (0x2AD2).
//
// Payload is a 16-bit little-endian flags field followed by whichever
// fields are flagged present, in ascending bit order, back to back with
// no padding. Bit 0 is the one exception in the spec: it is inverted
// ("More Data") — 0 means Instantaneous Speed IS present, 1 means it is
// NOT present. Every other bit uses normal "1 = present" logic.
//
// Pure function: no DOM/BLE dependencies, so it can be exercised directly
// under plain Node (see scripts/verify-ftms-parser.mjs).

const FIELD_READERS = [
  { bit: 0, key: 'instantaneousSpeedKmh', inverted: true, read: (v, o) => v.getUint16(o, true) * 0.01, size: 2 },
  { bit: 1, key: 'averageSpeedKmh', read: (v, o) => v.getUint16(o, true) * 0.01, size: 2 },
  { bit: 2, key: 'instantaneousCadenceRpm', read: (v, o) => v.getUint16(o, true) * 0.5, size: 2 },
  { bit: 3, key: 'averageCadenceRpm', read: (v, o) => v.getUint16(o, true) * 0.5, size: 2 },
  { bit: 4, key: 'totalDistanceM', read: (v, o) => v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16), size: 3 },
  { bit: 5, key: 'resistanceLevel', read: (v, o) => v.getInt16(o, true), size: 2 },
  { bit: 6, key: 'instantaneousPowerW', read: (v, o) => v.getInt16(o, true), size: 2 },
  { bit: 7, key: 'averagePowerW', read: (v, o) => v.getInt16(o, true), size: 2 },
  {
    bit: 8,
    key: 'expendedEnergy',
    read: (v, o) => ({
      totalKcal: v.getUint16(o, true),
      perHourKcal: v.getUint16(o + 2, true),
      perMinuteKcal: v.getUint8(o + 4),
    }),
    size: 5,
  },
  { bit: 9, key: 'heartRateBpm', read: (v, o) => v.getUint8(o), size: 1 },
  { bit: 10, key: 'metabolicEquivalent', read: (v, o) => v.getUint8(o) * 0.1, size: 1 },
  { bit: 11, key: 'elapsedTimeSec', read: (v, o) => v.getUint16(o, true), size: 2 },
  { bit: 12, key: 'remainingTimeSec', read: (v, o) => v.getUint16(o, true), size: 2 },
];

export function parseIndoorBikeData(dataView) {
  const reading = {
    instantaneousSpeedKmh: null,
    averageSpeedKmh: null,
    instantaneousCadenceRpm: null,
    averageCadenceRpm: null,
    totalDistanceM: null,
    resistanceLevel: null,
    instantaneousPowerW: null,
    averagePowerW: null,
    expendedEnergy: null,
    heartRateBpm: null,
    metabolicEquivalent: null,
    elapsedTimeSec: null,
    remainingTimeSec: null,
  };

  if (dataView.byteLength < 2) {
    console.warn('[ftms-parser] buffer too short to contain flags field');
    return reading;
  }

  const flags = dataView.getUint16(0, true);
  let offset = 2;

  for (const field of FIELD_READERS) {
    const bitSet = (flags & (1 << field.bit)) !== 0;
    const present = field.inverted ? !bitSet : bitSet;
    if (!present) continue;

    if (offset + field.size > dataView.byteLength) {
      console.warn(`[ftms-parser] buffer truncated before field "${field.key}"`);
      break;
    }

    reading[field.key] = field.read(dataView, offset);
    offset += field.size;
  }

  return reading;
}
