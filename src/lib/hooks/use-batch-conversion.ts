import { Video } from "@/app/page";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import JSZip from "jszip";
import { useCallback, useRef, useState } from "react";
import { useProgressStore } from "../stores/progress-store";

const MAX_CONCURRENT_CONVERSIONS = 3; // Limit concurrent tasks to prevent excessive resource usage

const useBatchConversion = (videos: Video[]) => {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const progressState = useProgressStore((state) => state.progress);

  const handleBatchConversion = useCallback(async () => {
    if (videos.length === 0) {
      return alert("Please select at least one video to download.");
    }

    const zip = new JSZip();
    setIsConverting(true);

    try {
      // Initialize FFmpeg instance
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

      // Helper to process a single video
      const processVideo = async (videoId: string) => {
        const video = videos.find((v) => v.id === videoId);
        if (!video) return;

        console.log(`Processing video: ${video.title}`);

        // Start processing
        useProgressStore.getState().startVideo(videoId, video.title);

        // Fetch video
        useProgressStore.getState().setStatus(videoId, "fetching");
        const response = await fetch(
          `/api/youtube/download?videoId=${videoId}`
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch audio for video: ${video.title}`);
        }

        const contentLength = Number(response.headers.get("Content-Length"));
        let downloadedSize = 0;

        // Read response stream
        useProgressStore.getState().setStatus(videoId, "downloading");
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { value, done } = (await reader?.read()) || {};
          if (done) break;
          if (value) {
            chunks.push(value);
            downloadedSize += value.length;

            // Update download progress
            useProgressStore
              .getState()
              .setProgress(videoId, downloadedSize / contentLength);
          }
        }

        // Convert video
        useProgressStore.getState().setStatus(videoId, "converting");
        const audioBlob = new Blob(chunks);
        const inputFileName = `${video.title}.webm`;
        const outputFileName = `${video.title.replace(/[^\w\s]/gi, "")}.mp3`;

        // Write input file to FFmpeg virtual filesystem
        await ffmpeg.writeFile(
          inputFileName,
          new Uint8Array(await audioBlob.arrayBuffer())
        );

        // Track FFmpeg progress
        ffmpeg.on("progress", ({ progress }) => {
          useProgressStore.getState().setProgress(videoId, progress);
        });

        // Convert to MP3
        await ffmpeg.exec(["-i", inputFileName, outputFileName]);

        // Read converted MP3
        const mp3Data = await ffmpeg.readFile(outputFileName);

        // Add to ZIP
        zip.file(outputFileName, mp3Data);

        // Clean up FFmpeg virtual filesystem
        await ffmpeg.deleteFile(inputFileName);
        await ffmpeg.deleteFile(outputFileName);

        // Mark as completed
        useProgressStore.getState().setStatus(videoId, "completed");
      };

      // Concurrent processing with a queue
      const queue = videos.slice(); // Copy of the selected videos
      const workers = Array.from(
        { length: MAX_CONCURRENT_CONVERSIONS },
        async () => {
          while (queue.length > 0) {
            const video = queue.shift(); // Take next video from the queue
            if (video) {
              await processVideo(video.id);
            }
          }
        }
      );

      // Wait for all workers to finish
      await Promise.all(workers);

      // Generate ZIP file and trigger download
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipUrl = URL.createObjectURL(zipBlob);

      setDownloadUrl(zipUrl);

      const link = document.createElement("a");
      link.href = zipUrl;
      link.download = "playlist.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      alert("Batch download complete!");
    } catch (error) {
      console.error("Error during batch conversion:", error);
      alert("An error occurred during batch conversion. Please try again.");
    } finally {
      setIsConverting(false);
    }
  }, [videos]);

  return {
    handleBatchConversion,
    isConverting,
    downloadUrl,
    progressState,
  };
};

export default useBatchConversion;
