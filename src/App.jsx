import { useCallback, useEffect, useRef, useState } from 'react';
import useBLE from './hooks/useBLE';
import useAudio, { NOTE_NAMES, INSTRUMENT_COLORS } from './hooks/useAudio';
import useSpotify from './hooks/useSpotify';
import Camera from './components/Camera';
import InstrumentVisualizer from './components/InstrumentVisualizer';
import { InstrumentSVGs } from './components/InstrumentIcons';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';

// ── Swatches ─────────────────────────────────────────────────

const SWATCHES = [
  { id: 0, name: 'Minimal', color: '#E5E5E5', desc: 'Analog + digital, pure black' },
  { id: 1, name: 'Jarvis',  color: '#00FFFF', desc: 'AI assistant, cyan glow' },
  { id: 2, name: 'Neural',  color: '#9333EA', desc: 'Brain dots, moves with tilt' },
  { id: 3, name: 'Sand',    color: '#FFD700', desc: 'Particles fall, shake for time' },
  { id: 4, name: 'Neon',    color: '#00FF88', desc: 'Synthwave, equalizer bars' },
];

// ── Swatch mini-preview SVGs ─────────────────────────────────

function SwatchPreview({ id }) {
  switch (id) {
    case 0: // Minimal — clock hands
      return (
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
          <circle cx="15" cy="15" r="12" stroke="#555" strokeWidth="0.5" />
          <line x1="15" y1="15" x2="15" y2="6" stroke="#888" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="15" y1="15" x2="22" y2="15" stroke="#888" strokeWidth="1" strokeLinecap="round" />
          <circle cx="15" cy="15" r="1" fill="#888" />
        </svg>
      );
    case 1: // Jarvis — cyan rings + text
      return (
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
          <circle cx="15" cy="15" r="10" stroke="#00FFFF" strokeWidth="0.5" opacity="0.5" />
          <circle cx="15" cy="15" r="6" stroke="#00FFFF" strokeWidth="0.5" opacity="0.7" />
          <text x="15" y="17" textAnchor="middle" fill="#00FFFF" fontSize="6" fontFamily="monospace">AI</text>
        </svg>
      );
    case 2: // Neural — purple dots
      return (
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
          <circle cx="10" cy="10" r="2" fill="#9333EA" opacity="0.8" />
          <circle cx="20" cy="12" r="1.5" fill="#9333EA" opacity="0.6" />
          <circle cx="15" cy="20" r="2.5" fill="#9333EA" opacity="0.7" />
          <circle cx="8" cy="22" r="1" fill="#9333EA" opacity="0.5" />
          <circle cx="22" cy="22" r="1.8" fill="#9333EA" opacity="0.6" />
        </svg>
      );
    case 3: // Sand — golden particles
      return (
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
          <circle cx="12" cy="18" r="1" fill="#FFD700" opacity="0.7" />
          <circle cx="15" cy="22" r="1.2" fill="#FFD700" opacity="0.8" />
          <circle cx="18" cy="20" r="0.8" fill="#FFD700" opacity="0.6" />
          <circle cx="10" cy="24" r="1" fill="#FFD700" opacity="0.5" />
          <circle cx="20" cy="25" r="1.5" fill="#FFD700" opacity="0.7" />
          <circle cx="14" cy="26" r="1" fill="#FFD700" opacity="0.9" />
        </svg>
      );
    case 4: // Neon — green equalizer bars
      return (
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
          <rect x="6" y="18" width="3" height="8" fill="#00FF88" opacity="0.7" rx="1" />
          <rect x="11" y="12" width="3" height="14" fill="#00FF88" opacity="0.8" rx="1" />
          <rect x="16" y="15" width="3" height="11" fill="#00FF88" opacity="0.6" rx="1" />
          <rect x="21" y="10" width="3" height="16" fill="#00FF88" opacity="0.7" rx="1" />
        </svg>
      );
    default:
      return null;
  }
}

// ── Helper: Material Symbol ──────────────────────────────────

function Icon({ name, className = '', style }) {
  return (
    <span className={`material-symbols-outlined ${className}`} style={style}>
      {name}
    </span>
  );
}

// ── App ───────────────────────────────────────────────────────

