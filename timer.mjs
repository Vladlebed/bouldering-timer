export const CLEANING = 15_000;

export function getClock(state, now) {
  const { duration, rotations, startedAt, elapsed } = state;
  const time = elapsed + (startedAt === null ? 0 : Math.max(0, now - startedAt));
  const period = duration + CLEANING;
  const rotation = 1 + Math.floor(time / period);
  const offset = time % period;

  if (rotations && time >= (rotations - 1) * period + duration) {
    return { phase: 'finished', rotation: rotations, remaining: 0, total: duration, time };
  }
  const cleaning = offset >= duration;
  const phase = cleaning ? 'cleaning' : 'climbing';
  return {
    phase: startedAt === null && time === 0 ? 'ready' : phase,
    rotation,
    remaining: (cleaning ? period : duration) - offset,
    total: cleaning ? CLEANING : duration,
    time,
  };
}

export function getCues({ duration, rotations, tenSecond }, after, through) {
  const period = duration + CLEANING;
  const cues = [];
  for (let round = Math.max(0, Math.floor(after / period)); round * period <= through; round++) {
    if (rotations && round >= rotations) break;
    const start = round * period;
    const events = [
      [start, 'start'],
      [start + duration - 60_000, 'warning'],
      ...(tenSecond ? [[start + duration - 10_000, 'warning']] : []),
      [start + duration, 'stop'],
    ];
    for (const [time, sound] of events) {
      if (time > after && time <= through) cues.push({ time, sound });
    }
  }
  return cues;
}

export function formatTime(remaining) {
  const seconds = Math.ceil(remaining / 1000);
  return [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
}
