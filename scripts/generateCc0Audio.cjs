const fs = require('fs');
const path = require('path');

const bgmDir = path.join(__dirname, '..', 'public', 'Audio', 'bgm');
const sfxDir = path.join(__dirname, '..', 'public', 'Audio', 'sfx');

fs.mkdirSync(bgmDir, { recursive: true });
fs.mkdirSync(sfxDir, { recursive: true });

function createWavBuffer(durationSec, sampleRate, sampleGenerator) {
  const numSamples = Math.floor(sampleRate * durationSec);
  const buffer = Buffer.alloc(44 + numSamples * 2);

  // RIFF Header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // subchunk1size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // audio format (1 = PCM)
  buffer.writeUInt16LE(1, 22); // num channels (1 = mono)
  buffer.writeUInt32LE(sampleRate, 24); // sample rate
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate (sampleRate * numChannels * bitsPerSample/8)
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const progress = t / durationSec;
    const val = sampleGenerator(t, progress);
    const clamped = Math.max(-1, Math.min(1, val));
    const int16 = Math.floor(clamped * 32767);
    buffer.writeInt16LE(int16, 44 + i * 2);
  }

  return buffer;
}

// ─────────────────────────────────────────────
// BGM Generators (Harmonic, warm, loopable, ~10-12s)
// ─────────────────────────────────────────────

// 1. Calm Piano: C - G - Am - F gentle arpeggio with soft decay
const calmPiano = createWavBuffer(12.0, 22050, (t, p) => {
  const chordTimes = [0, 3, 6, 9];
  const chordNotes = [
    [261.63, 329.63, 392.0, 523.25], // C major
    [196.0, 246.94, 293.66, 392.0],  // G major
    [220.0, 261.63, 329.63, 440.0],  // A minor
    [174.61, 220.0, 261.63, 349.23], // F major
  ];
  let val = 0;
  for (let c = 0; c < 4; c++) {
    const dt = t - chordTimes[c];
    if (dt >= 0 && dt < 4.0) {
      const notes = chordNotes[c];
      notes.forEach((freq, idx) => {
        const noteDt = dt - idx * 0.45;
        if (noteDt >= 0) {
          const env = Math.exp(-noteDt * 1.8);
          val += Math.sin(2 * Math.PI * freq * t) * 0.15 * env;
          val += Math.sin(4 * Math.PI * freq * t) * 0.05 * env;
        }
      });
    }
  }
  // Smooth loop boundary fade
  const loopEnv = Math.min(1, t * 2) * Math.min(1, (12.0 - t) * 2);
  return val * loopEnv * 0.7;
});

// 2. Mysterious Ambient: Low dark drone (A minor / D minor) with subtle bells
const mysteriousAmbient = createWavBuffer(10.0, 22050, (t, p) => {
  const drone1 = Math.sin(2 * Math.PI * 110.0 * t) * 0.25;
  const drone2 = Math.sin(2 * Math.PI * 164.81 * t) * 0.15;
  const droneSub = Math.sin(2 * Math.PI * 55.0 * t) * 0.2;
  const lfo = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.3 * t);
  const bell1 = Math.sin(2 * Math.PI * 880.0 * t) * Math.exp(-(t % 2.5) * 4) * 0.08;
  const bell2 = Math.sin(2 * Math.PI * 1318.5 * t) * Math.exp(-((t + 1.25) % 2.5) * 5) * 0.05;
  const loopEnv = Math.min(1, t * 1.5) * Math.min(1, (10.0 - t) * 1.5);
  return (drone1 * lfo + drone2 * (1 - lfo) + droneSub + bell1 + bell2) * loopEnv * 0.6;
});

// 3. Epic Action: Cinematic drums and driving ostinato strings
const epicAction = createWavBuffer(8.0, 22050, (t, p) => {
  const beat = (t * 2.2) % 1.0;
  const drumEnv = Math.exp(-beat * 12);
  const drum = Math.sin(2 * Math.PI * (60 + 80 * (1 - beat)) * t) * drumEnv * 0.4;
  const subThump = Math.sin(2 * Math.PI * 45 * t) * drumEnv * 0.3;
  // Ostinato 16th note strings
  const stringStep = Math.floor(t * 8.8) % 4;
  const freqs = [146.83, 174.61, 220.0, 196.0];
  const stringFreq = freqs[stringStep];
  const stringStepT = (t * 8.8) % 1.0;
  const stringEnv = Math.exp(-stringStepT * 5);
  const strings = Math.sin(2 * Math.PI * stringFreq * t) * stringEnv * 0.2;
  const loopEnv = Math.min(1, t * 2) * Math.min(1, (8.0 - t) * 2);
  return (drum + subThump + strings) * loopEnv * 0.8;
});

