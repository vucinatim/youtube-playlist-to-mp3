import { useQuery } from "@tanstack/react-query";
import { Video } from "@/app/page";

export interface PlaylistData {
  playlist: {
    id: string;
    url: string;
    title: string;
    channel: string;
    thumbnail: string | null;
    video_count: number;
    created_at: string;
    updated_at: string;
  };
  videos: Video[];
}

export const useGetPlaylistVideos = (playlistId: string | null) => {
  return useQuery<PlaylistData>({
    queryKey: ["playlist-videos", playlistId],
    queryFn: async () => {
      if (!playlistId) return null;
      const response = await fetch(`/api/youtube/playlists/${playlistId}`);
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      return response.json();
    },
    enabled: !!playlistId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
};
