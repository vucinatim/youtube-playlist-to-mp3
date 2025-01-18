import { NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("videoId");

  if (!videoId) {
    return NextResponse.json(
      { error: "Missing videoId parameter" },
      { status: 400 }
    );
  }

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Fetching YouTube audio stream for videoId: ${videoId}`);

    const info = await ytdl.getInfo(videoUrl, {
      playerClients: ["IOS", "ANDROID", "WEB_CREATOR"],
    });
    const format = ytdl.chooseFormat(info.formats, { quality: "highestaudio" });

    const stream = ytdl(videoUrl, { format });
    const dataSize = format.contentLength;
    console.log(`Downloading ${dataSize} bytes of audio`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Response(stream as any, {
      headers: {
        "Content-Disposition": `attachment; filename="audio.${format.container}"`,
        "Content-Type": "audio/mpeg",
        "Content-Length": dataSize,
      },
    });
  } catch (error) {
    console.error("Error fetching YouTube audio stream:", error);
    return NextResponse.json(
      { error: "Failed to fetch download audio" },
      { status: 500 }
    );
  }
}
