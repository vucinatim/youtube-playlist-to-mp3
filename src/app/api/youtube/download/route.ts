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
      requestOptions: {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.youtube.com/",
        },
      },
      playerClients: ["IOS", "ANDROID", "WEB_CREATOR"],
    });
    const format = ytdl.chooseFormat(info.formats, { quality: "highestaudio" });

    const stream = ytdl(videoUrl, { format });
    const dataSize = format.contentLength || "0";
    console.log(`Downloading ${dataSize} bytes of audio`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Response(stream as any, {
      headers: {
        "Content-Disposition": `attachment; filename="audio.${format.container}"`,
        "Content-Type": "audio/mpeg",
        "Content-Length": dataSize,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error("Error fetching YouTube audio stream:", error);
    if (error.response && error.response?.status === 429) {
      console.error(
        "YouTube has flagged your requests as too frequent (Rate Limited)."
      );
    } else if (error.message?.includes("Sign in")) {
      console.error("YouTube requires a sign-in to verify this request.");
    }
    return NextResponse.json(
      { error: "Failed to fetch download audio" },
      { status: 500 }
    );
  }
}
