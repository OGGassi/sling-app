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

// ── Instrument presets ────────────────────────────────────────

const PRESETS = {
  Piano: {
    osc1: 'triangle',
    attack: 0.01,
    decay: 0.3,
    sustain: 0.1,
    release: 0.5,
    // Subtle 2nd harmonic
    osc2: 'sine',
    osc2ratio: 2,
    osc2gain: 0.1,
    osc2detune: 0,
  },
  Guitar: {
    osc1: 'sawtooth',
    attack: 0.005,
    decay: 0.15,
    sustain: 0.05,
    release: 0.3,
    osc2: null,
    osc2ratio: 1,
    osc2gain: 0,
    osc2detune: 0,
  },
  Viola: {
    osc1: 'sawtooth',
    attack: 0.1,
    decay: 0.1,
    sustain: 0.8,
    release: 0.4,
    // Built-in vibrato
    vibrato: true,
    vibratoRate: 5.5,
    vibratoDepth: 12, // cents
    osc2: 'sawtooth',
    osc2ratio: 1,
    osc2gain: 0.3,
    osc2detune: 3,
  },
  Flute: {
    osc1: 'sine',
    attack: 0.08,
    decay: 0.05,
    sustain: 0.9,
    release: 0.3,
    osc2: null,
    osc2ratio: 1,
    osc2gain: 0,
    osc2detune: 0,
  },
  Pantam: {
    osc1: 'sine',
    attack: 0.001,
    decay: 0.5,
    sustain: 0,
    release: 1.5,
    // Metallic resonance harmonic
    osc2: 'sine',
    osc2ratio: 2.756,
    osc2gain: 0.2,
    osc2detune: 0,
  },
};

// ── Theme accent colors per instrument ────────────────────────

export const INSTRUMENT_COLORS = {
  Piano:  '#00FFFF',
  Guitar: '#FF6B35',
  Viola:  '#C77DFF',
  Flute:  '#72EFDD',
  Pantam: '#FFD166',
};

// ── Material icon names per instrument ────────────────────────

export const INSTRUMENT_ICONS = {
  Piano:  'piano',
  Guitar: 'guitar',          // may not be in Outlined — fallback handled in UI
  Viola:  'music_note',
  Flute:  'air',
  Pantam: 'radio_button_unchecked',
};

// ── Hook ──────────────────────────────────────────────────────

export default function useAudio() {
  const [instrument, setInstrument] = useState('Piano');
  const ctxRef = useRef(null);
  const activeNotes = useRef(new Map());

  const getCtx = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  // ── Play a note ─────────────────────────────────────────────
  // Extended packet: playNote(idx, velocity, pitchBend, vibrato, tremolo)
  //   pitchBend: -12..+12 semitones → mapped to cents
  //   vibrato:   0..127 → frequency LFO depth
  //   tremolo:   0..127 → amplitude LFO depth

  const playNote = useCallback(
    (noteIndex, velocity = 100, pitchBend = 0, vibratoAmt = 0, tremoloAmt = 0) => {
      const ctx = getCtx();
      const freq = NOTE_FREQ[noteIndex];
      if (freq == null) return;

      const p = PRESETS[instrument];
      const vol = (velocity / 127) * 0.5;
      const now = ctx.currentTime;

      // Pitch bend: map -12..+12 semitones to -1200..+1200 cents
      const bendCents = pitchBend * 100;

      // Master gain for tremolo
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(1, now);
      masterGain.connect(ctx.destination);

      // ── Primary oscillator ──
      const osc1 = ctx.createOscillator();
      osc1.type = p.osc1;
      osc1.frequency.value = freq;
      osc1.detune.value = bendCents;

      const gain1 = ctx.createGain();
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(vol, now + p.attack);
      gain1.gain.linearRampToValueAtTime(vol * p.sustain, now + p.attack + p.decay);
      osc1.connect(gain1).connect(masterGain);
      osc1.start(now);

      const nodes = [{ osc: osc1, gain: gain1 }];
      const lfoNodes = [];

      // ── Optional second oscillator ──
      if (p.osc2) {
        const osc2 = ctx.createOscillator();
        osc2.type = p.osc2;
        osc2.frequency.value = freq * (p.osc2ratio || 1);
        osc2.detune.value = (p.osc2detune || 0) + bendCents;

        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime(0, now);
        gain2.gain.linearRampToValueAtTime(vol * p.osc2gain, now + p.attack);
        gain2.gain.linearRampToValueAtTime(
          vol * p.osc2gain * p.sustain,
          now + p.attack + p.decay
        );
        osc2.connect(gain2).connect(masterGain);
        osc2.start(now);
        nodes.push({ osc: osc2, gain: gain2 });
      }

      // ── Vibrato LFO (frequency modulation) ──
      // Combine preset vibrato + incoming vibrato amount
      const hasPresetVibrato = p.vibrato;
      const hasInputVibrato = vibratoAmt > 0;

      if (hasPresetVibrato || hasInputVibrato) {
        const vibratoLfo = ctx.createOscillator();
        vibratoLfo.type = 'sine';

        // Rate: preset default or map input 0-127 → 4-8 Hz
        const rate = hasInputVibrato
          ? 4 + (vibratoAmt / 127) * 4
          : (p.vibratoRate || 5.5);

        // Depth in cents: preset or map input 0-127 → 0-20 cents
        const depth = hasInputVibrato
          ? (vibratoAmt / 127) * 20
          : (p.vibratoDepth || 12);

        vibratoLfo.frequency.value = rate;

        const vibratoGain = ctx.createGain();
        vibratoGain.gain.value = depth;

        vibratoLfo.connect(vibratoGain);
        // Connect to detune of all oscillators
        nodes.forEach(({ osc }) => {
          vibratoGain.connect(osc.detune);
        });
        vibratoLfo.start(now);
        lfoNodes.push(vibratoLfo);
      }

      // ── Tremolo LFO (amplitude modulation) ──
      if (tremoloAmt > 0) {
        const tremoloLfo = ctx.createOscillator();
        tremoloLfo.type = 'sine';
        // Rate: map 0-127 → 4-8 Hz
        tremoloLfo.frequency.value = 4 + (tremoloAmt / 127) * 4;

        const tremoloDepth = ctx.createGain();
        // Depth: map 0-127 → 0-0.3
        tremoloDepth.gain.value = (tremoloAmt / 127) * 0.3;

        tremoloLfo.connect(tremoloDepth);
        tremoloDepth.connect(masterGain.gain);
        tremoloLfo.start(now);
        lfoNodes.push(tremoloLfo);
      }

      activeNotes.current.set(noteIndex, {
        nodes,
        lfoNodes,
        masterGain,
        preset: p,
      });
    },
    [instrument, getCtx]
  );

  // ── Stop a note ─────────────────────────────────────────────

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
        osc.stop(now + fadeOut + 0.01);
      });

      // Stop LFOs
      entry.lfoNodes?.forEach((lfo) => {
        try { lfo.stop(now + fadeOut + 0.01); } catch { /* ok */ }
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
        entry.lfoNodes?.forEach((lfo) => {
          try { lfo.stop(); } catch { /* ok */ }
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
