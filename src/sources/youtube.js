const axios = require('axios');
const config = require('../config');

/**
 * Find the most-viewed GTA 6 videos uploaded within the last 24 hours
 * using the official YouTube Data API v3.
 * @returns {Promise<Array<{id: string, title: string, channel: string, viewCount: number, url: string, thumbnail?: string, publishedAt: string}>>}
 */
async function findTrendingStreams(query = 'GTA 6') {
  const apiKey = config.youtube?.apiKey;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY not configured in .env');

  // Calculate 24h ago timestamp
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const isoStart = yesterday.toISOString();

  try {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: query,
        type: 'video',
        publishedAfter: isoStart,
        order: 'viewCount',
        maxResults: 10,
        key: apiKey,
      },
    });

    const items = res.data.items || [];
    const videoIds = items.map((item) => item.id.videoId);

    // Fetch view counts in parallel
    let statsMap = new Map();
    if (videoIds.length > 0) {
      try {
        const statsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
          params: {
            part: 'statistics',
            id: videoIds.join(','),
            key: apiKey,
          },
        });
        statsRes.data.items.forEach((v) => {
          statsMap.set(v.id, parseInt(v.statistics?.viewCount || '0', 10));
        });
      } catch (_) { /* stats optional */ }
    }

    return items.map((item) => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      url: `https://youtube.com/watch?v=${item.id.videoId}`,
      thumbnail: item.snippet.thumbnails.high?.url,
      publishedAt: item.snippet.publishedAt,
      viewCount: statsMap.get(item.id.videoId) || 0,
    }));
  } catch (err) {
    console.error('[YouTube API] Error:', err.response?.data?.error?.message || err.message);
    return [];
  }
}

module.exports = { findTrendingStreams };
