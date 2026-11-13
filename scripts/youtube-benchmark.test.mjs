import assert from 'node:assert/strict';
import {test} from 'node:test';
import {distribution, playbackVerified} from './youtube-benchmark-lib.mjs';

const state = time => ({hostname: 'www.youtube.com', pathname: '/watch', video_id: 'selected',
  player_video_id: 'selected', ad_showing: false,
  video: {current_time: time, paused: false, ended: false, ready_state: 4}});
test('playback requires progress in the selected content, not merely a watch URL', () => {
  assert(playbackVerified(state(2), state(3.2), 'selected'));
  assert(!playbackVerified(state(2), state(2), 'selected'));
  assert(!playbackVerified(state(2), state(3.2), 'other'));
  assert(!playbackVerified(state(2), {...state(3.2), player_video_id: 'other'}, 'selected'));
  assert(!playbackVerified(state(2), {...state(3.2), hostname: 'example.com'}, 'selected'));
});
test('ads, paused or ended media, and buffering are not verified playback', () => {
  assert(!playbackVerified(undefined, state(3.2), 'selected'));
  assert(!playbackVerified(state(2), {...state(3.2), video: null}, 'selected'));
  assert(!playbackVerified(state(2), {...state(3.2), ad_showing: true}, 'selected'));
  for (const patch of [{paused: true}, {ended: true}, {ready_state: 1}, {current_time: NaN}]) {
    assert(!playbackVerified(state(2), {...state(3.2), video: {...state(3.2).video, ...patch}}, 'selected'));
  }
});
test('empty and small run summaries use observed samples without inventing a p95', () => {
  assert.equal(distribution([]), null);
  assert.deepEqual(distribution([40, 10, 30, 20]), {samples: 4, min_ms: 10, median_ms: 25, p95_ms: 40, max_ms: 40});
});
