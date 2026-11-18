import { formatTime, getClock, getCues } from './timer.mjs';

const $ = id => document.getElementById(id);
const key = 'bouldering-timer-v1';
const displayOnly = new URLSearchParams(location.search).has('display');
const defaults = { duration: 300_000, rotations: 0, tenSecond: false, volume: 80, startedAt: null, elapsed: 0, audioOwner: null };
const windowId = crypto.randomUUID?.() ?? String(Math.random());
const labels = { ready: 'Готов к старту', climbing: 'Ротация', cleaning: 'Чистка трасс', finished: 'Раунд завершён' };
const signals = {
  start: [[0, 1000, .12], [.22, 1000, .12]],
  warning: [[0, 750, .16]],
  stop: [[0, 500, .55]],
};
let state = { ...defaults };
let audio;
let volume;
let scheduledThrough = 0;
const pending = new Set();
let wakeLock;
let wantsWakeLock = false;
let sawFullscreen = false;

try {
  const saved = localStorage.getItem(key);
  if (saved) state = { ...defaults, ...JSON.parse(saved) };
} catch { /* The timer can run without browser storage. */ }

const scoreboard = $('scoreboard');
const clocks = Array.from(document.querySelectorAll('[data-clock]'), element => ({
  element,
  label: element.querySelector('[data-label]'),
  round: element.querySelector('[data-round]'),
  time: element.querySelector('[data-time]'),
  progress: element.querySelector('[data-progress]'),
}));

function writeText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function showMessage(message = '') {
  $('message').textContent = message;
  $('message').hidden = !message;
}

function save() {
  localStorage.setItem(key, JSON.stringify(state));
}

function update(patch) {
  Object.assign(state, patch);
  try { save(); } catch { /* Single-screen mode still works. */ }
  render();
}

function render() {
  const clock = getClock(state, Date.now());
  const running = state.startedAt !== null && clock.phase !== 'finished';
  const paused = !running && clock.phase !== 'ready' && clock.phase !== 'finished';
  const label = paused ? `Пауза · ${labels[clock.phase].toLowerCase()}` : labels[clock.phase];
  const button = running ? 'Пауза' : paused ? 'Продолжить' : clock.phase === 'finished' ? 'Новый старт' : 'Старт';

  for (const view of clocks) {
    view.element.dataset.phase = clock.phase;
    writeText(view.label, label);
    writeText(view.round, `Ротация ${clock.rotation}${state.rotations ? ` из ${state.rotations}` : ''}`);
    writeText(view.time, formatTime(clock.remaining));
    view.progress.style.transform = `scaleX(${clock.remaining / clock.total})`;
  }
  if (!displayOnly) {
    writeText($('toggle'), button);
    writeText($('board-toggle'), button);
    $('reset').disabled = clock.phase === 'ready';
    $('timing').disabled = clock.phase !== 'ready';
    $('ten-second').disabled = clock.phase !== 'ready';
    $('test-sound').disabled = running && state.audioOwner === windowId && audio?.state === 'running';
    writeText($('test-sound'), running ? 'Включить звук' : 'Проверить звук');
  }
  setWakeLock(running && !document.hidden);
}

function syncSettings() {
  $('duration').value = state.duration / 1000;
  $('rotations').value = state.rotations;
  $('ten-second').checked = state.tenSecond;
  $('volume').value = state.volume;
  writeText($('volume-value'), `${state.volume}%`);
  if (volume) volume.gain.value = state.volume / 100;
}

async function setWakeLock(wanted) {
  if (!navigator.wakeLock || wanted === wantsWakeLock) return;
  wantsWakeLock = wanted;
  if (!wanted) {
    wakeLock?.release().catch(() => {});
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    if (!wantsWakeLock) await wakeLock.release();
  }
  catch { /* The operating system may deny the request. */ }
}

async function enableAudio() {
  if (!audio) {
    audio = new AudioContext();
    volume = audio.createGain();
    volume.gain.value = state.volume / 100;
    volume.connect(audio.destination);
    audio.addEventListener('statechange', () => {
      if (audio.state !== 'running') {
        cancelCues();
        scheduledThrough = getClock(state, Date.now()).time;
      }
    });
  }
  await audio.resume();
  if (audio.state !== 'running') throw new Error('Audio is unavailable');
}

function play(sound, at) {
  for (const [delay, frequency, length] of signals[sound]) {
    const time = at + delay;
    const tone = audio.createOscillator();
    const envelope = audio.createGain();
    tone.type = 'triangle';
    tone.frequency.value = frequency;
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(.65, time + .006);
    envelope.gain.setValueAtTime(.65, time + length - .018);
    envelope.gain.linearRampToValueAtTime(0, time + length);
    tone.connect(envelope).connect(volume);
    tone.start(time);
    tone.stop(time + length);
    pending.add(tone);
    tone.onended = () => { pending.delete(tone); tone.disconnect(); envelope.disconnect(); };
  }
}

function cancelCues() {
  for (const tone of pending) tone.stop();
  pending.clear();
}

