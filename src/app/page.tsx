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
import { useFetchPlaylistVideos } from "@/lib/hooks/use-get-playlist-videos";
import useBatchConversion from "@/lib/hooks/use-batch-conversion";
import { useSearchParams } from "next/navigation";
import PlaylistsPanel from "@/components/common/playlists-panel";

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
  const listId = params.get("list");
  const videoIdParam = params.get("v");

  const {
    data: playlistData,
    mutate: fetchVideos,
    isPending: fetching,
  } = useFetchPlaylistVideos();

  // Allow overriding data from DB when available for instant load
  const [dbPlaylistData, setDbPlaylistData] = useState<{
    videos: Video[];
    playlist?: {
      id: string;
      title: string;
      channel: string;
      thumbnail: string;
    };
  } | null>(null);

  const videos = useMemo(() => {
    return (dbPlaylistData ?? playlistData)?.videos;
  }, [dbPlaylistData, playlistData]);

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

  useEffect(() => {
    if (!listId) return;
    const currentListId = listId;
    const currentVideoId = videoIdParam || undefined;
    const url = `https://www.youtube.com/playlist?list=${currentListId}`;
    setPlaylistUrl(url);
    setDbPlaylistData(null);

    let cancelled = false;
    const tryLoadFromDb = async () => {
      try {
        const res = await fetch(
          `/api/youtube/playlists/${encodeURIComponent(currentListId)}`,
          { cache: "no-store" }
        );
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const vids: Video[] = (data?.videos || []).map((v: any) => ({
            id: v.id,
            title: v.title,
            thumbnail: v.thumbnail,
            views: Number(v.views || 0),
            creator: v.creator || "",
          }));
          setDbPlaylistData({ videos: vids, playlist: data?.playlist });
          if (currentVideoId) {
            const found = vids.find((v) => v.id === currentVideoId);
            if (found) setActiveVideo(found);
          }
          return;
        }
      } catch {
        // fall through to network fetch
      }

      // Fallback to network fetch via YouTube API
      fetchVideos(url, {
        onSuccess: (payload: { videos: Video[] }) => {
          if (cancelled) return;
          if (currentVideoId) {
            const found = payload.videos.find(
              (v: Video) => v.id === currentVideoId
            );
            if (found) setActiveVideo(found);
          }
        },
      } as { onSuccess: (payload: { videos: Video[] }) => void });
    };

    tryLoadFromDb();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, videoIdParam]);

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
            />
            <Button
              variant={videos ? "outline" : "default"}
              onClick={() => fetchVideos(playlistUrl)}
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
