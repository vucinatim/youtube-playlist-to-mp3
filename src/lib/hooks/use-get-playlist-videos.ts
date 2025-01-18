import { Video } from "@/app/page";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

const fetchPlaylistVideos = async (playlistUrl: string): Promise<Video[]> => {
  const response = await fetch(`/api/youtube/fetch-playlist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: playlistUrl }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to fetch playlist videos.");
  }

  const data = await response.json();
  return data.videos;
};

export const useFetchPlaylistVideos = () => {
  const router = useRouter();
  return useMutation({
    mutationFn: (playlistUrl: string) => fetchPlaylistVideos(playlistUrl),
    onSuccess: (data, variables) => {
      const playlistUrl = variables;
      const playlistIdMatch = playlistUrl.match(/[&?]list=([a-zA-Z0-9_-]+)/);
      router.push(`${playlistIdMatch}`);
    },
  });
};
