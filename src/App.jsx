import { useCallback, useRef, useState } from 'react';
import useBLE from './hooks/useBLE';
import useAudio, { NOTE_NAMES } from './hooks/useAudio';
import useSpotify from './hooks/useSpotify';

const INSTRUMENT_ICONS = {
  Piano: '\u{1F3B9}',
  Guitar: '\u{1F3B8}',
  Viola: '\u{1F3BB}',
  Flute: '\u{1F3B5}',
  Pantam: '\u{1F941}',
};

export default function App() {
  const audio = useAudio();
  const [log, setLog] = useState([]);

  // Refs to break circular dependency between hooks
  const spotifyRef = useRef(null);
  const bleRef = useRef(null);

  // ── Status log ──────────────────────────────────────────────
  const addLog = useCallback((entry) => {
    setLog((prev) => [entry, ...prev].slice(0, 3));
  }, []);

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
        window.open(
          'intent:#Intent;action=android.media.action.IMAGE_CAPTURE;end',
          '_blank'
        );
        addLog('TAKE_PHOTO → Camera opened');
      } else if (cmd.startsWith('NOTE_ON:')) {
        const [, n, v] = cmd.split(':');
        const idx = parseInt(n);
        audio.playNote(idx, parseInt(v));
        addLog(
          `NOTE_ON:${n}:${v} → ${audio.instrument} ${NOTE_NAMES[idx] || '?'}`
        );
      } else if (cmd.startsWith('NOTE_OFF:')) {
        const [, n] = cmd.split(':');
        audio.stopNote(parseInt(n));
      } else if (cmd === 'GET_TIME') {
        const ts = Math.floor(Date.now() / 1000);
        bl?.sendToWatch(`TIME:${ts}`);
        addLog('GET_TIME → Time synced');
      }
    },
    [audio, addLog]
  );

  // Initialize hooks — BLE first, then Spotify with sendToWatch
  const ble = useBLE({ onCommand: handleCommand });
  const spotify = useSpotify(ble.sendToWatch);

  // Keep refs current
  spotifyRef.current = spotify;
  bleRef.current = ble;

  // ── UI ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black text-white flex flex-col font-[system-ui]">
      {/* ── CONNECTION STATUS BAR ── */}
      <div className="flex justify-between items-center px-5 py-2.5 border-b border-zinc-900 text-xs">
        <span className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              ble.connected
                ? 'bg-green-500'
                : ble.scanning
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-zinc-600'
            }`}
          />
          Sling Watch:{' '}
          {ble.connected
            ? 'Connected'
            : ble.scanning
              ? 'Scanning...'
              : 'Disconnected'}
        </span>
        <span className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              spotify.connected ? 'bg-green-500' : 'bg-zinc-600'
            }`}
          />
          Spotify:{' '}
          {spotify.connected ? (
            <button
              onClick={spotify.logout}
              className="text-green-400 hover:text-white transition"
            >
              Connected
            </button>
          ) : (
            'Login'
          )}
        </span>
      </div>

      {/* ── HEADER / LOGO ── */}
      <header className="pt-10 pb-4 flex flex-col items-center">
        <h1 className="text-4xl font-extralight tracking-[0.25em] lowercase">
          sling
        </h1>
        <p className="text-[10px] tracking-[0.35em] text-zinc-500 uppercase mt-1">
          Small tool. Big impact.
        </p>
      </header>

      <main className="flex-1 px-5 pb-6 flex flex-col gap-5 max-w-md mx-auto w-full">
        {/* ── BLE CONNECT ── */}
        <section>
          {ble.connected ? (
            <div className="flex items-center justify-between bg-zinc-900 rounded-2xl px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                <span className="font-medium text-sm">
                  {ble.deviceName} &#10003;
                </span>
              </div>
              <button
                onClick={ble.disconnect}
                className="text-xs text-zinc-500 hover:text-white transition"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={ble.connect}
              disabled={ble.scanning}
              className="w-full py-4 bg-zinc-900 hover:bg-zinc-800 rounded-2xl font-semibold text-sm transition disabled:opacity-50"
            >
              {ble.scanning ? 'Scanning...' : 'Connect Sling Watch'}
            </button>
          )}
        </section>

        {/* ── INSTRUMENT SELECTOR ── */}
        <section>
          <h2 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-2">
            Instrument
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {audio.instruments.map((name) => (
              <button
                key={name}
                onClick={() => audio.setInstrument(name)}
                className={`flex-shrink-0 flex flex-col items-center gap-1 w-[72px] py-3 rounded-xl text-xs font-medium transition border-2 ${
                  audio.instrument === name
                    ? 'bg-zinc-900 border-white text-white'
                    : 'bg-zinc-900 border-transparent text-zinc-500 hover:text-white'
                }`}
              >
                <span className="text-lg">{INSTRUMENT_ICONS[name]}</span>
                {name}
              </button>
            ))}
          </div>
        </section>

        {/* ── SPOTIFY ── */}
        <section>
          <h2 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-2">
            Spotify
          </h2>
          {spotify.connected ? (
            spotify.currentTrack ? (
              <div className="bg-zinc-900 rounded-2xl p-4 flex items-center gap-4">
                {spotify.currentTrack.albumArt && (
                  <img
                    src={spotify.currentTrack.albumArt}
                    alt="Album"
                    className="w-20 h-20 rounded-lg flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {spotify.currentTrack.song}
                  </p>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">
                    {spotify.currentTrack.artist}
                  </p>
                  <div className="flex gap-4 mt-3">
                    <button
                      onClick={spotify.prevTrack}
                      className="text-lg hover:text-green-400 transition"
                    >
                      &#9198;
                    </button>
                    <button
                      onClick={spotify.playPause}
                      className="text-lg hover:text-green-400 transition"
                    >
                      {spotify.currentTrack.isPlaying ? '⏸' : '▶'}
                    </button>
                    <button
                      onClick={spotify.nextTrack}
                      className="text-lg hover:text-green-400 transition"
                    >
                      &#9197;
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-zinc-900 rounded-2xl p-4 text-sm text-zinc-500">
                No track playing
              </div>
            )
          ) : (
            <button
              onClick={spotify.login}
              className="w-full py-4 bg-[#1DB954] hover:bg-[#1ed760] text-black rounded-2xl font-semibold text-sm transition"
            >
              Connect Spotify
            </button>
          )}
        </section>

        {/* ── STATUS LOG ── */}
        {log.length > 0 && (
          <section>
            <h2 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-2">
              Log
            </h2>
            <div className="bg-zinc-900 rounded-2xl px-4 py-3 font-mono text-[11px] text-zinc-500 space-y-1">
              {log.map((entry, i) => (
                <div key={i}>{entry}</div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* ── FOOTER ── */}
      <footer className="text-center text-[10px] text-zinc-700 pb-4">
        Sling Watch Companion v0.1
      </footer>
    </div>
  );
}
