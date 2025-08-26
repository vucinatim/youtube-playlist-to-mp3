"use client";

import { createContext, useContext, useEffect } from "react";
import { Segment, usePlayersStore } from "@/lib/stores/players-store";

interface PlayerProviderProps {
  id: string;
  mp3Url: string;
  segments?: Segment[];
  beats?: number[];
  children: React.ReactNode;
}

const PlayerContext = createContext<string | null>(null);

export const usePlayerId = () => {
  const id = useContext(PlayerContext);
  if (!id) throw new Error("usePlayerId must be used within PlayerProvider");
  return id;
};

export const PlayerProvider = ({
  id,
  mp3Url,
  segments,
  beats,
  children,
}: PlayerProviderProps) => {
  const initTrack = usePlayersStore((s) => s.initTrack);
  const setTrackMeta = usePlayersStore((s) => s.setTrackMeta);
  const removeTrack = usePlayersStore((s) => s.removeTrack);

  useEffect(() => {
    // Initialize only when id or mp3Url changes to avoid re-initialization
    initTrack(id, mp3Url);
    return () => {
      removeTrack(id);
    };
  }, [id, mp3Url, initTrack, removeTrack]);

  useEffect(() => {
    // Update metadata separately; cheap no-op if values are unchanged
    setTrackMeta(id, { segments, beats });
  }, [id, segments, beats, setTrackMeta]);

  return <PlayerContext.Provider value={id}>{children}</PlayerContext.Provider>;
};
