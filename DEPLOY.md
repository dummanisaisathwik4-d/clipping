# GTA 6 Auto Clips — Deployment Setup Guide

## Step-by-step: deploy fully online (no local machine needed)

### 1. Initialize Git Repository
```bash
cd ~/gta6-auto-clips
git init
git add .
git commit -m "feat: GTA 6 Instagram clip automation"
```

### 2. Create GitHub Repo & Push
```bash
gh repo create gta6-auto-clips --public --clone
cd gta6-auto-clips
git remote add origin https://github.com/YOUR_USERNAME/gta6-auto-clips.git
git push -u origin main
```
Replace `YOUR_USERNAME` with your actual GitHub username.

### 3. Deploy to Render.com
1. Go to [render.com](https://render.com) → Sign up / Log in
2. Click **New **+** → **Web Service**
3. Connect your GitHub account
4. Select the `gta6-auto-clips` repo
5. Fill in these settings:
   - **Name**: `gta6-auto-clips`
   - **Environment**: `Node`
   - **Build Command**: `npm ci --only=production`
   - **Start Command**: `node src/index.js`
   - **Instance Type**: Free
6. Under **Environment Variables**, paste each value from `.env`:

   | Key | Value |
   |-----|-------|
   | `BYNARA_API_KEY` | `sk-nry-ke6fktja4EibeVcntYXLp_OhdGQqteS7ZzeskbH1gTI` |
   | `INSTAGRAM_USERNAME` | `game.z.clips` |
   | `INSTAGRAM_PASSWORD` | `User@1234` |
   | `PORT` | `3000` |
   | `BYNARA_BASE_URL` | `https://router.bynara.id/v1` |
   | `BYNARA_MODEL` | `agnes-2.5-flash` |

7. Click **Create Web Service** — wait ~2 minutes for deploy

### 4. Set Up Hourly External Cron
Render's free tier doesn't support internal cron reliably, so use a free external scheduler:

1. Go to [cron-job.org](https://cron-job.org) → Sign up (free)
2. Click **Add New Job**
3. Settings:
   - **Title**: `GTA 6 Clip Hourly`
   - **URL**: `https://your-app-name.onrender.com/trigger`
     *(replace with your actual Render URL after deploy)*
   - **Frequency**: Every hour
   - **Method**: POST
   - **Content Type**: `application/json`
   - **Body**: `{}`
4. Click **Activate**

Your server is now set to produce one clip every hour, 24/7, fully cloud-hosted. ✅

---

## Monitoring

After deploy, check your app health:
```bash
curl https://your-app-name.onrender.com/health
```

View logs in the Render dashboard → your service → **Logs** tab.

---

## Files Created

| File | Purpose |
|------|---------|
| `render.yaml` | Declarative Render config (optional, used if you import via YAML) |
| `Dockerfile` | Container image with ffmpeg + yt-dlp + chromium pre-installed |
| `.env` | Your API keys — never commit this |
| `.gitignore` | Ensures `.env` stays local |
