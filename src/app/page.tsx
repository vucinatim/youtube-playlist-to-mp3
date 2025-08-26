"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import VideoCard from "@/components/common/video-card";
import SkeletonVideoCard from "@/components/common/skeleton-video-card";
import { useFilteredVideos } from "@/lib/hooks/use-filtered-videos";
import { useVideoSelection } from "@/lib/hooks/use-video-selection";
import { useGetPlaylistVideos } from "@/lib/hooks/use-get-playlist-videos";
import useBatchConversion from "@/lib/hooks/use-batch-conversion";
import { useSearchParams, useRouter } from "next/navigation";
import PlaylistsPanel from "@/components/common/playlists-panel";
import { useAnalysis } from "@/lib/hooks/use-analysis";
import { useKeyboardShortcuts } from "@/lib/hooks/use-keyboard-shortcuts";

export interface Video {
  id: string;
  title: string;
  thumbnail: string;
  views: number; // Add views property
  creator: string; // Add creator/channel property
  mp3_path?: string;
  analysis?: {
    key?: string;
    bpm?: number;
    energy?: number;
    danceability?: number;
    segments?: {
      start: number;
      end: number;
      label: string;
    }[];
    cue_points?: { time: number; label: string }[];
  };
}

export default function HomePage() {
  const [playlistUrl, setPlaylistUrl] = useState("");
  const params = useSearchParams();
  const router = useRouter();
  const listId = params.get("list");
  const videoIdParam = params.get("v");

  const {
    data: playlistData,
    isFetching: fetching,
    isError,
  } = useGetPlaylistVideos(listId);

  const videos = useMemo(() => {
    return playlistData?.videos;
  }, [playlistData]);

  const [activeVideo, setActiveVideo] = useState<Video | null>(null); // Current video for sidebar player

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

  const { mutate: analyze, isPending: isAnalyzing } = useAnalysis();
  const handlePlayVideo = (video: Video) => {
    setActiveVideo((curr) => (curr?.id === video.id ? null : video));
  };

  // Bind keyboard shortcuts for cue 1-4 on hovered track
  useKeyboardShortcuts();

  const handleFetchPlaylist = () => {
    const cleaned = playlistUrl.startsWith("@")
      ? playlistUrl.slice(1)
      : playlistUrl;
    const playlistIdMatch = cleaned.match(/[&?]list=([a-zA-Z0-9_-]+)/);
    if (playlistIdMatch) {
      router.push(`/?list=${playlistIdMatch[1]}`);
    } else {
      // TODO: Better error handling for invalid URLs
      console.error("Invalid YouTube Playlist URL");
    }
  };

  useEffect(() => {
    if (!listId) {
      setPlaylistUrl("");
      return;
    }
    const url = `https://www.youtube.com/playlist?list=${listId}`;
    setPlaylistUrl(url);

    if (videoIdParam && videos) {
      const found = videos.find((v) => v.id === videoIdParam);
      if (found) setActiveVideo(found);
    }
  }, [listId, videoIdParam, videos]);

  if (isError) {
    return <div>Error loading playlist</div>;
  }

  return (
    <div className="relative flex flex-col mx-auto p-6">
      <div className="flex gap-6 items-start min-h-0 grow">
        {/* Sidebar */}
        <aside className="w-full h-[calc(100vh-100px)] sm:w-96 md:w-[420px] shrink-0 flex flex-col gap-4 sticky top-[72px]">
          <div className={cn("flex gap-2")}>
            <Input
              placeholder="Enter YouTube Playlist URL"
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              className="grow"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleFetchPlaylist();
              }}
            />
            <Button
              variant={videos ? "outline" : "default"}
              onClick={handleFetchPlaylist}
              disabled={fetching}
            >
              {fetching && <Loader2 className="h-4 w-4 animate-spin" />}
              {fetching ? "Loading..." : "Load"}
            </Button>
          </div>

          <PlaylistsPanel />

          {activeVideo && (
            <div className="relative aspect-video rounded-md overflow-hidden border">
              <iframe
                src={`https://www.youtube.com/embed/${activeVideo.id}?autoplay=1`}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
          )}
          <div className="mt-auto sticky bottom-0 pt-3 bg-zinc-950/60 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/40">
            <div className="flex flex-col gap-3">
              <div className="relative flex items-center">
                <Input
                  className="grow pr-9"
                  placeholder="Search by title"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={!videos || videos.length === 0}
                />
                <Search className="absolute right-3 w-4 h-4 shrink-0 text-zinc-400" />
              </div>
              <div className="flex gap-2">
                <Select onValueChange={(value) => setSelectedCreator(value)}>
                  <SelectTrigger
                    className="grow"
                    disabled={!videos || videos.length === 0}
                  >
                    <SelectValue placeholder="Filter by creator" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {[
                      ...new Set((videos || []).map((video) => video.creator)),
                    ].map((creator) => (
                      <SelectItem key={creator} value={creator}>
                        {creator}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  onValueChange={(value) =>
                    setOrderBy(value as "views" | "title" | "default")
                  }
                >
                  <SelectTrigger
                    className="grow"
                    disabled={!videos || videos.length === 0}
                  >
                    <SelectValue placeholder="Order by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="views">Views</SelectItem>
                    <SelectItem value="title">Title</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="grow"
                  disabled={!videos || videos.length === 0}
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
                <Button
                  onClick={() => {
                    const downloadedVideos = selectedVideos.filter(
                      (v) => v.mp3_path
                    );
                    if (downloadedVideos.length > 0) {
                      analyze({
                        ids: downloadedVideos.map((v) => v.id),
                      });
                    }
                  }}
                  disabled={
                    !videos ||
                    videos.length === 0 ||
                    isAnalyzing ||
                    selectedVideos.length === 0 ||
                    selectedVideos.every((v) => !v.mp3_path)
                  }
                  className="grow"
                >
                  {isAnalyzing
                    ? "Analyzing..."
                    : selectedVideos.length > 0
                    ? `Analyze ${selectedVideos.length}`
                    : "Analyze"}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleBatchConversion}
                  disabled={
                    !videos ||
                    videos.length === 0 ||
                    isConverting ||
                    selectedVideos.length === 0
                  }
                  className="grow"
                >
                  {isConverting
                    ? "Processing..."
                    : selectedVideos.length > 0
                    ? `Download ${selectedVideos.length}`
                    : "Download"}
                </Button>
              </div>
            </div>
            {isConverting && (
              <div className="mt-3 flex flex-col gap-2">
                {Object.entries(progressState).map(([videoId, status]) => {
                  if (!status || status.status === "completed") return null;
                  return (
                    <div
                      key={videoId}
                      className="w-full relative h-8 border rounded-xl overflow-hidden flex items-center justify-center"
                    >
                      <div
                        className="absolute h-full w-0 left-0 -z-10 bg-white/20 transition-all duration-300 ease-in-out"
                        style={{ width: `${status.progress * 100}%` }}
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
        </aside>

        {/* Main scrollable list */}
        <section className="grow min-h-0 flex flex-col">
          <div className="mb-2 text-sm text-zinc-400">
            {videos ? `${filteredVideos.length} videos` : ""}
          </div>
          <div className="grow overflow-y-auto">
            {filteredVideos.length > 0 ? (
              <div className="space-y-4">
                {filteredVideos.map((video) => (
                  <VideoCard
                    key={video.id}
                    video={video}
                    isSelected={selectedVideos.includes(video)}
                    onToggleSelection={() => toggleSelection(video)}
                    onAnalyze={(videoId) => analyze({ ids: [videoId] })}
                    onPlayVideo={handlePlayVideo}
                    isActive={activeVideo?.id === video.id}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Static skeletons when empty; animate while fetching */}
                {Array.from({ length: 6 }).map((_, idx) => (
                  <SkeletonVideoCard key={idx} animate={fetching} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
