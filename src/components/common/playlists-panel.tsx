"use client";

import { usePlaylists } from "@/lib/hooks/use-playlists";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

export default function PlaylistsPanel() {
  const { data, isLoading, refetch, isRefetching } = usePlaylists();
  const router = useRouter();
  const params = useSearchParams();
  const activeId = params.get("list");

  return (
    <div className="border rounded-lg overflow-hidden">
      <Collapsible defaultOpen>
        <div className="flex items-center justify-between p-3 border-b">
          <div className="flex items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <ChevronDown className="h-4 w-4" />
                Saved Playlists
              </Button>
            </CollapsibleTrigger>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
        <CollapsibleContent>
          <div className="max-h-64 overflow-y-auto divide-y">
            {isLoading ? (
              <div className="p-3 text-sm text-zinc-400">Loading…</div>
            ) : data && data.length > 0 ? (
              data.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 p-3 hover:bg-zinc-900/30 ${
                    activeId === p.id ? "bg-zinc-900/40" : ""
                  }`}
                >
                  <div className="h-6 w-10 shrink-0 rounded overflow-hidden bg-zinc-800 border">
                    {p.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.thumbnail}
                        alt="thumb"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium">
                      {p.title || p.id}
                    </div>
                    <div className="truncate text-xs text-zinc-400">
                      {p.channel || p.url}
                    </div>
                  </div>
                  <div className="text-xs text-zinc-400 mr-2">
                    {p.video_count ?? ""}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      router.push(`/?list=${encodeURIComponent(p.id)}`)
                    }
                  >
                    Load
                  </Button>
                </div>
              ))
            ) : (
              <div className="p-3 text-sm text-zinc-400">
                No playlists saved yet.
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
