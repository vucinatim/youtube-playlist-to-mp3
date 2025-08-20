import { create } from "zustand";

type KeyResult = { key: string } | { error: string } | undefined;

interface KeyStore {
  keys: Record<string, KeyResult>;
  setKey: (id: string, result: KeyResult) => void;
  setMany: (entries: Record<string, KeyResult>) => void;
  reset: () => void;
}

export const useKeyStore = create<KeyStore>((set) => ({
  keys: {},
  setKey: (id, result) =>
    set((state) => ({ keys: { ...state.keys, [id]: result } })),
  setMany: (entries) =>
    set((state) => ({ keys: { ...state.keys, ...entries } })),
  reset: () => set({ keys: {} }),
}));
