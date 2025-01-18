import { Video } from "@/app/page";
import { useMemo, useState } from "react";

interface UseFilteredVideosProps {
  videos?: Video[];
}

export function useFilteredVideos({ videos }: UseFilteredVideosProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCreator, setSelectedCreator] = useState("");
  const [orderBy, setOrderBy] = useState<"views" | "title" | "default">(
    "default"
  );
  const filteredVideos = useMemo(() => {
    let result = videos ? [...videos] : [];

    if (searchQuery) {
      result = result.filter((video) =>
        video.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (selectedCreator !== "all" && selectedCreator) {
      result = result.filter((video) => video.creator === selectedCreator);
    }

    if (orderBy === "views") {
      result = result.sort((a, b) => b.views - a.views);
    } else if (orderBy === "title") {
      result = result.sort((a, b) => a.title.localeCompare(b.title));
    }

    return result;
  }, [videos, searchQuery, selectedCreator, orderBy]);

  return {
    filteredVideos,
    searchQuery,
    selectedCreator,
    orderBy,
    setSearchQuery,
    setSelectedCreator,
    setOrderBy,
  };
}
