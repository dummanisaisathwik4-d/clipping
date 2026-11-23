const { Innertube } = require('youtubei.js');

/** @type {import('youtubei.js').YouTubeSession | null} */
let youtubeSession = null;

/**
 * Initialize or reuse YouTube session.
 * @returns {Promise<import('youtubei.js').YouTubeSession>}
 */
async function initYouTube() {
  if (youtubeSession) return youtubeSession;
  console.log('[YouTube] Initializing session...');
  youtubeSession = await Innertube.create();
  console.log('[YouTube] Session initialized');
  return youtubeSession;
}

/**
 * Find the most-viewed GTA 6 videos uploaded within the last 24 hours on YouTube,
 * sorted by view count descending (most rated first).
 * @returns {Promise<Array<{id: string, title: string, channel: string, viewCount: number, url: string, thumbnail?: string, publishedAt: string}>>}
 */
async function findTrendingStreams(query = 'GTA 6') {
  const session = await initYouTube();

  // Filter: uploadDate=last_24_hours → only videos published today
  // SortBy: views → highest-viewed video appears first
  const search = await session.search(query, {
    params: {
      filters: 'uploadDate=last_24_hours',
      sortBy: 'views',
    },
  });

  // Keep only video results (exclude playlists / livestreams / channels)
  const videos = search.results.filter(
    (item) => item.type === 'video' && item.runTimeText?.text,
  );

  // Double-sort by raw view count descending as a safety net
  videos.sort((a, b) => {
    const parseViews = (v) =>
      parseInt(v?.viewCountText?.text?.replace(/\D/g, '') || '0', 10);
    return parseViews(b) - parseViews(a);
  });

  return videos.slice(0, 5).map((video) => ({
    id: video.videoId,
    title: video.title,
    channel: video.author,
    viewCount: Number(video.viewCountText?.text?.replace(/\D/g, '') || '0'),
    url: `https://youtube.com/watch?v=${video.videoId}`,
    thumbnail: video.thumbnail?.[0]?.url,
    publishedAt: video.uploadedDate?.text ?? '',
  }));
}

/**
 * Fetch metadata for a given YouTube video/stream URL.
 * @param {string} url
 * @returns {Promise<{id: string, title: string, duration: number, url: string, isLive: boolean}>}
 */
async function getStreamVod(url) {
  const session = await initYouTube();
  const videoId = new URL(url).searchParams.get('v');
  const result = await session.getBasicInfo(videoId);

  return {
    id: result.videoDetails.videoId,
    title: result.videoDetails.title,
    duration: Number(result.videoDetails.lengthSeconds),
    url: result.videoDetails.thumbnail[0].url,
    isLive: !!result.streamingData?.hlsManifestUrl,
  };
}

module.exports = { findTrendingStreams, getStreamVod };
