// Dev-only hardware probe. Not part of the app — it exists to replace the
// assumptions in PROMPT.md's Bluetooth section with facts read off the
// actual trainer, and to exercise the Control Point write path directly.

import { TrainerControl } from './ble/trainer-control.js';

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

  // Supported ranges — needed to design gears that map to real values.
  log('\n-- Supported Resistance Level Range (0x2AD6) --');
  try {
    const c = await service.getCharacteristic('supported_resistance_level_range');
    const v = await c.readValue();
    log('  raw:', hex(v.buffer));
    // SINT16 min, SINT16 max, UINT16 min-increment; all 0.1 resolution.
    log(`  min ${v.getInt16(0, true) * 0.1}  max ${v.getInt16(2, true) * 0.1}  increment ${v.getUint16(4, true) * 0.1}`);
  } catch (err) {
    log('  could not read 0x2AD6:', err.message);
  }

  log('\n-- Supported Power Range (0x2AD8) --');
  try {
    const c = await service.getCharacteristic('supported_power_range');
    const v = await c.readValue();
    log('  raw:', hex(v.buffer));
    // SINT16 min watts, SINT16 max watts, UINT16 min-increment watts.
    log(`  min ${v.getInt16(0, true)} W  max ${v.getInt16(2, true)} W  increment ${v.getUint16(4, true)} W`);
  } catch (err) {
    log('  could not read 0x2AD8:', err.message);
  }

  log('\ntrainer probe done.');
}

// ------------------------------------------------------- resistance test

// Keeps the trainer connected, takes control, and sweeps resistance so the
// rider can feel it change and confirm the 0x04 wire format via the acks.
async function testResistance() {
  log('\n=== RESISTANCE TEST ===');
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: ['fitness_machine'] }],
  });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService('fitness_machine');

  const control = new TrainerControl(service);
  control.addEventListener('ack', (e) => {
    const d = e.detail;
    log(`  ack: opcode 0x${d.reqOp.toString(16).padStart(2, '0')} -> ${d.ok ? 'OK' : 'FAIL'} (${d.message})`);
  });
  await control.init();

  log('requesting control...');
  await control.requestControl();
  log('control granted. Sweeping resistance — feel the pedals.');

  const steps = [2, 8, 14, 20, 5];
  for (const level of steps) {
    log(`  set resistance ${level.toFixed(1)} / 20.0`);
    try {
      await control.setResistance(level);
    } catch (err) {
      log('  !! ' + err.message);
      log('  !! 0x04 may want a different format; will switch to SINT16 if so.');
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  log('resistance test done. Set back to a light level.');
  try { await control.setResistance(2); } catch { /* ignore */ }
  device.gatt.disconnect();
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
wire('test-resistance-btn', testResistance);

document.getElementById('copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(logEl.textContent).then(() => log('\n(log copied)'));
});
document.getElementById('clear-btn').addEventListener('click', () => {
  logEl.textContent = '';
});

log('Ready. Chrome only. Trainer diagnostics.');
