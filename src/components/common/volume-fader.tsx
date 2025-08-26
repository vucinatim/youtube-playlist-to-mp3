"use client";

import { useEffect, useRef } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { usePlayersStore, getPlayerRefs } from "@/lib/stores/players-store";
import { usePlayerId } from "@/lib/providers/player-provider";

const SHOW_METER_SCALE = true;
const MAX_RMS = 0.9;

const VolumeFader = () => {
  const id = usePlayerId();
  const volume = usePlayersStore((s) => s.tracks[id]?.volume ?? 1);
  const duration = usePlayersStore((s) => s.tracks[id]?.duration || 0);
  const setVolume = usePlayersStore((s) => s.setVolume);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const leftAnalyzerRef = useRef<AnalyserNode | null>(null);
  const rightAnalyzerRef = useRef<AnalyserNode | null>(null);
  const monoAnalyzerRef = useRef<AnalyserNode | null>(null);
  const pullGainRef = useRef<GainNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);

  const attachedElRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // If already initialized for this track, skip re-init
    if (sourceRef.current && audioCtxRef.current) {
      return () => {};
    }
    const refs = getPlayerRefs(id);
    const audio = refs?.audioEl || null;
    if (!audio) return;
    attachedElRef.current = audio;

    const AC =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).AudioContext || (window as any).webkitAudioContext;
    // Some Safari contexts must be resumed on interaction; we keep it simple here
    const ctx: AudioContext = new AC();
    audioCtxRef.current = ctx;

    const source = ctx.createMediaElementSource(audio);
    sourceRef.current = source;

    // Build stereo split analyzers
    const splitter = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    left.fftSize = 2048;
    right.fftSize = 2048;
    source.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    splitterRef.current = splitter;
    leftAnalyzerRef.current = left;
    rightAnalyzerRef.current = right;

    // Mono fallback analyzer (tap same source)
    const mono = ctx.createAnalyser();
    mono.fftSize = 2048;
    source.connect(mono);
    monoAnalyzerRef.current = mono;

    const tdLeft = new Uint8Array(left.fftSize);
    const tdRight = new Uint8Array(right.fftSize);
    let smoothedL = 0;
    let smoothedR = 0;
    let peakHoldL = 0;
    let peakHoldR = 0;
    const tau = 0.3; // seconds
    const peakDecayPerSec = 1.2;
    let lastTs =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    const onPlay = () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== "running") {
        void audioCtxRef.current.resume();
      }
    };
    audio.addEventListener("play", onPlay);

    // Ensure context running if media is already playing
    if (audioCtxRef.current?.state === "suspended" && !audio.paused) {
      void audioCtxRef.current.resume();
    }

    // Create a zero-gain sink to pull the graph so analyzers receive data
    const pullGain = ctx.createGain();
    pullGain.gain.value = 0;
    left.connect(pullGain);
    right.connect(pullGain);
    pullGain.connect(ctx.destination);
    pullGainRef.current = pullGain;

    // Ensure audible path via context as some browsers stop default path
    const outputGain = ctx.createGain();
    outputGain.gain.value = Math.max(0, Math.min(1, audio.volume ?? 1));
    source.connect(outputGain);
    outputGain.connect(ctx.destination);
    outputGainRef.current = outputGain;

    let lastDraw = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const l = leftAnalyzerRef.current;
      const r = rightAnalyzerRef.current;
      const monoA = monoAnalyzerRef.current;
      if (!canvas || !l || !r) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // Time step
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const dt = Math.max(0.0001, (now - lastTs) / 1000);
      lastTs = now;

      // Size to device pixels
      const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(1, Math.floor(rect.width));
      const cssH = Math.max(1, Math.floor(rect.height));
      const targetW = Math.floor(cssW * dpr);
      const targetH = Math.floor(cssH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Compute instantaneous RMS per channel, fallback to mono if silent
      l.getByteTimeDomainData(tdLeft);
      r.getByteTimeDomainData(tdRight);
      let sumL = 0;
      let sumR = 0;
      for (let i = 0; i < tdLeft.length; i++) {
        const v = (tdLeft[i] - 128) / 128;
        sumL += v * v;
      }
      for (let i = 0; i < tdRight.length; i++) {
        const v = (tdRight[i] - 128) / 128;
        sumR += v * v;
      }
      let instL = Math.sqrt(sumL / tdLeft.length);
      let instR = Math.sqrt(sumR / tdRight.length);

      // If stereo looks silent but mono has activity, fallback to mono RMS
      if (monoA && instL < 1e-4 && instR < 1e-4) {
        const tdMono = new Uint8Array(monoA.fftSize);
        monoA.getByteTimeDomainData(tdMono);
        let sum = 0;
        for (let i = 0; i < tdMono.length; i++) {
          const v = (tdMono[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / tdMono.length);
        instL = rms;
        instR = rms;
      }

      const alpha = 1 - Math.exp(-dt / tau);
      smoothedL = smoothedL + alpha * (instL - smoothedL);
      smoothedR = smoothedR + alpha * (instR - smoothedR);
      peakHoldL = Math.max(
        instL,
        Math.max(0, peakHoldL - peakDecayPerSec * dt)
      );
      peakHoldR = Math.max(
        instR,
        Math.max(0, peakHoldR - peakDecayPerSec * dt)
      );

      const gain = Math.max(0, Math.min(1, volume ?? 1));
      const DB_MIN = -30;
      const ampL = Math.min(smoothedL / MAX_RMS, 1) * gain;
      const ampR = Math.min(smoothedR / MAX_RMS, 1) * gain;
      const dbL = 20 * Math.log10(Math.max(1e-6, ampL));
      const dbR = 20 * Math.log10(Math.max(1e-6, ampR));
      const tL = Math.max(0, Math.min(1, (dbL - DB_MIN) / (0 - DB_MIN)));
      const tR = Math.max(0, Math.min(1, (dbR - DB_MIN) / (0 - DB_MIN)));
      const barHeightL = tL * cssH;
      const barHeightR = tR * cssH;

      // Clear
      ctx2d.clearRect(0, 0, cssW, cssH);

      // Bars
      const barWidth = Math.max(4, Math.floor(cssW * 0.35));
      const leftX = 0;
      const rightX = cssW - barWidth;

      // Static full-height gradient, clipped to current bar height (Left)
      const gradL = ctx2d.createLinearGradient(0, cssH, 0, 0);
      gradL.addColorStop(0, "#22c55e");
      gradL.addColorStop(0.6, "#eab308");
      gradL.addColorStop(1, "#ef4444");
      ctx2d.save();
      ctx2d.beginPath();
      ctx2d.rect(leftX, cssH - barHeightL, barWidth, barHeightL);
      ctx2d.clip();
      ctx2d.fillStyle = gradL;
      ctx2d.fillRect(leftX, 0, barWidth, cssH);
      ctx2d.restore();

      // Static full-height gradient, clipped to current bar height (Right)
      const gradR = ctx2d.createLinearGradient(0, cssH, 0, 0);
      gradR.addColorStop(0, "#22c55e");
      gradR.addColorStop(0.6, "#eab308");
      gradR.addColorStop(1, "#ef4444");
      ctx2d.save();
      ctx2d.beginPath();
      ctx2d.rect(rightX, cssH - barHeightR, barWidth, barHeightR);
      ctx2d.clip();
      ctx2d.fillStyle = gradR;
      ctx2d.fillRect(rightX, 0, barWidth, cssH);
      ctx2d.restore();

      // Peak lines
      const peakAmpL = Math.min(peakHoldL / MAX_RMS, 1) * gain;
      const peakDbL = 20 * Math.log10(Math.max(1e-6, peakAmpL));
      const peakYL = Math.max(
        0,
        Math.min(cssH - 1, cssH - ((peakDbL - DB_MIN) / (0 - DB_MIN)) * cssH)
      );
      ctx2d.strokeStyle = "rgba(255,255,255,0.8)";
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(leftX, peakYL);
      ctx2d.lineTo(leftX + barWidth, peakYL);
      ctx2d.stroke();

      const peakAmpR = Math.min(peakHoldR / MAX_RMS, 1) * gain;
      const peakDbR = 20 * Math.log10(Math.max(1e-6, peakAmpR));
      const peakYR = Math.max(
        0,
        Math.min(cssH - 1, cssH - ((peakDbR - DB_MIN) / (0 - DB_MIN)) * cssH)
      );
      ctx2d.beginPath();
      ctx2d.moveTo(rightX, peakYR);
      ctx2d.lineTo(rightX + barWidth, peakYR);
      ctx2d.stroke();

      // Left-edge dB scale
      if (SHOW_METER_SCALE) {
        const major = [0, -3, -6, -9, -12, -18, -24, -30];
        const toY = (db: number) => {
          const t = (db - DB_MIN) / (0 - DB_MIN);
          return Math.max(6, Math.min(cssH - 6, cssH - t * cssH));
        };
        ctx2d.strokeStyle = "rgba(255,255,255,0.3)";
        ctx2d.fillStyle = "rgba(255,255,255,0.7)";
        ctx2d.textAlign = "left";
        ctx2d.textBaseline = "middle";
        ctx2d.font = "8px ui-sans-serif, system-ui, -apple-system, Segoe UI";
        for (const db of major) {
          const y = toY(db);
          ctx2d.beginPath();
          ctx2d.moveTo(0, y);
          ctx2d.lineTo(Math.min(6, cssW * 0.25), y);
          ctx2d.stroke();
          ctx2d.fillText(`${db}`, 1, y);
        }
      }

      // Throttle to ~30-45fps max; analyzer input is noisy but UI doesn't need 60Hz
      const nowTs = performance.now();
      if (nowTs - lastDraw > 22) {
        lastDraw = nowTs;
        rafRef.current = requestAnimationFrame(draw);
      } else {
        rafRef.current = requestAnimationFrame(draw);
      }
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audio.removeEventListener("play", onPlay);
      try {
        splitterRef.current?.disconnect();
      } catch {}
      try {
        leftAnalyzerRef.current?.disconnect();
      } catch {}
      try {
        rightAnalyzerRef.current?.disconnect();
      } catch {}
      try {
        monoAnalyzerRef.current?.disconnect();
      } catch {}
      try {
        pullGainRef.current?.disconnect();
      } catch {}
      try {
        outputGainRef.current?.disconnect();
      } catch {}
      try {
        sourceRef.current?.disconnect();
      } catch {}
      try {
        audioCtxRef.current?.close();
      } catch {}
      splitterRef.current = null;
      leftAnalyzerRef.current = null;
      rightAnalyzerRef.current = null;
      monoAnalyzerRef.current = null;
      pullGainRef.current = null;
      outputGainRef.current = null;
      sourceRef.current = null;
      audioCtxRef.current = null;
      attachedElRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, duration]);

  // Sync output gain with store volume and keep element volume at unity to avoid double attenuation
  useEffect(() => {
    if (outputGainRef.current) {
      outputGainRef.current.gain.value = Math.max(0, Math.min(1, volume ?? 1));
    }
    const el = attachedElRef.current;
    if (el) el.volume = 1;
  }, [volume]);

  const handleVolumeChange = (value: number[]) => {
    const v = Array.isArray(value) && value.length > 0 ? value[0] : 0;
    // Only set when actually changed to avoid excessive store updates
    if (v !== (volume ?? 1)) setVolume(id, v);
  };

  return (
    <div
      className="relative h-full w-12 select-none bg-zinc-900 rounded-md"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      <SliderPrimitive.Root
        orientation="vertical"
        className="absolute inset-x-0 inset-y-2 flex cursor-pointer touch-none select-none items-center justify-center"
        value={[volume]}
        onValueChange={handleVolumeChange}
        min={0}
        max={1}
        step={0.01}
      >
        <SliderPrimitive.Track className="relative h-full w-1 overflow-hidden rounded-full">
          <div className="absolute inset-0 bg-zinc-700">
            <SliderPrimitive.Range className="absolute h-full bg-primary" />
          </div>
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-2 w-6 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
      </SliderPrimitive.Root>
    </div>
  );
};

export default VolumeFader;
