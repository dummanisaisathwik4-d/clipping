/**
 * Instagram Reels content discovery module.
 *
 * Note: Instagram does not provide a public API for media discovery.
 * This module is intentionally minimal — use it at your own discretion
 * or swap in a third-party scraping service (Apify, ScrapingBee).
 */

/**
 * Find trending GTA 6 reels by hashtag.
 * @param {string[]} tags
 * @returns {Promise<Array<{id: string, url: string, likes: number}>>}
 */
async function findTrendingReels(tags = ['gta6', 'gtavipreorder']) {
  console.warn(
    '[Instagram] Direct scraping requires manual review — implement at your discretion.',
  );
  return [];
}

/**
 * Search reels by a specific hashtag.
 * @param {string} hashtag
 * @returns {Promise<Array<{id: string, url: string, engagement: number}>>>}
 */
async function findGta6ContentByHashtag(hashtag) {
  return [];
}

module.exports = { findTrendingReels, findGta6ContentByHashtag };