function scheduleCues() {
  if (state.audioOwner !== windowId || audio?.state !== 'running' || state.startedAt === null) return;
  const { time } = getClock(state, Date.now());
  // Web Audio keeps queued cues on time while the operator window is in the background.
  const through = time + 125_000;
  const at = audio.currentTime;
  for (const cue of getCues(state, Math.max(scheduledThrough, time - 500), through)) {
    play(cue.sound, at + Math.max(.025, (cue.time - time) / 1000));
  }
  scheduledThrough = through;
}

async function toggleTimer() {
  const clock = getClock(state, Date.now());
  if (state.startedAt !== null && clock.phase !== 'finished') {
    cancelCues();
    update({ startedAt: null, elapsed: Math.max(1, clock.time) });
    return;
  }
  cancelCues();
  showMessage();
  const elapsed = clock.phase === 'finished' ? 0 : state.elapsed;
  const startedAt = Date.now();
  scheduledThrough = elapsed || -1;
  update({ startedAt, elapsed, audioOwner: windowId });
  try {
    await enableAudio();
    if (state.startedAt === startedAt) scheduleCues();
  } catch {
    showMessage('Браузер пока не воспроизводит сигналы. Нажмите «Включить звук» на пульте.');
  }
}

function showScoreboard() {
  scoreboard.hidden = false;
  $('operator').hidden = true;
  if (!displayOnly) $('board-toggle').hidden = false;
}

function hideScoreboard() {
  scoreboard.hidden = true;
  $('operator').hidden = false;
  $('operator-fullscreen').focus();
}

async function openFullscreen() {
  showScoreboard();
  writeText($('board-fullscreen'), displayOnly ? 'На весь экран' : 'К пульту');
  try { await scoreboard.requestFullscreen(); }
  catch { /* The board still fills the browser window. */ }
}

document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement === scoreboard) {
    sawFullscreen = true;
    writeText($('board-fullscreen'), displayOnly ? 'Выйти из полноэкранного режима' : 'К пульту');
  } else if (sawFullscreen) {
    sawFullscreen = false;
    if (displayOnly) writeText($('board-fullscreen'), 'На весь экран');
    else hideScoreboard();
  }
});

$('board-fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (displayOnly) openFullscreen();
  else hideScoreboard();
});

window.addEventListener('storage', event => {
  if (event.key !== key || !event.newValue) return;
  const next = JSON.parse(event.newValue);
  if (!displayOnly) {
    if (next.startedAt !== state.startedAt || next.elapsed !== state.elapsed || next.audioOwner !== state.audioOwner) {
      cancelCues();
    }
    state = next;
    syncSettings();
  } else {
    state = next;
  }
  render();
});

if (displayOnly) {
  showScoreboard();
} else {
  syncSettings();
  $('duration').addEventListener('change', event => update({ duration: Number(event.target.value) * 1000 }));
  $('rotations').addEventListener('change', event => {
    const rotations = Math.max(0, Math.min(999, Math.trunc(event.target.valueAsNumber) || 0));
    event.target.value = rotations;
    update({ rotations });
  });
  $('ten-second').addEventListener('change', event => update({ tenSecond: event.target.checked }));
  $('volume').addEventListener('input', event => {
    update({ volume: Number(event.target.value) });
    syncSettings();
  });
  $('toggle').addEventListener('click', toggleTimer);
  $('board-toggle').addEventListener('click', toggleTimer);
  $('reset').addEventListener('click', () => {
    cancelCues();
    update({ startedAt: null, elapsed: 0 });
    showMessage();
  });
  $('test-sound').addEventListener('click', async () => {
    showMessage();
    try {
      await enableAudio();
      if (state.startedAt !== null && getClock(state, Date.now()).phase !== 'finished') {
        scheduledThrough = getClock(state, Date.now()).time;
        update({ audioOwner: windowId });
        scheduleCues();
      } else {
        cancelCues();
        for (const [index, sound] of Object.keys(signals).entries()) play(sound, audio.currentTime + .04 + index * .8);
      }
    } catch {
      showMessage('Звук недоступен. Проверьте настройки браузера и аудиовыход компьютера.');
    }
  });
  $('operator-fullscreen').addEventListener('click', openFullscreen);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !scoreboard.hidden && !document.fullscreenElement) hideScoreboard();
  });
  $('open-display').addEventListener('click', () => {
    showMessage();
    try { save(); }
    catch {
      showMessage('Для второго окна нужно разрешить локальное хранилище браузера.');
      return;
    }
    const url = new URL(location.href);
    url.searchParams.set('display', '');
    if (!window.open(url, 'bouldering-scoreboard', 'popup,width=1000,height=680')) {
      showMessage('Браузер заблокировал второе окно. Разрешите всплывающие окна для таймера.');
    }
  });
  setInterval(scheduleCues, 1000);
}

document.addEventListener('visibilitychange', () => {
  render();
  if (!displayOnly) scheduleCues();
});
render();
setInterval(render, 100);
