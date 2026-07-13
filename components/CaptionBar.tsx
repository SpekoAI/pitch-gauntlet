"use client";

import { useEffect, useRef, useState } from "react";

interface CaptionBarProps {
  speaker: string | null;
  text: string;
  tone: "panel" | "founder";
  /** ms per character while typing in */
  charMs?: number;
}

/**
 * Broadcast lower-third. Types the caption in fast; panel lines get the
 * interrupt treatment, founder lines stay parchment.
 */
export default function CaptionBar({
  speaker,
  text,
  tone,
  charMs = 14,
}: CaptionBarProps) {
  const [shown, setShown] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setShown("");
    if (!text) {
      return;
    }
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShown(text);
      return;
    }
    let index = 0;
    timer.current = setInterval(() => {
      index += 2;
      setShown(text.slice(0, index));
      if (index >= text.length && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    }, charMs);
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [text, charMs]);

  const typing = shown.length < text.length;

  return (
    <div className="min-h-[5.5rem] border-t-2 border-rulec bg-stage-deep px-4 py-3 sm:px-6">
      {speaker && (
        <p
          className={[
            "font-display text-xs uppercase tracking-widest",
            tone === "panel" ? "text-interrupt-bright" : "text-spotlight",
          ].join(" ")}
        >
          {speaker}
        </p>
      )}
      <p
        className={[
          "mt-1 text-base sm:text-lg",
          tone === "panel" ? "font-semibold text-parchment" : "text-parchment-dim",
          typing ? "type-caret" : "",
        ].join(" ")}
        aria-live="polite"
      >
        {shown}
      </p>
    </div>
  );
}
