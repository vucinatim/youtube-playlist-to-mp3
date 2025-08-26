"use client";

import { useEffect, useRef } from "react";
import Waveform from "./waveform";
import { Button } from "../ui/button";
import { Pause, Play } from "lucide-react";
import { usePlayersStore } from "@/lib/stores/players-store";
import { usePlayerId } from "@/lib/providers/player-provider";

const CUE_COLORS = [
  "rgba(250, 204, 21, 0.7)",
  "rgba(59, 130, 246, 0.7)",
  "rgba(16, 185, 129, 0.7)",
  "rgba(239, 68, 68, 0.7)",
];

const DEFAULT_CUES = Object.freeze([null, null, null, null] as (
  | number
  | null
)[]);

interface CustomAudioPlayerProps {
  waveformZoom?: number;
  waveformMaxResolution?: number;
}

const CustomAudioPlayer = ({
  waveformZoom,
  waveformMaxResolution = 4096,
}: CustomAudioPlayerProps) => {
  const zoomSmallWaveform = usePlayersStore((s) => s.zoomSmallWaveform);
  const setZoomSmallWaveform = usePlayersStore((s) => s.setZoomSmallWaveform);
  const id = usePlayerId();
  const audioRef = useRef<HTMLAudioElement>(null);
  // Select only the fields we need to avoid causing re-renders on unrelated store changes
  const isPlaying = usePlayersStore((s) => s.tracks[id]?.isPlaying || false);
  const duration = usePlayersStore((s) => s.tracks[id]?.duration || 0);
  const cuePoints = usePlayersStore(
    (s) => s.tracks[id]?.cuePoints ?? DEFAULT_CUES
  );
  const mp3Url = usePlayersStore((s) => s.tracks[id]?.mp3Url || "");

  const attachAudioEl = usePlayersStore((s) => s.attachAudioEl);
  const togglePlay = usePlayersStore((s) => s.togglePlay);
  const setDurationStore = usePlayersStore((s) => s.setDuration);
  const seek = usePlayersStore((s) => s.seek);
  const setCue = usePlayersStore((s) => s.setCue);
  // const play = usePlayersStore((s) => s.play);
  const pause = usePlayersStore((s) => s.pause);
  const playFrom = usePlayersStore((s) => s.playFrom);

  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const holdCueIndexRef = useRef<number | null>(null);
  const wasPausedAtHoldRef = useRef(false);
  const isHoldingCueRef = useRef(false);
  const latchedPlayRef = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    attachAudioEl(id, audio);

    const onLoaded = () => {
      setDurationStore(id, audio.duration || 0);
    };
    const updateTimeDisplay = (t: number) => {
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = formatTime(t);
      }
    };
    const onTime = () => {
      const t = audio.currentTime || 0;
      updateTimeDisplay(t);
    };
    const onSeeked = () => updateTimeDisplay(audio.currentTime || 0);
    const onEnded = () => {
      // ensure state reflects stopped
      if (!audio.paused) audio.pause();
      pause(id);
    };

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("seeked", onSeeked);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("seeked", onSeeked);
    };
  }, [id, attachAudioEl, setDurationStore, pause]);

  // Spacebar latch: if holding a cue and user hits Space, keep playing on release
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isSpace =
        e.code === "Space" || e.key === " " || e.key === "Spacebar";
      if (!isSpace) return;
      if (isHoldingCueRef.current) {
        latchedPlayRef.current = true;
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const togglePlayPause = () => {
    console.log("[player] toggle", { id });
    togglePlay(id);
  };

  const handleCueMouseDown = (index: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (cuePoints[index] !== null) {
      const seekTime = cuePoints[index] as number;
      // Avoid any extra synchronous work before seeking
      // Always use low-latency seek+play; release handler will pause/snapback if needed
      wasPausedAtHoldRef.current = !isPlaying;
      holdCueIndexRef.current = index;
      isHoldingCueRef.current = !isPlaying;
      latchedPlayRef.current = false;
      playFrom(id, seekTime);
    } else {
      const t = audio.currentTime || 0;
      setCue(id, index, t);
    }
  };

  const handleCueMouseUp = (index: number) => {
    const wasHolding =
      wasPausedAtHoldRef.current && holdCueIndexRef.current === index;
    if (wasHolding) {
      const cue = cuePoints[index];
      console.log("[player] cue mouseup (hold release)", { id, index, cue });
      if (latchedPlayRef.current) {
        // Continue playing; do not pause or snap back
      } else {
        pause(id);
        if (cue !== null) {
          // Return to cue point on release
          seek(id, cue);
        }
      }
    }
    wasPausedAtHoldRef.current = false;
    holdCueIndexRef.current = null;
    isHoldingCueRef.current = false;
    latchedPlayRef.current = false;
  };

  // Waveform interacts via store methods directly

  return (
    <div
      className="flex flex-col grow gap-2"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <audio
        ref={audioRef}
        src={mp3Url || undefined}
        preload="auto"
        playsInline
      ></audio>
      <div className="h-12 bg-zinc-800/50 rounded-md relative">
        <Waveform
          zoom={waveformZoom ?? zoomSmallWaveform}
          maxResolution={waveformMaxResolution}
        />
      </div>
      <div className="flex items-center gap-4">
        <Button onClick={togglePlayPause} variant="outline" size="icon">
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </Button>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span ref={timeDisplayRef}>{formatTime(0)}</span>
          <span>/</span>
          <span>{formatTime(duration)}</span>
        </div>
        <div
          className="flex items-center gap-2"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {cuePoints.map((cue, index) => (
            <Button
              key={index}
              onMouseDown={() => handleCueMouseDown(index)}
              onMouseUp={() => handleCueMouseUp(index)}
              onMouseLeave={() => handleCueMouseUp(index)}
              onTouchStart={() => handleCueMouseDown(index)}
              onTouchEnd={() => handleCueMouseUp(index)}
              variant={cue !== null ? "secondary" : "outline"}
              size="sm"
              className="bg-opacity-20 select-none"
              style={
                cue !== null
                  ? {
                      backgroundColor: CUE_COLORS[index],
                      borderColor: CUE_COLORS[index],
                      color: "white",
                    }
                  : {}
              }
            >
              Cue {index + 1}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto text-xs text-zinc-400">
          <span>Zoom</span>
          <input
            type="range"
            min={1}
            max={200}
            step={1}
            value={zoomSmallWaveform}
            onChange={(e) => setZoomSmallWaveform(Number(e.target.value))}
          />
          <span>{zoomSmallWaveform}x</span>
        </div>
      </div>
    </div>
  );
};

const formatTime = (time: number) => {
  if (isNaN(time) || time === 0) return "0:00";
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export default CustomAudioPlayer;
