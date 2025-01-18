# YouTube Playlist MP3 Downloader

This is a web application that allows users to download audio tracks from YouTube playlists as MP3 files. It provides a user-friendly interface to search, filter, and manage videos, with support for batch processing and individual downloads.

---

## Features

### Playlist Loading
- **Load YouTube Playlist:** Enter a YouTube playlist URL to fetch and display all videos in the playlist.
- **Dynamic Filters:**
  - Filter videos by title using a search bar.
  - Filter by creator/channel.
  - Sort videos by views or title.

---

### Video Management
- **Select Videos:**
  - Select individual videos or use the "Select All" button to batch-select videos.
  - Deselect videos individually or use the "Deselect All" button.
- **Video Cards:**
  - Each video is displayed with its thumbnail, title, views, and creator details.
  - Play or stop a video using the embedded YouTube player.
  - Individual download buttons for converting and downloading single videos.

---

### MP3 Conversion
- **Batch Processing:**
  - Select multiple videos and batch-convert them to MP3 format.
  - Track progress for each video during downloading and conversion.
  - Download all converted MP3 files as a ZIP archive.
- **Individual Downloads:**
  - Download single MP3 files with real-time progress tracking for downloading and conversion.
  - Conversion happens directly in the browser using `@ffmpeg/ffmpeg`.

---

### UI and Usability
- **Progress Tracking:**
  - For both individual and batch downloads, progress is displayed as a fill-up bar with percentage updates.
- **Floating Video Player:**
  - Allows users to play and preview any video from the playlist in a floating, resizable player.
- **Responsive Design:**
  - Optimized for both desktop and mobile devices.

---

## How It Works

1. **Load Playlist:**
   - Enter a YouTube playlist URL.
   - The app fetches the playlist details using a server endpoint and displays the videos.

2. **Select Videos:**
   - Use filters to refine your selection.
   - Select videos for conversion and downloading.

3. **Convert and Download:**
   - For individual downloads:
     - Click the "Convert to MP3" button for a video.
     - The app fetches the video stream and converts it to MP3 using `@ffmpeg/ffmpeg` in the browser.
   - For batch downloads:
     - Select multiple videos and click the "Download" button.
     - The app processes all selected videos concurrently and provides a ZIP file with the MP3s.

4. **Monitor Progress:**
   - Real-time progress is displayed for each video during the download and conversion process.

---

## Tech Stack

- **Frontend:** 
  - **Next.js** (App Router).
  - **TypeScript** for type safety.
  - **TailwindCSS** for styling.
  - **shadcn/ui components** for prebuilt, customizable UI components.
- **State Management:** 
  - Zustand for managing global state (e.g., progress tracking).
- **Media Processing:**
  - `@ffmpeg/ffmpeg` for client-side video-to-audio conversion.
- **Backend:** 
  - Next.js API routes handle playlist fetching and video stream redirection.

---

## Setup

### Prerequisites
- Node.js and npm installed.

### Installation
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```

### Environment Variables
- Set up a `.env.local` file with any necessary API keys or configurations.

---

## Future Improvements
- Add pagination for large playlists.
- Optimize FFmpeg processing for large batch downloads.
- Improve error handling for failed conversions or downloads.
- Add user authentication for personalized features.

Enjoy using the YouTube Playlist MP3 Downloader! 🎵