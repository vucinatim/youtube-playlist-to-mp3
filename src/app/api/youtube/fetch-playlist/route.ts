/* eslint-disable @typescript-eslint/no-explicit-any */
import { google, youtube_v3 } from "googleapis";
import { NextResponse } from "next/server";

export interface GaxiosResponse<T = any> {
  config: any;
  data: T;
  status: number;
  statusText: string;
  headers: any;
  request: any;
}

export async function POST(request: Request) {
  const { url } = await request.json();

  // Extract the playlist ID from the URL
  const playlistIdMatch = url.match(/[&?]list=([a-zA-Z0-9_-]+)/);
  if (!playlistIdMatch) {
    return NextResponse.json(
      { error: "Invalid playlist URL" },
      { status: 400 }
    );
  }
  const playlistId = playlistIdMatch[1];

  try {
    const youtube = google.youtube({
      version: "v3",
      auth: process.env.YOUTUBE_API_KEY, // Use your API key from environment variables
    });

    let videos: {
      id: string;
      title: string;
      thumbnail: string;
      views: number;
      creator: string;
    }[] = [];
    let nextPageToken: string | null | undefined = undefined;

    // Fetch videos from the playlist
    do {
      const response = (await youtube.playlistItems.list({
        part: ["snippet"],
        playlistId,
        maxResults: 50,
        pageToken: nextPageToken,
      })) as GaxiosResponse<youtube_v3.Schema$PlaylistItemListResponse>;

      const items = response.data.items || [];
      const videoIds = items
        .map((item) => item.snippet?.resourceId?.videoId || "")
        .filter((id) => id);

      if (videoIds.length > 0) {
        // Fetch detailed information about the videos
        const videoDetailsResponse = await youtube.videos.list({
          part: ["snippet", "statistics"],
          id: videoIds,
        });

        const videoDetails = videoDetailsResponse.data.items || [];
        videos = [
          ...videos,
          ...videoDetails.map((video) => ({
            id: video.id || "",
            title: video.snippet?.title || "Untitled",
            thumbnail: video.snippet?.thumbnails?.default?.url || "",
            views: parseInt(video.statistics?.viewCount || "0", 10),
            creator: video.snippet?.channelTitle || "Unknown",
          })),
        ];
      }

      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    return NextResponse.json({ videos });
  } catch (error) {
    console.error("Error fetching playlist:", error);
    return NextResponse.json(
      { error: "Failed to fetch playlist" },
      { status: 500 }
    );
  }
}
