# 🎶 YouTube Playlist MP3 Downloader 🎵

This web application lets you effortlessly download audio tracks from YouTube playlists as MP3 files. With a user-friendly interface, you can search, filter, and manage videos, supporting both batch processing and individual downloads. 🚀

[![YouTube Playlist MP3 Downloader](https://raw.githubusercontent.com/vucinatim/youtube-playlist-to-mp3/refs/heads/main/public/preview.png)](https://youtube-playlist-to-mp3.vercel.app/)
---

## 🌟 Features

### 📋 Playlist Loading
- **Load YouTube Playlist:** Enter a YouTube playlist URL to fetch and display all videos in the playlist.
- **Dynamic Filters:**
  - 🔍 Filter videos by title using a search bar.
  - 🎥 Filter by creator/channel.
  - 🔢 Sort videos by views or title.

---

### 📂 Video Management
- **Select Videos:**
  - ✅ Select individual videos or use the "Select All" button to batch-select videos.
  - ❌ Deselect videos individually or use the "Deselect All" button.
- **Video Cards:**
  - 🎞️ Display each video with its thumbnail, title, views, and creator details.
  - ▶️ Play or ⏹️ stop a video using the embedded YouTube player.
  - 🎵 Convert and download videos individually with easy-to-use buttons.

---

### 🔄 MP3 Conversion
- **Batch Processing:**
  - 🎛️ Select multiple videos and convert them to MP3 format.
  - 📈 Track progress for each video during downloading and conversion.
  - 📦 Download all converted MP3 files as a ZIP archive.
- **Individual Downloads:**
  - 🛠️ Convert and download single MP3 files with real-time progress tracking.
  - ⚡ Conversion is done directly in the browser using `@ffmpeg/ffmpeg`.

---

### 🖥️ UI and Usability
- **Progress Tracking:** 
  - 📊 See real-time progress for individual and batch downloads with a fill-up bar and percentage updates.
- **Floating Video Player:**
  - 🎥 Preview any video in a floating, resizable player.
- **Responsive Design:**
  - 📱 Optimized for both desktop and mobile devices.

---

## 💡 How It Works

1. **Load Playlist:**
   - Paste a YouTube playlist URL.
   - The app fetches playlist details via the server and displays the videos.

2. **Select Videos:**
   - Use filters to refine your selection.
   - ✅ Select videos for conversion and downloading.

3. **Convert and Download:**
   - **Individual Downloads:**
     - Click "Convert to MP3" on a video card.
     - The app fetches the video stream and converts it to MP3 using `@ffmpeg/ffmpeg` in the browser.
   - **Batch Downloads:**
     - Select multiple videos and click "Download."
     - All selected videos are processed concurrently and packaged as a ZIP file.

4. **Monitor Progress:**
   - Watch real-time progress updates for each video during the download and conversion.

---

## ⚙️ Tech Stack

- **Frontend:** 
  - 🌐 **Next.js** (App Router).
  - 💻 **TypeScript** for type safety.
  - 🎨 **TailwindCSS** for styling.
  - 🧩 **shadcn/ui components** for prebuilt, customizable UI components.
- **State Management:** 
  - 🗂️ Zustand for managing global state (e.g., progress tracking).
- **Media Processing:**
  - 🔧 `@ffmpeg/ffmpeg` for client-side video-to-audio conversion.
- **Backend:** 
  - 🔙 Next.js API routes handle playlist fetching and video stream redirection.

---

## 🛠️ Setup

### Prerequisites
- 🖥️ Node.js and npm installed.

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/vucinatim/youtube-playlist-to-mp3.git
   cd youtube-playlist-mp3-downloader
   ```
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Start the development server:
   ```bash
   pnpm dev
   ```

### Environment Variables
- Configure a `.env.local` file with any required API keys or settings.
You will need YOUTUBE_API_KEY to fetch playlist videos which you can get from [here](https://developers.google.com/youtube/v3/getting-started).

---

## 🚀 Future Improvements
- 📜 Add pagination for large playlists.
- ⚡ Optimize FFmpeg processing for large batch downloads.
- 🛡️ Enhance error handling for failed conversions or downloads.
- 🔑 Add user authentication for personalized features.

Enjoy using the YouTube Playlist MP3 Downloader! 🎧
