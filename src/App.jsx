import { useCallback, useRef, useState } from 'react';
import useBLE from './hooks/useBLE';
import useAudio, { NOTE_NAMES } from './hooks/useAudio';
import useSpotify from './hooks/useSpotify';
import Camera from './components/Camera';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';

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
  const [watchFwVersion, setWatchFwVersion] = useState(null);
  const [showAbout, setShowAbout] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);

  // Refs to break circular dependency between hooks
  const spotifyRef = useRef(null);
  const bleRef = useRef(null);
  const cameraRef = useRef(null);

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
        const cam = cameraRef.current;
        if (!cam || !cam.isActive()) {
          // First press: open camera
          setCameraVisible(true);
          // Camera component will auto-open via the openCamera button or we trigger it
          setTimeout(() => cameraRef.current?.openCamera(), 100);
          addLog('TAKE_PHOTO → Camera opened');
        } else {
          // Second press: capture with 2s countdown
          cam.takePhotoWithDelay(2);
          addLog('TAKE_PHOTO → Capturing...');
        }
      } else if (cmd === 'START_VIDEO') {
        const cam = cameraRef.current;
        if (!cam || !cam.isActive()) {
          setCameraVisible(true);
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
      } else if (cmd.startsWith('VERSION:')) {
        const ver = cmd.slice(8);
        setWatchFwVersion(ver);
        addLog(`VERSION → fw v${ver}`);
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

          {/* STATE 1: disconnected */}
          {spotify.spotifyState === 'disconnected' && (
            <button
              onClick={spotify.login}
              className="w-full py-4 bg-[#1DB954] hover:bg-[#1ed760] text-black rounded-2xl font-semibold text-sm transition"
            >
              Connect Spotify
            </button>
          )}

          {/* STATE 2: idle — logged in, nothing playing */}
          {spotify.spotifyState === 'idle' && (
            <div className="bg-zinc-900 rounded-2xl p-5 flex flex-col items-center gap-3">
              <span className="text-4xl text-zinc-600">&#9835;</span>
              <p className="text-sm text-zinc-500">
                Open Spotify and play something
              </p>
              <div className="flex gap-6 mt-1">
                <button
                  onClick={() => window.open('spotify:', '_blank')}
                  className="text-xl text-zinc-700 active:text-zinc-500 transition"
                >
                  &#9198;
                </button>
                <button
                  onClick={() => window.open('spotify:', '_blank')}
                  className="text-xl text-zinc-700 active:text-zinc-500 transition"
                >
                  &#9654;
                </button>
                <button
                  onClick={() => window.open('spotify:', '_blank')}
                  className="text-xl text-zinc-700 active:text-zinc-500 transition"
                >
                  &#9197;
                </button>
              </div>
            </div>
          )}

          {/* STATE 3 & 4: playing / paused — has track */}
          {(spotify.spotifyState === 'playing' ||
            spotify.spotifyState === 'paused') && (
            <div
              className={`bg-zinc-900 rounded-2xl p-4 transition-opacity ${
                spotify.spotifyState === 'paused' ? 'opacity-60' : 'opacity-100'
              }`}
            >
              <div className="flex items-center gap-4">
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
                  <div className="flex gap-6 mt-3">
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
                      {spotify.spotifyState === 'playing' ? '⏸' : '▶'}
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

              {/* ── Progress bar ── */}
              <div className="mt-3 h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-green-500 rounded-full transition-none ${
                    spotify.spotifyState === 'playing' ? '' : ''
                  }`}
                  style={{ width: `${(spotify.progress * 100).toFixed(1)}%` }}
                />
              </div>
            </div>
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

      {/* ── CAMERA OVERLAY ── */}
      {cameraVisible && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-medium">Camera</span>
            <button
              onClick={() => {
                cameraRef.current?.stopCamera();
                setCameraVisible(false);
              }}
              className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition text-lg"
            >
              &#10005;
            </button>
          </div>

          {/* Camera feed */}
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
          className="text-[10px] text-zinc-700 hover:text-zinc-500 transition"
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
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6"
          onClick={() => setShowAbout(false)}
        >
          <div
            className="bg-zinc-900 rounded-2xl p-6 max-w-sm w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-center">About Sling</h2>
            <div className="space-y-2 text-sm text-zinc-400">
              <div className="flex justify-between">
                <span>App version</span>
                <span className="text-white">v{APP_VERSION}</span>
              </div>
              <div className="flex justify-between">
                <span>Watch firmware</span>
                <span className="text-white">
                  {watchFwVersion ? `v${watchFwVersion}` : 'Not connected'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>BLE</span>
                <span className="text-white">
                  {ble.connected ? ble.deviceName : 'Disconnected'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Spotify</span>
                <span className="text-white">
                  {spotify.connected ? 'Connected' : 'Not linked'}
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowAbout(false)}
              className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-medium transition mt-2"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
