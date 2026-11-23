require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,

  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY,
    searchQuery: 'GTA 6 stream live',
    maxResults: 10,
  },

  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID,
    accessToken: process.env.TWITCH_ACCESS_TOKEN,
    channels: ['ninja', 'kai_cenat', 'xqc', 'summit1g'], // GTA 6 streamers to watch
  },

  openai: {
    apiKey: process.env.BYNARA_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.BYNARA_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.BYNARA_MODEL || process.env.OPENAI_MODEL || 'agnes-2.5-flash',
  },

  instagram: {
    username: process.env.INSTAGRAM_USERNAME,
    password: process.env.INSTAGRAM_PASSWORD,
  },

  clipSettings: {
    outputResolution: '1080p', // 1920x1080
    minClipDuration: 60,       // Minimum clip length in seconds
    maxClipDuration: 180,      // Maximum clip length in seconds
    targetDuration: 120,       // Ideal clip length
    fps: 30,
    bitrate: '8M',             // 8 Mbps for 1080p
  },

  uploadSchedule: {
    clipsPerDay: 24,           // One per hour
    intervalMs: 60 * 60 * 1000, // 1 hour between uploads
  },

  highlightThreshold: 0.7,     // Score threshold for selecting highlights
};

module.exports = config;
