/**
 * Worker process — launched by src/index.js as a detached child.
 *
 * Usage:
 *   node worker.js            — run ONE queued job (exit 0/1)
 *   node worker.js --daemon   — keep-alive loop, pick up jobs every minute
 *
 * Shares data with the scheduler via data/jobs.json.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(__dirname, '..', 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const LOCK_FILE = path.join(DATA_DIR, '.lock');
const WORKER_ID = parseInt(process.env.WORKER_ID || String(os.cpus().length - 1), 10);

// Timeout constants (in milliseconds)
const TIMEOUT_DOWNLOAD = 5 * 60 * 1000;   // 5 min for yt-dlp
const TIMEOUT_PIPELINE = 10 * 60 * 1000;  // 10 min total pipeline

// ─── Helpers ──────────────────────────────────────────────────────────────

function readJobs() {
  try { return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8')); } catch (_) { return []; }
}
function writeJobs(jobs) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = JOBS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2), 'utf8');
  fs.renameSync(tmp, JOBS_FILE);
}
function tryLock(owner) {
  try {
    const raw = fs.readFileSync(LOCK_FILE, 'utf8');
    const { pid, id } = JSON.parse(raw);
    if (pid !== process.pid && id !== owner) return false; // held by another worker
  } catch (_) { /* no lock */ }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, id: owner }));
  return true;
}
function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
}

// ─── Core pipeline (same logic as original index.js but exported for reuse)
async function downloadVideo(url) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const outputFile = path.join(os.tmpdir(), `source_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
    console.log(`[download] Starting: ${url}`);
    const proc = spawn('yt-dlp', [
      '-f', 'bestvideo[height<=1080][fps<=30]+bestaudio/best[height<=1080]',
      '--merge-output-format', 'mp4', '-o', outputFile,
      '--no-playlist', '--retries', '3', '--fragment-retries', '3', '-q', url,
    ], { stdio: ['ignore', 'inherit', 'pipe'] });
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('[download]')) console.log('[download]', text.trim());
    });
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Download timed out after 5 minutes'));
    }, TIMEOUT_DOWNLOAD);
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        console.log(`[download] Saved: ${outputFile}`);
        resolve(outputFile);
      } else {
        reject(new Error(`yt-dlp exited ${code}`));
      }
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function runJob(job) {
  const { findTrendingStreams } = require('./sources/youtube');
  const { findGta6Streams } = require('./sources/twitch');
  const { processSource } = require('./clipper');
  const { generateCaptions } = require('./captions');
  const { uploadToInstagram } = require('./instagram-uploader');

  // Step 1: Find source
  console.log(`[job] Finding source...`);
  let sourceUrl;
  if (job.source === 'twitch') {
    const streams = await findGta6Streams();
    if (!streams.length) throw new Error('No active GTA 6 Twitch streams');
    sourceUrl = streams[0].url;
  } else {
    const streams = await findTrendingStreams();
    if (!streams.length) throw new Error('No recent GTA 6 YouTube videos');
    sourceUrl = streams[0].url;
  }
  job.sourceUrl = sourceUrl;
  console.log(`[job] Found: ${sourceUrl}`);

  // Step 2: Download
  job.downloadedPath = await downloadVideo(sourceUrl);
  console.log(`[job] Download complete`);

  // Step 3: Extract clips
  console.log(`[job] Processing highlights...`);
  job.clips = await processSource(job.downloadedPath, 1);
  if (!job.clips?.length) throw new Error('No clips extracted');
  console.log(`[job] Extracted ${job.clips.length} clip(s)`);

  // Step 4: Generate caption
  console.log(`[job] Generating caption...`);
  const clipSummary = `GTA 6 gameplay from ${sourceUrl}`;
  const { caption, hashtags } = await generateCaptions(clipSummary);
  job.caption = caption;
  job.hashtags = hashtags;
  console.log(`[job] Caption generated`);

  // Step 5: Upload
  console.log(`[job] Uploading to Instagram...`);
  const result = await uploadToInstagram(job.clips[0].file, caption, hashtags);
  job.uploadResult = result;
  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  console.log(`[job] Done!`);
}

// ─── Single-shot mode (called by cron / manual trigger) ──────────────────
async function runOneCycle() {
  const jobs = readJobs();
  const queued = jobs.filter((j) => j.status === 'queued');
  if (!queued.length) { console.log('[worker] no queued jobs — exiting'); return; }

  // Atomic claim: first worker to acquire lock gets the job.
  if (!tryLock(WORKER_ID)) { console.log('[worker] lock taken by peer — skipping'); return; }

  const job = queued[0];
  job.status = 'processing';
  job.startedAt = new Date().toISOString();
  writeJobs(jobs);
  releaseLock();

  console.log(`[worker#${WORKER_ID}] running job ${job.id} source=${job.source}`);

  // Wrap entire pipeline in timeout
  const pipelineTimeout = setTimeout(() => {
    console.error(`[worker#${WORKER_ID}] Pipeline timed out after ${TIMEOUT_PIPELINE / 1000}s`);
    job.status = 'failed';
    job.error = `Pipeline exceeded ${TIMEOUT_PIPELINE / 1000}s timeout`;
    job.failedAt = new Date().toISOString();
    writeJobs(jobs);
    process.exit(1);
  }, TIMEOUT_PIPELINE);

  try {
    await runJob(job);
    clearTimeout(pipelineTimeout);
    console.log(`[worker#${WORKER_ID}] job ${job.id} done`);
  } catch (err) {
    clearTimeout(pipelineTimeout);
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    job.failedAt = new Date().toISOString();
    console.error(`[worker#${WORKER_ID}] job ${job.id} FAILED:`, job.error);
  } finally {
    writeJobs(jobs);
  }
}

// ─── Daemon mode (one persistent worker per CPU) ─────────────────────────
if (process.argv.includes('--daemon')) {
  console.log(`[daemon] worker#${WORKER_ID} started`);
  setInterval(() => void runOneCycle(), 60000); // poll every minute
  // Keep alive — prevent Render free-tier sleep.
  setInterval(async () => {
    try { await fetch(`http://localhost:${require('./config').port}/health`); } catch (_) {}
  }, 240000);
} else {
  // Single-shot CLI usage.
  void runOneCycle().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2); });
}
