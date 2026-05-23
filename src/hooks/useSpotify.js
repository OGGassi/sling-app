import { useState, useRef, useEffect, useCallback } from 'react';

const CLIENT_ID = '64f31f35e8ac47149ac415bfb3ea6a8f';
const REDIRECT_URI = 'https://OGGassi.github.io/sling-app/';
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
].join(' ');
const API = 'https://api.spotify.com/v1/me/player';

// ── PKCE helpers ──────────────────────────────────────────────

function randomString(len) {
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(buf, (b) => possible[b % possible.length]).join('');
}

async function sha256Challenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ── Token persistence ─────────────────────────────────────────

function saveTokens(access, refresh, expiresIn) {
  localStorage.setItem('sp_access', access);
  localStorage.setItem('sp_refresh', refresh);
  localStorage.setItem('sp_expiry', String(Date.now() + expiresIn * 1000));
}

function loadTokens() {
  const access = localStorage.getItem('sp_access');
  const refresh = localStorage.getItem('sp_refresh');
  const expiry = Number(localStorage.getItem('sp_expiry') || 0);
  if (!access) return null;
  return { access, refresh, expiry };
}

function clearTokens() {
  localStorage.removeItem('sp_access');
  localStorage.removeItem('sp_refresh');
  localStorage.removeItem('sp_expiry');
}

// ── Hook ──────────────────────────────────────────────────────

export default function useSpotify(sendToWatch) {
  const [connected, setConnected] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [volume, setVolumeState] = useState(50);
  const tokenRef = useRef(null);
  const refreshRef = useRef(null);
  const pollRef = useRef(null);
  const refreshTimerRef = useRef(null);

  // ── Refresh token ───────────────────────────────────────────

  const refreshToken = useCallback(async () => {
    const rt = refreshRef.current || localStorage.getItem('sp_refresh');
    if (!rt) return false;

    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: rt,
          client_id: CLIENT_ID,
        }),
      });
      if (!res.ok) {
        clearTokens();
        tokenRef.current = null;
        refreshRef.current = null;
        setConnected(false);
        return false;
      }

      const data = await res.json();
      tokenRef.current = data.access_token;
      refreshRef.current = data.refresh_token || rt;
      saveTokens(
        data.access_token,
        data.refresh_token || rt,
        data.expires_in
      );
      setConnected(true);

      // Schedule next refresh at 80% of expiry
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(
        refreshToken,
        data.expires_in * 800
      );
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── Authenticated fetch ─────────────────────────────────────

  const api = useCallback(
    async (url, opts = {}) => {
      if (!tokenRef.current) return null;
      const res = await fetch(url, {
        ...opts,
        headers: {
          Authorization: `Bearer ${tokenRef.current}`,
          ...opts.headers,
        },
      });
      if (res.status === 401) {
        const ok = await refreshToken();
        if (ok) {
          // Retry once with new token
          const retry = await fetch(url, {
            ...opts,
            headers: {
              Authorization: `Bearer ${tokenRef.current}`,
              ...opts.headers,
            },
          });
          if (retry.status === 204 || retry.status === 202) return {};
          if (!retry.ok) return null;
          return retry.json();
        }
        tokenRef.current = null;
        setConnected(false);
        return null;
      }
      if (res.status === 204 || res.status === 202) return {};
      if (!res.ok) return null;
      return res.json();
    },
    [refreshToken]
  );

  // ── Playback queries ────────────────────────────────────────

  const getCurrentTrack = useCallback(async () => {
    const data = await api(`${API}/currently-playing`);
    if (data?.item) {
      const track = {
        song: data.item.name,
        artist: data.item.artists.map((a) => a.name).join(', '),
        albumArt: data.item.album?.images?.[0]?.url,
        isPlaying: data.is_playing,
      };
      setCurrentTrack(track);
      if (data.device) setVolumeState(data.device.volume_percent);

      // Push track info to watch over BLE
      if (sendToWatch) {
        sendToWatch(`TRACK:${track.song}:${track.artist}`);
      }

      return track;
    }
    return null;
  }, [api, sendToWatch]);

  // ── Playback controls ───────────────────────────────────────

  const playPause = useCallback(async () => {
    if (currentTrack?.isPlaying) {
      await api(`${API}/pause`, { method: 'PUT' });
    } else {
      await api(`${API}/play`, { method: 'PUT' });
    }
    setTimeout(getCurrentTrack, 300);
  }, [api, currentTrack, getCurrentTrack]);

  const nextTrack = useCallback(async () => {
    await api(`${API}/next`, { method: 'POST' });
    setTimeout(getCurrentTrack, 300);
  }, [api, getCurrentTrack]);

  const prevTrack = useCallback(async () => {
    await api(`${API}/previous`, { method: 'POST' });
    setTimeout(getCurrentTrack, 300);
  }, [api, getCurrentTrack]);

  const setVolume = useCallback(
    async (delta) => {
      const v = Math.max(0, Math.min(100, volume + delta));
      await api(`${API}/volume?volume_percent=${v}`, { method: 'PUT' });
      setVolumeState(v);
    },
    [api, volume]
  );

  // ── OAuth PKCE login ────────────────────────────────────────

  const login = useCallback(async () => {
    const verifier = randomString(64);
    const challenge = await sha256Challenge(verifier);
    localStorage.setItem('spotify_verifier', verifier);

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    });
    window.location.href = `https://accounts.spotify.com/authorize?${params}`;
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    tokenRef.current = null;
    refreshRef.current = null;
    clearTimeout(refreshTimerRef.current);
    clearInterval(pollRef.current);
    setConnected(false);
    setCurrentTrack(null);
  }, []);

  // ── Handle redirect callback ────────────────────────────────

  const handleCallback = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const verifier = localStorage.getItem('spotify_verifier');
    if (!code || !verifier) return false;

    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
    localStorage.removeItem('spotify_verifier');

    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          code_verifier: verifier,
        }),
      });
      if (!res.ok) return false;

      const data = await res.json();
      tokenRef.current = data.access_token;
      refreshRef.current = data.refresh_token;
      saveTokens(data.access_token, data.refresh_token, data.expires_in);
      setConnected(true);

      // Schedule refresh at 80% of expiry
      refreshTimerRef.current = setTimeout(
        refreshToken,
        data.expires_in * 800
      );
      return true;
    } catch {
      return false;
    }
  }, [refreshToken]);

  // ── On mount: restore tokens or handle callback ─────────────

  useEffect(() => {
    const saved = loadTokens();
    if (saved) {
      if (Date.now() < saved.expiry) {
        // Token still valid
        tokenRef.current = saved.access;
        refreshRef.current = saved.refresh;
        setConnected(true);

        const remaining = saved.expiry - Date.now();
        refreshTimerRef.current = setTimeout(
          refreshToken,
          remaining * 0.8
        );
      } else if (saved.refresh) {
        // Expired but has refresh token
        refreshRef.current = saved.refresh;
        refreshToken();
      }
    } else {
      handleCallback();
    }

    return () => {
      clearTimeout(refreshTimerRef.current);
    };
  }, [handleCallback, refreshToken]);

  // ── Poll currently playing every 3s while connected ─────────

  useEffect(() => {
    if (!connected) {
      clearInterval(pollRef.current);
      return;
    }
    getCurrentTrack();
    pollRef.current = setInterval(getCurrentTrack, 3000);
    return () => clearInterval(pollRef.current);
  }, [connected, getCurrentTrack]);

  return {
    connected,
    currentTrack,
    volume,
    login,
    logout,
    playPause,
    nextTrack,
    prevTrack,
    setVolume,
  };
}
