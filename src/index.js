const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const config = require('./config');
const { findTrendingStreams } = require('./sources/youtube');
const { findGta6Streams } = require('./sources/twitch');
const { processSource } = require('./clipper');
const { generateCaptions } = require('./captions');
const { uploadToInstagram } = require('./instagram-uploader');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// ─── In-memory job queue ───────────────────────────────────────────
/** @typedef {{id: string, status: 'queued'|'processing'|'completed'|'failed', createdAt: string, source: string, sourceUrl?: string, downloadedPath?: string, clips?: Array<{id:string,file:string,startTimer:number,endTime:number,score:number}>, caption?: string, hashtags?: string[], uploadResult?: object, error?: string, startedAt?: string, completedAt?: string, failedAt?: string}} Job */
/** @type {Array<Job>} */
const jobQueue = [];
let isProcessing = false;

// ─── Routes ────────────────────────────────────────────────────────

/** POST /job – Create a clipping job */
app.post('/job', (req, res) => {
  /** @type {Job} */
  const job = {
    id: uuidv4(),
    status: 'queued',
    createdAt: new Date().toISOString(),
    source: req.body.source || 'youtube',
  };
  jobQueue.push(job);
  res.json({ success: true, jobId: job.id });
});

/** GET /jobs – List last 50 jobs */
app.get('/jobs', (_req, res) => {
  res.json(jobQueue.slice(-50));
});

/** GET /job/:id – Get job status */
app.get('/job/:id', (req, res) => {
  const job = jobQueue.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

/** GET /health – System health check */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    queueLength: jobQueue.length,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/** POST /trigger – Manually trigger one clip cycle */
app.post('/trigger', async (_req, res) => {
  /** @type {Job} */
  const job = {
    id: uuidv4(),
    status: 'queued',
    createdAt: new Date().toISOString(),
    source: _req.body.source || 'youtube',
  };
  jobQueue.push(job);
  res.json({ success: true, jobId: job.id });
  if (!isProcessing && jobQueue.length > 0) void processNextJob();
});

// ─── Core functions ────────────────────────────────────────────────

/**
 * Download a video from YouTube/Twitch using yt-dlp.
 * Stderr is silenced so Render container output stays within limits.
 * @param {string} url
 * @returns {Promise<string>} Absolute path to the downloaded MP4.
 */
async function downloadVideo(url) {
  return new Promise((resolve, reject) => {
    const outputFile = path.join(os.tmpdir(), `source_${Date.now()}.mp4`);
    const proc = spawn('yt-dlp', [
      '-f', 'bestvideo[height<=1080][fps<=30]+bestaudio/best[height<=1080]',
      '--merge-output-format', 'mp4',
      '-o', outputFile,
      '--no-playlist',
      '--retries', '3',
      '--fragment-retries', '3',
      '--newline',          // strip progress bars from stderr
      '-q',                 // quiet mode
      url,
    ], { stdio: ['ignore', 'ignore', 'ignore'] });   // all stdio discarded
    proc.on('close', (code) => {
      if (code === 0) resolve(outputFile);
      else reject(new Error(`yt-dlp exited ${code}`));
    });
    proc.on('error', reject);
  });
}

/**
 * Execute one full pipeline cycle for a single job.
 */
async function runOneJob(job) {
  job.status = 'processing';
  job.startedAt = new Date().toISOString();

  let sourceUrl;
  if (job.source === 'youtube') {
    const streams = await findTrendingStreams();
    if (streams.length === 0) throw new Error('No recent GTA 6 videos found on YouTube');
    sourceUrl = streams[0].url;
    job.sourceTitle = streams[0].title;
  } else if (job.source === 'twitch') {
    const streams = await findGta6Streams();
    if (streams.length === 0) throw new Error('No active GTA 6 streams on Twitch');
    sourceUrl = streams[0].url;
    job.sourceTitle = streams[0].title;
  } else {
    throw new Error('Invalid source');
  }
  job.sourceUrl = sourceUrl;

  // Download
  const downloadedPath = await downloadVideo(sourceUrl);
  job.downloadedPath = downloadedPath;

  // Extract highlight clip (1080p)
  job.clips = await processSource(downloadedPath, 1);

  // Generate caption + hashtags via byNara
  const clipSummary = `GTA 6 gameplay from ${sourceUrl}`;
  const { caption, hashtags } = await generateCaptions(clipSummary);
  job.caption = caption;
  job.hashtags = hashtags;

  // Upload to Instagram Reels
  if (job.clips?.length > 0) {
    const result = await uploadToInstagram(job.clips[0].file, caption, hashtags);
    job.uploadResult = result;
  }

  job.status = 'completed';
  job.completedAt = new Date().toISOString();
}

/**
 * Dequeue and run the next job (sequentially, never concurrently).
 */
async function processNextJob() {
  if (isProcessing || jobQueue.length === 0) return;
  isProcessing = true;
  const job = jobQueue.shift();
  try {
    await runOneJob(job);
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    job.failedAt = new Date().toISOString();
  } finally {
    isProcessing = false;
  }
}

// ─── Scheduler ─────────────────────────────────────────────────────
cron.schedule('0 * * * *', () => {
  if (!isProcessing && jobQueue.length > 0) void processNextJob();
});

// ─── Start server ──────────────────────────────────────────────────
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`[Scheduler] listening on port ${PORT}`);
  console.log(`[Scheduler] target: ${config.uploadSchedule.clipsPerDay} clips/day`);
});

module.exports = app;
