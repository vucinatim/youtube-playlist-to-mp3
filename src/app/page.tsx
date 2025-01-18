"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Expand, Loader2, Search, Shrink } from "lucide-react";
import { cn } from "@/lib/utils";
import VideoCard from "@/components/common/video-card";
import { useFilteredVideos } from "@/lib/hooks/use-filtered-videos";
import { useVideoSelection } from "@/lib/hooks/use-video-selection";
import { useFetchPlaylistVideos } from "@/lib/hooks/use-get-playlist-videos";
import useBatchConversion from "@/lib/hooks/use-batch-conversion";
import { useSearchParams } from "next/navigation";

export interface Video {
  id: string;
  title: string;
  thumbnail: string;
  views: number; // Add views property
  creator: string; // Add creator/channel property
}

export default function HomePage() {
  const [playlistUrl, setPlaylistUrl] = useState("");
  const params = useSearchParams();

  console.log(params);

  const {
    data: videos,
    mutate: fetchVideos,
    isPending: fetching,
  } = useFetchPlaylistVideos();

  const [activeVideo, setActiveVideo] = useState<Video | null>(null); // Current video for floating player
  const [isExpanded, setIsExpanded] = useState(false); // Expand player state

  const {
    filteredVideos,
    searchQuery,
    setSearchQuery,
    setSelectedCreator,
    setOrderBy,
  } = useFilteredVideos({ videos });

  const { selectedVideos, toggleSelection, deselectAll, selectAll } =
    useVideoSelection(videos);

  const { handleBatchConversion, isConverting, progressState } =
    useBatchConversion(selectedVideos);

  useEffect(() => {
    // If the playlistId is provided, fetch the videos
    const listId = params.get("list");
    if (listId) {
      const url = `https://www.youtube.com/playlist?list=${listId}`;
      setPlaylistUrl(url);
      fetchVideos(url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex flex-col container sm:h-dvh mx-auto p-6">
      {!videos && <div className="grow" />}
      <div className="mb-6">
        <h1 className="text-center text-xl sm:text-3xl font-bold mb-4">
          YouTube Playlist MP3 Downloader
        </h1>

        {/* Playlist Input */}
        <div
          className={cn(
            "mb-4 flex gap-4 flex-wrap sm:flex-nowrap",
            !videos && "flex-col items-center max-w-[500px] mx-auto"
          )}
        >
          <Input
            placeholder="Enter YouTube Playlist URL"
            value={playlistUrl}
            onChange={(e) => setPlaylistUrl(e.target.value)}
            className="grow"
          />
          <Button
            variant={videos ? "outline" : "default"}
            className="grow"
            onClick={() => fetchVideos(playlistUrl)}
            disabled={fetching}
          >
            {fetching && <Loader2 className="h-4 w-4 animate-spin" />}
            {fetching ? "Loading..." : "Load Videos"}
          </Button>
        </div>

        {/* Filters */}
        {videos && (
          <>
            <div className="mb-6 gap-4 flex flex-wrap">
              <div className="relative grow flex items-center">
                <Input
                  className="grow min-w-[300px] pr-9"
                  placeholder="Search by title"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                  }}
                />
                <Search className="absolute right-3 w-4 h-4 shrink-0 text-zinc-400" />
              </div>

              <Select
                onValueChange={(value) => {
                  setSelectedCreator(value);
                }}
              >
                <SelectTrigger className="grow sm:w-52 shrink-0">
                  <SelectValue placeholder="Filter by creator/channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {[...new Set(videos.map((video) => video.creator))].map(
                    (creator) => (
                      <SelectItem key={creator} value={creator}>
                        {creator}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>

              <Select
                onValueChange={(value) => {
                  setOrderBy(value as "views" | "title" | "default");
                }}
              >
                <SelectTrigger className="grow sm:w-52 shrink-0">
                  <SelectValue placeholder="Order by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="views">Views</SelectItem>
                  <SelectItem value="title">Title</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center flex-wrap gap-4">
              <h2 className="text-xl shrink-0 grow font-semibold">
                {filteredVideos.length} Playlist Videos:
              </h2>
              <Button
                variant="outline"
                onClick={() => {
                  if (selectedVideos.length > 0) {
                    deselectAll();
                  } else {
                    selectAll();
                  }
                }}
              >
                {selectedVideos.length > 0 ? `Deselect All` : "Select All"}
              </Button>
              {/* Submit Button */}
              <Button
                onClick={handleBatchConversion}
                className="grow sm:grow-0"
                disabled={isConverting || selectedVideos.length === 0}
              >
                {isConverting
                  ? "Processing..."
                  : selectedVideos.length > 0
                  ? `Download ${selectedVideos.length} Videos`
                  : "Download"}
              </Button>
            </div>
          </>
        )}
        {isConverting && (
          <div className="flex flex-col gap-2">
            {Object.entries(progressState).map(([videoId, status]) => {
              if (!status || status.status === "completed") return null;
              return (
                <div
                  key={videoId}
                  className="w-full relative mt-4 h-8 border rounded-xl overflow-hidden flex items-center justify-center"
                >
                  <div
                    className="absolute h-full w-0 left-0 -z-10 bg-white/20 transition-all duration-300 ease-in-out"
                    style={{
                      width: `${status.progress * 100}%`,
                    }}
                  />
                  <div className="text-xs capitalize text-white">
                    {`${status.status} | ${status.title} | ${(
                      status.progress * 100
                    ).toFixed(0)}%`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grow overflow-y-auto">
        {/* Videos List */}
        {filteredVideos.length > 0 && (
          <div className="space-y-4">
            {filteredVideos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                isSelected={selectedVideos.includes(video)}
                isPlaying={activeVideo?.id === video.id}
                onToggleSelection={() => toggleSelection(video)}
                onTogglePlayVideo={(video) =>
                  setActiveVideo((currentVideo) => {
                    if (video.id === currentVideo?.id) {
                      return null;
                    } else {
                      return video;
                    }
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Floating Player */}
      {activeVideo && (
        <div
          className={cn(
            "fixed bottom-4 right-4 bg-black border aspect-video rounded-lg shadow-lg transition-all"
          )}
          style={{
            width: isExpanded ? "calc(100vw - 32px)" : "calc(min(50%, 24rem))",
          }}
        >
          <iframe
            src={`https://www.youtube.com/embed/${activeVideo.id}?autoplay=1`}
            className="w-full h-full rounded-lg"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          ></iframe>
          <Button
            variant="outline"
            className="absolute top-2 left-2 w-10 h-10"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <Shrink size={20} /> : <Expand size={20} />}
          </Button>
        </div>
      )}
    </div>
  );
}
