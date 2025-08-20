import { useQuery } from "@tanstack/react-query";

export interface SavedPlaylist {
  id: string;
  url: string;
  title?: string;
  channel?: string;
  thumbnail?: string;
  video_count?: number;
  created_at?: string;
  updated_at?: string;
}

async function fetchPlaylists(): Promise<SavedPlaylist[]> {
  const res = await fetch(`/api/youtube/playlists`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Failed to load playlists");
  }
  const data = await res.json();
  return (data?.playlists || []) as SavedPlaylist[];
}

export function usePlaylists() {
  return useQuery({
    queryKey: ["saved-playlists"],
    queryFn: fetchPlaylists,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}
