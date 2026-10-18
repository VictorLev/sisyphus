// Workout files: export and import, as CSV (edit it in a spreadsheet) or as
// Zwift's .zwo (the common workout format, also read and written by
// TrainerRoad, intervals.icu and others). Both carry targets as % of FTP,
// like Sisyphus itself, so a file means the same thing for every rider.
//
// Pure functions, no DOM: the Workouts page calls them, the tests too.

import { t } from '../i18n.js';

const pctOf = (watts, ftp) => Math.round((watts / ftp) * 1000) / 10;
const round1 = (n) => Math.round(n * 10) / 10;

// --------------------------------------------------------------------- CSV

// One row per segment. The workout column lets one file hold many
// workouts (Export all) and keeps a single workout's name with it.
const CSV_HEADER = ['workout', 'label', 'duration_sec', 'ftp_pct', 'grade_pct'];

function csvField(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(workouts) {
  const rows = [CSV_HEADER.join(',')];
  for (const workout of [].concat(workouts)) {
    for (const seg of workout.structure) {
      rows.push([
        workout.name,
        seg.label ?? '',
        seg.duration_sec,
        seg.target_ftp_pct,
        seg.grade_percent ? seg.grade_percent : '',
      ].map(csvField).join(','));
    }
  }
  return `${rows.join('\n')}\n`;
}

// RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside
// quotes. Returns rows of strings with their 1-based line numbers.
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else { if (c === '\n') line++; field += c; }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push({ cells: row, line: rowLine });
      row = []; field = ''; line++; rowLine = line;
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push({ cells: row, line: rowLine });
  return rows;
}

// Accepted column names (case and spacing don't matter).
const COLUMNS = {
  workout: ['workout', 'name', 'workout_name'],
  label: ['label', 'segment', 'step', 'description'],
  duration: ['duration_sec', 'duration', 'seconds', 'duration_s', 'time'],
  pct: ['ftp_pct', '%ftp', 'pct_ftp', 'percent_ftp', 'ftp_percent', 'power_pct', 'intensity'],
  watts: ['watts', 'target_watts', 'power', 'power_w'],
  grade: ['grade_pct', 'grade', 'grade_percent', 'slope'],
};

// "300", "5:00" and "1:02:30" are all durations.
function parseDuration(text) {
  const t = text.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));
  const parts = t.split(':');
  if (parts.length >= 2 && parts.length <= 3 && parts.every((p) => /^\d+$/.test(p))) {
    return parts.reduce((sum, p) => sum * 60 + Number(p), 0);
  }
  return NaN;
}

export function fromCsv(text, { ftp = 200, fallbackName = 'Imported workout' } = {}) {
  const rows = parseCsvRows(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error(t('file.csvEmpty'));

  const header = rows[0].cells.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const col = (kind) => header.findIndex((h) => COLUMNS[kind].includes(h));
  const at = { workout: col('workout'), label: col('label'), duration: col('duration'), pct: col('pct'), watts: col('watts'), grade: col('grade') };
  if (at.duration === -1) throw new Error(t('file.noDuration'));
  if (at.pct === -1 && at.watts === -1) throw new Error(t('file.noTarget'));

  const byName = new Map();
  for (const { cells, line } of rows.slice(1)) {
    const get = (i) => (i === -1 ? '' : (cells[i] ?? '').trim());
    const duration = parseDuration(get(at.duration));
    if (!Number.isInteger(duration) || duration <= 0) throw new Error(t('file.badDuration', { line }));

    let pct;
    if (get(at.pct) !== '') pct = Number(get(at.pct).replace('%', ''));
    else if (get(at.watts) !== '') pct = pctOf(Number(get(at.watts)), ftp);
    if (!Number.isFinite(pct) || pct < 0 || pct > 300) throw new Error(t('file.badTarget', { line }));

    const segment = { duration_sec: duration, target_ftp_pct: round1(pct), label: get(at.label) };
    const grade = get(at.grade) === '' ? 0 : Number(get(at.grade).replace('%', ''));
    if (!Number.isFinite(grade) || grade < -20 || grade > 20) throw new Error(t('file.badGrade', { line }));
    if (grade) segment.grade_percent = grade;

    const name = get(at.workout) || fallbackName;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(segment);
  }
  return [...byName].map(([name, structure]) => ({ name, structure }));
}

// --------------------------------------------------------------------- ZWO

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescapeXml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

// Zwift has no terrain in workouts, so grades are not exported.
export function toZwo(workout) {
  const steps = workout.structure.map((seg) => {
    const power = (seg.target_ftp_pct / 100).toFixed(3);
    const text = seg.label ? `\n      <textevent timeoffset="0" message="${escapeXml(seg.label)}"/>\n    ` : '';
    return text
      ? `    <SteadyState Duration="${seg.duration_sec}" Power="${power}">${text}</SteadyState>`
      : `    <SteadyState Duration="${seg.duration_sec}" Power="${power}"/>`;
  });
  return [
    '<workout_file>',
    '  <author>Sisyphus</author>',
    `  <name>${escapeXml(workout.name)}</name>`,
    '  <description></description>',
    '  <sportType>bike</sportType>',
    '  <workout>',
    ...steps,
    '  </workout>',
    '</workout_file>',
    '',
  ].join('\n');
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g)) out[m[1].toLowerCase()] = unescapeXml(m[2]);
  return out;
}

