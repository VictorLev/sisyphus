// The title and description suggested for a ride on Strava.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { suggestedTitle, suggestedDescription, partOfDay } from '../frontend/js/ui/strava-text.js';
import { setLanguageForTests } from '../frontend/js/i18n.js';

// A ride starting at a local hour in Montréal (UTC-4).
const ride = (localHour, extra = {}) => {
  const start = Date.UTC(2026, 9, 24, localHour + 4, 10);
  return { started_at: new Date(start).toISOString(), ended_at: new Date(start + 55 * 60_000).toISOString(), tz_offset_min: -240, ...extra };
};

describe('title', () => {
  test('"Indoor" + the part of the day of the ride\'s local start + "Ride"', () => {
    assert.equal(suggestedTitle(ride(7)), 'Indoor Morning Ride');
    assert.equal(suggestedTitle(ride(13)), 'Indoor Afternoon Ride');
    assert.equal(suggestedTitle(ride(18)), 'Indoor Evening Ride');
    assert.equal(suggestedTitle(ride(23)), 'Indoor Night Ride');
    assert.equal(suggestedTitle(ride(2)), 'Indoor Night Ride', 'read in the rider\'s time zone, not UTC');
  });

  test('the boundaries: morning from 5, afternoon from 12, evening from 17, night from 21', () => {
    assert.deepEqual([4, 5, 11, 12, 16, 17, 20, 21].map(partOfDay),
      ['night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night']);
  });

  test('in French', () => {
    setLanguageForTests('fr');
    try {
      assert.equal(suggestedTitle(ride(7)), 'Sortie intérieure du matin');
      assert.equal(suggestedTitle(ride(13)), "Sortie intérieure de l'après-midi");
    } finally {
      setLanguageForTests('en');
    }
  });
});

describe('description', () => {
  test('the workout, then average power, time and distance', () => {
    assert.equal(
      suggestedDescription(ride(7, { workout_name: 'Sweet Spot 3x10', avg_power: 182.4, distance_m: 26_310 })),
      'Sweet Spot 3x10\nAvg power: 182 W · Time: 55 min · Distance: 26.3 km'
    );
  });

  test('a free ride, a long ride, and a ride without power', () => {
    const long = { ...ride(7), ended_at: new Date(Date.parse(ride(7).started_at) + 95 * 60_000).toISOString(), distance_m: 50_000 };
    assert.equal(suggestedDescription(long), 'Free Ride\nTime: 1 h 35 · Distance: 50.0 km');
  });

  test('in French, with a decimal comma', () => {
    setLanguageForTests('fr');
    try {
      assert.equal(
        suggestedDescription(ride(7, { workout_name: 'Free ride', avg_power: 150, distance_m: 15_250 })),
        'Free ride\nPuissance moy. : 150 W · Durée : 55 min · Distance : 15,3 km'
      );
    } finally {
      setLanguageForTests('en');
    }
  });
});
