"use client";

import { memo, useEffect, useRef, useState } from "react";
import { usePlayerId } from "@/lib/providers/player-provider";
import { getPlayerRefs, usePlayersStore } from "@/lib/stores/players-store";

const CUE_COLORS = [
  "rgba(250, 204, 21, 0.7)",
  "rgba(59, 130, 246, 0.7)",
  "rgba(16, 185, 129, 0.7)",
  "rgba(239, 68, 68, 0.7)",
];

const HEIGHT = 48;
const DEFAULT_CUES = Object.freeze([null, null, null, null] as (
  | number
  | null
)[]);

interface WaveformProps {
  // Zoom multiplier for horizontal detail. 1 = default. Higher shows more detail.
  zoom?: number;
  // Upper bound for preprocessing resolution (number of averaged samples computed once).
  maxResolution?: number;
}

const Waveform = ({ zoom, maxResolution = 4096 }: WaveformProps) => {
  const id = usePlayerId();
  // Select narrowly to avoid re-renders from unrelated track field updates
  const track = usePlayersStore((s) => s.tracks[id]);
  const globalZoom = usePlayersStore((s) => s.zoomSmallWaveform);
  const mp3Url = track?.mp3Url || "";
  const duration = track?.duration || 0;
  const segments = track?.segments;
  const beats = track?.beats;
  const cuePoints = track?.cuePoints ?? DEFAULT_CUES;
  const setCue = usePlayersStore((s) => s.setCue);
  const seek = usePlayersStore((s) => s.seek);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [width, setWidth] = useState(0);
  const prevWidthRef = useRef(0);
  // High-resolution data computed once per track
  const [fullResData, setFullResData] = useState<number[]>([]);
  // Keep raw decoded buffer and channel data for per-frame high-res viewport sampling
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const channelDataRef = useRef<Float32Array | null>(null);
  const [draggingCuePoint, setDraggingCuePoint] = useState<number | null>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [isHoveringPlayhead, setIsHoveringPlayhead] = useState(false);
  const [isJogDragging, setIsJogDragging] = useState(false);
  const lastDragXRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        if (entries[0]) {
          const rounded = Math.round(entries[0].contentRect.width);
          if (rounded !== prevWidthRef.current) {
            prevWidthRef.current = rounded;
            setWidth(rounded);
          }
        }
      });

      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, []);

  useEffect(() => {
    if (!mp3Url) return;

    const processAudio = async () => {
      setLoading(true);
      try {
        const audioContext = new (window.AudioContext ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).webkitAudioContext)();
        const response = await fetch(mp3Url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const channelData = audioBuffer.getChannelData(0);
        const targetSamples = Math.max(
          512,
          Math.min(maxResolution, channelData.length)
        );
        const sampleSize = Math.max(
          1,
          Math.floor(channelData.length / targetSamples)
        );
        const data: number[] = [];
        for (let i = 0; i < targetSamples; i++) {
          const start = i * sampleSize;
          let sum = 0;
          let count = 0;
          for (
            let j = 0;
            j < sampleSize && start + j < channelData.length;
            j++
          ) {
            sum += Math.abs(channelData[start + j]);
            count++;
          }
          data.push(count > 0 ? sum / count : 0);
        }
        setFullResData(data);
        audioBufferRef.current = audioBuffer;
        // Copy to ensure underlying buffer is retained and safe for GC
        channelDataRef.current = new Float32Array(channelData);
      } catch (error) {
        console.error("Error processing audio for waveform:", error);
      } finally {
        setLoading(false);
      }
    };

    processAudio();
  }, [mp3Url, maxResolution]);

  // No-op: drawing happens against fullResData with a viewport slice derived per frame

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || fullResData.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = HEIGHT * dpr;
    canvas.style.width = "100%"; // avoid feedback loop with ResizeObserver
    canvas.style.height = `${HEIGHT}px`;
    canvas.style.display = "block";

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, HEIGHT);

    const drawWaveform = (
      context: CanvasRenderingContext2D,
      viewportStart: number,
      viewportDuration: number,
      effectiveZoom: number
    ) => {
      context.fillStyle = "#A1A1AA"; // zinc-400
      const raw = channelDataRef.current;
      const buffer = audioBufferRef.current;
      if (!raw || !buffer || duration <= 0 || width <= 0) return;

      const samplesPerSecond = buffer.sampleRate;
      const startSample = Math.max(
        0,
        Math.floor(viewportStart * samplesPerSecond)
      );
      const endSample = Math.min(
        raw.length,
        Math.ceil((viewportStart + viewportDuration) * samplesPerSecond)
      );
      const visibleSamples = Math.max(0, endSample - startSample);
      if (visibleSamples <= 0) return;

      // One vertical bar per CSS pixel
      const bars = Math.max(10, Math.floor(width));
      const samplesPerBar = Math.max(1, Math.floor(visibleSamples / bars));

      // First pass: compute per-bar RMS levels (robust against spikes)
      const levels: number[] = new Array(bars);
      for (let i = 0; i < bars; i++) {
        const s0 = startSample + i * samplesPerBar;
        const s1 = Math.min(endSample, s0 + samplesPerBar);
        let sumSq = 0;
        let count = 0;
        for (let s = s0; s < s1; s++) {
          const v = raw[s];
          sumSq += v * v;
          count++;
        }
        const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
        levels[i] = rms;
      }

      // Robust normalization: use the 98th percentile level
      const sorted = [...levels].sort((a, b) => a - b);
      const qIndex = Math.max(
        0,
        Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))
      );
      const peak = Math.max(1e-6, sorted[qIndex]);

      const barWidth = width / bars;
      // At small zoom, draw thinner bars with gaps. Increase fill as zoom increases.
      const fillRatio = Math.max(
        0.35,
        Math.min(0.95, 0.45 + Math.log2(Math.max(1, effectiveZoom)) * 0.1)
      );
      for (let i = 0; i < bars; i++) {
        const level = levels[i];
        const barHeight = Math.max(
          0,
          Math.min(HEIGHT, (level / peak) * HEIGHT)
        );
        const w = Math.max(0.5, barWidth * fillRatio);
        const x = i * barWidth + (barWidth - w) / 2;
        const y = (HEIGHT - barHeight) / 2;
        context.fillRect(x, y, w, barHeight);
      }
    };

    const drawSegments = (
      context: CanvasRenderingContext2D,
      viewportStart: number,
      viewportDuration: number
    ) => {
      if (!segments || !width || !duration) return;

      const colors: { [key: string]: string } = {
        intro: "rgba(74, 222, 128, 0.4)",
        verse: "rgba(96, 165, 250, 0.4)",
        buildup: "rgba(251, 191, 36, 0.4)",
        drop: "rgba(248, 113, 113, 0.4)",
        bridge: "rgba(192, 132, 252, 0.4)",
        outro: "rgba(161, 161, 170, 0.4)",
      };

      segments.forEach((segment) => {
        const segStart = Math.max(segment.start, viewportStart);
        const segEnd = Math.min(segment.end, viewportStart + viewportDuration);
        if (segEnd <= segStart) return;
        const startX = ((segStart - viewportStart) / viewportDuration) * width;
        const endX = ((segEnd - viewportStart) / viewportDuration) * width;
        const segmentWidth = endX - startX;
        context.fillStyle = colors[segment.label] || "rgba(255, 255, 255, 0.2)";
        context.fillRect(startX, 0, segmentWidth, HEIGHT);
        if (segmentWidth >= 20) {
          context.fillStyle = "rgba(255, 255, 255, 0.9)";
          context.font = "10px sans-serif";
          context.textAlign = "center";
          context.fillText(
            segment.label,
            startX + segmentWidth / 2,
            HEIGHT / 2 + 4
          );
        }
      });
    };

    const drawBeatGrid = (
      context: CanvasRenderingContext2D,
      viewportStart: number,
      viewportDuration: number,
      effectiveZoom: number
    ) => {
      if (!beats || beats.length === 0 || !width) return;
      // Fade grid by zoom: invisible at 1x, stronger toward higher zooms
      const z = Math.max(1, effectiveZoom);
      const fade = Math.max(0, Math.min(1, (Math.log2(z) - 0) / 4)); // 0 at 1x, ~1 near 16x
      if (fade <= 0) return;
      const weakAlpha = Math.min(0.35, 0.12 + fade * 0.18);
      const strongAlpha = Math.min(0.65, 0.24 + fade * 0.41);
      const weakWidth = Math.min(2, 0.8 + fade * 0.6);
      const strongWidth = Math.min(3, 1.2 + fade * 1.1);

      // Precompute visible beat indices (plus neighbors for subdivisions)
      const startT = viewportStart - viewportDuration * 0.5;
      const endT = viewportStart + viewportDuration * 1.5;
      const indices: number[] = [];
      for (let i = 0; i < beats.length; i++) {
        const t = beats[i];
        if (t >= startT && t <= endT) indices.push(i);
      }
      if (indices.length === 0) return;

      context.save();
      context.globalCompositeOperation = "source-over"; // overlay on top

      const drawLine = (xPos: number, isStrong: boolean) => {
        const x = Math.round(xPos) + 0.5; // crisp line
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, HEIGHT);
        context.lineWidth = isStrong ? strongWidth : weakWidth;
        context.strokeStyle = `rgba(255,255,255,${
          isStrong ? strongAlpha : weakAlpha
        })`;
        context.stroke();
      };

      // Draw primary beats; every 4th as strong
      for (const i of indices) {
        const t = beats[i];
        const rel = (t - viewportStart) / viewportDuration;
        if (rel < 0 || rel > 1) continue;
        const x = rel * width;
        drawLine(x, i % 4 === 0);
      }

      // Subdivisions at higher zoom for better guidance
      if (effectiveZoom >= 6) {
        for (const i of indices) {
          if (i + 1 >= beats.length) break;
          const t0 = beats[i];
          const t1 = beats[i + 1];
          const half = t0 + (t1 - t0) * 0.5;
          const relH = (half - viewportStart) / viewportDuration;
          if (relH >= 0 && relH <= 1) {
            const xH = relH * width;
            drawLine(xH, false);
          }

          if (effectiveZoom >= 12) {
            const q1 = t0 + (t1 - t0) * 0.25;
            const q3 = t0 + (t1 - t0) * 0.75;
            const relQ1 = (q1 - viewportStart) / viewportDuration;
            const relQ3 = (q3 - viewportStart) / viewportDuration;
            if (relQ1 >= 0 && relQ1 <= 1) drawLine(relQ1 * width, false);
            if (relQ3 >= 0 && relQ3 <= 1) drawLine(relQ3 * width, false);
          }
        }
      }

      context.restore();
    };

    const drawPlayhead = (
      context: CanvasRenderingContext2D,
      nowTime: number,
      viewportStart: number,
      viewportDuration: number
    ) => {
      if (!duration || !width) return;
      const progressX = ((nowTime - viewportStart) / viewportDuration) * width;
      const clampedX = Math.max(0, Math.min(width, progressX));
      context.fillStyle = "rgba(250, 250, 250, 0.2)";
      context.fillRect(0, 0, clampedX, HEIGHT);
      if (isHoveringPlayhead || isDraggingPlayhead) {
        if (progressX >= 0 && progressX <= width) {
          context.fillStyle = "rgba(250, 250, 250, 0.9)";
          context.fillRect(progressX - 1, 0, 3, HEIGHT);
        }
      }
    };

    const drawCuePoints = (
      context: CanvasRenderingContext2D,
      viewportStart: number,
      viewportDuration: number
    ) => {
      if (!cuePoints || !duration || !width) return;
      cuePoints.forEach((cue, index) => {
        if (cue === null) return;
        const relative = (cue - viewportStart) / viewportDuration;
        if (relative < 0 || relative > 1) return;
        context.fillStyle = CUE_COLORS[index] || "rgba(250, 204, 21, 0.7)";
        const cueX = relative * width;
        context.fillRect(cueX - 1, 0, 2, HEIGHT);
      });
    };

    const renderOnce = () => {
      ctx.clearRect(0, 0, width, HEIGHT);
      const refs = getPlayerRefs(id);
      const nowTime = refs?.audioEl?.currentTime || 0;
      const effectiveZoom = (zoom ?? globalZoom) || 1;
      const isZoomed = effectiveZoom > 1 && duration > 0;
      const viewportDuration = isZoomed
        ? Math.max(0.001, duration / effectiveZoom)
        : duration;
      const half = viewportDuration / 2;
      const maxStart = Math.max(0, duration - viewportDuration);
      const viewportStart = isZoomed
        ? Math.max(0, Math.min(maxStart, nowTime - half))
        : 0;

      // Draw waveform and segments first, grid overlays them
      drawWaveform(ctx, viewportStart, viewportDuration, effectiveZoom);
      drawSegments(ctx, viewportStart, viewportDuration);
      drawBeatGrid(ctx, viewportStart, viewportDuration, effectiveZoom);
      if (duration) {
        drawPlayhead(ctx, nowTime, viewportStart, viewportDuration);
        drawCuePoints(ctx, viewportStart, viewportDuration);
      }
    };

    const loop = () => {
      const audio = getPlayerRefs(id)?.audioEl;
      const isPlayingNow = !!audio && audio.paused === false;
      renderOnce();
      if (isPlayingNow || isDraggingPlayhead || isJogDragging) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        rafRef.current = null;
      }
    };

    // Initial draw
    renderOnce();
    // If currently playing, start loop
    const audioEl = getPlayerRefs(id)?.audioEl;
    if (audioEl && audioEl.paused === false) {
      loop();
    }
    const onPlay = () => {
      if (!rafRef.current) loop();
    };
    const onPause = () => {
      renderOnce();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    const onSeeked = () => renderOnce();
    audioEl?.addEventListener("play", onPlay);
    audioEl?.addEventListener("pause", onPause);
    audioEl?.addEventListener("seeked", onSeeked);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audioEl?.removeEventListener("play", onPlay);
      audioEl?.removeEventListener("pause", onPause);
      audioEl?.removeEventListener("seeked", onSeeked);
    };
  }, [
    fullResData,
    width,
    segments,
    beats,
    cuePoints,
    duration,
    isDraggingPlayhead,
    isHoveringPlayhead,
    id,
    zoom,
    globalZoom,
    isJogDragging,
  ]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!duration) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    const refs = getPlayerRefs(id);
    const nowTime = refs?.audioEl?.currentTime || 0;
    const effectiveZoom = (zoom ?? globalZoom) || 1;
    const isZoomed = effectiveZoom > 1 && duration > 0;
    const viewportDuration = isZoomed
      ? Math.max(0.001, duration / effectiveZoom)
      : duration;
    const half = viewportDuration / 2;
    const maxStart = Math.max(0, duration - viewportDuration);
    const viewportStart = isZoomed
      ? Math.max(0, Math.min(maxStart, nowTime - half))
      : 0;

    // Check for cue point drag first
    if (cuePoints) {
      for (let i = 0; i < cuePoints.length; i++) {
        const cue = cuePoints[i];
        if (cue === null) continue;
        const rel = (cue - viewportStart) / viewportDuration;
        if (rel < 0 || rel > 1) continue;
        const cueX = rel * width;
        if (Math.abs(x - cueX) < 5) {
          setDraggingCuePoint(i);
          return; // Prioritize cue point dragging
        }
      }
    }

    // If not dragging a cue point, decide behavior based on zoom level.
    if (effectiveZoom > 1.5) {
      // Jog-style drag: keep playhead centered, drag the audio underneath.
      setIsJogDragging(true);
      lastDragXRef.current = x;
      canvas.style.cursor = "grabbing";
      console.log("[waveform] mousedown jog start", { id, x, effectiveZoom });
    } else {
      // Low zoom: treat as playhead handle drag.
      setIsDraggingPlayhead(true);
      const newTime = viewportStart + (x / width) * viewportDuration;
      const t = Math.max(0, Math.min(duration, newTime));
      console.log("[waveform] mousedown seek (no autoplay)", {
        id,
        x,
        t,
        width,
        duration,
      });
      // On click: only seek. If already playing, audio continues. If paused, stays paused.
      seek(id, t);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Change cursor for cue points
    let isHoveringCue = false;
    const refs = getPlayerRefs(id);
    const nowTime = refs?.audioEl?.currentTime || 0;
    const effectiveZoom = (zoom ?? globalZoom) || 1;
    const isZoomed = effectiveZoom > 1 && duration > 0;
    const viewportDuration = isZoomed
      ? Math.max(0.001, duration / effectiveZoom)
      : duration;
    const half = viewportDuration / 2;
    const maxStart = Math.max(0, duration - viewportDuration);
    const viewportStart = isZoomed
      ? Math.max(0, Math.min(maxStart, nowTime - half))
      : 0;
    if (cuePoints) {
      for (const cue of cuePoints) {
        if (cue === null) continue;
        const rel = (cue - viewportStart) / viewportDuration;
        if (rel < 0 || rel > 1) continue;
        const cueX = rel * width;
        if (Math.abs(x - cueX) < 5) {
          isHoveringCue = true;
          break;
        }
      }
    }

    // Change cursor for playhead
    let isHoveringHead = false;
    const progressX = ((nowTime - viewportStart) / viewportDuration) * width;
    if (Math.abs(x - progressX) < 5) {
      isHoveringHead = true;
    }
    setIsHoveringPlayhead(isHoveringHead);

    if (isHoveringCue) {
      canvas.style.cursor = "ew-resize";
    } else if (isHoveringHead) {
      canvas.style.cursor = "pointer";
    } else {
      canvas.style.cursor = "default";
    }

    // Handle dragging cue point
    if (draggingCuePoint !== null) {
      const newTime = viewportStart + (x / width) * viewportDuration;
      const t = Math.max(0, Math.min(duration, newTime));
      console.log("[waveform] drag cue", {
        id,
        cueIndex: draggingCuePoint,
        t,
      });
      setCue(id, draggingCuePoint, t);
    }

    // Handle dragging playhead
    if (isDraggingPlayhead) {
      const newTime = viewportStart + (x / width) * viewportDuration;
      const t = Math.max(0, Math.min(duration, newTime));
      console.debug("[waveform] drag playhead seek", { id, t });
      seek(id, t);
    }

    // Handle jog-style dragging at higher zoom
    if (isJogDragging) {
      const lastX = lastDragXRef.current ?? x;
      const deltaX = x - lastX;
      lastDragXRef.current = x;

      const refs2 = getPlayerRefs(id);
      const nowTime2 = refs2?.audioEl?.currentTime || 0;
      const effectiveZoom2 = (zoom ?? globalZoom) || 1;
      const isZoomed2 = effectiveZoom2 > 1 && duration > 0;
      const viewportDuration2 = isZoomed2
        ? Math.max(0.001, duration / effectiveZoom2)
        : duration;

      // Convert horizontal movement to time delta. Dragging left advances forward.
      const deltaTime = -(deltaX / Math.max(1, width)) * viewportDuration2;
      const t = Math.max(0, Math.min(duration, nowTime2 + deltaTime));
      // Only seek; playback state is preserved.
      seek(id, t);
    }
  };

  const handleMouseUp = () => {
    setDraggingCuePoint(null);
    setIsDraggingPlayhead(false);
    setIsJogDragging(false);
    lastDragXRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "default";
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center"
    >
      {loading && (
        <div className="absolute text-xs text-zinc-500">
          Loading waveform...
        </div>
      )}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
};

export default memo(Waveform);