// A ramp (Zwift's Warmup, Cooldown and Ramp) as steps of about a minute,
// since a Sisyphus segment holds one target.
function rampSteps(duration, low, high, label) {
  const count = Math.max(1, Math.min(20, Math.round(duration / 60)));
  const steps = [];
  let used = 0;
  for (let i = 0; i < count; i++) {
    const length = i === count - 1 ? duration - used : Math.round(duration / count);
    used += length;
    const pct = (low + (high - low) * ((i + 0.5) / count)) * 100;
    steps.push({ duration_sec: length, target_ftp_pct: round1(pct), label });
  }
  return steps.filter((s) => s.duration_sec > 0);
}

export function fromZwo(text, { fallbackName = 'Imported workout' } = {}) {
  if (!/<workout_file[\s>]/i.test(text)) throw new Error(t('file.notZwo'));
  const name = unescapeXml((text.match(/<name>([\s\S]*?)<\/name>/i)?.[1] ?? '').trim()) || fallbackName;
  const body = text.match(/<workout>([\s\S]*?)<\/workout>/i)?.[1];
  if (body == null) throw new Error(t('file.noWorkoutSection'));

  const structure = [];
  // Each step: a self-closing tag, or an open tag with text events inside.
  const stepPattern = /<(\w+)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  for (const m of body.matchAll(stepPattern)) {
    const type = m[1].toLowerCase();
    const a = attrs(m[2]);
    const message = m[4] ? unescapeXml(m[4].match(/message\s*=\s*"([^"]*)"/i)?.[1] ?? '') : '';
    const duration = Math.round(Number(a.duration));
    const power = (key) => Number(a[key]);

    if (type === 'steadystate') {
      if (!(duration > 0)) continue;
      const p = Number.isFinite(power('power')) ? power('power') : (power('powerlow') + power('powerhigh')) / 2;
      structure.push({ duration_sec: duration, target_ftp_pct: round1(p * 100), label: message || 'Steady' });
    } else if (type === 'warmup' || type === 'cooldown' || type === 'ramp') {
      if (!(duration > 0)) continue;
      const fallback = type === 'warmup' ? 'Warmup' : type === 'cooldown' ? 'Cooldown' : 'Ramp';
      structure.push(...rampSteps(duration, power('powerlow'), power('powerhigh'), message || fallback));
    } else if (type === 'intervalst') {
      const repeat = Math.max(1, Math.round(Number(a.repeat) || 1));
      const on = Math.round(Number(a.onduration));
      const off = Math.round(Number(a.offduration));
      for (let i = 0; i < repeat; i++) {
        if (on > 0) structure.push({ duration_sec: on, target_ftp_pct: round1(power('onpower') * 100), label: message || 'On' });
        if (off > 0) structure.push({ duration_sec: off, target_ftp_pct: round1(power('offpower') * 100), label: 'Off' });
      }
    } else if (type === 'freeride') {
      if (duration > 0) structure.push({ duration_sec: duration, target_ftp_pct: 60, label: message || 'Free ride' });
    } else if (type === 'maxeffort') {
      if (duration > 0) structure.push({ duration_sec: duration, target_ftp_pct: 150, label: message || 'Max effort' });
    }
  }
  if (structure.length === 0) throw new Error(t('file.noSteps'));
  if (structure.some((s) => !Number.isFinite(s.target_ftp_pct))) throw new Error(t('file.noPower'));
  return [{ name, structure }];
}

// Picks the format from the file name or its content.
export function parseWorkoutFile(fileName, text, options = {}) {
  const fallbackName = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || undefined;
  const opts = { ...options, fallbackName: options.fallbackName ?? fallbackName };
  if (/\.zwo$/i.test(fileName) || /^\s*(<\?xml[^>]*>\s*)?<workout_file/i.test(text)) return fromZwo(text, opts);
  return fromCsv(text, opts);
}

export function fileSlug(name) {
  return String(name).normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'workout';
}
