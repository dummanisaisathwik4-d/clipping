const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

const CLIPS_DIR = path.join(os.tmpdir(), 'gta6-clips');

/** Ensure the clips output directory exists. */
async function ensureClipsDir() {
  await fs.mkdir(CLIPS_DIR, { recursive: true });
}

// Delayed import so top-level requires stay synchronous
const fs = require('fs').promises;

/**
 * Score each N-second audio chunk of a video by average loudness (dB).
 * Higher score = louder / more exciting moment.
 *
 * @param {string} inputPath  Absolute path to source video.
 * @param {number} segmentMs  Length of each analysis segment in seconds (default 5).
 * @returns {Promise<Array<{start: number, end: number, score: number}>>}
 */
async function analyzeHighlights(inputPath, segmentMs = 5) {
  console.log('[HighlightDetector] Analyzing highlights…');

  return new Promise((resolve, reject) => {
    const chunks = [];
    let pendingStart = 0;
    const chunkVolumes = [];
    let probeDuration = null;

    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);
      probeDuration = metadata.format.duration;
      const totalSegments = Math.ceil(probeDuration / segmentMs);

      // Run loudness analysis via astats filter and capture stats
      ffmpeg(inputPath)
        .audioFilter(`astats=metadata=1:reset=${segmentMs}`)
        .on('stderr', (stderrLine) => {
          const match = stderrLine.match(/Average level=(-?\d+(?:\.\d+)?) dB/);
          if (match) {
            const volume = parseFloat(match[1]);
            chunkVolumes.push(volume);
            if (chunkVolumes.length >= Math.ceil(segmentMs * 10)) {
              const avg =
                chunkVolumes.reduce((a, b) => a + b, 0) / chunkVolumes.length;
              chunks.push({ start: pendingStart, end: pendingStart + segmentMs, score: avg });
              pendingStart += segmentMs;
              chunkVolumes.length = 0;
            }
          }
        })
        .on('end', () => resolve(chunks))
        .on('error', () => {
          // Tolerate partial errors — fall through to fallback
          resolve(chunks.length > 0 ? chunks : generateFallbackSegments(inputPath, segmentMs));
        })
        .run();
    });
  });
}

/**
 * Fallback: evenly-spaced segments scored randomly when audio analysis fails.
 */
async function generateFallbackSegments(inputPath, segmentMs) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata.format.duration;
      const segments = [];
      for (let i = 0; i * segmentMs < duration; i++) {
        segments.push({
          start: i * segmentMs,
          end: Math.min((i + 1) * segmentMs, duration),
          score: 0.4 + Math.random() * 0.5,
        });
      }
      resolve(segments.sort((a, b) => b.score - a.score));
    });
  });
}

/**
 * Extract a single clip from a source video, encoded to the configured resolution.
 *
 * @param {string} inputPath   Source video absolute path.
 * @param {number} startTime   Start time in seconds.
 * @param {number} endTime     End time in seconds.
 * @param {string} outputFile  Output path (will be created).
 * @returns {Promise<string>}  Resolves with outputFile path on success.
 */
async function extractClip(inputPath, startTime, endTime, outputFile) {
  const clipDuration = endTime - startTime;

  if (clipDuration < config.clipSettings.minClipDuration) {
    throw new Error(`Clip too short: ${clipDuration}s < minimum`);
  }

  const { width, height } =
    config.clipSettings.outputResolution === '1080p'
      ? { width: 1920, height: 1080 }
      : config.clipSettings.outputResolution === '720p'
        ? { width: 1280, height: 720 }
        : { width: 854, height: 480 };

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(startTime)
      .duration(clipDuration)
      .videoCodec('libx264')
      .size(`${width}x${height}`)
      .fps(config.clipSettings.fps)
      .outputOptions([
        '-preset medium',
        `-b:v ${config.clipSettings.bitrate}`,
        '-crf 23',
        '-movflags +faststart',
        `-vf "scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2"`,
      ])
      .audioCodec('aac')
      .audioBitrate('192k')
      .output(outputFile)
      .on('end', () => resolve(outputFile))
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Main workflow: find top highlight segments and produce clip files.
 *
 * @param {string} inputPath  Source video path.
 * @param {number} count      Number of clips to extract.
 * @returns {Promise<Array<{id: string, file: string, startTime: number, endTime: number, score: number}>>}
 */
async function processSource(inputPath, count = 1) {
  await ensureClipsDir();
  console.log('[Clipper] Processing:', inputPath);

  const segments = await analyzeHighlights(inputPath, config.clipSettings.targetDuration);
  const topSegments = segments.slice(0, count);
  const clips = [];

  for (const segment of topSegments) {
    const clipId = uuidv4();
    const outputFile = path.join(CLIPS_DIR, `${clipId}.mp4`);

    try {
      await extractClip(inputPath, segment.start, segment.end, outputFile);
      clips.push({
        id: clipId,
        file: outputFile,
        startTime: segment.start,
        endTime: segment.end,
        score: segment.score,
      });
    } catch (error) {
      console.error('[Clipper] Failed to extract clip:', error.message);
    }
  }

  return clips;
}

module.exports = { analyzeHighlights, extractClip, processSource, CLIPS_DIR };
