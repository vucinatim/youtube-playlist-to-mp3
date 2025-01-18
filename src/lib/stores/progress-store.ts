import { create } from "zustand";

interface VideoProgress {
  title: string;
  status: "init" | "fetching" | "downloading" | "converting" | "completed";
  progress: number; // Progress percentage (0 to 1)
}

type ProgressState = Record<string, VideoProgress>;

interface ProgressStore {
  progress: ProgressState;
  startVideo: (videoId: string, title: string) => void;
  setStatus: (videoId: string, status: VideoProgress["status"]) => void;
  setProgress: (videoId: string, progress: number) => void;
  reset: () => void;
}

export const useProgressStore = create<ProgressStore>((set) => ({
  progress: {},
  startVideo: (videoId, title) =>
    set((state) => ({
      progress: {
        ...state.progress,
        [videoId]: { title, status: "fetching", progress: 0 },
      },
    })),
  setStatus: (videoId, status) =>
    set((state) => ({
      progress: {
        ...state.progress,
        [videoId]: {
          ...state.progress[videoId],
          status,
        },
      },
    })),
  setProgress: (videoId, progress) =>
    set((state) => ({
      progress: {
        ...state.progress,
        [videoId]: {
          ...state.progress[videoId],
          progress,
        },
      },
    })),
  reset: () => set({ progress: {} }),
}));
