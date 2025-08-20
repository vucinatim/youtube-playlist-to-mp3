"use client";

import { cn } from "@/lib/utils";
import { Image as ImageIcon, Play, Eye } from "lucide-react";

interface SkeletonVideoCardProps {
  animate?: boolean;
}

export default function SkeletonVideoCard({ animate }: SkeletonVideoCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col sm:flex-row sm:items-center gap-4 border p-3 rounded-lg",
        animate && "animate-pulse"
      )}
    >
      <div className="flex items-center gap-4">
        {/* Checkbox placeholder */}
        <div className="h-4 w-4 rounded-sm bg-zinc-800 border" />
        {/* Thumbnail placeholder */}
        <div className="relative h-16 aspect-video rounded-md overflow-hidden bg-zinc-900 border flex items-center justify-center text-zinc-600">
          <ImageIcon size={20} />
        </div>
      </div>
      <div className="flex flex-col grow gap-2">
        {/* Title line */}
        <div className="h-3 w-2/3 rounded bg-zinc-800" />
        {/* Controls row */}
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-2 text-zinc-600">
            <div className="h-8 w-20 rounded bg-zinc-800 border flex items-center justify-center">
              <Play size={16} />
            </div>
            <div className="flex items-center gap-1 text-xs text-zinc-500">
              <Eye size={14} />
              <div className="h-3 w-10 rounded bg-zinc-800" />
            </div>
          </div>
          <div className="ml-auto h-8 w-24 rounded bg-zinc-800 border" />
        </div>
      </div>
    </div>
  );
}