// 4. Cheerful Acoustic: Bouncy rhythm and cheerful marimba
const cheerfulAcoustic = createWavBuffer(8.0, 22050, (t, p) => {
  const step = Math.floor(t * 4) % 8;
  const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 523.25, 329.63, 392.0];
  const stepT = (t * 4) % 1.0;
  const env = Math.exp(-stepT * 4);
  const freq = notes[step];
  const marimba = (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t)) * env * 0.3;
  const bass = Math.sin(2 * Math.PI * (freq / 2) * t) * Math.exp(-stepT * 2) * 0.2;
  const loopEnv = Math.min(1, t * 1.5) * Math.min(1, (8.0 - t) * 1.5);
  return (marimba + bass) * loopEnv * 0.7;
});

// 5. Dramatic Strings: Warm cello and violin adagio chords
const dramaticStrings = createWavBuffer(12.0, 22050, (t, p) => {
  const chords = [
    [196.0, 293.66, 392.0, 466.16], // G minor
    [164.81, 246.94, 329.63, 392.0], // E-flat major / E minor
    [174.61, 261.63, 349.23, 440.0], // F major
    [146.83, 220.0, 293.66, 369.99], // D minor
  ];
  const chordIdx = Math.min(3, Math.floor((t / 12.0) * 4));
  const chord = chords[chordIdx];
  let val = 0;
  chord.forEach((freq, idx) => {
    // Rich vibrato strings
    const vib = 1 + 0.008 * Math.sin(2 * Math.PI * 5.2 * t);
    val += Math.sin(2 * Math.PI * freq * vib * t) * (0.2 - idx * 0.03);
    val += Math.sin(4 * Math.PI * freq * vib * t) * 0.06;
  });
  const loopEnv = Math.min(1, t * 2) * Math.min(1, (12.0 - t) * 2);
  return val * loopEnv * 0.6;
});

// 6. Cyberpunk Sci-Fi: Analog synthwave arpeggio and sub bass
const cyberpunkSciFi = createWavBuffer(8.0, 22050, (t, p) => {
  const arpStep = Math.floor(t * 8) % 8;
  const arpNotes = [110.0, 130.81, 164.81, 220.0, 261.63, 329.63, 261.63, 164.81];
  const stepT = (t * 8) % 1.0;
  const env = Math.exp(-stepT * 6);
  const freq = arpNotes[arpStep];
  // Sawtooth-like wave
  let saw = 0;
  for (let h = 1; h <= 5; h++) {
    saw += (1 / h) * Math.sin(2 * Math.PI * freq * h * t);
  }
  const subBass = Math.sin(2 * Math.PI * 55.0 * t) * 0.25;
  const loopEnv = Math.min(1, t * 1.5) * Math.min(1, (8.0 - t) * 1.5);
  return (saw * env * 0.25 + subBass) * loopEnv * 0.7;
});

fs.writeFileSync(path.join(bgmDir, 'calm_piano.mp3'), calmPiano);
fs.writeFileSync(path.join(bgmDir, 'mysterious_ambient.mp3'), mysteriousAmbient);
fs.writeFileSync(path.join(bgmDir, 'epic_action.mp3'), epicAction);
fs.writeFileSync(path.join(bgmDir, 'cheerful_acoustic.mp3'), cheerfulAcoustic);
fs.writeFileSync(path.join(bgmDir, 'dramatic_strings.mp3'), dramaticStrings);
fs.writeFileSync(path.join(bgmDir, 'cyberpunk_sci_fi.mp3'), cyberpunkSciFi);

// ─────────────────────────────────────────────
// SFX Generators (~1.0 - 2.5s)
// ─────────────────────────────────────────────

// 1. Footsteps indoor
const footsteps = createWavBuffer(1.6, 22050, (t) => {
  let val = 0;
  [0.1, 0.5, 0.9, 1.3].forEach((stepT) => {
    const dt = t - stepT;
    if (dt >= 0 && dt < 0.2) {
      const env = Math.exp(-dt * 25);
      val += Math.sin(2 * Math.PI * 120 * (1 - dt * 2) * t) * env * 0.5;
      val += (Math.random() * 2 - 1) * env * 0.15;
    }
  });
  return val;
});

