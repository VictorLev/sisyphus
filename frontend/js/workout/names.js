import { EN } from '../i18n/en.js';
import { t, tOr } from '../i18n.js';

// Library workouts are named in the dictionaries by their stable key
// (library.json's "key", sent by the API as `key`); a rider's own workouts
// keep the name they gave them.
export function workoutName(workout) {
  if (!workout) return '';
  return workout.library && workout.key ? tOr(`library.${workout.key}`, workout.name) : workout.name;
}

// A past ride only keeps the workout's name as it was. If that is a library
// workout's English name, show it in the current language.
const libraryKeyByEnglishName = new Map(
  Object.entries(EN).filter(([key]) => key.startsWith('library.')).map(([key, name]) => [name, key])
);
export function rideName(name) {
  return name && libraryKeyByEnglishName.has(name) ? t(libraryKeyByEnglishName.get(name)) : name;
}
