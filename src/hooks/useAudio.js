import { useState, useRef, useCallback, useEffect } from 'react';
import * as Tone from 'tone';

// ── Note names: 2 octaves C3-B4 (24 notes) ───────────────────

export const NOTE_NAMES = [
  'C3','C#3','D3','D#3','E3','F3','F#3','G3','G#3','A3','A#3','B3',
  'C4','C#4','D4','D#4','E4','F4','F#4','G4','G#4','A4','A#4','B4',
];

// ── Theme accent colors per instrument ────────────────────────

export const INSTRUMENT_COLORS = {
  Piano:  '#00FFFF',
  Guitar: '#FF8C00',
  Viola:  '#9333EA',
  Flute:  '#00FF88',
  Pantam: '#FFD700',
};

// ── Synth factory per instrument ──────────────────────────────

function createSynth(name) {
  switch (name) {
    case 'Piano': {
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle8' },
        envelope: {
          attack: 0.02,
          decay: 0.5,
          sustain: 0.3,
          release: 1.2,
        },
      }).toDestination();
    }

    case 'Guitar': {
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fmsawtooth', modulationIndex: 3 },
        envelope: {
          attack: 0.005,
          decay: 0.15,
          sustain: 0.05,
          release: 0.4,
        },
      });
      const filter = new Tone.Filter(2000, 'lowpass').toDestination();
      synth.connect(filter);
      return synth;
    }

    case 'Viola': {
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth4' },
        envelope: {
          attack: 0.18,
          decay: 0.1,
          sustain: 0.9,
          release: 0.7,
        },
      });
      const chorus = new Tone.Chorus(4, 2.5, 0.5).toDestination();
      chorus.start();
      synth.connect(chorus);
      return synth;
    }

    case 'Flute': {
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: {
          attack: 0.1,
          decay: 0.05,
          sustain: 0.95,
          release: 0.5,
        },
      });
      const reverb = new Tone.Reverb(1.5).toDestination();
      synth.connect(reverb);
      return synth;
    }

    case 'Pantam': {
      // MetalSynth can't be wrapped in PolySynth, so we create a
      // pool of MonoSynths tuned for metallic timbre instead
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: {
          attack: 0.001,
          decay: 1.4,
          sustain: 0.0,
          release: 0.2,
        },
      });
      // Add a second partial at 2.756x for metallic shimmer
      const synth2 = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: {
          attack: 0.001,
          decay: 1.0,
          sustain: 0.0,
          release: 0.15,
        },
      });
      const gain2 = new Tone.Gain(0.4).toDestination();
      synth2.connect(gain2);
      synth.toDestination();
      // Return both synths as a combined object
      return { triggerAttack: (n, t, v) => {
        synth.triggerAttack(n, t, v);
        // Shift second partial up by ~17.5 semitones (2.756 ratio)
        const shifted = Array.isArray(n)
          ? n.map(note => Tone.Frequency(note).toFrequency() * 2.756)
          : Tone.Frequency(n).toFrequency() * 2.756;
        synth2.triggerAttack(
          Array.isArray(shifted) ? shifted.map(f => f) : shifted,
          t, (v || 1) * 0.4
        );
      }, triggerRelease: (n, t) => {
        synth.triggerRelease(n, t);
        // Release second synth too — use same notes transposed
        const shifted = Array.isArray(n)
          ? n.map(note => Tone.Frequency(note).toFrequency() * 2.756)
          : Tone.Frequency(n).toFrequency() * 2.756;
        synth2.triggerRelease(
          Array.isArray(shifted) ? shifted : [shifted],
          t
        );
      }, releaseAll: () => {
        synth.releaseAll();
        synth2.releaseAll();
      }, dispose: () => {
        synth.dispose();
        synth2.dispose();
        gain2.dispose();
      }};
    }

    default:
      return new Tone.PolySynth(Tone.Synth).toDestination();
  }
}

const INSTRUMENT_LIST = ['Piano', 'Guitar', 'Viola', 'Flute', 'Pantam'];

// ── Hook ──────────────────────────────────────────────────────

export default function useAudio() {
  const [instrument, setInstrumentState] = useState('Piano');
  const synthRef = useRef(null);
  const activeRef = useRef({}); // noteIndex → noteName
  const effectsRef = useRef([]); // track effects for disposal

  // ── Initialize / swap synth ─────────────────────────────────

  const initSynth = useCallback(async (name) => {
    // Dispose previous
    if (synthRef.current) {
      try { synthRef.current.releaseAll(); } catch { /* ok */ }
      try { synthRef.current.dispose(); } catch { /* ok */ }
    }
    effectsRef.current.forEach((e) => {
      try { e.dispose(); } catch { /* ok */ }
    });
    effectsRef.current = [];

    // Ensure audio context started
    await Tone.start();

    synthRef.current = createSynth(name);
    activeRef.current = {};
  }, []);

  // ── Play a note ─────────────────────────────────────────────

  const playNote = useCallback(
    (noteIndex, velocity = 100, pitchBend = 0, _vibrato = 0, _tremolo = 0) => {
      if (!synthRef.current) return;
      if (noteIndex < 0 || noteIndex >= NOTE_NAMES.length) return;

      const noteName = NOTE_NAMES[noteIndex];
      const vol = Math.max(0.01, velocity / 127);

      // Stop same note if already playing to prevent stacking
      if (activeRef.current[noteIndex]) {
        try {
          synthRef.current.triggerRelease(activeRef.current[noteIndex], Tone.now());
        } catch { /* ok */ }
      }

      // Apply pitch bend by shifting the note frequency
      let playNote = noteName;
      if (pitchBend !== 0) {
        const baseFreq = Tone.Frequency(noteName).toFrequency();
        playNote = baseFreq * Math.pow(2, (pitchBend * 100) / 1200);
      }

      try {
        synthRef.current.triggerAttack(playNote, Tone.now(), vol);
        activeRef.current[noteIndex] = playNote;
      } catch (e) {
        console.error('Tone playNote error:', e);
      }
    },
    []
  );

  // ── Stop a note ─────────────────────────────────────────────

  const stopNote = useCallback((noteIndex) => {
    if (!synthRef.current) return;
    const note = activeRef.current[noteIndex];
    if (note != null) {
      try {
        synthRef.current.triggerRelease(note, Tone.now());
      } catch { /* ok */ }
      delete activeRef.current[noteIndex];
    }
  }, []);

  // ── Stop all notes ──────────────────────────────────────────

  const stopAllNotes = useCallback(() => {
    if (!synthRef.current) return;
    try { synthRef.current.releaseAll(); } catch { /* ok */ }
    activeRef.current = {};
  }, []);

  // ── Change instrument ───────────────────────────────────────

  const setInstrument = useCallback(
    async (name) => {
      if (!INSTRUMENT_LIST.includes(name)) return;
      stopAllNotes();
      setInstrumentState(name);
      await initSynth(name);
    },
    [initSynth, stopAllNotes]
  );

  // ── Initialize on mount ─────────────────────────────────────

  useEffect(() => {
    initSynth('Piano');
    return () => {
      if (synthRef.current) {
        try { synthRef.current.releaseAll(); } catch { /* ok */ }
        try { synthRef.current.dispose(); } catch { /* ok */ }
      }
      effectsRef.current.forEach((e) => {
        try { e.dispose(); } catch { /* ok */ }
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    instrument,
    setInstrument,
    playNote,
    stopNote,
    stopAllNotes,
    instruments: INSTRUMENT_LIST,
  };
}
