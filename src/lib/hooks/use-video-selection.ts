import { Video } from "@/app/page";
import { useState, useCallback, useMemo } from "react";

export function useVideoSelection(videos?: Video[]) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggleSelection = useCallback((video: Video) => {
    setSelectedIds((prev) =>
      prev.includes(video.id)
        ? prev.filter((id) => id !== video.id)
        : [...prev, video.id]
    );
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds((videos || []).map((v) => v.id));
  }, [videos]);

  const deselectAll = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const selectedVideos = useMemo(() => {
    const map = new Map((videos || []).map((v) => [v.id, v] as const));
    return selectedIds.map((id) => map.get(id)).filter(Boolean) as Video[];
  }, [selectedIds, videos]);

  return {
    selectedVideos,
    selectedIds,
    toggleSelection,
    selectAll,
    deselectAll,
  };
}
