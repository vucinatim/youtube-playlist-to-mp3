import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
    ],
  },

  // Configure rewrites to proxy API requests to the Flask backend during development
  async rewrites() {
    return [
      {
        // Source path: The path Next.js receives from the frontend
        source: "/api/youtube/download",
        // Destination path: The URL of the Flask backend endpoint
        // NOTE: Ensure the port (5328) matches the port in backend/app.py
        destination: "http://127.0.0.1:5328/download",
      },
      {
        source: "/api/youtube/batch-zip",
        destination: "http://127.0.0.1:5328/batch-zip",
      },
      {
        source: "/api/youtube/download-mp3",
        destination: "http://127.0.0.1:5328/download-mp3",
      },
      // Add other rewrites here if needed
    ];
  },
};

export default nextConfig;
