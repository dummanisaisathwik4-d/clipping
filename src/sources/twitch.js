const axios = require('axios');
const config = require('../config');

/**
 * Exchange client credentials for a Twitch access token.
 * @returns {Promise<string|null>} Bearer token or null on failure.
 */
async function getAccessToken() {
  if (!config.twitch.clientId || !config.twitch.accessToken) {
    console.warn('[Twitch] API credentials not configured');
    return null;
  }

  try {
    const response = await axios.post(
      'https://id.twitch.tv/oauth2/token',
      {
        client_id: config.twitch.clientId,
        client_secret: config.twitch.accessToken,
        grant_type: 'client_credentials',
      },
    );
    return response.data.access_token;
  } catch (error) {
    console.error('[Twitch] Failed to get access token:', error.message);
    return null;
  }
}

/**
 * Check a fixed list of known GTA 6 streamers and return those currently live.
 * @returns {Promise<Array<{id: string, title: string, viewerCount: number, url: string, startedAt: string}>>}
 */
async function findGta6Streams() {
  const token = await getAccessToken();
  if (!token) return [];

  const results = [];

  for (const channel of config.twitch.channels) {
    try {
      const streamRes = await axios.get(
        `https://api.twitch.tv/helix/streams?user_login=${channel}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Client-ID': config.twitch.clientId,
          },
        },
      );

      if (streamRes.data.data?.length > 0) {
        const stream = streamRes.data.data[0];
        if (
          stream.game_name?.toLowerCase().includes('gta') ||
          stream.title?.toLowerCase().includes('gta 6')
        ) {
          results.push({
            id: stream.id,
            title: stream.title,
            broadcaster: stream.user_name,
            viewerCount: stream.viewer_count,
            url: `https://twitch.tv/${channel}`,
            startedAt: stream.started_at,
          });
        }
      }
    } catch (error) {
      console.error(`[Twitch] Error fetching ${channel}:`, error.message);
    }
  }

  // Sort by viewer count descending — "most rated"
  results.sort((a, b) => b.viewerCount - a.viewerCount);
  return results;
}

/**
 * Search Twitch for any stream tagged with GTA VI across all channels.
 * @returns {Promise<Array<{id: string, title: string, broadcaster: string, viewerCount: number, url: string}>>}
 */
async function getFollowedGta6Streams() {
  const token = await getAccessToken();
  if (!token) return [];

  try {
    const response = await axios.get('https://api.twitch.tv/helix/search/channels', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Client-ID': config.twitch.clientId,
      },
      params: { query: 'GTA 6' },
    });

    return response.data.data
      .filter((c) => c.is_live)
      .map((c) => ({
        id: c.stream_id,
        title: c.title,
        broadcaster: c.broadcaster_login,
        viewerCount: c.viewer_count,
        url: `https://twitch.tv/${c.broadcaster_login}`,
      }))
      .sort((a, b) => b.viewerCount - a.viewerCount);
  } catch (error) {
    console.error('[Twitch] Search failed:', error.message);
    return [];
  }
}

module.exports = { findGta6Streams, getFollowedGta6Streams };
