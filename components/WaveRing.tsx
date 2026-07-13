"use client";

import { useEffect, useRef } from "react";

interface WaveRingProps {
  /** live analyser from the mic, or null for simulated motion */
  analyser: AnalyserNode | null;
  /** whether the ring should move at all */
  active: boolean;
  size?: number;
}

const BAR_COUNT = 28;

/**
 * A ring of amplitude bars around the mic stage. Live mode reads the
 * analyser; simulated mode (replays) breathes smoothly. Honest visual:
 * simulated mode is only used on clearly-labeled replays.
 */
export default function WaveRing({ analyser, active, size = 240 }: WaveRingProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const center = size / 2;
    const innerRadius = size * 0.3;
    const maxBar = size * 0.14;
    let t = 0;

    const styles = getComputedStyle(document.documentElement);
    const spotlight = styles.getPropertyValue("--spotlight").trim() || "#d9b36a";
    const rule = styles.getPropertyValue("--rule").trim() || "#4a443c";

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, size, size);
      t += 1;
      for (let i = 0; i < BAR_COUNT; i += 1) {
        let level = 0.12;
        if (active) {
          if (analyser && data) {
            analyser.getByteFrequencyData(data);
            const bin = Math.floor((i / BAR_COUNT) * data.length * 0.6);
            level = Math.max(0.08, (data[bin] ?? 0) / 255);
          } else {
            level =
              0.2 +
              0.16 * Math.abs(Math.sin(t / 14 + i * 0.7)) +
              0.1 * Math.abs(Math.sin(t / 5 + i * 1.9));
          }
        }
        const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
        const barLength = innerRadius * 0.12 + level * maxBar;
        const x0 = center + Math.cos(angle) * innerRadius;
        const y0 = center + Math.sin(angle) * innerRadius;
        const x1 = center + Math.cos(angle) * (innerRadius + barLength);
        const y1 = center + Math.sin(angle) * (innerRadius + barLength);
        ctx.strokeStyle = active && level > 0.15 ? spotlight : rule;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      if (!reduced) {
        frame.current = requestAnimationFrame(draw);
      }
    }

    draw();
    return () => cancelAnimationFrame(frame.current);
  }, [analyser, active, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="mx-auto block"
      aria-hidden="true"
    />
  );
}
