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

// Instrument presets — each creates a unique timbre via oscillator mix + envelope
const PRESETS = {
  Piano: {
    osc1: 'sine',
    osc2: 'triangle',
    osc2gain: 0.4,
    osc2detune: 0,
    attack: 0.01,
    decay: 0.3,
    sustain: 0.2,
    release: 0.4,
  },
  Guitar: {
    osc1: 'sawtooth',
    osc2: null,
    osc2gain: 0,
    osc2detune: 0,
    attack: 0.005,
    decay: 0.15,
    sustain: 0.08,
    release: 0.2,
  },
  Viola: {
    osc1: 'sawtooth',
    osc2: 'sawtooth',
    osc2gain: 0.3,
    osc2detune: 3,
    attack: 0.12,
    decay: 0.1,
    sustain: 0.7,
    release: 0.5,
  },
  Flute: {
    osc1: 'sine',
    osc2: 'sine',
    osc2gain: 0.15,
    osc2detune: 0,
    attack: 0.08,
    decay: 0.05,
    sustain: 0.6,
    release: 0.3,
  },
  Pantam: {
    osc1: 'sine',
    osc2: 'triangle',
    osc2gain: 0.35,
    osc2detune: 0,
    osc2ratio: 2, // 2nd harmonic for metallic shimmer
    attack: 0.005,
    decay: 0.6,
    sustain: 0.05,
    release: 0.8,
  },
};

export default function useAudio() {
  const [instrument, setInstrument] = useState('Piano');
  const ctxRef = useRef(null);
  const activeNotes = useRef(new Map());

  const getCtx = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const playNote = useCallback(
    (noteIndex, velocity = 100) => {
      const ctx = getCtx();
      const freq = NOTE_FREQ[noteIndex];
      if (freq == null) return;

      const p = PRESETS[instrument];
      const vol = (velocity / 127) * 0.5;
      const now = ctx.currentTime;

      // Primary oscillator
      const osc1 = ctx.createOscillator();
      osc1.type = p.osc1;
      osc1.frequency.value = freq;

      const gain1 = ctx.createGain();
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(vol, now + p.attack);
      gain1.gain.linearRampToValueAtTime(vol * p.sustain, now + p.attack + p.decay);
      osc1.connect(gain1).connect(ctx.destination);
      osc1.start(now);

      const nodes = [{ osc: osc1, gain: gain1 }];

      // Optional second oscillator for richer timbre
      if (p.osc2) {
        const osc2 = ctx.createOscillator();
        osc2.type = p.osc2;
        osc2.frequency.value = freq * (p.osc2ratio || 1);
        osc2.detune.value = p.osc2detune || 0;

        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime(0, now);
        gain2.gain.linearRampToValueAtTime(vol * p.osc2gain, now + p.attack);
        gain2.gain.linearRampToValueAtTime(
          vol * p.osc2gain * p.sustain,
          now + p.attack + p.decay
        );
        osc2.connect(gain2).connect(ctx.destination);
        osc2.start(now);

        nodes.push({ osc: osc2, gain: gain2 });
      }

      activeNotes.current.set(noteIndex, { nodes, preset: p });
    },
    [instrument, getCtx]
  );

  const stopNote = useCallback(
    (noteIndex) => {
      const entry = activeNotes.current.get(noteIndex);
      if (!entry) return;

      const ctx = getCtx();
      const now = ctx.currentTime;
      const fadeOut = entry.preset.release;

      entry.nodes.forEach(({ osc, gain }) => {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + fadeOut);
        osc.stop(now + fadeOut);
      });

      activeNotes.current.delete(noteIndex);
    },
    [getCtx]
  );

  // Cleanup on instrument change
  useEffect(() => {
    return () => {
      activeNotes.current.forEach((entry) => {
        entry.nodes.forEach(({ osc }) => {
          try { osc.stop(); } catch { /* already stopped */ }
        });
      });
      activeNotes.current.clear();
    };
  }, [instrument]);

  return {
    instrument,
    setInstrument,
    playNote,
    stopNote,
    instruments: Object.keys(PRESETS),
  };
}
