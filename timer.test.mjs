import assert from 'node:assert/strict';
import { formatTime, getClock, getCues } from './timer.mjs';

const settings = { duration: 240_000, rotations: 2, tenSecond: false };
const state = { ...settings, startedAt: 1000, elapsed: 0 };
const at = time => getClock(state, state.startedAt + time);

assert.equal(at(239_999).phase, 'climbing');
assert.equal(formatTime(at(239_999).remaining), '00:01');
assert.equal(at(240_000).phase, 'cleaning');
assert.equal(formatTime(at(240_000).remaining), '00:15');
assert.equal(at(255_000).rotation, 2);
assert.equal(formatTime(at(255_000).remaining), '04:00');
assert.equal(at(495_000).phase, 'finished');
assert.equal(getClock({ ...state, rotations: 0 }, 1_000 + 510_000).rotation, 3);

const paused = { ...state, startedAt: null, elapsed: 245_000 };
assert.equal(getClock(paused, 100_000).remaining, 10_000);
assert.equal(getClock({ ...paused, startedAt: 1_000 }, 11_000).rotation, 2);

assert.deepEqual(getCues(settings, -1, 510_000), [
  { time: 0, sound: 'start' },
  { time: 180_000, sound: 'warning' },
  { time: 240_000, sound: 'stop' },
  { time: 255_000, sound: 'start' },
  { time: 435_000, sound: 'warning' },
  { time: 495_000, sound: 'stop' },
]);
assert.deepEqual(getCues({ ...settings, tenSecond: true }, 180_000, 230_000), [{ time: 230_000, sound: 'warning' }]);
assert.deepEqual(getCues(settings, 180_000, 239_999), []);
