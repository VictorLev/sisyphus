import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseYouTube, parseSceneryList, pickScenery, sceneryRows, serializeSceneryRows, nextScenery, DEFAULT_SCENERY_LINK } from '../frontend/js/ui/scenery.js';

describe('parseYouTube', () => {
  test('reads the video from a watch link, ignoring playlist parameters', () => {
    assert.deepEqual(
      parseYouTube('https://www.youtube.com/watch?v=D6tC1pyrsTM&list=PLiNcRO_l_QWfhgFUDiBBaJ5NEF7xyfb_f&index=1'),
      { id: 'D6tC1pyrsTM', start: 0 }
    );
  });

  test('accepts the other link shapes', () => {
    for (const link of [
      'https://youtu.be/D6tC1pyrsTM',
      'https://m.youtube.com/watch?v=D6tC1pyrsTM',
      'https://www.youtube.com/embed/D6tC1pyrsTM',
      'https://www.youtube.com/live/D6tC1pyrsTM',
      'https://www.youtube-nocookie.com/embed/D6tC1pyrsTM',
    ]) {
      assert.equal(parseYouTube(link)?.id, 'D6tC1pyrsTM', link);
    }
  });

  test('keeps a start time in any of its forms', () => {
    assert.equal(parseYouTube('https://youtu.be/D6tC1pyrsTM?t=90').start, 90);
    assert.equal(parseYouTube('https://youtu.be/D6tC1pyrsTM?t=90s').start, 90);
    assert.equal(parseYouTube('https://www.youtube.com/watch?v=D6tC1pyrsTM&t=1h2m3s').start, 3723);
  });

  test('rejects anything that is not a YouTube video', () => {
    assert.equal(parseYouTube('not a link'), null);
    assert.equal(parseYouTube('https://vimeo.com/12345'), null);
    assert.equal(parseYouTube('https://www.youtube.com/watch?v=short'), null);
    assert.equal(parseYouTube('https://www.youtube.com/playlist?list=PLiNcRO_l_QWfhgFUDiBBaJ5NEF7xyfb_f'), null);
  });
});

describe('parseSceneryList', () => {
  test('one video per line, named or numbered, skipping junk', () => {
    const videos = parseSceneryList([
      'Swiss Alps | https://youtu.be/D6tC1pyrsTM',
      '',
      'just a note',
      'https://www.youtube.com/watch?v=abcdefghijk',
    ].join('\n'));
    assert.deepEqual(videos.map((v) => [v.name, v.id]), [
      ['Swiss Alps', 'D6tC1pyrsTM'],
      ['Scenery 2', 'abcdefghijk'],
    ]);
  });

  test('separated by commas, named or not', () => {
    const videos = parseSceneryList('Swiss Alps | https://youtu.be/D6tC1pyrsTM, https://youtu.be/abcdefghijk,Dolomites | https://www.youtube.com/watch?v=ABCDEFGHIJK&t=90');
    assert.deepEqual(videos.map((v) => [v.name, v.id, v.start]), [
      ['Swiss Alps', 'D6tC1pyrsTM', 0],
      ['Scenery 2', 'abcdefghijk', 0],
      ['Dolomites', 'ABCDEFGHIJK', 90],
    ]);
  });

  test('lists saved one per line before still work, even mixed with commas', () => {
    const videos = parseSceneryList('https://youtu.be/D6tC1pyrsTM\nhttps://youtu.be/abcdefghijk, https://youtu.be/ABCDEFGHIJK');
    assert.equal(videos.length, 3);
  });

  test('an empty or missing list is no videos', () => {
    assert.deepEqual(parseSceneryList(''), []);
    assert.deepEqual(parseSceneryList(undefined), []);
  });
});

describe('pickScenery', () => {
  const list = parseSceneryList('A | https://youtu.be/aaaaaaaaaaa, B | https://youtu.be/bbbbbbbbbbb, C | https://youtu.be/ccccccccccc');

  test('picks at random across the list', () => {
    assert.equal(pickScenery(list, null, () => 0).name, 'A');
    assert.equal(pickScenery(list, null, () => 0.5).name, 'B');
    assert.equal(pickScenery(list, null, () => 0.99).name, 'C');
  });

  test('never repeats the last video when there is another', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      assert.notEqual(pickScenery(list, 'bbbbbbbbbbb', () => r).id, 'bbbbbbbbbbb');
    }
    const one = list.slice(0, 1);
    assert.equal(pickScenery(one, 'aaaaaaaaaaa').id, 'aaaaaaaaaaa', 'with only one, it plays again');
    assert.equal(pickScenery([], null), null);
  });
});

describe('the scenery editor\'s rows', () => {
  test('saved text becomes name and link rows, and back', () => {
    const text = 'Alps | https://youtu.be/aaaaaaaaaaa, https://youtu.be/bbbbbbbbbbb';
    const rows = sceneryRows(text);
    assert.deepEqual(rows, [
      { name: 'Alps', link: 'https://youtu.be/aaaaaaaaaaa' },
      { name: '', link: 'https://youtu.be/bbbbbbbbbbb' },
    ]);
    assert.equal(serializeSceneryRows(rows), text);
  });

  test('a comma or bar in a name cannot split the list; empty rows are dropped', () => {
    const text = serializeSceneryRows([
      { name: 'Alps, Switzerland', link: 'https://youtu.be/aaaaaaaaaaa' },
      { name: 'nothing here', link: '  ' },
      { name: 'A | B', link: ' https://youtu.be/bbbbbbbbbbb ' },
    ]);
    assert.deepEqual(parseSceneryList(text).map((v) => [v.name, v.id]), [
      ['Alps - Switzerland', 'aaaaaaaaaaa'],
      ['A - B', 'bbbbbbbbbbb'],
    ]);
  });
});

describe('ride order', () => {
  const videos = ['a', 'b', 'c'].map((id) => ({ id }));

  test('in order plays the one after last time\'s, wrapping around', () => {
    assert.equal(nextScenery(videos, null).id, 'a');
    assert.equal(nextScenery(videos, 'a').id, 'b');
    assert.equal(nextScenery(videos, 'c').id, 'a');
    assert.equal(nextScenery(videos, 'gone').id, 'a', 'a video no longer listed starts over');
    assert.equal(nextScenery([], 'a'), null);
  });

  test('the default ride is a valid link, the same one new accounts get', () => {
    assert.deepEqual(parseYouTube(DEFAULT_SCENERY_LINK), { id: 'D6tC1pyrsTM', start: 60 });
    // Read as text: importing the route would open a database.
    const source = readFileSync(new URL('../backend/src/routes/config.js', import.meta.url), 'utf8');
    assert.ok(source.includes(`scenery_videos: '${DEFAULT_SCENERY_LINK}'`));
  });
});