// 2. Door creak close
const doorCreak = createWavBuffer(2.0, 22050, (t) => {
  let val = 0;
  if (t < 1.3) {
    // Creak: modulated sawtooth sweep
    const f = 75 + 40 * Math.sin(t * 12);
    val = Math.sin(2 * Math.PI * f * t) * Math.min(1, t * 3) * Math.exp(-t * 0.6) * 0.35;
  } else {
    // Thud latch: impact
    const dt = t - 1.3;
    val = Math.sin(2 * Math.PI * 90 * dt) * Math.exp(-dt * 18) * 0.6;
  }
  return val;
});

// 3. Heavy impact punch
const impactPunch = createWavBuffer(0.8, 22050, (t) => {
  const env = Math.exp(-t * 14);
  const freq = 220 * (1 - t * 1.1);
  const sub = Math.sin(2 * Math.PI * Math.max(30, freq) * t) * env * 0.7;
  const slap = (Math.random() * 2 - 1) * Math.exp(-t * 35) * 0.4;
  return sub + slap;
});

// 4. Distant explosion
const explosion = createWavBuffer(2.5, 22050, (t) => {
  const env = Math.exp(-t * 1.5);
  const rumble = Math.sin(2 * Math.PI * (55 + 20 * Math.sin(t * 8)) * t) * env * 0.5;
  const noise = (Math.random() * 2 - 1) * env * 0.35;
  return rumble + noise;
});

// 5. Gentle rain
const rain = createWavBuffer(2.5, 22050, (t) => {
  const noise = (Math.random() * 2 - 1) * 0.25;
  const env = Math.min(1, t * 4) * Math.min(1, (2.5 - t) * 3);
  return noise * env;
});

// 6. Magic chime sparkle
const magicChime = createWavBuffer(1.8, 22050, (t) => {
  const freqs = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
  let val = 0;
  freqs.forEach((freq, idx) => {
    const dt = t - idx * 0.12;
    if (dt >= 0) {
      val += Math.sin(2 * Math.PI * freq * t) * Math.exp(-dt * 4.5) * 0.18;
      val += Math.sin(4 * Math.PI * freq * t) * Math.exp(-dt * 6.0) * 0.08;
    }
  });
  return val;
});

// 7. Heartbeat tense
const heartbeat = createWavBuffer(1.8, 22050, (t) => {
  let val = 0;
  [0.2, 0.42, 1.0, 1.22].forEach((thumpT) => {
    const dt = t - thumpT;
    if (dt >= 0 && dt < 0.2) {
      const env = Math.exp(-dt * 20);
      val += Math.sin(2 * Math.PI * 65 * dt) * env * 0.65;
    }
  });
  return val;
});

// 8. Sword blade whoosh
const swordBlade = createWavBuffer(1.0, 22050, (t) => {
  const env = Math.exp(-t * 6);
  const ring = Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 3) * 0.35;
  const whoosh = (Math.random() * 2 - 1) * env * 0.3;
  return ring + whoosh;
});

// 9. Phone notification
const phoneChime = createWavBuffer(1.2, 22050, (t) => {
  let val = 0;
  const dt1 = t - 0.05;
  if (dt1 >= 0) val += Math.sin(2 * Math.PI * 784 * t) * Math.exp(-dt1 * 6) * 0.35;
  const dt2 = t - 0.22;
  if (dt2 >= 0) val += Math.sin(2 * Math.PI * 1046.5 * t) * Math.exp(-dt2 * 5) * 0.4;
  return val;
});

fs.writeFileSync(path.join(sfxDir, 'footsteps_indoor.mp3'), footsteps);
fs.writeFileSync(path.join(sfxDir, 'door_creak_close.mp3'), doorCreak);
fs.writeFileSync(path.join(sfxDir, 'heavy_impact_punch.mp3'), impactPunch);
fs.writeFileSync(path.join(sfxDir, 'explosion_distant.mp3'), explosion);
fs.writeFileSync(path.join(sfxDir, 'rain_gentle.mp3'), rain);
fs.writeFileSync(path.join(sfxDir, 'magic_chime_sparkle.mp3'), magicChime);
fs.writeFileSync(path.join(sfxDir, 'heartbeat_tense.mp3'), heartbeat);
fs.writeFileSync(path.join(sfxDir, 'sword_blade_whoosh.mp3'), swordBlade);
fs.writeFileSync(path.join(sfxDir, 'phone_notification.mp3'), phoneChime);

console.log('Successfully generated all BGM and SFX audio files in public/Audio!');
