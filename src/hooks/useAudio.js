import { useState, useRef, useCallback, useEffect } from 'react';

// C3 through B4 — two full octaves (24 notes)
const NOTE_FREQ = [
  130.81, 138.59, 146.83, 155.56, 164.81, 174.61, // C3  C#3 D3  D#3 E3  F3
  185.00, 196.00, 207.65, 220.00, 233.08, 246.94, // F#3 G3  G#3 A3  A#3 B3
  261.63, 277.18, 293.66, 311.13, 329.63, 349.23, // C4  C#4 D4  D#4 E4  F4
  369.99, 392.00, 415.30, 440.00, 466.16, 493.88, // F#4 G4  G#4 A4  A#4 B4
];

export const NOTE_NAMES = [
  'C3','C#3','D3','D#3','E3','F3','F#3','G3','G#3','A3','A#3','B3',
  'C4','C#4','D4','D#4','E4','F4','F#4','G4','G#4','A4','A#4','B4',
];

// ── Instrument presets with multi-harmonic + filter ───────────

const PRESETS = {
  Piano: {
    type: 'triangle',
    attack: 0.01,
    decay: 0.4,
    sustain: 0.2,
    release: 0.8,
    harmonics: [
      { ratio: 2, gain: 0.3 },
      { ratio: 3, gain: 0.15 },
      { ratio: 4, gain: 0.08 },
    ],
    filterType: 'lowpass',
    filterFreq: 3000,
    vibratoRate: 0,
    vibratoDepth: 0,
  },
  Guitar: {
    type: 'sawtooth',
    attack: 0.005,
    decay: 0.2,
    sustain: 0.1,
    release: 0.4,
    harmonics: [
      { ratio: 2, gain: 0.4 },
      { ratio: 3, gain: 0.2 },
    ],
    filterType: 'lowpass',
    filterFreq: 2000,
    vibratoRate: 0,
    vibratoDepth: 0,
  },
  Viola: {
    type: 'sawtooth',
    attack: 0.15,
    decay: 0.1,
    sustain: 0.9,
    release: 0.5,
    harmonics: [
      { ratio: 2, gain: 0.5 },
      { ratio: 3, gain: 0.25 },
      { ratio: 5, gain: 0.1 },
    ],
    filterType: 'lowpass',
    filterFreq: 1500,
    // Built-in vibrato (bowed string)
    vibratoRate: 5.5,
    vibratoDepth: 12,
  },
  Flute: {
    type: 'sine',
    attack: 0.1,
    decay: 0.05,
    sustain: 0.95,
    release: 0.3,
    harmonics: [],
    filterType: 'highpass',
    filterFreq: 8000,
    vibratoRate: 0,
    vibratoDepth: 0,
  },
  Pantam: {
    type: 'sine',
    attack: 0.001,
    decay: 0.8,
    sustain: 0.0,
    release: 2.0,
    harmonics: [
      { ratio: 2.756, gain: 0.5 },
      { ratio: 5.404, gain: 0.25 },
    ],
    filterType: 'bandpass',
    filterFreq: 800,
    vibratoRate: 0,
    vibratoDepth: 0,
  },
};

const MAX_POLYPHONY = 5;

// ── Theme accent colors per instrument ────────────────────────

export const INSTRUMENT_COLORS = {
  Piano:  '#00FFFF',
  Guitar: '#FF8C00',
  Viola:  '#9333EA',
  Flute:  '#00FF88',
  Pantam: '#FFD700',
};

// ── Hook ──────────────────────────────────────────────────────

