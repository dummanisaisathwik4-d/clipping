const express = require('express');
const cron = require('node-cron');
const config = require('./config');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// ─── In-memory job queue (persisted to data/jobs.json on every mutation) ──
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

function loadJobs() {
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  } catch (_) {
    return [];
  }
}
function saveJobs(jobs) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(JOBS_FILE + '.tmp', JSON.stringify(jobs, null, 2));
  fs.renameSync(JOBS_FILE + '.tmp', JOBS_FILE);
}

let jobs = loadJobs();

// ─── Startup recovery: clear any stale processing jobs (>30 min old) ──
const STALE_THRESHOLD_MS = 30 * 60 * 1000;
jobs.forEach((job) => {
  if (job.status === 'processing' && job.startedAt) {
    const elapsed = Date.now() - new Date(job.startedAt).getTime();
    if (elapsed > STALE_THRESHOLD_MS) {
      console.warn(`[recovery] Clearing stale job ${job.id} (${Math.round(elapsed/60000)}min old)`);
      job.status = 'failed';
      job.error = 'Stale job cleared on restart (worker crashed or hung)';
      job.failedAt = new Date().toISOString();
    }
  }
});
saveJobs(jobs);

let isProcessing = false;

// ─── Routes ────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', queueLength: jobs.filter((j) => j.status === 'queued').length, uptime: process.uptime(), timestamp: new Date().toISOString() }),
);

app.post('/job', (req, res) => {
  const job = { id: uuidv4(), status: 'queued', createdAt: new Date().toISOString(), source: req.body.source || 'youtube' };
  jobs.push(job);
  saveJobs(jobs);
  res.json({ success: true, jobId: job.id });
});

app.get('/jobs', (_req, res) => res.json(jobs.slice(-50)));

app.get('/job/:id', (req, res) => {
  const job = jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.post('/trigger', (_req, res) => {
  const job = { id: uuidv4(), status: 'queued', createdAt: new Date().toISOString(), source: _req.body.source || 'youtube' };
  jobs.push(job);
  saveJobs(jobs);
  console.log(`[Scheduler] Enqueued job ${job.id}`);
  res.json({ success: true, jobId: job.id });
});

app.post('/purge', (_req, res) => {
  jobs = jobs.filter((j) => j.status !== 'queued' && j.status !== 'processing');
  saveJobs(jobs);
  res.json({ removed: jobs.length });
});

// Emergency endpoint to force-mark a processing job as failed
app.post('/emergency/fail-job/:id', (_req, res) => {
  const job = jobs.find((j) => j.id === req.params.id);
  if (!job || job.status !== 'processing') {
    return res.status(404).json({ error: 'Job not found or not in processing state' });
  }
  job.status = 'failed';
  job.error = 'Emergency fail by admin';
  job.failedAt = new Date().toISOString();
  saveJobs(jobs);
  console.log(`[emergency] Failed job ${job.id}`);
  res.json({ success: true, jobId: job.id });
});

// Emergency endpoint to clear all stuck jobs
app.post('/emergency/clear-stuck', (_req, res) => {
  const stuckCount = jobs.filter((j) => j.status === 'processing').length;
  jobs = jobs.filter((j) => j.status !== 'processing');
  saveJobs(jobs);
  console.log(`[emergency] Cleared ${stuckCount} stuck jobs`);
  res.json({ cleared: stuckCount, remaining: jobs.length });
});

app.post('/process-queue', (_req, res) => {
  const queued = jobs.filter((j) => j.status === 'queued');
  if (!queued.length || isProcessing) {
    return res.json({ message: 'No queued jobs or already processing', count: queued.length });
  }
  const job = queued[0];
  job.status = 'processing';
  job.startedAt = new Date().toISOString();
  saveJobs(jobs);
  console.log(`[manual] Processing job ${job.id}`);
  spawnProcessJob(job.id).then(() => {
    res.json({ message: 'Job started', jobId: job.id });
  }).catch(err => {
    res.status(500).json({ error: err.message });
  });
});

async function spawnProcessJob(jobId) {
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [path.join(__dirname, 'worker.js')], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code) => {
    console.log(`[manual] Worker exited code=${code} for job ${jobId}`);
  });
}

// ─── Cron: dequeue one queued job per hour ─────────────────────────────────
cron.schedule('0 * * * *', () => {
  const queued = jobs.filter((j) => j.status === 'queued');
  if (!queued.length || isProcessing) return;
  isProcessing = true;
  const job = queued[0];
  job.status = 'processing';
  job.startedAt = new Date().toISOString();
  saveJobs(jobs);
  console.log(`[cron] dequeued job ${job.id} — spawning worker`);
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [path.join(__dirname, 'worker.js')], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env },
  });
  child.on('exit', (code) => {
    // Worker itself updates the job record on completion/failure.
    console.log(`[cron] worker exited code=${code}`);
    isProcessing = false;
  });
});

// Keep-alive: ping our own /health every 4 min so Render doesn't sleep.
setInterval(async () => {
  try {
    const url = `http://localhost:${config.port}/health`;
    await fetch(url);
  } catch (_) {}
}, 240000);

// ─── Start ─────────────────────────────────────────────────────────────────
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`[Scheduler] listening on port ${PORT}`);
  console.log(`[Scheduler] target: ${config.uploadSchedule.clipsPerDay} clips/day`);
  console.log(`[Scheduler] active jobs: ${jobs.length}`);
});

module.exports = app;
