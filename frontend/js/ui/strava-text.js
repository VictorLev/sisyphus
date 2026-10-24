// The title and description Sisyphus suggests for a ride on Strava, in the
// rider's language. The rider can change both before pasting them.
//   Title:       "Indoor Morning Ride" (by the ride's local start time)
//   Description: the workout's name (or "Free ride"), then one line per
//                stat, as on the summary screen: time, distance, average
//                and max power, average cadence and speed

import { t, num } from '../i18n.js';
import { rideName } from '../workout/names.js';

// Local hour the ride started, in the rider's time zone as saved with the
// ride (else this browser's).
function localHour(session) {
  const start = Date.parse(session.started_at);
  if (Number.isInteger(session.tz_offset_min)) return new Date(start + session.tz_offset_min * 60_000).getUTCHours();
  return new Date(start).getHours();
}

export function partOfDay(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export function suggestedTitle(session) {
  return t(`stravaText.title.${partOfDay(localHour(session))}`);
}

function duration(session) {
  const minutes = Math.round((Date.parse(session.ended_at) - Date.parse(session.started_at)) / 60_000);
  if (!(minutes > 0)) return null;
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

// A stat the ride doesn't have (no power from the trainer, say) is left out.
export function suggestedDescription(session) {
  const stats = [];
  const time = duration(session);
  if (time) stats.push(t('stravaText.time', { time }));
  if (session.distance_m != null) stats.push(t('stravaText.distance', { km: num(session.distance_m / 1000, 1) }));
  if (session.avg_power != null) stats.push(t('stravaText.avgPower', { watts: Math.round(session.avg_power) }));
  if (session.max_power != null) stats.push(t('stravaText.maxPower', { watts: Math.round(session.max_power) }));
  if (session.avg_cadence != null) stats.push(t('stravaText.avgCadence', { rpm: Math.round(session.avg_cadence), unit: t('unit.rpm') }));
  if (session.avg_speed != null) stats.push(t('stravaText.avgSpeed', { kmh: num(session.avg_speed, 1) }));
  const name = rideName(session.workout_name) || t('home.freeRide');
  return [name, ...stats].join('\n');
}