export default function useAudio() {
  const [instrument, setInstrument] = useState('Piano');
  const ctxRef = useRef(null);
  const activeRef = useRef(new Map()); // noteIndex → { oscillators, gain, lfoNodes, inst }

  const getCtx = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  // ── Stop all notes (cleanup stuck notes) ────────────────────

  const stopAllNotes = useCallback(() => {
    const ctx = ctxRef.current;
    const now = ctx ? ctx.currentTime : 0;
    activeRef.current.forEach((entry) => {
      entry.oscillators.forEach((osc) => {
        try { osc.stop(now + 0.05); } catch { /* ok */ }
      });
      entry.lfoNodes.forEach((lfo) => {
        try { lfo.stop(now + 0.05); } catch { /* ok */ }
      });
    });
    activeRef.current.clear();
  }, []);

  // ── Play a note ─────────────────────────────────────────────
  //   pitchBend: -12..+12 semitones → cents
  //   vibrato:   0..127 → frequency LFO
  //   tremolo:   0..127 → amplitude LFO

  const playNote = useCallback(
    (noteIndex, velocity = 100, pitchBend = 0, vibratoAmt = 0, tremoloAmt = 0) => {
      const ctx = getCtx();
      const baseFreq = NOTE_FREQ[noteIndex];
      if (baseFreq == null) return;

      // Guard: stop stuck notes if polyphony exceeded
      if (activeRef.current.size >= MAX_POLYPHONY) {
        stopAllNotes();
      }

      // Stop same note if already playing
      if (activeRef.current.has(noteIndex)) {
        const prev = activeRef.current.get(noteIndex);
        const now = ctx.currentTime;
        prev.oscillators.forEach((o) => { try { o.stop(now + 0.02); } catch { /* ok */ } });
        prev.lfoNodes.forEach((l) => { try { l.stop(now + 0.02); } catch { /* ok */ } });
        activeRef.current.delete(noteIndex);
      }

      const inst = PRESETS[instrument];
      const vol = (velocity / 127) * 0.5;
      const now = ctx.currentTime;

      // Pitch bend: map semitones to frequency multiplier
      const freq = baseFreq * Math.pow(2, (pitchBend * 100) / 1200);

      // ── Filter for character ──
      const filter = ctx.createBiquadFilter();
      filter.type = inst.filterType;
      filter.frequency.value = inst.filterFreq;
      if (inst.filterType === 'bandpass') filter.Q.value = 2;

      // ── Master gain (ADSR envelope) ──
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(vol, now + inst.attack);
      gainNode.gain.linearRampToValueAtTime(
        inst.sustain * vol,
        now + inst.attack + inst.decay
      );

      filter.connect(gainNode);
      gainNode.connect(ctx.destination);

      const oscillators = [];
      const lfoNodes = [];

      // ── Primary oscillator ──
      const osc = ctx.createOscillator();
      osc.type = inst.type;
      osc.frequency.value = freq;
      osc.connect(filter);
      osc.start(now);
      oscillators.push(osc);

      // ── Harmonic oscillators for richness ──
      inst.harmonics.forEach((h) => {
        const harmOsc = ctx.createOscillator();
        harmOsc.type = inst.type;
        harmOsc.frequency.value = freq * h.ratio;

        const harmGain = ctx.createGain();
        harmGain.gain.setValueAtTime(0, now);
        harmGain.gain.linearRampToValueAtTime(h.gain * vol, now + inst.attack);
        harmGain.gain.linearRampToValueAtTime(
          h.gain * vol * inst.sustain,
          now + inst.attack + inst.decay
        );

        harmOsc.connect(harmGain);
        harmGain.connect(filter);
        harmOsc.start(now);
        oscillators.push(harmOsc);
      });

      // ── Vibrato LFO (frequency modulation) ──
      const hasPresetVib = inst.vibratoRate > 0;
      const hasInputVib = vibratoAmt > 10;

      if (hasPresetVib || hasInputVib) {
        const vibratoLfo = ctx.createOscillator();
        vibratoLfo.type = 'sine';

        const rate = hasInputVib
          ? 5 + (vibratoAmt / 127) * 3
          : inst.vibratoRate;
        const depth = hasInputVib
          ? freq * 0.02 * (vibratoAmt / 127)
          : freq * 0.005;

        vibratoLfo.frequency.value = rate;

        const vibratoGain = ctx.createGain();
        vibratoGain.gain.value = depth;

        vibratoLfo.connect(vibratoGain);
        // Modulate frequency of all oscillators
        oscillators.forEach((o) => vibratoGain.connect(o.frequency));
        vibratoLfo.start(now);
        lfoNodes.push(vibratoLfo);
      }

      // ── Tremolo LFO (amplitude modulation) ──
      if (tremoloAmt > 10) {
        const tremoloLfo = ctx.createOscillator();
        tremoloLfo.type = 'sine';
        tremoloLfo.frequency.value = 4 + (tremoloAmt / 127) * 4;

        const tremoloDepth = ctx.createGain();
        tremoloDepth.gain.value = (tremoloAmt / 127) * 0.3;

        tremoloLfo.connect(tremoloDepth);
        tremoloDepth.connect(gainNode.gain);
        tremoloLfo.start(now);
        lfoNodes.push(tremoloLfo);
      }

      activeRef.current.set(noteIndex, {
        oscillators,
        lfoNodes,
        gain: gainNode,
        inst,
      });
    },
    [instrument, getCtx, stopAllNotes]
  );

  // ── Stop a note ─────────────────────────────────────────────

  const stopNote = useCallback(
    (noteIndex) => {
      const entry = activeRef.current.get(noteIndex);
      if (!entry) return;

      const ctx = getCtx();
      const now = ctx.currentTime;
      const release = entry.inst.release;
      const stopTime = now + release;

      // Fade out gain
      entry.gain.gain.cancelScheduledValues(now);
      entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
      entry.gain.gain.linearRampToValueAtTime(0, stopTime);

      // Schedule oscillator stops
      entry.oscillators.forEach((osc) => {
        try { osc.stop(stopTime + 0.01); } catch { /* ok */ }
      });
      entry.lfoNodes.forEach((lfo) => {
        try { lfo.stop(stopTime + 0.01); } catch { /* ok */ }
      });

      activeRef.current.delete(noteIndex);
    },
    [getCtx]
  );

  // Cleanup on instrument change — stop all notes
  useEffect(() => {
    return () => {
      stopAllNotes();
    };
  }, [instrument, stopAllNotes]);

  return {
    instrument,
    setInstrument,
    playNote,
    stopNote,
    stopAllNotes,
    instruments: Object.keys(PRESETS),
  };
}
