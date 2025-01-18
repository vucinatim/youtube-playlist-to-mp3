import { Video } from "@/app/page";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { Ban, Eye, Pause, Play } from "lucide-react";
import { Checkbox } from "../ui/checkbox";
import Image from "next/image";
import SingleDownloadButton from "./single-download-button";

interface VideoCardProps {
  video: Video;
  isSelected: boolean;
  isPlaying: boolean;
  onToggleSelection: (videoId: string) => void;
  onTogglePlayVideo: (video: Video) => void;
}

const VideoCard = ({
  video,
  isSelected,
  isPlaying,
  onToggleSelection,
  onTogglePlayVideo,
}: VideoCardProps) => {
  const renderPlaySection = () => {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button
          onMouseDown={(e) => e.stopPropagation()}
          variant="outline"
          className={cn(isPlaying && "text-sky-400")}
          onClick={() => onTogglePlayVideo(video)}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          {isPlaying ? "Stop" : "Play"}
        </Button>
        <div className="text-xs flex items-center gap-2">
          <Eye className="text-zinc-400" size={16} />
          {ViewsToReadableString(video.views)}
        </div>
      </div>
    );
  };
  return (
    <div
      key={video.id}
      className={cn(
        "relative flex hover:brightness-110 transition-colors hover:border-zinc-600 flex-col sm:flex-row sm:items-center gap-4 border p-3 rounded-lg cursor-pointer",
        isSelected && "bg-zinc-900/50 border-zinc-400/50 brightness-110",
        isPlaying && "bg-sky-900/20 border-sky-400/50"
      )}
      onMouseDown={() => onToggleSelection(video.id)}
    >
      <div className="flex items-center gap-4">
        <Checkbox checked={isSelected} />
        <div
          className={cn(
            "relative h-16 shrink-0 aspect-video flex items-center justify-center rounded-md overflow-hidden",
            !video.thumbnail && "bg-zinc-300"
          )}
        >
          {video.thumbnail ? (
            <Image
              src={video.thumbnail}
              alt={video.title}
              fill
              sizes="(max-width: 768px) 100vw, 640px"
              className="object-cover"
            />
          ) : (
            <div className="text-white">
              <Ban size={24} />
            </div>
          )}
        </div>
        <div className="sm:hidden">{renderPlaySection()}</div>
      </div>
      <div className="sm:hidden">{video.title}</div>
      <div className="relative flex flex-col grow items-start gap-1">
        <span className="hidden sm:block">{video.title}</span>
        <div className="flex gap-4 w-full items-center">
          <div className="hidden sm:block grow">{renderPlaySection()}</div>
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="relative flex w-full sm:w-[150px] justify-end"
          >
            <SingleDownloadButton videoId={video.id} title={video.title} />
          </div>
        </div>
      </div>
    </div>
  );
};

const ViewsToReadableString = (views: number) => {
  if (views < 1000) {
    return `${views} Views`;
  } else if (views < 1000000) {
    return `${(views / 1000).toFixed(1)} K Views`;
  } else {
    return `${(views / 1000000).toFixed(1)} M Views`;
  }
};

export default VideoCard;
