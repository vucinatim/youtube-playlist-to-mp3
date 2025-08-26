import { create } from "zustand";

export interface Segment {
  start: number;
  end: number;
  label: string;
}

export interface TrackState {
  id: string;
  mp3Url: string;
  segments?: Segment[];
  beats?: number[];
  isPlaying: boolean;
  duration: number;
  currentTime: number;
  cuePoints: (number | null)[];
  volume?: number;
}

type TracksState = Record<string, TrackState>;

// Non-reactive refs per track to avoid unnecessary rerenders
// Mutate these directly for optimal performance
export type PlayerRefs = {
  audioEl: HTMLAudioElement | null;
};

const playerRefs = new Map<string, PlayerRefs>();

export const getPlayerRefs = (trackId: string): PlayerRefs | undefined =>
  playerRefs.get(trackId);

interface PlayersStore {
  tracks: TracksState;
  // Global UI settings
  zoomSmallWaveform: number;
  hoveredTrackId: string | null;
  setHoveredTrackId: (id: string | null) => void;
  initTrack: (
    id: string,
    mp3Url: string,
    segments?: Segment[],
    beats?: number[]
  ) => void;
  setTrackMeta: (
    id: string,
    meta: { segments?: Segment[]; beats?: number[] }
  ) => void;
  attachAudioEl: (id: string, el: HTMLAudioElement | null) => void;
  play: (id: string) => void;
  pause: (id: string) => void;
  togglePlay: (id: string) => void;
  seek: (id: string, time: number) => void;
  playFrom: (id: string, time: number) => void;
  setDuration: (id: string, duration: number) => void;
  setCurrentTime: (id: string, time: number) => void;
  setCue: (id: string, index: number, time?: number) => void;
  removeTrack: (id: string) => void;
  setZoomSmallWaveform: (zoom: number) => void;
  setVolume: (id: string, volume: number) => void;
}

export const usePlayersStore = create<PlayersStore>((set, get) => ({
  tracks: {},
  zoomSmallWaveform: 1,
  hoveredTrackId: null,
  setHoveredTrackId: (id) => set(() => ({ hoveredTrackId: id })),
  initTrack: (id, mp3Url, segments, beats) =>
    set((state) => {
      if (state.tracks[id]) {
        // Update mp3Url if changed, keep runtime state and meta set via setTrackMeta
        return {
          tracks: {
            ...state.tracks,
            [id]: {
              ...state.tracks[id],
              mp3Url,
            },
          },
        };
      }
      return {
        tracks: {
          ...state.tracks,
          [id]: {
            id,
            mp3Url,
            segments,
            beats,
            isPlaying: false,
            duration: 0,
            currentTime: 0,
            cuePoints: [null, null, null, null],
            volume: 1,
          },
        },
      };
    }),
  setTrackMeta: (id, meta) =>
    set((state) => {
      const track = state.tracks[id];
      if (!track) return state;
      return {
        tracks: {
          ...state.tracks,
          [id]: {
            ...track,
            segments: meta.segments ?? track.segments,
            beats: meta.beats ?? track.beats,
          },
        },
      };
    }),
  attachAudioEl: (id, el) => {
    const refs = playerRefs.get(id) || { audioEl: null };
    refs.audioEl = el;
    playerRefs.set(id, refs);
  },
  play: (id) => {
    const refs = playerRefs.get(id);
    if (!refs?.audioEl) return;
    void refs.audioEl.play();
    set((state) => ({
      tracks: {
        ...state.tracks,
        [id]: { ...state.tracks[id], isPlaying: true },
      },
    }));
  },
  pause: (id) => {
    const refs = playerRefs.get(id);
    if (!refs?.audioEl) return;
    refs.audioEl.pause();
    set((state) => ({
      tracks: {
        ...state.tracks,
        [id]: { ...state.tracks[id], isPlaying: false },
      },
    }));
  },
  togglePlay: (id) => {
    const track = get().tracks[id];
    if (!track) return;
    if (track.isPlaying) {
      get().pause(id);
    } else {
      get().play(id);
    }
  },
  seek: (id, time) => {
    const refs = playerRefs.get(id);
    if (refs?.audioEl) {
      const audio = refs.audioEl;
      const maybeFastSeek = (
        a: HTMLMediaElement & { fastSeek?: (t: number) => void },
        t: number
      ) => {
        if (typeof a.fastSeek === "function") {
          try {
            a.fastSeek(t);
            return;
          } catch {}
        }
        a.currentTime = t;
      };
      maybeFastSeek(audio, time);
    }
  },
  playFrom: (id, time) => {
    const refs = playerRefs.get(id);
    const audio = refs?.audioEl;
    if (!audio) return;
    // Optimistic low-latency seek + play
    const target = Math.max(0, time);
    const maybeFastSeek = (
      a: HTMLMediaElement & { fastSeek?: (t: number) => void },
      t: number
    ) => {
      if (typeof a.fastSeek === "function") {
        try {
          a.fastSeek(t);
          return;
        } catch {}
      }
      a.currentTime = t;
    };
    maybeFastSeek(audio, target);
    void audio.play();
    set((state) => ({
      tracks: {
        ...state.tracks,
        [id]: { ...state.tracks[id], isPlaying: true },
      },
    }));
  },
  setDuration: (id, duration) =>
    set((state) => ({
      tracks: {
        ...state.tracks,
        [id]: { ...state.tracks[id], duration },
      },
    })),
  setCurrentTime: (id, time) =>
    set((state) => ({
      tracks: {
        ...state.tracks,
        [id]: { ...state.tracks[id], currentTime: time },
      },
    })),
  setCue: (id, index, time) =>
    set((state) => {
      const track = state.tracks[id];
      if (!track) return state;
      const next = [...track.cuePoints];
      const computedTime = time ?? track.currentTime;
      next[index] = computedTime;
      return {
        tracks: {
          ...state.tracks,
          [id]: { ...track, cuePoints: next },
        },
      };
    }),
  removeTrack: (id) => {
    set((state) => {
      const next = { ...state.tracks };
      delete next[id];
      return { tracks: next };
    });
    playerRefs.delete(id);
  },
  setZoomSmallWaveform: (zoom) =>
    set(() => ({ zoomSmallWaveform: Math.max(1, zoom) })),
  setVolume: (id, volume) =>
    set((state) => {
      const track = state.tracks[id];
      if (!track) return state;
      const clamped = Math.max(0, Math.min(1, volume));
      // Also reflect immediately on the audio element if attached
      const refs = playerRefs.get(id);
      if (refs?.audioEl) {
        refs.audioEl.volume = clamped;
      }
      return {
        tracks: {
          ...state.tracks,
          [id]: { ...track, volume: clamped },
        },
      };
    }),
}));
