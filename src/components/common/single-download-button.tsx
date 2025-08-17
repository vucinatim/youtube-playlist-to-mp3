import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "../ui/button";

interface LocalDownloadButtonProps {
  videoId: string;
  title: string;
}

const SingleDownloadButton = ({ videoId, title }: LocalDownloadButtonProps) => {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0); // Tracks overall progress
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [status, setStatus] = useState<
    "init" | "fetching" | "downloading" | "converting" | "finished"
  >("init");

  const handleConversion = async () => {
    setStatus("fetching");

    try {
      // Fetch the audio stream from your server
      const response = await fetch(`/api/youtube/download?videoId=${videoId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch audio stream.");
      }
      setStatus("downloading");
      setProgress(0); // Reset progress

      const contentLengthHeader = response.headers.get("Content-Length");
      const contentLength = contentLengthHeader
        ? Number(contentLengthHeader)
        : 0;
      let downloadedSize = 0;

      // Read response as stream and calculate download progress
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      if (reader) {
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          if (value) {
            chunks.push(value);
            downloadedSize += value.length;
            console.log(
              `Downloaded ${downloadedSize} bytes of ${contentLength}`
            );
            if (contentLength > 0) {
              setProgress(downloadedSize / contentLength);
            } else {
              // Fallback: show an indeterminate style by mapping bytes to a capped percentage
              const approx = Math.min(0.95, downloadedSize / (2 * 1024 * 1024));
              setProgress(approx);
            }
          }
          done = readerDone;
        }
      }
      setStatus("converting");
      setProgress(0); // Reset progress
      const audioBlob = new Blob(chunks as BlobPart[]);

      // Initialize FFmpeg
      if (!ffmpegRef.current) {
        ffmpegRef.current = new FFmpeg();
        const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
        await ffmpegRef.current.load({
          coreURL: await toBlobURL(
            `${baseURL}/ffmpeg-core.js`,
            "text/javascript"
          ),
          wasmURL: await toBlobURL(
            `${baseURL}/ffmpeg-core.wasm`,
            "application/wasm"
          ),
        });
      }

      const ffmpeg = ffmpegRef.current;

      // Write input file
      const inputFileName = "input.webm";
      const outputFileName = "output.mp3";

      await ffmpeg.writeFile(
        inputFileName,
        new Uint8Array(await audioBlob.arrayBuffer())
      );

      // Track conversion progress
      ffmpeg.on("progress", ({ progress }) => {
        setProgress(progress);
      });

      // Execute conversion
      await ffmpeg.exec(["-i", inputFileName, outputFileName]);

      // Read the output file
      const mp3Data = await ffmpeg.readFile(outputFileName);

      // Create a Blob URL for the MP3 file
      // @ts-expect-error - FileData is not assignable to BlobPart
      const mp3Blob = new Blob([mp3Data], { type: "audio/mpeg" });
      const mp3Url = URL.createObjectURL(mp3Blob);

      setDownloadUrl(mp3Url);
    } catch (error) {
      console.error("Error during audio conversion:", error);
      alert("An error occurred during audio conversion. Please try again.");
    } finally {
      setStatus("finished");
      setProgress(0); // Reset progress after completion
    }
  };

  const handleDownload = () => {
    if (downloadUrl) {
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${title.replace(/[^\w\s]/gi, "")}.mp3`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const progressText = useMemo(() => {
    return `${(progress * 100).toFixed(0)}%`;
  }, [progress]);

  const getStatusDisplay = () => {
    switch (status) {
      case "init":
        return "Convert to MP3";
      case "fetching":
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case "downloading":
        return `Downloading ${progressText}`;
      case "converting":
        return `Converting ${progressText}`;
      case "finished":
        return "Click to download";
      default:
        return "Unknown status";
    }
  };

  return (
    <Button
      variant={status === "finished" ? "default" : "outline"}
      onClick={status === "finished" ? handleDownload : handleConversion}
      disabled={status !== "init" && status !== "finished"}
      className="relative w-full overflow-hidden"
    >
      {(status === "downloading" || status === "converting") && (
        <div
          className="absolute -z-10 top-0 left-0 bottom-0 bg-sky-500 transition-all"
          style={{ width: `${progressText}` }}
        />
      )}

      {getStatusDisplay()}
    </Button>
  );
};

export default SingleDownloadButton;