export default function App() {
  const audio = useAudio();
  const [log, setLog] = useState([]);
  const [watchFwVersion, setWatchFwVersion] = useState(null);
  const [showAbout, setShowAbout] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [activeNotes, setActiveNotes] = useState([]);
  const [activeMode, setActiveMode] = useState(null); // null | 'camera' | 'music' | 'instrument'
  const [activeSwatch, setActiveSwatch] = useState(0);

  // Refs to break circular dependency between hooks
  const spotifyRef = useRef(null);
  const bleRef = useRef(null);
  const cameraRef = useRef(null);

  // Theme accent color follows active instrument
  const themeColor = INSTRUMENT_COLORS[audio.instrument] || '#9333EA';

  // Apply CSS variable for theme color
  useEffect(() => {
    document.documentElement.style.setProperty('--theme-color', themeColor);
  }, [themeColor]);

  // ── Status log ──────────────────────────────────────────────
  const addLog = useCallback((entry) => {
    setLog((prev) => [entry, ...prev].slice(0, 3));
  }, []);

  // ── Exit mode ───────────────────────────────────────────────
  const exitMode = useCallback(
    (mode) => {
      bleRef.current?.sendToWatch('EXIT:' + (mode || '').toUpperCase());
      setActiveMode(null);
      audio.stopAllNotes();
      setActiveNotes([]);
      if (mode === 'camera') {
        cameraRef.current?.stopCamera();
        setCameraVisible(false);
      }
    },
    [audio]
  );

  // ── Command handler (watch → phone via STATUS notifications) ─
  const handleCommand = useCallback(
    (cmd) => {
      const sp = spotifyRef.current;
      const bl = bleRef.current;

      if (cmd === 'PLAY_PAUSE') {
        sp?.playPause();
        addLog('PLAY_PAUSE → Spotify toggled');
      } else if (cmd === 'NEXT_TRACK') {
        sp?.nextTrack();
        addLog('NEXT_TRACK → Spotify next');
      } else if (cmd === 'PREV_TRACK') {
        sp?.prevTrack();
        addLog('PREV_TRACK → Spotify prev');
      } else if (cmd === 'VOLUME_UP') {
        sp?.setVolume(10);
        addLog('VOLUME_UP → +10');
      } else if (cmd === 'VOLUME_DOWN') {
        sp?.setVolume(-10);
        addLog('VOLUME_DOWN → -10');
      } else if (cmd === 'TAKE_PHOTO') {
        const cam = cameraRef.current;
        if (!cam || !cam.isActive()) {
          setCameraVisible(true);
          setActiveMode('camera');
          setTimeout(() => cameraRef.current?.openCamera(), 100);
          addLog('TAKE_PHOTO → Camera opened');
        } else {
          cam.takePhotoWithDelay(2);
          addLog('TAKE_PHOTO → Capturing...');
        }
      } else if (cmd === 'START_VIDEO') {
        const cam = cameraRef.current;
        if (!cam || !cam.isActive()) {
          setCameraVisible(true);
          setActiveMode('camera');
          setTimeout(() => {
            cameraRef.current?.openCamera();
            setTimeout(() => cameraRef.current?.startVideo(), 500);
          }, 100);
        } else {
          cam.startVideo();
        }
        addLog('START_VIDEO → Recording');
      } else if (cmd === 'STOP_VIDEO') {
        cameraRef.current?.stopVideo();
        addLog('STOP_VIDEO → Saved');
      } else if (cmd === 'LAUNCH:CAMERA') {
        setCameraVisible(true);
        setActiveMode('camera');
        setTimeout(() => cameraRef.current?.openCamera(), 100);
        addLog('LAUNCH → Camera');
      } else if (cmd === 'LAUNCH:SPOTIFY') {
        setActiveMode('music');
        window.open('spotify:', '_blank');
        addLog('LAUNCH → Spotify');
      } else if (cmd.startsWith('NOTE_ON:')) {
        const parts = cmd.split(':');
        const note = parseInt(parts[1]);
        const vel = parseInt(parts[2]) || 100;
        const bend = parseInt(parts[3]) || 0;
        const vib = parseInt(parts[4]) || 0;
        const trem = parseInt(parts[5]) || 0;
        if (activeMode !== 'instrument') setActiveMode('instrument');
        audio.playNote(note, vel, bend, vib, trem);
        setActiveNotes((prev) => [
          ...prev.filter((n) => n.note !== note),
          { note, velocity: vel, pitchBend: bend, vibrato: vib },
        ]);
        addLog(`NOTE ${NOTE_NAMES[note] || '?'} → ${audio.instrument}`);
      } else if (cmd.startsWith('NOTE_OFF:')) {
        const note = parseInt(cmd.split(':')[1]);
        audio.stopNote(note);
        setActiveNotes((prev) => prev.filter((n) => n.note !== note));
      } else if (cmd.startsWith('INSTRUMENT:')) {
        const name = cmd.slice(11);
        if (audio.instruments.includes(name)) {
          audio.setInstrument(name);
          setActiveNotes([]);
          addLog(`INSTRUMENT → ${name}`);
        }
      } else if (cmd.startsWith('VERSION:')) {
        const ver = cmd.slice(8);
        setWatchFwVersion(ver);
        addLog(`VERSION → fw v${ver}`);
      } else if (cmd === 'GET_TIME') {
        const ts = Math.floor(Date.now() / 1000);
        bl?.sendToWatch(`TIME:${ts}`);
        addLog('GET_TIME → synced');
      }
    },
    [audio, addLog, activeMode]
  );

  // Initialize hooks
  const ble = useBLE({ onCommand: handleCommand });
  const spotify = useSpotify(ble.sendToWatch);

  // Keep refs current
  spotifyRef.current = spotify;
  bleRef.current = ble;

  // Send active instrument to watch on connect
  useEffect(() => {
    if (ble.connected) {
      ble.sendToWatch(`INSTRUMENT:${audio.instrument}`);
    }
  }, [ble.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop all notes on BLE disconnect
  useEffect(() => {
    if (!ble.connected) {
      audio.stopAllNotes();
      setActiveNotes([]);
      setActiveMode(null);
    }
  }, [ble.connected, audio.stopAllNotes]);

  // ── Swatch tap handler ──────────────────────────────────────
  const selectSwatch = useCallback(
    (id) => {
      setActiveSwatch(id);
      bleRef.current?.sendToWatch(`SWATCH:${id}`);
      addLog(`SWATCH → ${SWATCHES[id]?.name}`);
    },
    [addLog]
  );

  // ── UI ──────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex flex-col font-[system-ui]"
      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      {/* ── HEADER ── */}
      <header className="flex items-center justify-between px-5 py-3">
        <button
          onClick={() => setShowAbout(true)}
          className="text-xl font-extralight tracking-[0.2em] lowercase opacity-80 hover:opacity-100 transition"
        >
          sling
        </button>
        <button
          onClick={ble.connected ? ble.disconnect : ble.connect}
          disabled={ble.scanning}
          className="relative flex items-center gap-2"
        >
          <Icon
            name={
              ble.connected
                ? 'bluetooth_connected'
                : ble.scanning
                  ? 'bluetooth_searching'
                  : 'bluetooth_disabled'
            }
            className={`icon-sm ${
              ble.connected
                ? 'icon-active'
                : ble.scanning
                  ? 'icon-active animate-pulse'
                  : 'icon-dim'
            }`}
          />
          {ble.connected && (
            <span
              className="relative w-2 h-2 rounded-full pulse-ring"
              style={{ background: themeColor }}
            />
          )}
        </button>
      </header>

      <main className="flex-1 px-5 pb-4 flex flex-col gap-5 max-w-md mx-auto w-full">
        {/* ── BLE CONNECTION SECTION ── */}
        {!ble.connected && (
          <section
            className="flex flex-col items-center gap-4 py-8 cursor-pointer"
            onClick={ble.scanning ? undefined : ble.connect}
          >
            <div className="relative">
              <Icon
                name="bluetooth_searching"
                className="icon-xl icon-active animate-pulse"
              />
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {ble.scanning ? 'Scanning...' : 'Looking for Sling Watch...'}
            </p>
            {!ble.scanning && (
              <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                Tap to connect
              </p>
            )}
          </section>
        )}

        {ble.connected && (
          <section className="flex items-center gap-3 px-1">
            <Icon name="bluetooth_connected" className="icon-sm icon-active" />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {ble.deviceName}
            </span>
            <button onClick={ble.disconnect} className="ml-auto">
              <Icon
                name="close"
                className="icon-sm icon-dim hover:text-white transition"
              />
            </button>
          </section>
        )}

        {/* ── EXIT BUTTON (top-left, when in a mode) ── */}
        {activeMode && (
          <button
            onClick={() => exitMode(activeMode)}
            style={{ color: '#444444', fontSize: '12px' }}
            className="self-start"
          >
            ← Exit
          </button>
        )}

        {/* ── SWATCH SELECTOR (when connected, no active mode) ── */}
        {ble.connected && activeMode === null && (
          <section>
            <p
              className="text-[10px] uppercase tracking-widest mb-3"
              style={{ color: 'var(--text-dim)' }}
            >
              Watch Face
            </p>
            <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollSnapType: 'x mandatory' }}>
              {SWATCHES.map((sw) => (
                <button
                  key={sw.id}
                  onClick={() => selectSwatch(sw.id)}
                  className="flex flex-col items-center gap-1.5 flex-shrink-0"
                  style={{ scrollSnapAlign: 'start' }}
                >
                  <div
                    className="w-[60px] h-[60px] rounded-full flex items-center justify-center transition-all"
                    style={{
                      background: '#000',
                      border:
                        activeSwatch === sw.id
                          ? '2px solid #fff'
                          : '2px solid #222',
                      boxShadow:
                        activeSwatch === sw.id
                          ? `0 0 12px ${sw.color}30`
                          : 'none',
                    }}
                  >
                    <SwatchPreview id={sw.id} />
                  </div>
                  <span
                    className="text-[10px]"
                    style={{
                      color:
                        activeSwatch === sw.id ? '#fff' : 'var(--text-dim)',
                    }}
                  >
                    {sw.name}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── INSTRUMENT VISUALIZER (instrument mode or default) ── */}
        {(activeMode === null || activeMode === 'instrument') && (
          <section>
            <InstrumentVisualizer
              activeNotes={activeNotes}
              instrument={audio.instrument}
            />
          </section>
        )}

        {/* ── INSTRUMENT PICKER — radio button style (default view) ── */}
        {activeMode === null && (
          <section>
            <p
              className="text-[10px] uppercase tracking-widest mb-3"
              style={{ color: 'var(--text-dim)' }}
            >
              Instrument
            </p>
            <div className="flex flex-col gap-2">
              {audio.instruments.map((name) => {
                const isActive = audio.instrument === name;
                const color = INSTRUMENT_COLORS[name];
                return (
                  <button
                    key={name}
                    onClick={() => {
                      audio.setInstrument(name);
                      setActiveNotes([]);
                      bleRef.current?.sendToWatch(`INSTRUMENT:${name}`);
                    }}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 transition-all"
                    style={{
                      background: isActive ? '#111' : 'transparent',
                      border: isActive
                        ? `1px solid ${color}40`
                        : '1px solid transparent',
                    }}
                  >
                    {/* Radio indicator */}
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
                      style={{
                        border: isActive
                          ? `2px solid ${color}`
                          : '2px solid #333',
                      }}
                    >
                      {isActive && (
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ background: color }}
                        />
                      )}
                    </div>
                    {/* Icon */}
                    <div
                      className="w-8 h-8 flex items-center justify-center flex-shrink-0"
                      style={{ color: isActive ? color : '#555' }}
                    >
                      {InstrumentSVGs[name]}
                    </div>
                    {/* Label */}
                    <span
                      className="text-sm font-medium"
                      style={{ color: isActive ? '#E5E5E5' : 'var(--text-dim)' }}
                    >
                      {name}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── SPOTIFY (music mode or default) ── */}
        {(activeMode === null || activeMode === 'music') && (
          <section>
            {/* STATE 1: disconnected */}
            {spotify.spotifyState === 'disconnected' && (
              <button
                onClick={spotify.login}
                className="w-full py-4 bg-[#1DB954] hover:bg-[#1ed760] text-black rounded-2xl font-semibold text-sm transition flex items-center justify-center gap-2"
              >
                <Icon name="music_note" className="!text-black !text-[18px]" />
                Connect Spotify
              </button>
            )}

            {/* STATE 2: idle */}
            {spotify.spotifyState === 'idle' && (
              <div
                className="rounded-2xl p-5 flex flex-col items-center gap-3"
                style={{ background: 'var(--bg-card)' }}
              >
                <Icon
                  name="music_note"
                  className="icon-xl"
                  style={{ color: 'var(--text-ghost)' }}
                />
                <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
                  Open Spotify to start playing
                </p>
                <div className="flex items-center gap-8 mt-1">
                  <button onClick={() => window.open('spotify:', '_blank')}>
                    <Icon name="skip_previous" className="icon-dim" />
                  </button>
                  <button onClick={() => window.open('spotify:', '_blank')}>
                    <Icon name="play_arrow" className="icon-lg icon-dim" />
                  </button>
                  <button onClick={() => window.open('spotify:', '_blank')}>
                    <Icon name="skip_next" className="icon-dim" />
                  </button>
                </div>
              </div>
            )}

            {/* STATE 3 & 4: playing / paused */}
            {(spotify.spotifyState === 'playing' ||
              spotify.spotifyState === 'paused') && (
              <div
                className="rounded-2xl p-4 transition-opacity"
                style={{
                  background: 'var(--bg-card)',
                  opacity: spotify.spotifyState === 'paused' ? 0.6 : 1,
                }}
              >
                <div className="flex items-center gap-4">
                  {spotify.currentTrack.albumArt && (
                    <img
                      src={spotify.currentTrack.albumArt}
                      alt="Album"
                      className="w-14 h-14 rounded-lg flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">
                      {spotify.currentTrack.song}
                    </p>
                    <p
                      className="text-xs truncate mt-0.5"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {spotify.currentTrack.artist}
                    </p>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex items-center justify-center gap-8 mt-3">
                  <button
                    onClick={spotify.prevTrack}
                    className="transition hover:opacity-80"
                  >
                    <Icon name="skip_previous" />
                  </button>
                  <button
                    onClick={spotify.playPause}
                    className="transition hover:opacity-80"
                  >
                    <Icon
                      name={
                        spotify.spotifyState === 'playing' ? 'pause' : 'play_arrow'
                      }
                      className="icon-lg"
                    />
                  </button>
                  <button
                    onClick={spotify.nextTrack}
                    className="transition hover:opacity-80"
                  >
                    <Icon name="skip_next" />
                  </button>
                </div>

                {/* Progress bar */}
                <div
                  className="mt-3 h-[3px] rounded-full overflow-hidden"
                  style={{ background: '#222' }}
                >
                  <div
                    className="h-full rounded-full transition-none"
                    style={{
                      width: `${(spotify.progress * 100).toFixed(1)}%`,
                      background:
                        spotify.spotifyState === 'playing'
                          ? '#1DB954'
                          : 'var(--text-dim)',
                    }}
                  />
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── STATUS LOG ── */}
        {log.length > 0 && (
          <section className="mt-auto">
            <div
              className="font-mono text-[10px] space-y-0.5"
              style={{ color: 'var(--text-ghost)' }}
            >
              {log.map((entry, i) => (
                <div key={i} className="log-entry">
                  {entry}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* ── CAMERA OVERLAY ── */}
      {cameraVisible && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={() => exitMode('camera')}
              style={{ color: '#444444', fontSize: '12px' }}
            >
              ← Exit
            </button>
            <div className="flex items-center gap-2">
              <Icon name="camera_alt" className="icon-sm" />
              <span className="text-sm font-medium">Camera</span>
            </div>
            <div className="w-12" />
          </div>
          <div className="flex-1 flex items-center justify-center px-4 pb-4">
            <Camera
              ref={cameraRef}
              onPhoto={() => addLog('Photo saved')}
              onVideoSaved={() => addLog('Video saved')}
            />
          </div>
        </div>
      )}

      {/* ── FOOTER ── */}
      <footer className="text-center pb-4">
        <button
          onClick={() => setShowAbout(true)}
          className="text-[10px] transition"
          style={{ color: 'var(--text-ghost)' }}
        >
          Sling App v{APP_VERSION}
          {watchFwVersion && (
            <span className="ml-2">| Watch fw: v{watchFwVersion}</span>
          )}
        </button>
      </footer>

      {/* ── ABOUT OVERLAY ── */}
      {showAbout && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-6"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setShowAbout(false)}
        >
          <div
            className="rounded-2xl p-6 max-w-sm w-full space-y-4"
            style={{ background: 'var(--bg-card)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-center">About Sling</h2>
            <div
              className="space-y-3 text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Icon name="info" className="icon-sm icon-dim" />
                  <span>App version</span>
                </div>
                <span style={{ color: 'var(--text-primary)' }}>
                  v{APP_VERSION}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Icon name="memory" className="icon-sm icon-dim" />
                  <span>Watch firmware</span>
                </div>
                <span style={{ color: 'var(--text-primary)' }}>
                  {watchFwVersion ? `v${watchFwVersion}` : 'Not connected'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Icon
                    name={
                      ble.connected
                        ? 'bluetooth_connected'
                        : 'bluetooth_disabled'
                    }
                    className={`icon-sm ${ble.connected ? 'icon-active' : 'icon-dim'}`}
                  />
                  <span>BLE</span>
                </div>
                <span style={{ color: 'var(--text-primary)' }}>
                  {ble.connected ? ble.deviceName : 'Disconnected'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Icon
                    name="music_note"
                    className={`icon-sm ${spotify.connected ? 'icon-active' : 'icon-dim'}`}
                  />
                  <span>Spotify</span>
                </div>
                <span style={{ color: 'var(--text-primary)' }}>
                  {spotify.connected ? 'Connected' : 'Not linked'}
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowAbout(false)}
              className="w-full py-3 rounded-xl text-sm font-medium transition hover:opacity-80"
              style={{ background: '#222' }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
