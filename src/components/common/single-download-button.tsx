import { Download, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../ui/button";

interface LocalDownloadButtonProps {
  videoId: string;
  title: string;
  mp3_path?: string | null;
}

const SingleDownloadButton = ({
  videoId,
  title,
  mp3_path,
}: LocalDownloadButtonProps) => {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0); // Tracks overall progress
  const [status, setStatus] = useState<
    "init" | "fetching" | "downloading" | "converting" | "finished"
  >("init");

  const handleConversion = async () => {
    setStatus("fetching");

    try {
      // Fetch the final MP3 stream from the server
      const response = await fetch(
        `/api/youtube/download-mp3?videoId=${videoId}`
      );
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
      // Create a Blob URL for the MP3 file
      const mp3Blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
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
        return "Download";
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

  // If the MP3 path is already provided, we can skip the conversion process.
  if (mp3_path) {
    return (
      <Button asChild size="icon" variant="ghost">
        <a
          href={`/api/youtube/download-mp3?videoId=${videoId}`}
          download={`${title.replace(/[^\w\s]/gi, "")}.mp3`}
        >
          <Download size={20} />
        </a>
      </Button>
    );
  }

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
