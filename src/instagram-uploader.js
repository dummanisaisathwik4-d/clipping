const puppeteer = require('puppeteer-core');
const path = require('path');
const os = require('os');
const config = require('./config');

// For serverless (Render/Fly) deployment with Chromium bundled in the container,
// puppeteer-core alone works fine. Install 'chromium' separately if needed:
//   npm install chromium
let executablePath = undefined;
try {
  const chromiumPkg = require('chromium');
  executablePath = chromiumPkg.executablePath;
} catch {
  // Will fall back to system Chrome / browser installed on host
  console.log('[InstagramUploader] No bundled Chromium found — using system Chrome');
}

/**
 * Upload a rendered clip to Instagram Reels via headless browser.
 *
 * ⚠️ Automated login may violate Instagram's Terms of Service.
 * Use only on accounts you own, and monitor for suspensions.
 *
 * @param {string} videoPath  Absolute path to the 1080p MP4 to upload.
 * @param {string} caption    Caption text body.
 * @param {string[]} hashtags Array of hashtag strings (e.g. ['#GTA6']).
 * @returns {Promise<{success: boolean, error?: string, screenshotPath?: string}>}
 */
async function uploadToInstagram(videoPath, caption, hashtags) {
  console.log('[InstagramUploader] Starting upload…');

  /** @type {puppeteer.LaunchOptions} */
  const launchOpts = {
    headless: 'new',
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  };

  const browser = await puppeteer.launch(launchOpts);
  let screenshotPath = null;

  try {
    const page = await browser.newPage();
    await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2', timeout: 30000 });

    // Login check
    if (page.url().includes('/accounts/login/')) {
      await login(page);
    }

    // Navigate to reel creator
    await page.goto('https://www.instagram.com/create/reel/');
    await page.waitForSelector('[data-testid="composer-photo-upload-button"]', {
      visible: true,
      timeout: 30000,
    });

    // Upload video file
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.uploadFile(path.resolve(videoPath));
      console.log('[InstagramUploader] Video form field populated');
    }

    // Wait for editor to appear
    await page.waitForFunction(
      () => !!document.querySelector('[data-testid="feed-description-textarea"]'),
      { timeout: 60000 },
    );

    // Add caption
    const captionEl = await page.$('[data-testid="feed-description-textarea"]');
    if (captionEl) {
      await captionEl.click();
      await captionEl.type(`${caption}\n\n${hashtags.join(' ')}`);
    }

    // Publish
    const shareBtn = await page.$('[data-testid="share-reel-button"]');
    if (shareBtn) {
      await shareBtn.click();
    }

    // Confirmation screenshot
    await page.waitForTimeout(5000);
    screenshotPath = path.join(os.tmpdir(), `ig-success-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('[InstagramUploader] Screenshot saved:', screenshotPath);

    return { success: true, screenshotPath };
  } catch (error) {
    console.error('[InstagramUploader] Upload failed:', error.message);
    return { success: false, error: error.message, screenshotPath };
  } finally {
    await browser.close();
  }
}

/**
 * Log in with stored Instagram credentials.
 * @param {import('puppeteer').Page} page
 */
async function login(page) {
  await page.type('input[name="username"]', config.instagram.username);
  await page.type('input[name="password"]', config.instagram.password);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
}

module.exports = { uploadToInstagram };
