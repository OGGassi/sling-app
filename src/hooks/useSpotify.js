import { useState, useRef, useEffect, useCallback } from 'react';

const CLIENT_ID =
  import.meta.env.VITE_SPOTIFY_CLIENT_ID || 'YOUR_SPOTIFY_CLIENT_ID';
const REDIRECT_URI =
  import.meta.env.VITE_SPOTIFY_REDIRECT_URI || window.location.origin;
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
].join(' ');
const API = 'https://api.spotify.com/v1/me/player';

// ── PKCE helpers ──────────────────────────────────────────────

function randomHex(len) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Challenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ── Hook ──────────────────────────────────────────────────────

export default function useSpotify() {
  const [connected, setConnected] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [volume, setVolumeState] = useState(50);
  const tokenRef = useRef(null);
  const pollRef = useRef(null);

  // Authenticated fetch — auto-disconnects on 401
  const api = useCallback(async (url, opts = {}) => {
    if (!tokenRef.current) return null;
    const res = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${tokenRef.current}`, ...opts.headers },
    });
    if (res.status === 401) {
      tokenRef.current = null;
      setConnected(false);
      return null;
    }
    if (res.status === 204 || res.status === 202) return {};
    if (!res.ok) return null;
    return res.json();
  }, []);

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
      return track;
    }
    return null;
  }, [api]);

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
    const verifier = randomHex(64);
    const challenge = await sha256Challenge(verifier);
    sessionStorage.setItem('spotify_verifier', verifier);

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

  // Handle redirect callback
  const handleCallback = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const verifier = sessionStorage.getItem('spotify_verifier');
    if (!code || !verifier) return false;

    window.history.replaceState({}, '', window.location.pathname);
    sessionStorage.removeItem('spotify_verifier');

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
    setConnected(true);
    return true;
  }, []);

  // On mount: check for OAuth callback
  useEffect(() => {
    handleCallback();
  }, [handleCallback]);

  // Poll currently playing every 3 s while connected
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
    playPause,
    nextTrack,
    prevTrack,
    setVolume,
  };
}
