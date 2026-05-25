import { useState, useRef, useCallback, useEffect } from 'react';
import * as Tone from 'tone';

// ── Note names: 2 octaves C3-B4 (24 notes) ───────────────────

export const NOTE_NAMES = [
  'C3','C#3','D3','D#3','E3','F3','F#3','G3','G#3','A3','A#3','B3',
  'C4','C#4','D4','D#4','E4','F4','F#4','G4','G#4','A4','A#4','B4',
];

// ── Theme accent colors per instrument ────────────────────────

export const INSTRUMENT_COLORS = {
  Viola:     '#9333EA',
  Saxophone: '#FF8C00',
  Custom:    '#888888',
};

// ── Synth factory per instrument ──────────────────────────────

function createSynth(name) {
  switch (name) {
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

    case 'Saxophone': {
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: {
          attack: 0.05,
          decay: 0.2,
          sustain: 0.8,
          release: 0.3,
        },
      });
      const filter = new Tone.Filter(900, 'bandpass').toDestination();
      synth.connect(filter);
      return synth;
    }

    case 'Custom': {
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: {
          attack: 0.05,
          decay: 0.3,
          sustain: 0.5,
          release: 0.8,
        },
      }).toDestination();
    }

    default:
      return new Tone.PolySynth(Tone.Synth).toDestination();
  }
}

const INSTRUMENT_LIST = ['Viola', 'Saxophone', 'Custom'];

// ── Hook ──────────────────────────────────────────────────────

export default function useAudio() {
  const [instrument, setInstrumentState] = useState('Viola');
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
    initSynth('Viola');
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
