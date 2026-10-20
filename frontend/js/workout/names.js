import { EN } from '../i18n/en.js';
import { t, tOr } from '../i18n.js';

// "My First Ride", given to every new account (backend/src/db/first-ride.js),
// is saved in English; until the rider renames it, it reads in their
// language.
const FIRST_RIDE_NAME = 'My First Ride';

// Library workouts are named in the dictionaries by their stable key
// (library.json's "key", sent by the API as `key`); a rider's own workouts
// keep the name they gave them.
export function workoutName(workout) {
  if (!workout) return '';
  if (workout.library && workout.key) return tOr(`library.${workout.key}`, workout.name);
  return workout.name === FIRST_RIDE_NAME ? t('workout.firstRide') : workout.name;
}

// A past ride only keeps the workout's name as it was. If that is a library
// workout's English name, show it in the current language.
const libraryKeyByEnglishName = new Map(
  Object.entries(EN).filter(([key]) => key.startsWith('library.')).map(([key, name]) => [name, key])
);
export function rideName(name) {
  if (name === FIRST_RIDE_NAME) return t('workout.firstRide');
  return name && libraryKeyByEnglishName.has(name) ? t(libraryKeyByEnglishName.get(name)) : name;
}
