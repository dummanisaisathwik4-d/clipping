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
 * Find currently live GTA 6 streams on YouTube, sorted by viewers descending.
 * @returns {Promise<Array<{id: string, title: string, channel: string, viewCount: string, url: string, thumbnail?: string}>>}
 */
async function findTrendingStreams(query = 'GTA 6') {
  const session = await initYouTube();

  const search = await session.search(query, {
    params: { filters: 'live', sortBy: 'relevance' },
  });

  const liveVideos = search.results.filter(
    (item) => item.runTimeText?.text?.toLowerCase().includes('now'),
  );

  // Sort by viewer count descending so "most rated" is picked first
  liveVideos.sort((a, b) => {
    const parse = (v) => parseInt(v?.replace(/\D/g, '') || '0', 10);
    return parse(b.viewers) - parse(a.viewers);
  });

  return liveVideos.map((video) => ({
    id: video.videoId,
    title: video.title,
    channel: video.author,
    viewCount: video.viewers ? `${video.viewers} watching` : 'Live',
    url: `https://youtube.com/watch?v=${video.videoId}`,
    thumbnail: video.thumbnail?.[0]?.url,
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
