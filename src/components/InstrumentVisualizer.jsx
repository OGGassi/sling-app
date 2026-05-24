import { useRef, useEffect } from 'react';

const COLORS = {
  Piano:  '#00FFFF',
  Guitar: '#FF8C00',
  Viola:  '#9333EA',
  Flute:  '#00FF88',
  Pantam: '#FFD700',
};

export default function InstrumentVisualizer({ activeNotes = [], instrument = 'Piano' }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const color = COLORS[instrument] || '#00FFFF';

    // Parse hex → rgb for alpha compositing
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);

    function draw(time) {
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;

      // Clear
      ctx.fillStyle = '#080808';
      ctx.fillRect(0, 0, W, H);

      if (activeNotes.length === 0) {
        // ── IDLE: pulsing corona rings ──
        for (let i = 0; i < 6; i++) {
          const radius = 70 + i * 5;
          const phase = time / 2000 + i * 0.7;
          const alpha = (Math.sin(phase) * 0.5 + 0.5) * 0.7;
          ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Dark center
        ctx.fillStyle = '#080808';
        ctx.beginPath();
        ctx.arc(cx, cy, 65, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // ── ACTIVE: waveform per note ──
        activeNotes.forEach((note) => {
          const noteVal = note.note || 0;
          const ratio = noteVal / 23;
          const hue = ratio * 280;
          const vel = (note.velocity || 80) / 127;
          const amp = vel * 55 + 15;
          const freq = 1.5 + noteVal * 0.25;
          const speed = time / 150;

          // Waveform
          ctx.strokeStyle = `hsla(${hue}, 100%, 65%, 0.85)`;
          ctx.lineWidth = 2.5;
          ctx.beginPath();

          for (let x = 0; x <= W; x += 2) {
            const t = (x / W) * Math.PI * 2 * freq;
            const vib = (note.vibrato || 0) > 10 ? Math.sin(time / 50) * 5 : 0;
            const y = cy + Math.sin(t + speed + vib) * amp;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // Glow dot at note position
          const nx = ratio * W;
          for (let gr = 20; gr >= 4; gr -= 4) {
            const a = (0.05 * (20 - gr)).toFixed(2);
            ctx.strokeStyle = `hsla(${hue}, 100%, 65%, ${a})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(nx, cy, gr, 0, Math.PI * 2);
            ctx.stroke();
          }
          // Solid center dot
          ctx.fillStyle = `hsla(${hue}, 100%, 70%, 0.9)`;
          ctx.beginPath();
          ctx.arc(nx, cy, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [activeNotes, instrument]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={180}
      style={{
        width: '100%',
        maxWidth: '400px',
        height: 'auto',
        borderRadius: '16px',
        display: 'block',
        margin: '0 auto',
        background: '#080808',
      }}
    />
  );
}
