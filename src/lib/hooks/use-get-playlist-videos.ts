import { Video } from "@/app/page";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useKeyStore } from "../stores/key-store";

type PlaylistMeta = {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
};

const fetchPlaylistVideos = async (
  playlistUrl: string
): Promise<{ videos: Video[]; playlist?: PlaylistMeta }> => {
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
  return data as { videos: Video[]; playlist?: PlaylistMeta };
};

export const useFetchPlaylistVideos = () => {
  const router = useRouter();
  const setMany = useKeyStore((s) => s.setMany);
  return useMutation<
    { videos: Video[]; playlist?: PlaylistMeta },
    Error,
    string
  >({
    mutationFn: (playlistUrl: string) => fetchPlaylistVideos(playlistUrl),
    onSuccess: (payload, variables) => {
      const playlistUrl = variables;
      const cleaned = playlistUrl.startsWith("@")
        ? playlistUrl.slice(1)
        : playlistUrl;
      const playlistIdMatch = cleaned.match(/[&?]list=([a-zA-Z0-9_-]+)/);
      const listId = playlistIdMatch ? playlistIdMatch[1] : "";
      const videoIdMatch = cleaned.match(/[&?]v=([a-zA-Z0-9_-]+)/);
      const indexMatch = cleaned.match(/[&?]index=(\d+)/);
      const vParam = videoIdMatch ? `&v=${videoIdMatch[1]}` : "";
      const idxParam = indexMatch ? `&index=${indexMatch[1]}` : "";
      router.push(`/?list=${listId}${vParam}${idxParam}`);

      // Kick off batched key detection in background
      const ids = payload.videos.map((v) => v.id);
      const hw =
        typeof navigator !== "undefined" && navigator.hardwareConcurrency
          ? navigator.hardwareConcurrency
          : 4;
      const maxWorkers = Math.max(2, Math.min(8, Math.floor(hw / 2)));

      // Chunk into batches to avoid giant requests
      const chunkSize = 25;
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += chunkSize) {
        chunks.push(ids.slice(i, i + chunkSize));
      }

      (async () => {
        for (const chunk of chunks) {
          try {
            const res = await fetch(`/api/youtube/detect-key`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: chunk, maxWorkers }),
            });
            if (!res.ok) continue;
            const payload = await res.json();
            const results = (payload?.results || {}) as Record<
              string,
              { key?: string; error?: string }
            >;
            const mapped: Record<string, { key: string } | { error: string }> =
              {};
            Object.entries(results).forEach(([id, obj]) => {
              if (obj && typeof obj === "object") {
                if (obj.key) mapped[id] = { key: obj.key };
                else if (obj.error) mapped[id] = { error: obj.error };
              }
            });
            setMany(mapped);
          } catch {
            // ignore batch failure; continue
          }
        }
      })();
      // Persist playlist to backend DB with metadata
      // Use listId derived above (handles '@' and full video URLs)
      fetch(`/api/youtube/playlists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: payload.playlist?.id || listId,
          url: playlistUrl,
          title: payload.playlist?.title || "",
          channel: payload.playlist?.channel || "",
          thumbnail: payload.playlist?.thumbnail || "",
          videos: payload.videos,
        }),
      }).catch(() => {});
    },
  });
};
