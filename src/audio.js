// Section 10 (revised): a slow, warm ambient piece made live with Web Audio.
// Soft sine pads drift through four chords in D, under a generated hall reverb,
// with the occasional quiet bell note from the chord's own scale. No audio files.
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const KEY = 'samesky.muted';

// Dmaj9 -> Bm11 -> Gmaj9 -> Asus2 ; each held ~14 s and cross-faded
const CHORDS = [
  [38, 50, 54, 57, 61, 64],
  [35, 50, 54, 57, 61, 64],
  [31, 50, 54, 57, 59, 62],
  [33, 49, 52, 57, 59, 64],
];
const BELLS = [74, 76, 78, 81, 83, 86, 88]; // D major pentatonic-ish, high and sparse
const HOLD = 14;

function impulse(ac, seconds, decay) {
  const rate = ac.sampleRate, len = Math.floor(rate * seconds);
  const buf = ac.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export function createAudio() {
  let ac = null, master = null, dry = null, verb = null;
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch {}
  const LEVEL = 0.55;
  let chordIndex = 0, voices = [], bellTimer = 0, chordTimer = 0;

  function voice(m, t0, gain) {
    // two slightly detuned sines with a slow independent swell: warm, no buzz
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 5);
    const oscs = [-4, 4].map((det) => {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = midi(m);
      o.detune.value = det;
      o.connect(g);
      o.start(t0);
      return o;
    });
    const trem = ac.createOscillator();
    trem.frequency.value = 0.05 + Math.random() * 0.08;
    const tg = ac.createGain();
    tg.gain.value = gain * 0.35;
    trem.connect(tg); tg.connect(g.gain);
    trem.start(t0);
    oscs.push(trem);
    g.connect(dry);
    g.connect(verb);
    return { g, oscs };
  }

  function playChord() {
    const now = ac.currentTime;
    voices.forEach((v) => {
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setValueAtTime(v.g.gain.value, now);
      v.g.gain.linearRampToValueAtTime(0, now + 6);
      v.oscs.forEach((o) => o.stop(now + 6.2));
    });
    const notes = CHORDS[chordIndex % CHORDS.length];
    voices = notes.map((m, i) => voice(m, now + i * 0.35, (m < 45 ? 0.05 : 0.028)));
    chordIndex++;
    chordTimer = setTimeout(playChord, HOLD * 1000);
  }

  function bell(m, vol) {
    if (!ac) return;
    const now = ac.currentTime;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
    // a sine plus a quiet inharmonic partial reads as a soft glass bell
    [[1, 1], [2.76, 0.18]].forEach(([ratio, amp]) => {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = midi(m) * ratio;
      const og = ac.createGain();
      og.gain.value = amp;
      o.connect(og); og.connect(g);
      o.start(now); o.stop(now + 3.3);
    });
    g.connect(dry);
    g.connect(verb);
  }

  function bells() {
    if (!muted) bell(BELLS[Math.floor(Math.random() * BELLS.length)], 0.012 + Math.random() * 0.016);
    bellTimer = setTimeout(bells, 2800 + Math.random() * 6500);
  }

  function start() {
    if (ac) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    if (ac.state === 'suspended') ac.resume();
    master = ac.createGain();
    master.gain.value = 0;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    master.connect(comp); comp.connect(ac.destination);

    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.connect(master);

    dry = ac.createGain();
    dry.gain.value = 0.55;
    dry.connect(lp);
    verb = ac.createConvolver();
    verb.buffer = impulse(ac, 5.5, 2.6);
    const wet = ac.createGain();
    wet.gain.value = 0.9;
    verb.connect(wet); wet.connect(lp);

    playChord();
    setTimeout(bells, 4000);
    if (!muted) master.gain.setTargetAtTime(LEVEL, ac.currentTime, 1.6); // ~5 s fade in
  }

  function pluck() {
    if (!ac || muted) return;
    // a tap rings a bell from the current chord, a little brighter than the ambient ones
    bell(86, 0.05);
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem(KEY, m ? '1' : '0'); } catch {}
    if (ac) {
      if (ac.state === 'suspended') ac.resume();
      master.gain.cancelScheduledValues(ac.currentTime);
      master.gain.setTargetAtTime(m ? 0 : LEVEL, ac.currentTime, m ? 0.15 : 0.8);
    }
  }

  // iOS suspends audio when the page is hidden; pick it back up on return
  document.addEventListener('visibilitychange', () => {
    if (ac && document.visibilityState === 'visible' && ac.state !== 'running') ac.resume();
  });

  return { start, pluck, bell, setMuted, get muted() { return muted; } };
}
