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
    const proc = spawn('yt-dlp', [
      '-f', 'bestvideo[height<=1080][fps<=30]+bestaudio/best[height<=1080]',
      '--merge-output-format', 'mp4', '-o', outputFile,
      '--no-playlist', '--retries', '3', '--fragment-retries', '3', '-q', url,
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
    proc.on('close', (code) => code === 0 ? resolve(outputFile) : reject(new Error(`yt-dlp exited ${code}`)));
    proc.on('error', reject);
  });
}

async function runJob(job) {
  const { findTrendingStreams } = require('./sources/youtube');
  const { findGta6Streams } = require('./sources/twitch');
  const { processSource } = require('./clipper');
  const { generateCaptions } = require('./captions');
  const { uploadToInstagram } = require('./instagram-uploader');

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

  job.downloadedPath = await downloadVideo(sourceUrl);
  job.clips = await processSource(job.downloadedPath, 1);
  if (!job.clips?.length) throw new Error('No clips extracted');

  const clipSummary = `GTA 6 gameplay from ${sourceUrl}`;
  const { caption, hashtags } = await generateCaptions(clipSummary);
  job.caption = caption;
  job.hashtags = hashtags;

  const result = await uploadToInstagram(job.clips[0].file, caption, hashtags);
  job.uploadResult = result;
  job.status = 'completed';
  job.completedAt = new Date().toISOString();
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
  try {
    await runJob(job);
    console.log(`[worker#${WORKER_ID}] job ${job.id} done`);
  } catch (err) {
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
