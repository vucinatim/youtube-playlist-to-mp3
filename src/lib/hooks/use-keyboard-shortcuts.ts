"use client";

import { useEffect, useRef } from "react";
import { usePlayersStore } from "@/lib/stores/players-store";

// Binds number keys 1-4 to cue actions on the currently hovered track.
// Behavior:
// - If track is playing: jump to cue and continue playing.
// - If track is paused: hold-to-play when the key is held; on release pause and snap back to cue unless Space was pressed during hold.
export function useKeyboardShortcuts() {
  const holdingKeyRef = useRef<number | null>(null);
  const latchedPlayRef = useRef(false);
  const pressedKeysRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      if (!tag) return false;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if ((t as HTMLElement).isContentEditable) return true;
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const state = usePlayersStore.getState();
      const hoveredTrackId = state.hoveredTrackId;
      if (!hoveredTrackId) return;
      if (isTypingTarget(e.target)) return;
      // Latch while holding for Space
      const isSpace =
        e.code === "Space" || e.key === " " || e.key === "Spacebar";
      if (isSpace && holdingKeyRef.current !== null) {
        latchedPlayRef.current = true;
        e.preventDefault();
        return;
      }

      // Number keys 1-4
      const keyIndex = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
      if (keyIndex === -1) return;
      // Ignore auto-repeat and repeated keydown while held
      if (e.repeat) return;
      if (pressedKeysRef.current.has(keyIndex)) return;
      pressedKeysRef.current.add(keyIndex);
      const track = state.tracks[hoveredTrackId];
      if (!track) return;
      const cue = track.cuePoints[keyIndex];
      if (cue == null) return;

      // Prevent page shortcuts
      e.preventDefault();

      const isPlaying = track.isPlaying;
      if (isPlaying) {
        state.playFrom(hoveredTrackId, cue);
      } else {
        // Start hold-to-play
        holdingKeyRef.current = keyIndex;
        latchedPlayRef.current = false;
        state.playFrom(hoveredTrackId, cue);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const state = usePlayersStore.getState();
      const hoveredTrackId = state.hoveredTrackId;
      if (!hoveredTrackId) return;
      if (isTypingTarget(e.target)) return;
      // Number up ends hold if it matches current hold
      const keyIndex = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
      if (keyIndex === -1) return;
      // Clear pressed state
      pressedKeysRef.current.delete(keyIndex);

      const isHoldRelease = holdingKeyRef.current === keyIndex;

      const track = state.tracks[hoveredTrackId];
      if (!track) return;
      const cue = track.cuePoints[keyIndex];

      if (isHoldRelease) {
        if (!latchedPlayRef.current) {
          state.pause(hoveredTrackId);
          if (cue != null) state.seek(hoveredTrackId, cue);
        }
      }
      holdingKeyRef.current = null;
      latchedPlayRef.current = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}
