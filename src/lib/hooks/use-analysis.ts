import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Video } from "@/app/page";

interface AnalysisPayload {
  ids: string[];
}

interface AnalysisResult {
  results: {
    [videoId: string]: {
      key?: string;
      bpm?: number;
      error?: string;
    };
  };
}

const analyzeVideos = async (
  payload: AnalysisPayload
): Promise<AnalysisResult> => {
  const response = await fetch("/api/youtube/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to analyze videos: ${errorText}`);
  }

  return response.json();
};

export const useAnalysis = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: analyzeVideos,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["playlist-videos"] });
    },
  });
};
