import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

const Camera = forwardRef(function Camera({ onPhoto, onVideoSaved }, ref) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  const [active, setActive] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [flash, setFlash] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [facingMode, setFacingMode] = useState('environment');
  const [lastPhoto, setLastPhoto] = useState(null);

  const recordTimerRef = useRef(null);

  // ── Open camera stream ──────────────────────────────────────

  const openCamera = useCallback(
    async (facing) => {
      const mode = facing || facingMode;
      try {
        // Stop any existing stream first
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }

        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: true,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
        streamRef.current = s;
        setActive(true);
        setFacingMode(mode);
      } catch (e) {
        console.error('Camera error:', e);
      }
    },
    [facingMode]
  );

  // ── Stop camera stream ──────────────────────────────────────

  const stopCamera = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    clearInterval(recordTimerRef.current);
    setActive(false);
    setRecording(false);
    setRecordTime(0);
    setCountdown(0);
    setLastPhoto(null);
  }, []);

  // ── Capture photo ───────────────────────────────────────────

  const capturePhoto = useCallback(() => {
    if (!videoRef.current) return;

    // Flash effect
    setFlash(true);
    setTimeout(() => setFlash(false), 150);

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0);

    canvas.toBlob(
      (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sling-${Date.now()}.jpg`;
        a.click();

        setLastPhoto(url);
        setTimeout(() => setLastPhoto(null), 2000);
        onPhoto?.(url);
      },
      'image/jpeg',
      0.92
    );
  }, [onPhoto]);

  // ── Take photo with countdown ───────────────────────────────

  const takePhotoWithDelay = useCallback(
    (delay = 2) => {
      if (!active) {
        // Camera not open yet — open it first, take photo on next call
        openCamera();
        return;
      }

      if (delay <= 0) {
        capturePhoto();
        return;
      }

      setCountdown(delay);
      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            capturePhoto();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    },
    [active, openCamera, capturePhoto]
  );

  // ── Start video recording ───────────────────────────────────

  const startVideo = useCallback(async () => {
    if (!active) await openCamera();
    if (!streamRef.current) return;

    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sling-${Date.now()}.webm`;
      a.click();
      onVideoSaved?.(url);
    };

    recorder.start(1000);
    recorderRef.current = recorder;
    setRecording(true);
    setRecordTime(0);

    recordTimerRef.current = setInterval(() => {
      setRecordTime((prev) => prev + 1);
    }, 1000);
  }, [active, openCamera, onVideoSaved]);

  // ── Stop video recording ────────────────────────────────────

  const stopVideo = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    clearInterval(recordTimerRef.current);
    setRecording(false);
    setRecordTime(0);
  }, []);

  // ── Flip camera ─────────────────────────────────────────────

  const flipCamera = useCallback(() => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    openCamera(next);
  }, [facingMode, openCamera]);

  // ── Expose methods to parent via ref ────────────────────────

  useImperativeHandle(
    ref,
    () => ({
      openCamera,
      takePhotoWithDelay,
      capturePhoto,
      startVideo,
      stopVideo,
      stopCamera,
      isActive: () => active,
      isRecording: () => recording,
    }),
    [openCamera, takePhotoWithDelay, capturePhoto, startVideo, stopVideo, stopCamera, active, recording]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // ── Format recording time ───────────────────────────────────

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // ── Render ──────────────────────────────────────────────────

  if (!active) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <span className="text-5xl text-zinc-600">&#128247;</span>
        <p className="text-sm text-zinc-500">Camera not active</p>
        <button
          onClick={() => openCamera()}
          className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-medium transition"
        >
          Open Camera
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      {/* ── Video feed ── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full rounded-xl bg-black"
        style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
      />

      {/* ── Flash effect ── */}
      {flash && (
        <div className="absolute inset-0 bg-white rounded-xl pointer-events-none animate-pulse" />
      )}

      {/* ── Countdown overlay ── */}
      {countdown > 0 && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
          <span className="text-7xl font-bold text-white drop-shadow-lg animate-ping">
            {countdown}
          </span>
        </div>
      )}

      {/* ── Last photo thumbnail ── */}
      {lastPhoto && (
        <div className="absolute top-3 left-3 w-16 h-16 rounded-lg overflow-hidden border-2 border-white shadow-lg">
          <img src={lastPhoto} alt="Last" className="w-full h-full object-cover" />
        </div>
      )}

      {/* ── Recording indicator ── */}
      {recording && (
        <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/60 rounded-full px-3 py-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-mono text-white">{formatTime(recordTime)}</span>
        </div>
      )}

      {/* ── Controls bar ── */}
      <div className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-6 py-4 bg-gradient-to-t from-black/70 to-transparent rounded-b-xl">
        {/* Flip camera */}
        <button
          onClick={flipCamera}
          className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition"
        >
          &#x21BB;
        </button>

        {/* Shutter / record */}
        {!recording ? (
          <button
            onClick={() => takePhotoWithDelay(0)}
            className="w-16 h-16 rounded-full border-4 border-white bg-white/20 hover:bg-white/40 transition active:scale-90"
          />
        ) : (
          <button
            onClick={stopVideo}
            className="w-16 h-16 rounded-full border-4 border-red-500 flex items-center justify-center hover:bg-red-500/20 transition"
          >
            <span className="w-6 h-6 rounded-sm bg-red-500" />
          </button>
        )}

        {/* Video toggle */}
        <button
          onClick={recording ? stopVideo : startVideo}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition ${
            recording
              ? 'bg-red-500/30 text-red-400'
              : 'bg-white/20 text-white hover:bg-white/30'
          }`}
        >
          &#9679;
        </button>
      </div>
    </div>
  );
});

export default Camera;
