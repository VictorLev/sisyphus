// Dev-only hardware probe. Not part of the app — it exists to replace the
// assumptions in PROMPT.md's Bluetooth section with facts read off the
// actual devices, before any Control Point or Click code gets written.

import { ZwiftClickConnection } from './ble/zwift-click.js';

const logEl = document.getElementById('log');

function log(...parts) {
  logEl.textContent += parts.join(' ') + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function ascii(buffer) {
  return [...new Uint8Array(buffer)].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
}

// ---------------------------------------------------------------- trainer

// Fitness Machine Feature (0x2ACC) is two little-endian uint32s.
const MACHINE_FEATURES = [
  'Average Speed', 'Cadence', 'Total Distance', 'Inclination',
  'Elevation Gain', 'Pace', 'Step Count', 'Resistance Level',
  'Stride Count', 'Expended Energy', 'Heart Rate Measurement',
  'Metabolic Equivalent', 'Elapsed Time', 'Remaining Time',
  'Power Measurement', 'Force on Belt and Power Output',
  'User Data Retention',
];

// Bit 13 here is the one that decides whether grade simulation is possible.
const TARGET_FEATURES = [
  'Speed Target', 'Inclination Target', 'Resistance Target (0x04)',
  'Power Target / ERG (0x05)', 'Heart Rate Target',
  'Targeted Expended Energy', 'Targeted Step Number',
  'Targeted Stride Number', 'Targeted Distance', 'Targeted Training Time',
  'Targeted Time in Two HR Zones', 'Targeted Time in Three HR Zones',
  'Targeted Time in Five HR Zones',
  'Indoor Bike Simulation Parameters (0x11)',
  'Wheel Circumference', 'Spin Down Control', 'Targeted Cadence',
];

function decodeBits(value, names) {
  for (let i = 0; i < names.length; i++) {
    log(`    [${((value >>> i) & 1) ? 'x' : ' '}] bit ${String(i).padStart(2)}  ${names[i]}`);
  }
}

async function probeTrainer() {
  log('\n=== TRAINER PROBE ===');
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: ['fitness_machine'] }],
    optionalServices: ['device_information', 'battery_service'],
  });
  log('device:', device.name || '(unnamed)', '| id:', device.id);

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService('fitness_machine');

  log('\n-- characteristics on fitness_machine --');
  for (const c of await service.getCharacteristics()) {
    const p = Object.entries(c.properties).filter(([, v]) => v).map(([k]) => k).join(',');
    log(`  ${c.uuid}  [${p}]`);
  }

  log('\n-- Fitness Machine Feature (0x2ACC) --');
  try {
    const featureChar = await service.getCharacteristic('fitness_machine_feature');
    const v = await featureChar.readValue();
    log('  raw:', hex(v.buffer));
    const machine = v.getUint32(0, true);
    const target = v.getUint32(4, true);
    log(`\n  Fitness Machine Features (0x${machine.toString(16).padStart(8, '0')}):`);
    decodeBits(machine, MACHINE_FEATURES);
    log(`\n  Target Setting Features (0x${target.toString(16).padStart(8, '0')}):`);
    decodeBits(target, TARGET_FEATURES);

    log('\n  >>> VERDICT');
    log('  ERG (Set Target Power 0x05):        ', (target >>> 3) & 1 ? 'SUPPORTED' : 'NOT supported');
    log('  Resistance (0x04):                  ', (target >>> 2) & 1 ? 'SUPPORTED' : 'NOT supported');
    log('  Simulation / grade (0x11):          ', (target >>> 13) & 1 ? 'SUPPORTED' : 'NOT supported');
  } catch (err) {
    log('  could not read 0x2ACC:', err.message);
  }

  log('\ntrainer probe done.');
}

// ------------------------------------------------------------------ click

// Constants now confirmed against OpenBikeControl's implementation, so this
// drives the real module rather than guessing at UUIDs.
let click = null;

let clickSawData = false;
let clickWatchdog = null;

async function probeClick() {
  log('\n=== CLICK PROBE ===');

  // Drop any previous connection first — re-probing without this leaves a
  // stale handle holding the device, which then reads as silent.
  if (click) {
    try { click.disconnect(); } catch { /* already gone */ }
  }
  clearTimeout(clickWatchdog);
  clickSawData = false;

  click = new ZwiftClickConnection();

  click.addEventListener('connected', (e) => log('connected:', e.detail.deviceName || '(unnamed)'));
  click.addEventListener('disconnected', () => log('disconnected.'));
  click.addEventListener('battery', (e) => { clickSawData = true; log('battery:', e.detail.level + '%'); });
  click.addEventListener('unknown-message', (e) => {
    log(`unknown msg type 0x${e.detail.type.toString(16)}: ${hex(e.detail.bytes.buffer ?? e.detail.bytes)}`);
  });
  click.addEventListener('button', (e) => {
    clickSawData = true;
    log(`  BUTTON: ${e.detail.name}  (bit ${e.detail.bit})`);
  });
  click.addEventListener('unknown-message', () => { clickSawData = true; });
  click.addEventListener('shift', (e) => {
    log(`  >>> SHIFT ${e.detail.direction.toUpperCase()}`);
  });

  await click.connect();
  log('handshake sent (RideOn).');

  // If nothing arrives within a few seconds, the connection is silent.
  clickWatchdog = setTimeout(() => {
    if (clickSawData) return;
    log('\n  !! NO DATA after handshake.');
    log('  !! This is almost always a STALE rotated address: the Click');
    log('  !! changes its Bluetooth id, and you connected to an old one.');
    log('  !! Fix: Windows Settings > Bluetooth, REMOVE every "Zwift Click"');
    log('  !! entry, toggle Bluetooth off/on, press a Click button to wake');
    log('  !! it, then re-probe and pick the freshly-listed device.');
  }, 3000);
  log('\n>>> Press the + (plus) button a few times, then the - (minus).');
  log('>>> Each press now prints a BUTTON name. Tell me which name the +');
  log('>>> button shows and which the - shows, and I lock the mapping.');
}

// ------------------------------------------------------------------- wiring

function wire(id, fn) {
  document.getElementById(id).addEventListener('click', async () => {
    try {
      await fn();
    } catch (err) {
      log('ERROR:', err.message);
    }
  });
}

wire('probe-trainer-btn', probeTrainer);
wire('probe-click-btn', probeClick);

document.getElementById('copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(logEl.textContent).then(() => log('\n(log copied)'));
});
document.getElementById('clear-btn').addEventListener('click', () => {
  logEl.textContent = '';
});

log('Ready. Chrome only. Probe the trainer first, then the Click.');
