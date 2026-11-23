# GTA 6 Auto Clips — Instagram Automation

Fully cloud-hosted automation that finds trending GTA 6 streams, extracts AI-powered highlight clips in 1080p, generates captions + hashtags, and posts to Instagram Reels — **one clip per hour, 24/day**.

## How It Works

```
Hourly cron trigger
       ↓
Source Finder  ──► YouTube Live + Twitch GTA 6 channels (sorted by viewer count)
       ↓
Highlight Detector  ──► FFmpeg astats audio analysis → top-scoring segments
       ↓
Clipper  ──► FFmpeg encode to 1920×1080 @ 30 fps, 8 Mbps
       ↓
Caption Generator  ──► OpenAI GPT-4o-mini creates engaging caption + 15-20 hashtags
       ↓
Instagram Uploader  ──► Headless Puppeteer publishes Reel
```

## Prerequisites

Before running locally or deploying:

```bash
# Install system dependencies
# macOS
brew install ffmpeg yt-dlp

# Ubuntu/Debian
sudo apt install ffmpeg yt-dlp

# Windows (Chocolatey)
choco install ffmpeg yt-dlp
```

## Quick Start

```bash
cd ~/gta6-auto-clips
npm install
cp .env.example .env
# Edit .env — add your API keys
npm start
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `YOUTUBE_API_KEY` | Yes* | YouTube Data API v3 key (used by youtubei.js) |
| `OPENAI_API_KEY` | Yes | Used for caption generation |
| `TWITCH_CLIENT_ID` | Optional | Twitch Helix API client ID |
| `TWITCH_ACCESS_TOKEN` | Optional | Twitch OAuth token (or client-credentials flow) |
| `INSTAGRAM_USERNAME` | Yes | Your Instagram username for headless login |
| `INSTAGRAM_PASSWORD` | Yes | Your Instagram password |
| `PORT` | No | Defaults to `3000` |

*YouTube integration uses the `youtubei.js` SDK which works without an API key for basic searches. Provide `YOUTUBE_API_KEY` for higher rate limits.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Uptime, queue depth |
| `POST` | `/job` | Queue a job (`{source:"youtube"|"twitch"}`) |
| `GET` | `/jobs` | Last 50 jobs |
| `GET` | `/job/:id` | Single job status |
| `POST` | `/trigger` | Immediate one-shot clip |

## Deployment

### Render.com (recommended)
1. Push to GitHub, connect repo on Render
2. Set env vars in Render dashboard
3. Deploy — free tier supports Node web services with persistent schedule

### Fly.io
```bash
fly apps create gta6-clips
fly deploy
```

## Important Notes

- **Instagram ToS**: Headless browser login may flag automated activity. Rotate account usage and monitor.
- **Download step**: The HTTP server scaffolds the pipeline; the `yt-dlp` download step is marked in `src/index.js` with a TODO — wire it in before production use.
- **FFmpeg**: Ensure the host environment has `ffmpeg` installed (Render/Fly support it via buildpacks).
- **Schedule**: The built-in `node-cron` fires hourly. For longer-running reliability, pair with an external croner (cron-job.org or GitHub Actions) hitting `/trigger`.

## Architecture Diagram

```
┌─────────────────┐    ┌──────────────────┐
│  External Cron  │───►│  Express API     │
└─────────────────┘    │  /trigger        │
                        └────────┬─────────┘
                                  ▼
                     ┌──────────────────────┐
                     │  Source Discovery     │
                     │  YT Live + Twitch     │
                     └──────────┬───────────┘
                                ▼
                     ┌──────────────────────┐
                     │  Highlight Analysis   │
                     │  FFmpeg astats + sort │
                     └──────────┬───────────┘
                                ▼
                     ┌──────────────────────┐
                     │  Clip Rendering       │
                     │  1080p / 30fps / 8Mbps│
                     └──────────┬───────────┘
                                ▼
                     ┌──────────────────────┐
                     │  Caption Gen (OpenAI) │
                     └──────────┬───────────┘
                                ▼
                     ┌──────────────────────┐
                     │  Instagram Upload     │
                     │  Puppeteer headless   │
                     └──────────────────────┘
```
