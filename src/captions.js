const OpenAI = require('openai');
const config = require('./config');

/**
 * Initialize LLM client — works with OpenAI or any compatible provider (byNara).
 */
const llm = new OpenAI({
  baseURL: config.openai.baseURL,
  apiKey: config.openai.apiKey,
});

/** Popular gaming hashtags rotated into every caption. */
const HASHTAG_POOL = [
  '#GTA6', '#GTAVI', '#GTANew', '#GrandTheftAuto6',
  '#RockstarGames', '#Gaming', '#NextGenGaming', '#OpenWorld',
  '#GTA6Leaks', '#GTA6Gameplay', '#PlayStation', '#Xbox',
  '#NVIDIA', '#RTX', '#GamingCommunity', '#Streamer', '#LiveStream',
];

/**
 * Generate an engaging Instagram caption and hashtags via OpenAI.
 *
 * @param {string} clipSummary  Brief description of the clip's highlight moment.
 * @returns {Promise<{caption: string, hashtags: string[]}>}
 */
async function generateCaptions(clipSummary) {
  try {
    const response = await llm.chat.completions.create({
      model: config.openai.model,
      messages: [
        {
          role: 'user',
          content: `Generate an exciting Instagram caption for a GTA 6 gameplay clip.\n\nContext: ${clipSummary}\n\nRequirements:\n- Under 2200 characters total (caption + hashtags)\n- Add relevant emojis\n- Include 15-20 popular gaming hashtags from: ${HASHTAG_POOL.join(', ')}`,
        },
      ],
      max_tokens: 500,
      temperature: 0.8,
    });

    const fullCaption = response.choices[0].message.content.trim();
    const hashtags = [...fullCaption.matchAll(/#\w+/g)].map((m) => m[0]).slice(-20);
    const caption = fullCaption.replace(/#\w+/g, '').trim();

    return { caption, hashtags };
  } catch (error) {
    console.error('[Captions] OpenAI error:', error.message);
    return generateFallbackCaptions();
  }
}

/**
 * Fallback caption generator when OpenAI is unavailable.
 * @param {'action'|'funny'|'discovery'|'challenge'} [momentType='action']
 * @returns {{caption: string, hashtags: string[]}}
 */
function generateFallbackCaptions(momentType = 'action') {
  const templates = {
    action: '🔥 Insane action in GTA 6! You won\'t believe what happens next! 🚗💨',
    funny: '😂 GTA 6 never fails to make me laugh! This part had me rolling! 😂',
    discovery: '👀 First time seeing this in GTA 6! The details are insane! 🔍',
    challenge: '🎯 Took me 10 tries but I finally nailed this! 💪 #GTA6 #Gaming',
  };

  return {
    caption: templates[momentType] ?? templates.action,
    hashtags: HASHTAG_POOL.slice(0, 15),
  };
}

module.exports = { generateCaptions, generateFallbackCaptions };
