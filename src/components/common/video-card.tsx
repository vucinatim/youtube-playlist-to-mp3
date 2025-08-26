import { Video } from "@/app/page";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { Ban, Eye, Zap, Music, Smile, Play } from "lucide-react";
import Image from "next/image";
import SingleDownloadButton from "./single-download-button";
import CustomAudioPlayer from "./custom-audio-player";
import { PlayerProvider } from "@/lib/providers/player-provider";
import { usePlayersStore } from "@/lib/stores/players-store";
import VolumeFader from "./volume-fader";

interface VideoCardProps {
  video: Video;
  isSelected: boolean;
  onToggleSelection: (videoId: string) => void;
  onAnalyze: (videoId: string) => void;
  onPlayVideo: (video: Video) => void;
  isActive?: boolean;
}

const VideoCard = ({
  video,
  isSelected,
  onToggleSelection,
  onAnalyze,
  onPlayVideo,
  isActive,
}: VideoCardProps) => {
  const setHoveredTrackId = usePlayersStore((s) => s.setHoveredTrackId);
  const renderPlaySection = () => {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button
          onMouseDown={(e) => e.stopPropagation()}
          variant={isActive ? "default" : "outline"}
          onClick={() => onPlayVideo(video)}
        >
          <Play size={20} />
          {isActive ? "Playing" : "Play Video"}
        </Button>
        <Button
          onMouseDown={(e) => e.stopPropagation()}
          variant="outline"
          onClick={() => onAnalyze(video.id)}
          disabled={!video.mp3_path}
        >
          Analyze
        </Button>
        <div className="text-xs flex items-center gap-2">
          <Eye className="text-zinc-400 shrink-0" size={16} />
          {ViewsToReadableString(video.views)}
        </div>
      </div>
    );
  };
  return (
    <PlayerProvider
      id={video.id}
      mp3Url={`/api/youtube/download-mp3?videoId=${video.id}`}
      segments={video.analysis?.segments}
      beats={(video.analysis?.cue_points || [])
        .filter((c) => c.label === "beat")
        .map((c) => c.time)}
    >
      <div
        key={video.id}
        className={cn(
          "relative flex items-stretch hover:brightness-110 transition-colors hover:border-zinc-600 gap-3 border p-3 rounded-lg cursor-pointer",
          isSelected && "bg-zinc-900/50 border-zinc-400/50 brightness-110"
        )}
        onMouseDown={() => onToggleSelection(video.id)}
        onMouseEnter={() => setHoveredTrackId(video.id)}
        onMouseLeave={() => setHoveredTrackId(null)}
      >
        <div>{video.mp3_path && <VolumeFader />}</div>
        <div className="flex flex-col gap-2 w-full">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-4">
              {/* <Checkbox checked={isSelected} /> */}
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
                <div className="hidden sm:block grow">
                  {renderPlaySection()}
                </div>
                {video.analysis && (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-4 w-full items-center text-xs text-zinc-400">
                      <div className="flex items-center gap-1">
                        <Music size={14} />
                        <span>{video.analysis.key || "-"}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <strong>BPM</strong>
                        <span>{video.analysis.bpm || "-"}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Zap size={14} />
                        <span>{video.analysis.energy || "-"}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Smile size={14} />
                        <span>{video.analysis.danceability || "-"}</span>
                      </div>
                    </div>
                  </div>
                )}
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  className="relative flex justify-end"
                >
                  <SingleDownloadButton
                    videoId={video.id}
                    title={video.title}
                    mp3_path={video.mp3_path}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="flex-1 relative">
            {video.mp3_path && <CustomAudioPlayer />}
          </div>
        </div>
      </div>
    </PlayerProvider>
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
