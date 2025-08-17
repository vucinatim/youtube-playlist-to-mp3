import { Video } from "@/app/page";
import { useCallback, useState } from "react";
import { useProgressStore } from "../stores/progress-store";

const useBatchConversion = (videos: Video[]) => {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const progressState = useProgressStore((state) => state.progress);

  const handleBatchConversion = useCallback(async () => {
    if (videos.length === 0) {
      return alert("Please select at least one video to download.");
    }

    setIsConverting(true);

    try {
      // Initialize progress per video
      videos.forEach((v) => {
        useProgressStore.getState().startVideo(v.id, v.title);
        useProgressStore.getState().setStatus(v.id, "fetching");
      });

      // Determine a reasonable parallelism level for the backend
      const hw =
        typeof navigator !== "undefined" && navigator.hardwareConcurrency
          ? navigator.hardwareConcurrency
          : 4;
      const suggestedWorkers = Math.max(1, Math.floor(hw / 2));
      const maxWorkers = Math.min(8, suggestedWorkers, videos.length);

      const response = await fetch(`/api/youtube/batch-zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: videos.map((v) => ({ id: v.id, title: v.title })),
          maxWorkers,
        }),
      });

      if (!response.ok) {
        const msg = await response.text();
        throw new Error(msg || "Batch request failed");
      }

      const total = Number(response.headers.get("Content-Length") || 0);
      const chunks: Uint8Array[] = [];
      let downloaded = 0;

      videos.forEach((v) =>
        useProgressStore.getState().setStatus(v.id, "downloading")
      );

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            downloaded += value.length;
            const ratio = total > 0 ? downloaded / total : 0;
            videos.forEach((v) =>
              useProgressStore
                .getState()
                .setProgress(v.id, Math.min(0.99, ratio))
            );
          }
        }
      } else {
        const blob = await response.blob();
        chunks.push(new Uint8Array(await blob.arrayBuffer()));
      }

      const zipBlob = new Blob(chunks as BlobPart[], {
        type: "application/zip",
      });
      const zipUrl = URL.createObjectURL(zipBlob);
      setDownloadUrl(zipUrl);

      const link = document.createElement("a");
      link.href = zipUrl;
      link.download = "playlist.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      videos.forEach((v) => {
        useProgressStore.getState().setProgress(v.id, 1);
        useProgressStore.getState().setStatus(v.id, "completed");
      });
    } catch (error) {
      console.error("Error during server-side batch conversion:", error);
      alert("An error occurred during batch conversion. Please try again.");
    } finally {
      setIsConverting(false);
    }
  }, [videos]);

  return { handleBatchConversion, isConverting, downloadUrl, progressState };
};

export default useBatchConversion;
