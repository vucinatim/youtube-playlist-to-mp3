import { Video } from "@/app/page";
import { useState, useCallback } from "react";

export function useVideoSelection(videos?: Video[]) {
  const [selectedVideos, setSelectedVideos] = useState<Video[]>([]);

  const toggleSelection = useCallback((video: Video) => {
    setSelectedVideos((prev) =>
      prev.includes(video)
        ? prev.filter((v) => v.id !== video.id)
        : [...prev, video]
    );
  }, []);

  const selectAll = useCallback(() => {
    setSelectedVideos(videos || []);
  }, [videos]);

  const deselectAll = useCallback(() => {
    setSelectedVideos([]);
  }, []);

  return {
    selectedVideos,
    toggleSelection,
    selectAll,
    deselectAll,
  };
}
