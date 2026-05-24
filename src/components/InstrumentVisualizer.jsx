import { useRef, useEffect } from 'react';

const COLORS = {
  Piano:  '#00FFFF',
  Guitar: '#FF8C00',
  Viola:  '#9333EA',
  Flute:  '#00FF88',
  Pantam: '#FFD700',
};

export default function InstrumentVisualizer({ activeNotes = [], instrument }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animFrame;
    const color = COLORS[instrument] || '#00FFFF';

    // Parse hex color → rgb for alpha compositing
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);

    function draw(time) {
      ctx.fillStyle = '#080808';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      if (activeNotes.length === 0) {
        // ── IDLE: pulsing corona rings ──
        for (let i = 0; i < 7; i++) {
          const radius = 65 + i * 8;
          const phase = time / 2000 + i * 0.7;
          const alpha = (Math.sin(phase) * 0.5 + 0.5) * 0.4;
          ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Dark center
        ctx.fillStyle = '#080808';
        ctx.beginPath();
        ctx.arc(cx, cy, 60, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // ── ACTIVE: waveform per note ──
        activeNotes.forEach((note) => {
          const noteRatio = (note.note || 0) / 23;
          const hue = noteRatio * 280;
          const vel = (note.velocity || 100) / 127;

          // Waveform
          ctx.strokeStyle = `hsla(${hue}, 100%, 60%, 0.8)`;
          ctx.lineWidth = 2;
          ctx.beginPath();

          const waveFreq = 2 + (note.note || 0) * 0.3;
          const amp = vel * 50 + 15;
          const phase = time / 200 + (note.pitchBend || 0) * 0.1;

          for (let x = 0; x <= canvas.width; x += 2) {
            const t = (x / canvas.width) * Math.PI * 2 * waveFreq;
            const vib = (note.vibrato || 0) > 10
              ? Math.sin(time / 50) * 5
              : 0;
            const y = cy + Math.sin(t + phase + vib) * amp;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // Glow dot at note position
          const dotX = noteRatio * canvas.width;
          for (let gr = 20; gr >= 4; gr -= 4) {
            const a = (0.4 - gr / 60).toFixed(2);
            ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${a})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(dotX, cy, gr, 0, Math.PI * 2);
            ctx.stroke();
          }
          // Solid center dot
          ctx.fillStyle = `hsla(${hue}, 100%, 70%, 0.9)`;
          ctx.beginPath();
          ctx.arc(dotX, cy, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      animFrame = requestAnimationFrame(draw);
    }

    animFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrame);
  }, [activeNotes, instrument]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={160}
      className="w-full rounded-xl"
      style={{ background: '#080808' }}
    />
  );
}
