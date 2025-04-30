import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
      // Add other rewrites here if needed
    ];
  },
};

export default nextConfig;
