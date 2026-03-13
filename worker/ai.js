/**
 * ABIDE Worker - AI handlers.
 *
 * Plan generation provider order (if configured):
 *   1) Gemini
 *   2) OpenRouter
 *   3) Groq
 */

const PLAN_CACHE_TTL = 24 * 60 * 60; // 24 hours (seconds, for KV)
const PHRASE_CACHE_TTL = 60 * 60;    // 1 hour
const ROUTING_STATE_TTL = 14 * 24 * 60 * 60; // 14 days
const ROUTING_STATE_KEY = 'ai:routing:v1';
const DEFAULT_MIN_MORNING_WORDS = 170;
const DEFAULT_MIN_EVENING_WORDS = 130;
const DEFAULT_MIN_MORNING_PARAGRAPHS = 3;
const DEFAULT_MIN_EVENING_PARAGRAPHS = 2;
const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';
const DEFAULT_OPENROUTER_MODELS = [
  'meta-llama/llama-3.1-8b-instruct:free',
  'google/gemma-2-9b-it:free',
  'mistralai/mistral-7b-instruct:free',
];
const DEFAULT_GROQ_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
];
const MODEL_LIST_CACHE_MS = 15 * 60 * 1000;
let _modelListCache = null;
let _modelListCachedAt = 0;

// ── Strong's Concordance (Open Scriptures, CC-BY-SA, public domain 1890) ────
// Cached in KV on first use — fetched once ever per language, ~1–2MB each.
const STRONGS_GREEK_URL   = 'https://raw.githubusercontent.com/openscriptures/strongs/master/greek/strongs-greek-dictionary.js';
const STRONGS_HEBREW_URL  = 'https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/strongs-hebrew-dictionary.js';
const STRONGS_CACHE_TTL   = 30 * 24 * 60 * 60; // 30 days

async function loadStrongsDict(env, language) {
  const kvKey = `strongs:dict:${language}:v1`;
  if (env.ABIDE_KV) {
    const cached = await env.ABIDE_KV.get(kvKey, 'json');
    if (cached) return cached;
  }
  const url = language === 'greek' ? STRONGS_GREEK_URL : STRONGS_HEBREW_URL;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Strong's ${language} fetch failed: ${res.status}`);
  const text = await res.text();
  // Strip JS wrapper: `var strongsXDictionary = {...}; module.exports = ...`
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`Could not parse Strong's ${language} file`);
  const dict = JSON.parse(text.slice(start, end + 1));
  if (env.ABIDE_KV) {
    await env.ABIDE_KV.put(kvKey, JSON.stringify(dict), { expirationTtl: STRONGS_CACHE_TTL });
  }
  return dict;
}

async function lookupStrongs(env, strongsNumber) {
  if (!strongsNumber?.trim()) return null;
  const num  = strongsNumber.trim().toUpperCase();
  const lang = num.startsWith('G') ? 'greek' : num.startsWith('H') ? 'hebrew' : null;
  if (!lang) return null;
  try {
    const dict  = await loadStrongsDict(env, lang);
    const entry = dict[num];
    if (!entry) return null;
    return {
      strongsNumber: num,
      lemma:      entry.lemma || '',
      translit:   entry.translit || entry.xlit || '',
      definition: entry.strongs_def || '',
      kjv:        entry.kjv_def || '',
      language:   lang === 'greek' ? 'Greek' : 'Hebrew',
    };
  } catch (err) {
    console.warn(`Strong's lookup failed for ${num}:`, err.message);
    return null;
  }
}

// ── MorphGNT — per-verse Greek lemma → Strong's number mapping ───────────────
// MorphGNT (morphgnt/sblgnt, CC-BY-SA) provides the Greek NT with per-word lemmas.
// We cross-reference lemmas with the cached Strong's dictionary to get G-numbers.
// Book file numbers: Matthew=61 … Revelation=87 (NT only; OT uses morphhb XML).
const MORPHGNT_BASE = 'https://raw.githubusercontent.com/morphgnt/sblgnt/master/';
const MORPHGNT_CACHE_TTL = 90 * 24 * 60 * 60; // 90 days (static data)

// Map of common book name variants → {fileNum, bookNum}
// fileNum: the MorphGNT file prefix (61–87); bookNum: 2-digit book code in reference lines
const MORPHGNT_BOOK_MAP = {
  // Matthew
  'matthew':1,'matt':1,'mt':1,
  // Mark
  'mark':2,'mk':2,'mar':2,
  // Luke
  'luke':3,'lk':3,'luk':3,
  // John
  'john':4,'jn':4,'joh':4,
  // Acts
  'acts':5,'ac':5,'act':5,
  // Romans
  'romans':6,'rom':6,'ro':6,
  // 1 Corinthians
  '1corinthians':7,'1cor':7,'1co':7,'ico':7,
  // 2 Corinthians
  '2corinthians':8,'2cor':8,'2co':8,'iico':8,
  // Galatians
  'galatians':9,'gal':9,'ga':9,
  // Ephesians
  'ephesians':10,'eph':10,'ep':10,
  // Philippians
  'philippians':11,'phil':11,'php':11,'phpl':11,'phi':11,
  // Colossians
  'colossians':12,'col':12,'co':12,
  // 1 Thessalonians
  '1thessalonians':13,'1thess':13,'1th':13,'1thes':13,
  // 2 Thessalonians
  '2thessalonians':14,'2thess':14,'2th':14,'2thes':14,
  // 1 Timothy
  '1timothy':15,'1tim':15,'1ti':15,
  // 2 Timothy
  '2timothy':16,'2tim':16,'2ti':16,
  // Titus
  'titus':17,'tit':17,'ti':17,
  // Philemon
  'philemon':18,'phlm':18,'phm':18,'philem':18,
  // Hebrews
  'hebrews':19,'heb':19,'he':19,
  // James
  'james':20,'jas':20,'jm':20,
  // 1 Peter
  '1peter':21,'1pet':21,'1pe':21,'1pt':21,
  // 2 Peter
  '2peter':22,'2pet':22,'2pe':22,'2pt':22,
  // 1 John
  '1john':23,'1jn':23,'1jo':23,
  // 2 John
  '2john':24,'2jn':24,'2jo':24,
  // 3 John
  '3john':25,'3jn':25,'3jo':25,
  // Jude
  'jude':26,'jud':26,'jd':26,
  // Revelation
  'revelation':27,'rev':27,'re':27,'rv':27,
};

function buildLemmaIndex(dict) {
  // Build reverse map: Greek lemma → Strong's number
  // dict: { "G3563": { lemma: "νοῦς", ... }, ... }
  const idx = {};
  for (const [num, entry] of Object.entries(dict)) {
    if (entry.lemma) idx[entry.lemma] = num;
  }
  return idx;
}

async function fetchVerseStrongs(env, reference) {
  // Returns { lemma: strongsNumber, ... } for all verifiable words in a NT verse.
  // Returns null for OT passages (MorphGNT is NT only) or on any error.
  if (!reference) return null;

  // Parse reference: "Philippians 4:7", "Phil 4:7", "1 Cor 3:16", "Phil 4:6-7", etc.
  // Multi-verse ranges like "4:6-7" → use the FIRST verse (the passage context gives full text)
  const m = reference.trim().match(/^(\d?\s*[a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+(\d+):(\d+)/);
  if (!m) { console.log(`[fetchVerseStrongs] Could not parse reference: "${reference}"`); return null; }

  // Normalize book name: lowercase, strip spaces
  const rawBook = m[1].trim().toLowerCase().replace(/\s+/g, '');
  const chapter = parseInt(m[2], 10);
  const verse   = parseInt(m[3], 10);

  console.log(`[fetchVerseStrongs] ref="${reference}" → book="${rawBook}" ch=${chapter} v=${verse}`);

  const bookInfo = MORPHGNT_BOOK_MAP[rawBook];
  if (!bookInfo) { console.log(`[fetchVerseStrongs] OT or unknown book: "${rawBook}"`); return null; }

  // Build MorphGNT reference code: BBCCVV (2-digit each, zero-padded)
  // MorphGNT book numbers: bookInfo (1–27), offset to file numbers 61–87
  const bookNum = bookInfo; // 1 = Matthew … 27 = Revelation
  const fileNum = bookNum + 60; // 61 = Matthew … 87 = Revelation
  const refCode = String(bookNum).padStart(2, '0') +
                  String(chapter).padStart(2, '0') +
                  String(verse).padStart(2, '0');
  console.log(`[fetchVerseStrongs] bookNum=${bookNum} fileNum=${fileNum} refCode=${refCode}`);

  // Check KV cache for this book's MorphGNT text
  const kvKey = `morphgnt:book:${fileNum}:v1`;
  let bookText = null;
  if (env.ABIDE_KV) {
    bookText = await env.ABIDE_KV.get(kvKey, 'text').catch(() => null);
  }
  if (!bookText) {
    // File names: "61-Mt-morphgnt.txt" etc. — derive from fileNum
    const fileNames = {
      61:'61-Mt-morphgnt.txt', 62:'62-Mk-morphgnt.txt', 63:'63-Lk-morphgnt.txt',
      64:'64-Jn-morphgnt.txt', 65:'65-Ac-morphgnt.txt', 66:'66-Ro-morphgnt.txt',
      67:'67-1Co-morphgnt.txt', 68:'68-2Co-morphgnt.txt', 69:'69-Ga-morphgnt.txt',
      70:'70-Eph-morphgnt.txt', 71:'71-Php-morphgnt.txt', 72:'72-Col-morphgnt.txt',
      73:'73-1Th-morphgnt.txt', 74:'74-2Th-morphgnt.txt', 75:'75-1Ti-morphgnt.txt',
      76:'76-2Ti-morphgnt.txt', 77:'77-Tit-morphgnt.txt', 78:'78-Phm-morphgnt.txt',
      79:'79-Heb-morphgnt.txt', 80:'80-Jas-morphgnt.txt', 81:'81-1Pe-morphgnt.txt',
      82:'82-2Pe-morphgnt.txt', 83:'83-1Jn-morphgnt.txt', 84:'84-2Jn-morphgnt.txt',
      85:'85-3Jn-morphgnt.txt', 86:'86-Jud-morphgnt.txt', 87:'87-Re-morphgnt.txt',
    };
    const fileName = fileNames[fileNum];
    if (!fileName) return null;
    const res = await fetch(`${MORPHGNT_BASE}${fileName}`).catch(() => null);
    if (!res?.ok) return null;
    bookText = await res.text();
    if (env.ABIDE_KV) {
      env.ABIDE_KV.put(kvKey, bookText, { expirationTtl: MORPHGNT_CACHE_TTL }).catch(() => {});
    }
  }

  // Filter lines for this verse (refCode matches start of line)
  const verseLines = bookText
    .split('\n')
    .filter(l => l.startsWith(refCode + ' ') || l.startsWith(refCode + '\t'));

  if (!verseLines.length) {
    console.log(`[fetchVerseStrongs] No lines found for refCode=${refCode}`);
    return null;
  }
  console.log(`[fetchVerseStrongs] Found ${verseLines.length} lines for refCode=${refCode}`);

  // Extract lemmas: last whitespace-separated token, strip trailing punctuation
  const lemmas = [...new Set(
    verseLines.map(l => {
      const parts = l.trim().split(/\s+/);
      const raw = parts[parts.length - 1] || '';
      return raw.replace(/[.,;:·!?⸂⸃"'()[\]{}⌈⌉]/g, '').trim();
    }).filter(l => l.length > 1)
  )];

  console.log(`[fetchVerseStrongs] Lemmas: ${lemmas.join(', ')}`);

  if (!lemmas.length) return null;

  // Build reverse index from Strong's Greek dict and map lemmas → G-numbers
  const greekDict = await loadStrongsDict(env, 'greek').catch(() => null);
  if (!greekDict) { console.log('[fetchVerseStrongs] Greek dict load failed'); return null; }

  const lemmaIndex = buildLemmaIndex(greekDict);
  const result = {};
  for (const lemma of lemmas) {
    const num = lemmaIndex[lemma];
    if (num) result[lemma] = num;
    else console.log(`[fetchVerseStrongs] No Strong's match for lemma: "${lemma}"`);
  }
  console.log(`[fetchVerseStrongs] Resolved ${Object.keys(result).length} of ${lemmas.length} lemmas`);
  return Object.keys(result).length ? result : null;
}

function wordCount(text = '') {
  return String(text)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function normalizePositiveInt(value, fallback, min = 1, max = 4000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function devotionalText(session = {}) {
  if (Array.isArray(session.body)) {
    return session.body
      .filter(b => b?.type === 'paragraph' && b?.content)
      .map(b => b.content.trim())
      .join('\n\n');
  }
  return String(session.devotion || '').trim();
}

function devotionalParagraphs(session = {}) {
  if (Array.isArray(session.body)) {
    return session.body.filter(b => b?.type === 'paragraph' && b?.content).length;
  }
  const txt = String(session.devotion || '').trim();
  if (!txt) return 0;
  return txt.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).length;
}

function validatePlanLength(planData, cfg) {
  const issues = [];

  planData.days.forEach((day, i) => {
    const morningText = devotionalText(day.morning);
    const eveningText = devotionalText(day.evening);
    const morningWords = wordCount(morningText);
    const eveningWords = wordCount(eveningText);
    const morningParas = devotionalParagraphs(day.morning);
    const eveningParas = devotionalParagraphs(day.evening);
    const dayNum = i + 1;

    if (morningWords < cfg.minMorningWords || morningParas < cfg.minMorningParagraphs) {
      issues.push(`Day ${dayNum} morning too short (${morningWords} words, ${morningParas} paragraphs)`);
    }
    if (eveningWords < cfg.minEveningWords || eveningParas < cfg.minEveningParagraphs) {
      issues.push(`Day ${dayNum} evening too short (${eveningWords} words, ${eveningParas} paragraphs)`);
    }
  });

  return issues;
}

async function runGemini(env, { systemPrompt, userPrompt, temperature = 0.65, maxOutputTokens = 8192, jsonMode = false, preferredModel = '' }) {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const discoveredModels = await listGeminiGenerateModels(env);
  const modelCandidates = buildModelCandidates(env, discoveredModels, preferredModel);

  let lastError = null;

  for (const model of modelCandidates) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

    const payload = {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      const message = `Gemini(${model}) error ${res.status}: ${body.slice(0, 300)}`;
      lastError = new Error(message);

      // Try next model for model-related/transient failures.
      if ([400, 404, 429, 500, 503].includes(res.status)) continue;
      throw lastError;
    }

    const data = await res.json();
    const blocked = data?.promptFeedback?.blockReason;
    if (blocked) {
      throw new Error(`Gemini blocked prompt: ${blocked}`);
    }

    const text = (data?.candidates || [])
      .flatMap(c => c?.content?.parts || [])
      .map(p => p?.text || '')
      .join('\n')
      .trim();

    if (!text) {
      lastError = new Error(`Gemini(${model}) returned empty response`);
      continue;
    }

    return { text, model, provider: 'gemini' };
  }

  throw lastError || new Error('Gemini request failed for all candidate models');
}

async function runCloudflareAI(env, { systemPrompt, userPrompt, temperature = 0.2, maxTokens = 900 }) {
  if (!env.AI || typeof env.AI.run !== 'function') {
    throw new Error('Cloudflare AI binding (env.AI) is not configured');
  }

  const candidates = [
    '@cf/meta/llama-3.1-8b-instruct',
    '@cf/meta/llama-3.1-8b-instruct-fast',
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  ];

  let lastErr = null;
  for (const model of candidates) {
    try {
      const result = await env.AI.run(model, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
      });

      const text = String(
        result?.response
        || result?.text
        || result?.result
        || result?.output_text
        || ''
      ).trim();
      if (!text) throw new Error(`Cloudflare AI(${model}) returned empty text`);
      return { text, model, provider: 'cloudflare-ai' };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Cloudflare AI failed for all candidate models');
}

function extractTextFromOpenAIChoice(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map(c => {
        if (typeof c === 'string') return c;
        if (c?.type === 'text') return c.text || '';
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

async function runOpenRouter(env, {
  systemPrompt,
  userPrompt,
  messages: messagesOverride = null, // optional: full conversation history (overrides systemPrompt+userPrompt)
  temperature = 0.65,
  maxOutputTokens = 4096,
  jsonMode = false,
  preferredModel = '',
}) {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const candidates = [
    preferredModel,
    env.OPENROUTER_MODEL,
    ...DEFAULT_OPENROUTER_MODELS,
  ].filter(Boolean);

  const messages = messagesOverride || [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let lastError = null;
  for (const model of [...new Set(candidates)]) {
    const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        ...(env.OPENROUTER_HTTP_REFERER ? { 'HTTP-Referer': env.OPENROUTER_HTTP_REFERER } : {}),
        ...(env.OPENROUTER_APP_TITLE ? { 'X-Title': env.OPENROUTER_APP_TITLE } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxOutputTokens,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      lastError = new Error(`OpenRouter(${model}) error ${res.status}: ${body.slice(0, 320)}`);
      if ([400, 404, 429, 500, 503].includes(res.status)) continue;
      throw lastError;
    }

    const data = await res.json();
    const text = extractTextFromOpenAIChoice(data?.choices?.[0]?.message?.content);
    if (!text) {
      lastError = new Error(`OpenRouter(${model}) returned empty response`);
      continue;
    }
    return { text, model, provider: 'openrouter' };
  }

  throw lastError || new Error('OpenRouter request failed for all candidate models');
}

async function runGroq(env, {
  systemPrompt,
  userPrompt,
  messages: messagesOverride = null, // optional: full conversation history (overrides systemPrompt+userPrompt)
  temperature = 0.65,
  maxOutputTokens = 4096,
  jsonMode = false,
  preferredModel = '',
}) {
  if (!env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const candidates = [
    preferredModel,
    env.GROQ_MODEL,
    ...DEFAULT_GROQ_MODELS,
  ].filter(Boolean);

  const messages = messagesOverride || [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let lastError = null;
  for (const model of [...new Set(candidates)]) {
    const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxOutputTokens,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      lastError = new Error(`Groq(${model}) error ${res.status}: ${body.slice(0, 320)}`);
      if ([400, 404, 429, 500, 503].includes(res.status)) continue;
      throw lastError;
    }

    const data = await res.json();
    const text = extractTextFromOpenAIChoice(data?.choices?.[0]?.message?.content);
    if (!text) {
      lastError = new Error(`Groq(${model}) returned empty response`);
      continue;
    }
    return { text, model, provider: 'groq' };
  }

  throw lastError || new Error('Groq request failed for all candidate models');
}

async function listGeminiGenerateModels(env) {
  const now = Date.now();
  if (_modelListCache && (now - _modelListCachedAt) < MODEL_LIST_CACHE_MS) {
    return _modelListCache;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const res = await fetch(endpoint);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini models.list error ${res.status}: ${body.slice(0, 260)}`);
  }

  const data = await res.json();
  const models = (data.models || [])
    .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map(m => (m.name || '').replace(/^models\//, ''))
    .filter(Boolean);

  if (!models.length) {
    throw new Error('Gemini models.list returned no generateContent-capable models');
  }

  _modelListCache = models;
  _modelListCachedAt = now;
  return models;
}

function buildModelCandidates(env, discoveredModels = [], preferredOverride = '') {
  const preferred = [
    preferredOverride,
    env.GEMINI_PLAN_MODEL,
    env.GEMINI_MODEL,
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    DEFAULT_GEMINI_MODEL,
  ].filter(Boolean).map(m => String(m).replace(/^models\//, ''));

  const seen = new Set();
  const out = [];

  function pushIfAvailable(model) {
    if (!model || seen.has(model)) return;
    if (discoveredModels.includes(model)) {
      seen.add(model);
      out.push(model);
    }
  }

  preferred.forEach(pushIfAvailable);

  // Then fill with other available flash models
  discoveredModels
    .filter(m => m.includes('flash'))
    .forEach(pushIfAvailable);

  // Finally allow any remaining compatible model
  discoveredModels.forEach(pushIfAvailable);
  return out;
}

// ---------------------------------------------------------------------------
// GET /ai/models
// Returns available Gemini models that support generateContent
// ---------------------------------------------------------------------------
export async function handleAIModels(request, url, env, origin, json) {
  if (request.method !== 'GET') return json({ error: 'GET required' }, 405, origin);
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY is not configured' }, 503, origin);

  try {
    const discovered = await listGeminiGenerateModels(env);
    const candidates = buildModelCandidates(env, discovered);
    return json({
      ok: true,
      configuredModel: env.GEMINI_MODEL || null,
      discoveredCount: discovered.length,
      discovered,
      candidates,
      selected: candidates[0] || null,
    }, 200, origin);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500, origin);
  }
}

// ---------------------------------------------------------------------------
// GET /ai/providers
// Returns configured AI providers and plan provider order
// ---------------------------------------------------------------------------
export async function handleAIProviders(request, url, env, origin, json) {
  if (request.method !== 'GET') return json({ error: 'GET required' }, 405, origin);

  const planProviderOrder = buildPlanProviderOrder(env);
  return json({
    ok: true,
    planProviderOrder,
    providers: {
      gemini: {
        configured: !!env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL || null,
        planModel: env.GEMINI_PLAN_MODEL || null,
      },
      openrouter: {
        configured: !!env.OPENROUTER_API_KEY,
        model: env.OPENROUTER_MODEL || null,
        planModel: env.OPENROUTER_PLAN_MODEL || null,
      },
      groq: {
        configured: !!env.GROQ_API_KEY,
        model: env.GROQ_MODEL || null,
        planModel: env.GROQ_PLAN_MODEL || null,
      },
      cloudflareAi: {
        configured: !!(env.AI && typeof env.AI.run === 'function'),
      },
    },
  }, 200, origin);
}

// ---------------------------------------------------------------------------
// GET /ai/routing
// Returns routing health/cooldowns/scores for plan providers
// ---------------------------------------------------------------------------
export async function handleAIRouting(request, url, env, origin, json) {
  if (request.method !== 'GET') return json({ error: 'GET required' }, 405, origin);
  const providerOrder = buildPlanProviderOrder(env);
  const state = await loadRoutingState(env);
  const ranked = rankProvidersWithState(providerOrder, state, env);

  const providers = {};
  providerOrder.forEach((provider) => {
    const entry = state.providers?.[provider] || {};
    providers[provider] = {
      configured: providerConfigured(env, provider),
      preferredModel: providerPreferredModel(env, provider),
      attempts: Number(entry.attempts || 0),
      successes: Number(entry.successes || 0),
      failures: Number(entry.failures || 0),
      lastLatencyMs: Number(entry.lastLatencyMs || 0),
      consecutive429: Number(entry.consecutive429 || 0),
      cooldownUntil: Number(entry.cooldownUntil || 0) || null,
      coolingDown: isCoolingDown(entry),
      score: providerScore(entry),
      lastError: entry.lastError || '',
      lastSuccessAt: Number(entry.lastSuccessAt || 0) || null,
      lastErrorAt: Number(entry.lastErrorAt || 0) || null,
    };
  });

  return json({
    ok: true,
    updatedAt: state.updatedAt,
    providerOrder,
    rankedProviders: ranked,
    bestProvider: ranked[0] || null,
    providers,
  }, 200, origin);
}

// ---------------------------------------------------------------------------
// POST /ai/probe
// Tiny probe prompt per configured provider; updates routing stats
// ---------------------------------------------------------------------------
export async function handleAIProbe(request, url, env, origin, json) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405, origin);

  const providers = buildPlanProviderOrder(env).filter(p => providerConfigured(env, p));
  const state = await loadRoutingState(env);
  const results = [];

  const systemPrompt = 'Respond with valid JSON only.';
  const userPrompt = 'Return {"ok":true}.';

  for (const provider of providers) {
    const startedAt = Date.now();
    try {
      let response = null;
      if (provider === 'gemini') {
        response = await runGemini(env, {
          systemPrompt,
          userPrompt,
          temperature: 0.0,
          maxOutputTokens: 120,
          jsonMode: true,
          preferredModel: providerPreferredModel(env, provider) || '',
        });
      } else if (provider === 'openrouter') {
        response = await runOpenRouter(env, {
          systemPrompt,
          userPrompt,
          temperature: 0.0,
          maxOutputTokens: 120,
          jsonMode: true,
          preferredModel: providerPreferredModel(env, provider) || '',
        });
      } else if (provider === 'groq') {
        response = await runGroq(env, {
          systemPrompt,
          userPrompt,
          temperature: 0.0,
          maxOutputTokens: 120,
          jsonMode: true,
          preferredModel: providerPreferredModel(env, provider) || '',
        });
      }

      const parsed = parseJsonBlock(response?.text || '');
      if (!parsed || parsed.ok !== true) throw new Error('Probe response must include {"ok":true}');

      const latencyMs = Date.now() - startedAt;
      updateRoutingState(state, provider, { ok: true, latencyMs, probe: true });
      results.push({ provider, ok: true, model: response?.model || null, latencyMs });
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const statusCode = parseStatusCodeFromError(err);
      updateRoutingState(state, provider, {
        ok: false,
        latencyMs,
        probe: true,
        statusCode,
        error: err.message,
      });
      results.push({
        provider,
        ok: false,
        statusCode: statusCode || null,
        error: String(err.message || '').slice(0, 200),
        latencyMs,
      });
    }
  }

  await saveRoutingState(env, state);
  return json({ ok: true, results }, 200, origin);
}

// ---------------------------------------------------------------------------
// POST /ai/summarize
// Summarize a long topic/prompt into a 3-5 word series label
// ---------------------------------------------------------------------------
export async function handleAISummarize(request, url, env, origin, json) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405, origin);

  let body = {};
  try { body = await request.json(); } catch {}
  const topic = String(body?.topic || '').trim();
  if (!topic) return json({ error: 'Missing topic' }, 400, origin);

  const words = topic.split(/\s+/).filter(Boolean);
  if (words.length <= 5 && topic.length <= 42) {
    return json({ ok: true, label: topic }, 200, origin);
  }

  const systemPrompt = 'You create short devotional series titles. Respond with valid JSON only.';
  const userPrompt = `Summarize this devotional request into a reverent 3-5 word title.

Rules:
- 3 to 5 words only
- No punctuation other than apostrophes
- Keep it human and pastoral
- Return JSON only as: {"label":"..."}

Request:
${topic}`;

  const providerOrder = buildPlanProviderOrder(env).filter((p) => providerConfigured(env, p));
  const providers = providerOrder.length ? providerOrder : ['gemini', 'openrouter', 'groq'];
  let lastErr = null;

  for (const provider of providers) {
    try {
      let response = null;
      if (provider === 'gemini') {
        response = await runGemini(env, {
          systemPrompt,
          userPrompt,
          temperature: 0.2,
          maxOutputTokens: 90,
          jsonMode: true,
          preferredModel: providerPreferredModel(env, provider) || '',
        });
      } else if (provider === 'openrouter') {
        response = await runOpenRouter(env, {
          systemPrompt,
          userPrompt,
          temperature: 0.2,
          maxOutputTokens: 90,
          jsonMode: true,
          preferredModel: providerPreferredModel(env, provider) || '',
        });
      } else if (provider === 'groq') {
        response = await runGroq(env, {
          systemPrompt,
          userPrompt,
          temperature: 0.2,
          maxOutputTokens: 90,
          jsonMode: true,
          preferredModel: providerPreferredModel(env, provider) || '',
        });
      }
      const parsed = parseJsonBlock(response?.text || '');
      const label = String(parsed?.label || '').replace(/[^\w\s']/g, '').replace(/\s+/g, ' ').trim();
      const trimmed = label.split(/\s+/).slice(0, 5).join(' ').trim();
      if (!trimmed || trimmed.split(/\s+/).length < 3) throw new Error('Invalid summary label');
      return json({
        ok: true,
        label: trimmed,
        provider: response?.provider || provider,
        model: response?.model || '',
      }, 200, origin);
    } catch (err) {
      lastErr = err;
    }
  }

  return json({ error: lastErr?.message || 'Could not summarize topic' }, 500, origin);
}

// ---------------------------------------------------------------------------
// POST /ai/chat-summary
// Summarize an Ask the Bible conversation into a title/subtitle
// ---------------------------------------------------------------------------
export async function handleAIChatSummary(request, url, env, origin, json) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405, origin);

  let body = {};
  try { body = await request.json(); } catch {}
  const messages = Array.isArray(body?.messages)
    ? body.messages
        .map((message) => ({
          role: message?.role === 'user' ? 'user' : 'assistant',
          content: String(message?.content || '').trim(),
        }))
        .filter((message) => message.content)
        .slice(0, 24)
    : [];
  if (!messages.length) return json({ error: 'Missing messages' }, 400, origin);

  const transcript = messages
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n\n');

  const systemPrompt = 'You summarize Christian Bible conversations into concise archive labels. Respond with valid JSON only.';
  const userPrompt = `Create a title and optional subtitle for this saved "Ask the Bible" conversation.

Rules:
- Return JSON only as {"title":"...","subtitle":"..."}
- Title should be 3 to 7 words
- Subtitle should be blank unless it genuinely adds needed context
- Keep wording pastoral, concrete, and natural
- No quotation marks around the values
- Do not mention "chat", "conversation", or "ask the bible"

Transcript:
${transcript}`;

  const providerOrder = buildPlanProviderOrder(env).filter((p) => providerConfigured(env, p));
  const providers = providerOrder.length ? providerOrder : ['gemini', 'openrouter', 'groq'];
  let lastErr = null;

  for (const provider of providers) {
    try {
      let response = null;
      if (provider === 'gemini') {
        response = await runGemini(env, {
          systemPrompt,
          userPrompt,
          temperature: 0.2,
          maxOutputTokens: 120,
          jsonMode: true,
          preferredModel: providerPreferredModel(env, provider) || '',
        });
      } else if (provider === 'openrouter') {
        response = await runOpenRouter(env, {
          systemPrompt,
          userPrompt,
          temperature: 0.2,
          maxOutputTokens: 120,
          jsonMode: true,
          preferredModel: providerPreferredModel(env, provider) || '',
        });
      } else if (provider === 'groq') {
        response = await runGroq(env, {
          systemPrompt,
          userPrompt,
          temperature: 0.2,
          maxOutputTokens: 120,
          jsonMode: true,
          preferredModel: providerPreferredModel(env, provider) || '',
        });
      }
      const parsed = parseJsonBlock(response?.text || '');
      const title = String(parsed?.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const subtitle = String(parsed?.subtitle || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      if (!title || title.split(/\s+/).length < 2) throw new Error('Invalid chat title');
      return json({
        ok: true,
        title,
        subtitle,
        provider: response?.provider || provider,
        model: response?.model || '',
      }, 200, origin);
    } catch (err) {
      lastErr = err;
    }
  }

  return json({ error: lastErr?.message || 'Could not summarize chat' }, 500, origin);
}

// ---------------------------------------------------------------------------
// POST /ai/context  { reference: string }
// Returns short historical/cultural context for a Bible passage, cached 90 days
// ---------------------------------------------------------------------------
export async function handleAIContext(request, url, env, origin, json) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405, origin);

  let body = {};
  try { body = await request.json(); } catch {}
  const reference = String(body?.reference || '').trim();
  if (!reference) return json({ error: 'Missing reference' }, 400, origin);

  // Cache key — stable per reference, 90-day TTL
  const cacheKey = `ai:context:v1:${reference.toLowerCase().replace(/\s+/g, '-')}`;
  const TTL = 90 * 24 * 60 * 60; // 90 days in seconds

  if (env.ABIDE_KV) {
    const cached = await env.ABIDE_KV.get(cacheKey, 'json');
    if (cached) return json({ ...cached, cached: true }, 200, origin);
  }

  const systemPrompt = `You are a Bible scholar. Write a short, pastoral historical and cultural context note for a scripture passage. Be concise, factual, and faith-enriching. Evangelical Protestant perspective. No politics. Return valid JSON only.`;

  const userPrompt = `Passage: ${reference}

Write a short historical context note (3–4 sentences max, ~60–80 words) covering:
1. When and where this was written / who wrote it
2. The key cultural or historical situation the original audience faced
3. One sentence on why this context deepens our understanding today

Return JSON as: {"context":"...","period":"...","author":"..."}
- context: the 3–4 sentence note
- period: e.g. "circa 60 AD", "circa 950 BC"
- author: e.g. "Paul", "David", "Isaiah"`;

  const providerOrder = buildPlanProviderOrder(env).filter(p => providerConfigured(env, p));
  const providers = providerOrder.length ? providerOrder : ['gemini', 'openrouter', 'groq'];
  let lastErr = null;

  for (const provider of providers) {
    try {
      let response;
      if (provider === 'gemini') {
        response = await runGemini(env, { systemPrompt, userPrompt, temperature: 0.4, maxOutputTokens: 300, jsonMode: true });
      } else if (provider === 'openrouter') {
        response = await runOpenRouter(env, { systemPrompt, userPrompt, temperature: 0.4, maxOutputTokens: 300, jsonMode: true });
      } else if (provider === 'groq') {
        response = await runGroq(env, { systemPrompt, userPrompt, temperature: 0.4, maxOutputTokens: 300, jsonMode: true });
      }
      const parsed = parseJsonBlock(response?.text || '');
      if (!parsed?.context) throw new Error('Missing context field in response');
      const result = {
        reference,
        context: String(parsed.context || '').trim(),
        period: String(parsed.period || '').trim(),
        author: String(parsed.author || '').trim(),
        provider: response?.provider || provider,
        model: response?.model || '',
      };
      if (env.ABIDE_KV) {
        await env.ABIDE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: TTL });
      }
      return json(result, 200, origin);
    } catch (err) {
      lastErr = err;
    }
  }

  return json({ error: lastErr?.message || 'Could not generate context' }, 500, origin);
}

// ---------------------------------------------------------------------------
// POST /ai/crossrefs  { reference: string }
// Returns 3-5 thematically related cross-references, cached 90 days
// ---------------------------------------------------------------------------
export async function handleAICrossRefs(request, url, env, origin, json) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405, origin);

  let body = {};
  try { body = await request.json(); } catch {}
  const reference = String(body?.reference || '').trim();
  if (!reference) return json({ error: 'Missing reference' }, 400, origin);

  const cacheKey = `ai:crossrefs:v1:${reference.toLowerCase().replace(/\s+/g, '-')}`;
  const TTL = 90 * 24 * 60 * 60;

  if (env.ABIDE_KV) {
    const cached = await env.ABIDE_KV.get(cacheKey, 'json');
    if (cached) return json({ ...cached, cached: true }, 200, origin);
  }

  const systemPrompt = `You are a Bible scholar. Suggest cross-reference passages that deepen understanding of a given scripture. Return valid JSON only.`;

  const userPrompt = `Passage: ${reference}

Suggest 4–5 related Bible passages (cross-references) that illuminate this passage through shared theme, fulfillment, contrast, or context.

Rules:
- Use standard Bible notation (e.g. "Romans 8:28", "Psalm 23:1")
- Vary the books — don't cluster in the same book
- For each, give a 6–10 word reason why it connects
- Return JSON as: {"refs":[{"ref":"...","why":"..."},...]}`;

  const providerOrder = buildPlanProviderOrder(env).filter(p => providerConfigured(env, p));
  const providers = providerOrder.length ? providerOrder : ['gemini', 'openrouter', 'groq'];
  let lastErr = null;

  for (const provider of providers) {
    try {
      let response;
      if (provider === 'gemini') {
        response = await runGemini(env, { systemPrompt, userPrompt, temperature: 0.3, maxOutputTokens: 400, jsonMode: true });
      } else if (provider === 'openrouter') {
        response = await runOpenRouter(env, { systemPrompt, userPrompt, temperature: 0.3, maxOutputTokens: 400, jsonMode: true });
      } else if (provider === 'groq') {
        response = await runGroq(env, { systemPrompt, userPrompt, temperature: 0.3, maxOutputTokens: 400, jsonMode: true });
      }
      const parsed = parseJsonBlock(response?.text || '');
      const refs = (Array.isArray(parsed?.refs) ? parsed.refs : [])
        .filter(r => r?.ref && r?.why)
        .map(r => ({ ref: String(r.ref).trim(), why: String(r.why).trim() }))
        .slice(0, 5);
      if (!refs.length) throw new Error('No refs returned');
      const result = { reference, refs, provider: response?.provider || provider, model: response?.model || '' };
      if (env.ABIDE_KV) {
        await env.ABIDE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: TTL });
      }
      return json(result, 200, origin);
    } catch (err) {
      lastErr = err;
    }
  }

  return json({ error: lastErr?.message || 'Could not generate cross-references' }, 500, origin);
}

function extractFirstJsonObject(input) {
  const text = String(input || '');
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return '';
}

function parseJsonBlock(raw) {
  const cleaned = String(raw)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const candidates = [
    cleaned,
    extractFirstJsonObject(cleaned),
  ].filter(Boolean);

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    candidates.push(cleaned.slice(start, end + 1));
  }

  let lastErr = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastErr = err;
      const repaired = candidate
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/\u201C|\u201D/g, '"')
        .replace(/\u2018|\u2019/g, "'")
        .replace(/\u0000/g, '');
      try {
        return JSON.parse(repaired);
      } catch (err2) {
        lastErr = err2;
      }
    }
  }

  throw new Error(`Unable to parse model JSON: ${lastErr?.message || 'unknown parse error'}`);
}

function sanitizeWordLookupReply(raw) {
  const input = String(raw || '').trim();
  if (!input) return '';

  const tryParse = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && typeof parsed.reply === 'string') {
        return String(parsed.reply).trim();
      }
    } catch {}
    return '';
  };

  if (input.startsWith('{') && input.endsWith('}')) {
    const parsedWhole = tryParse(input);
    if (parsedWhole) return parsedWhole;
  }

  const fenced = input.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsedFence = tryParse(fenced[1].trim());
    if (parsedFence) return parsedFence;
  }

  const leakPattern = /\s*,?\s*"word"\s*:\s*"[^"]*"\s*,\s*"transliteration"\s*:\s*"[^"]*"\s*,\s*"strongsNumber"\s*:\s*"[^"]*"\s*,\s*"language"\s*:\s*"[^"]*"\s*\}?\s*$/i;
  return input.replace(leakPattern, '').trim();
}

function normalizeVerseList(data) {
  const verses = Array.isArray(data?.verses) ? data.verses : [];
  return verses
    .map(v => ({
      ref: String(v?.ref || '').trim(),
      why: String(v?.why || '').trim(),
    }))
    .filter(v => v.ref && v.why)
    .slice(0, 6);
}

function buildPlanProviderOrder(env) {
  const raw = String(env.PLAN_AI_PROVIDER_ORDER || 'gemini,openrouter,groq').trim();
  const allowed = new Set(['gemini', 'openrouter', 'groq']);
  const parsed = raw
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(Boolean)
    .filter(p => allowed.has(p));

  const unique = [...new Set(parsed)];
  if (!unique.length) return ['gemini', 'openrouter', 'groq'];
  return unique;
}

function defaultRoutingState() {
  return {
    version: 1,
    updatedAt: Date.now(),
    providers: {},
  };
}

function parseStatusCodeFromError(err) {
  const msg = String(err?.message || '');
  const match = msg.match(/\berror\s+(\d{3})\b/i) || msg.match(/\b(\d{3})\b/);
  if (!match) return 0;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : 0;
}

function cooldownMsForConsecutive429(n) {
  const x = Math.max(1, Math.min(6, Number(n) || 1));
  return Math.min(60, 5 * (2 ** (x - 1))) * 60 * 1000;
}

function providerConfigured(env, provider) {
  if (provider === 'gemini') return !!env.GEMINI_API_KEY;
  if (provider === 'openrouter') return !!env.OPENROUTER_API_KEY;
  if (provider === 'groq') return !!env.GROQ_API_KEY;
  return false;
}

function providerPreferredModel(env, provider) {
  if (provider === 'gemini') return env.GEMINI_PLAN_MODEL || env.GEMINI_MODEL || null;
  if (provider === 'openrouter') return env.OPENROUTER_PLAN_MODEL || env.OPENROUTER_MODEL || null;
  if (provider === 'groq') return env.GROQ_PLAN_MODEL || env.GROQ_MODEL || null;
  return null;
}

async function loadRoutingState(env) {
  if (!env.ABIDE_KV) return defaultRoutingState();
  const loaded = await env.ABIDE_KV.get(ROUTING_STATE_KEY, 'json');
  if (!loaded || typeof loaded !== 'object') return defaultRoutingState();
  return {
    version: 1,
    updatedAt: Number(loaded.updatedAt) || Date.now(),
    providers: (loaded.providers && typeof loaded.providers === 'object') ? loaded.providers : {},
  };
}

async function saveRoutingState(env, state) {
  if (!env.ABIDE_KV) return;
  state.updatedAt = Date.now();
  await env.ABIDE_KV.put(ROUTING_STATE_KEY, JSON.stringify(state), { expirationTtl: ROUTING_STATE_TTL });
}

function isCoolingDown(entry = {}) {
  return Number(entry.cooldownUntil || 0) > Date.now();
}

function providerScore(entry = {}) {
  const attempts = Number(entry.attempts || 0);
  const successes = Number(entry.successes || 0);
  const failures = Number(entry.failures || 0);
  const total = Math.max(1, attempts);
  const successRate = successes / total;
  const avgLatencyMs = Number(entry.totalLatencyMs || 0) / Math.max(1, successes + failures);
  const penalty429 = Number(entry.consecutive429 || 0) * 0.25;
  const latencyPenalty = Math.min(1.2, avgLatencyMs / 8000);
  const failurePenalty = Math.min(0.7, failures / total);
  return (successRate * 2.0) - penalty429 - latencyPenalty - failurePenalty;
}

function rankProvidersWithState(order, state, env) {
  const configured = order.filter(p => providerConfigured(env, p));
  const live = configured.filter(p => !isCoolingDown(state.providers?.[p]));
  const cooling = configured.filter(p => isCoolingDown(state.providers?.[p]));
  const sortByScore = (a, b) => providerScore(state.providers?.[b] || {}) - providerScore(state.providers?.[a] || {});
  if (live.length) return live.sort(sortByScore);
  return cooling.sort(sortByScore);
}

function updateRoutingState(state, provider, outcome) {
  if (!state.providers[provider]) {
    state.providers[provider] = {
      attempts: 0,
      successes: 0,
      failures: 0,
      totalLatencyMs: 0,
      lastLatencyMs: 0,
      lastError: '',
      lastErrorAt: 0,
      lastSuccessAt: 0,
      consecutive429: 0,
      cooldownUntil: 0,
      probes: 0,
    };
  }

  const entry = state.providers[provider];
  entry.attempts += 1;
  entry.totalLatencyMs += Math.max(0, Number(outcome.latencyMs || 0));
  entry.lastLatencyMs = Math.max(0, Number(outcome.latencyMs || 0));
  if (outcome.probe) entry.probes += 1;

  if (outcome.ok) {
    entry.successes += 1;
    entry.lastSuccessAt = Date.now();
    entry.lastError = '';
    entry.lastErrorAt = 0;
    entry.consecutive429 = 0;
    entry.cooldownUntil = 0;
    return;
  }

  entry.failures += 1;
  entry.lastError = String(outcome.error || '').slice(0, 240);
  entry.lastErrorAt = Date.now();
  if (Number(outcome.statusCode || 0) === 429) {
    entry.consecutive429 += 1;
    entry.cooldownUntil = Date.now() + cooldownMsForConsecutive429(entry.consecutive429);
  }
}

async function repairJsonWithGemini(env, malformedJson, schemaHint = '') {
  const systemPrompt = 'You repair malformed JSON. Return valid JSON only. No markdown, no explanation.';
  const userPrompt = `Fix this malformed JSON so it is valid and complete.
${schemaHint ? `Schema hint: ${schemaHint}` : ''}

Malformed JSON:
${String(malformedJson).slice(0, 120000)}
`;

  const repaired = await runGemini(env, {
    systemPrompt,
    userPrompt,
    temperature: 0.0,
    maxOutputTokens: 8192,
    jsonMode: true,
  });

  return parseJsonBlock(repaired.text);
}

// ---------------------------------------------------------------------------
// POST /ai/plan  { topic: string, pastors?: string[] }
// Returns a full 7-day devotional plan as JSON
// ---------------------------------------------------------------------------
export async function handleAIPlan(request, url, env, origin, json) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405, origin);

  let topic = 'Grace';
  let pastors = [];
  let retryReason = '';
  let daysCount = 7;
  const cfg = {
    minMorningWords: DEFAULT_MIN_MORNING_WORDS,
    minEveningWords: DEFAULT_MIN_EVENING_WORDS,
    minMorningParagraphs: DEFAULT_MIN_MORNING_PARAGRAPHS,
    minEveningParagraphs: DEFAULT_MIN_EVENING_PARAGRAPHS,
  };

  try {
    const b = await request.json();
    topic = b.topic || 'Grace';
    pastors = Array.isArray(b.pastors) ? b.pastors.filter(Boolean) : [];
    retryReason = String(b.retryReason || '').trim();
    daysCount = normalizePositiveInt(b.daysCount, 7, 1, 7);

    cfg.minMorningWords = normalizePositiveInt(b.minMorningWords, DEFAULT_MIN_MORNING_WORDS, 80, 1200);
    cfg.minEveningWords = normalizePositiveInt(b.minEveningWords, DEFAULT_MIN_EVENING_WORDS, 60, 900);
    cfg.minMorningParagraphs = normalizePositiveInt(b.minMorningParagraphs, DEFAULT_MIN_MORNING_PARAGRAPHS, 2, 8);
    cfg.minEveningParagraphs = normalizePositiveInt(b.minEveningParagraphs, DEFAULT_MIN_EVENING_PARAGRAPHS, 2, 7);
  } catch {}

  const pastorKey = pastors.map(p => p.toLowerCase().trim()).sort().join('|');
  const lengthKey = `${cfg.minMorningWords}-${cfg.minEveningWords}-${cfg.minMorningParagraphs}-${cfg.minEveningParagraphs}-${daysCount}`;
  const cacheKey = `plan:ai:v6:${topic.toLowerCase().trim()}:${pastorKey}:${lengthKey}`;
  if (env.ABIDE_KV) {
    const cached = await env.ABIDE_KV.get(cacheKey, 'json');
    if (cached) return json(cached, 200, origin);
  }

  const systemPrompt = `You are a thoughtful non-denominational Protestant pastor writing personal daily Bible devotions.
You draw inspiration from trusted Protestant pastors provided by the user.
You write in a warm, direct, gospel-centered style.
CRITICAL REQUIREMENT: Every single morning AND evening block MUST have a non-empty scripture_ref field with a real Bible reference (e.g. "Romans 8:28", "Psalm 23:1").
You MUST respond with valid JSON only — no markdown, no code blocks, no extra text before or after the JSON.`;

  const pastorLine = pastors.length
    ? `\nTrusted pastors to draw from: ${pastors.join(', ')}.`
    : '\nTrusted pastors to draw from: Tim Keller, John Mark Comer, Jon Pokluda, Louie Giglio, John Piper, Ben Stuart.';

  const buildDayPrompt = (dayIndex, priorDays = [], retryNote = '') => {
    let priorContext = '';
    if (priorDays.length > 0) {
      const usedRefs = priorDays.map((d, i) =>
        `- Day ${i + 1} Morning: ${d.morning?.scripture_ref || '(none)'}, Evening: ${d.evening?.scripture_ref || '(none)'}`
      );
      const usedTitles = priorDays.map((d, i) =>
        `- Day ${i + 1}: "${d.title || `Day ${i + 1}`}"`
      );
      priorContext = `

CRITICAL — Previously used scripture references (you MUST NOT reuse any of these):
${usedRefs.join('\n')}

Previously used day titles/themes (vary your approach, explore a different facet):
${usedTitles.join('\n')}

Requirements for variety:
- Pick a scripture from a DIFFERENT book of the Bible than all previous days if possible.
- Do NOT repeat the same theological angle or application as a previous day.
- Vary your opening sentence style — do NOT start with "As we..." or any phrase similar to a previous day's opening.
- Each day should feel distinct in tone, structure, and scriptural focus.`;
    }

    return `Write day ${dayIndex + 1} of a ${daysCount}-day personal Bible devotional plan on the theme: "${topic}".${pastorLine}
${priorContext}
Return ONLY this exact JSON structure (no markdown fences, no explanation, just raw JSON):
{
  "dayIndex": ${dayIndex},
  "title": "Day title",
  "inspired_by": ["Pastor Name 1", "Pastor Name 2"],
  "morning": {
    "scripture_ref": "Book Chapter:Verse",
    "body": [
      { "type": "paragraph", "content": "Paragraph 1..." },
      { "type": "paragraph", "content": "Paragraph 2..." },
      { "type": "paragraph", "content": "Paragraph 3..." }
    ],
    "reflection_prompts": ["Question 1?", "Question 2?", "Question 3?"],
    "prayer": "A 2-3 sentence personal prayer."
  },
  "evening": {
    "scripture_ref": "Book Chapter:Verse",
    "body": [
      { "type": "paragraph", "content": "Paragraph 1..." },
      { "type": "paragraph", "content": "Paragraph 2..." }
    ],
    "reflection_prompts": ["Question 1?", "Question 2?"],
    "prayer": "A 1-2 sentence evening prayer."
  },
  "faith_stretch": {
    "title": "Practical action title",
    "description": "A concrete 1-2 sentence action to live out this theme today."
  }
}

Devotional body content must be substantial. Scripture references do NOT count toward body length.
Morning body: at least ${cfg.minMorningParagraphs} paragraphs and at least ${cfg.minMorningWords} words.
Evening body: at least ${cfg.minEveningParagraphs} paragraphs and at least ${cfg.minEveningWords} words.
Use a unique scripture reference for this day that differs from other days in the same week.
Ensure valid JSON only.
Do not include trailing commas. Escape quotes inside strings. Do not include markdown.${retryNote ? `\n\nRETRY REQUIREMENT: ${retryNote}` : ''}`;
  };

  function normalizeSession(session, fallbackRef, fallbackParagraphs) {
    const normalized = (session && typeof session === 'object') ? { ...session } : {};
    normalized.scripture_ref = String(normalized.scripture_ref || '').trim() || fallbackRef;

    let body = [];
    if (Array.isArray(normalized.body)) {
      body = normalized.body
        .filter(b => b && typeof b === 'object')
        .map(b => ({
          type: 'paragraph',
          content: String(b.content || '').trim(),
        }))
        .filter(b => b.content);
    } else if (typeof normalized.devotion === 'string') {
      body = normalized.devotion
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(Boolean)
        .map(content => ({ type: 'paragraph', content }));
    }

    while (body.length < fallbackParagraphs) {
      body.push({ type: 'paragraph', content: 'Pause, pray, and reflect on this scripture in your present circumstances.' });
    }
    normalized.body = body;

    if (!Array.isArray(normalized.reflection_prompts)) normalized.reflection_prompts = [];
    normalized.reflection_prompts = normalized.reflection_prompts
      .map(p => String(p || '').trim())
      .filter(Boolean);
    normalized.prayer = String(normalized.prayer || '').trim();
    return normalized;
  }

  function normalizeDay(dayData, dayIndex, fallbackRefs) {
    const fallbackMorningRef = fallbackRefs[dayIndex % fallbackRefs.length];
    const fallbackEveningRef = fallbackRefs[(dayIndex + 4) % fallbackRefs.length];

    const safe = (dayData && typeof dayData === 'object') ? { ...dayData } : {};
    safe.dayIndex = dayIndex;
    safe.title = String(safe.title || `Day ${dayIndex + 1}`).trim();
    safe.inspired_by = Array.isArray(safe.inspired_by) && safe.inspired_by.length
      ? safe.inspired_by.map(p => String(p || '').trim()).filter(Boolean).slice(0, 4)
      : (pastors.length ? pastors.slice(0, 3) : ['Tim Keller', 'John Mark Comer']);
    safe.morning = normalizeSession(safe.morning, fallbackMorningRef, cfg.minMorningParagraphs);
    safe.evening = normalizeSession(safe.evening, fallbackEveningRef, cfg.minEveningParagraphs);

    if (!safe.faith_stretch || typeof safe.faith_stretch !== 'object') safe.faith_stretch = {};
    safe.faith_stretch.title = String(safe.faith_stretch.title || 'Faith Stretch').trim();
    safe.faith_stretch.description = String(safe.faith_stretch.description || 'Take one concrete, faithful step in response to today\'s scripture.').trim();
    return safe;
  }

  try {
    const FALLBACK_REFS = [
      'Romans 8:28', 'Psalm 23:1', 'John 3:16', 'Philippians 4:6-7',
      'Isaiah 41:10', 'Jeremiah 29:11', 'Matthew 11:28', 'Psalm 46:1',
      'Proverbs 3:5-6', 'Isaiah 40:31', '2 Corinthians 12:9', 'Hebrews 11:1',
    ];
    const days = [];
    const modelUsage = [];
    const providerUsage = [];
    const providerOrder = buildPlanProviderOrder(env);
    const routingState = await loadRoutingState(env);

    for (let dayIndex = 0; dayIndex < daysCount; dayIndex++) {
      const dayCacheKey = `plan-day:ai:v3:${topic.toLowerCase().trim()}:${pastorKey}:${cfg.minMorningWords}-${cfg.minEveningWords}-${cfg.minMorningParagraphs}-${cfg.minEveningParagraphs}:d${dayIndex + 1}`;
      if (env.ABIDE_KV) {
        const cachedDay = await env.ABIDE_KV.get(dayCacheKey, 'json');
        if (cachedDay && typeof cachedDay === 'object') {
          days.push(normalizeDay(cachedDay.day || cachedDay, dayIndex, FALLBACK_REFS));
          if (cachedDay.meta?.model) modelUsage.push(`${cachedDay.meta.provider || 'unknown'}:${cachedDay.meta.model}`);
          if (cachedDay.meta?.provider) providerUsage.push(cachedDay.meta.provider);
          continue;
        }
      }

      let dayData = null;
      let lastDayErr = null;
      let dayRetryReason = retryReason;
      let dayModel = '';
      const dayTemp = 0.6 + (dayIndex * 0.025); // Day 0: 0.6 → Day 6: 0.75

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          let lastProviderErr = null;
          let response = null;
          const rankedProviders = rankProvidersWithState(providerOrder, routingState, env);
          for (const provider of rankedProviders) {
            const startedAt = Date.now();
            try {
              if (provider === 'gemini') {
                response = await runGemini(env, {
                  systemPrompt,
                  userPrompt: buildDayPrompt(dayIndex, days, dayRetryReason),
                  temperature: dayTemp,
                  maxOutputTokens: 4096,
                  jsonMode: true,
                  preferredModel: env.GEMINI_PLAN_MODEL || env.GEMINI_MODEL || '',
                });
              } else if (provider === 'openrouter') {
                response = await runOpenRouter(env, {
                  systemPrompt,
                  userPrompt: buildDayPrompt(dayIndex, days, dayRetryReason),
                  temperature: dayTemp,
                  maxOutputTokens: 4096,
                  jsonMode: true,
                  preferredModel: env.OPENROUTER_PLAN_MODEL || env.OPENROUTER_MODEL || '',
                });
              } else if (provider === 'groq') {
                response = await runGroq(env, {
                  systemPrompt,
                  userPrompt: buildDayPrompt(dayIndex, days, dayRetryReason),
                  temperature: dayTemp,
                  maxOutputTokens: 4096,
                  jsonMode: true,
                  preferredModel: env.GROQ_PLAN_MODEL || env.GROQ_MODEL || '',
                });
              }
              if (response?.text) {
                updateRoutingState(routingState, provider, {
                  ok: true,
                  latencyMs: Date.now() - startedAt,
                });
                break;
              }
            } catch (providerErr) {
              updateRoutingState(routingState, provider, {
                ok: false,
                latencyMs: Date.now() - startedAt,
                statusCode: parseStatusCodeFromError(providerErr),
                error: providerErr.message,
              });
              lastProviderErr = providerErr;
            }
          }

          if (!response?.text) {
            throw lastProviderErr || new Error('No configured AI providers are available for plan generation');
          }

          dayModel = `${response.provider}:${response.model}` || dayModel;
          dayData = parseJsonBlock(response.text);

          dayData = normalizeDay(dayData, dayIndex, FALLBACK_REFS);
          const dayLengthIssues = validatePlanLength({ days: [dayData] }, cfg);
          if (dayLengthIssues.length) {
            throw new Error(dayLengthIssues.join('; '));
          }
          days.push(dayData);
          if (dayModel) modelUsage.push(dayModel);
          providerUsage.push(response.provider);
          if (env.ABIDE_KV) {
            await env.ABIDE_KV.put(dayCacheKey, JSON.stringify({
              day: dayData,
              meta: { provider: response.provider, model: response.model, cachedAt: Date.now() },
            }), { expirationTtl: PLAN_CACHE_TTL });
          }
          break;
        } catch (errDay) {
          lastDayErr = errDay;
          dayRetryReason = `Previous attempt failed with: ${errDay.message}`;
        }
      }

      if (!dayData) {
        throw lastDayErr || new Error(`Day ${dayIndex + 1}: generation failed`);
      }
    }

    await saveRoutingState(env, routingState);

    days.sort((a, b) => (a.dayIndex || 0) - (b.dayIndex || 0));

    const planData = { theme: topic, days };
    const lengthIssues = validatePlanLength(planData, cfg);
    if (lengthIssues.length) {
      throw new Error(`Plan too short: ${lengthIssues.slice(0, 4).join('; ')}`);
    }

    // Log duplicate scripture refs for monitoring — do NOT swap refs, as that
    // causes a mismatch between the splash verse and the body content.
    // Prior-day context in the prompt should prevent most duplicates.
    const seenMorning = new Set();
    const seenEvening = new Set();
    days.forEach((day, idx) => {
      const m = (day.morning?.scripture_ref || '').toLowerCase();
      const e = (day.evening?.scripture_ref || '').toLowerCase();
      if (seenMorning.has(m)) {
        console.warn(`Plan dedup: duplicate morning ref "${day.morning.scripture_ref}" on day ${idx + 1}`);
      } else if (m) {
        seenMorning.add(m);
      }
      if (seenEvening.has(e)) {
        console.warn(`Plan dedup: duplicate evening ref "${day.evening.scripture_ref}" on day ${idx + 1}`);
      } else if (e) {
        seenEvening.add(e);
      }
    });

    const uniqueModels = [...new Set(modelUsage.filter(Boolean))];
    const uniqueProviders = [...new Set(providerUsage.filter(Boolean))];
    const result = {
      theme: topic,
      days: planData.days.slice(0, daysCount),
      ai_meta: {
        provider: uniqueProviders.length === 1 ? uniqueProviders[0] : 'mixed',
        providers: uniqueProviders,
        models: uniqueModels,
        chunked: true,
        daysCount,
      },
    };

    if (env.ABIDE_KV) {
      await env.ABIDE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: PLAN_CACHE_TTL });
    }

    return json(result, 200, origin);
  } catch (err) {
    console.error('AI plan error:', err.message);
    return json({ error: `AI plan failed: ${err.message}` }, 502, origin);
  }
}

// ---------------------------------------------------------------------------
// POST /ai/phrase  { phrase: string }
// Returns 6 best Bible verse refs + one-line explanations
// ---------------------------------------------------------------------------
export async function handleAIPhrase(request, url, env, origin, json) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405, origin);

  let phrase = '';
  try { const b = await request.json(); phrase = b.phrase || ''; } catch {}
  if (!phrase.trim()) return json({ verses: [], fallback: true }, 200, origin);

  const cacheKey = `phrase:cfai:v2:${phrase.toLowerCase().trim()}`;
  if (env.ABIDE_KV) {
    const cached = await env.ABIDE_KV.get(cacheKey, 'json');
    if (cached) return json(cached, 200, origin);
  }

  const systemPrompt = 'You are a Bible scholar. Respond with valid JSON only.';
  const userPrompt = `A person searching their Bible app typed: "${phrase}"

List the 6 most relevant Bible verses for this search. Consider emotional context, theological meaning, and practical application.

Respond ONLY with this JSON (no markdown, no extra text, just raw JSON):
{
  "verses": [
    { "ref": "Book Chapter:Verse", "why": "One sentence explaining relevance." },
    { "ref": "Book Chapter:Verse", "why": "One sentence explaining relevance." },
    { "ref": "Book Chapter:Verse", "why": "One sentence explaining relevance." },
    { "ref": "Book Chapter:Verse", "why": "One sentence explaining relevance." },
    { "ref": "Book Chapter:Verse", "why": "One sentence explaining relevance." },
    { "ref": "Book Chapter:Verse", "why": "One sentence explaining relevance." }
  ]
}

Use standard Bible references like "John 3:16", "Psalm 23:1", "Romans 8:28". Rank by relevance.`;

  // Prefer Cloudflare AI for lightweight/low-cost phrase search.
  try {
    const cf = await runCloudflareAI(env, {
      systemPrompt,
      userPrompt,
      temperature: 0.15,
      maxTokens: 900,
    });
    const parsed = parseJsonBlock(cf.text);
    const verses = normalizeVerseList(parsed);
    if (!verses.length) throw new Error('Empty verses array from Cloudflare AI');
    const result = { verses, fallback: false, provider: cf.provider, model: cf.model };

    if (env.ABIDE_KV) {
      await env.ABIDE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: PHRASE_CACHE_TTL });
    }

    return json(result, 200, origin);
  } catch (cfErr) {
    console.warn('Cloudflare AI phrase error, falling back to Gemini:', cfErr.message);
  }

  // Fallback to Gemini if Cloudflare AI is unavailable/unhealthy.
  try {
    const gemini = await runGemini(env, {
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      maxOutputTokens: 1400,
      jsonMode: true,
    });
    const parsed = parseJsonBlock(gemini.text);
    const verses = normalizeVerseList(parsed);
    if (!verses.length) throw new Error('Empty verses array from Gemini');
    const result = { verses, fallback: false, provider: gemini.provider, model: gemini.model };

    if (env.ABIDE_KV) {
      await env.ABIDE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: PHRASE_CACHE_TTL });
    }
    return json(result, 200, origin);
  } catch (err) {
    console.error('Phrase search failed on all providers:', err.message);
    return json({ verses: [], fallback: true }, 200, origin);
  }
}

/* ── Word / Hebrew-Greek Deep Dive ── */
export async function handleWordLookup(request, url, env, origin, json) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405, origin);

  let body = {};
  try { body = await request.json(); } catch {}

  const { word, context = {}, history = [] } = body;

  // Mode A = passage analysis (no word supplied); Mode B = single word follow-up
  const isPassageMode = !word?.trim();
  const isFirstTurn   = history.length === 0;

  // ── Cache key ──────────────────────────────────────────────────────────────
  const refSlug = (context.reference || '').toLowerCase().replace(/\s+/g, '');
  const cacheKey = isPassageMode
    ? `word:passage:v3:${refSlug}`
    : `word:lookup:v4:${word.toLowerCase().trim()}:${refSlug}`;

  if (isFirstTurn && env.ABIDE_KV) {
    const cached = await env.ABIDE_KV.get(cacheKey, 'json');
    if (cached) return json(cached, 200, origin);
  }

  // ── Mode A: pre-fetch verified verse words from MorphGNT (NT only) ──────────
  // This gives us the actual Greek lemmas present in the verse plus their
  // confirmed Strong's numbers — injected into the prompt so the AI picks from
  // real data instead of guessing from memory.
  const verseStrongs = context.reference
    ? await fetchVerseStrongs(env, context.reference).catch(() => null)
    : null;

  const verseAnchor = verseStrongs && Object.keys(verseStrongs).length
    ? `\n\nVERIFIED ORIGINAL LANGUAGE WORDS IN THIS VERSE (from morphological tagging of the Greek NT — you MUST use ONLY these Strong's numbers for words you identify; do not invent other numbers):\n` +
      Object.entries(verseStrongs)
        .map(([lemma, num]) => `  ${num}: ${lemma}`)
        .join('\n') + '\n'
    : '';

  // ── Mode B: pre-fetch verified Strong's entry to anchor the prompt ──────────
  // Fetch for ALL Mode B turns (not just first turn) so the system prompt always
  // contains the verified lexical data regardless of conversation depth.
  const verifiedEntry = (!isPassageMode && context.strongsNumber)
    ? await lookupStrongs(env, context.strongsNumber).catch(() => null)
    : null;

  const strongsAnchor = verifiedEntry
    ? `\n\nVERIFIED LEXICAL DATA (Strong's Exhaustive Concordance — treat as absolute ground truth, do not contradict or alter):\n` +
      `Strong's number: ${verifiedEntry.strongsNumber}\n` +
      `Original word:   ${verifiedEntry.lemma}\n` +
      `Transliteration: ${verifiedEntry.translit}\n` +
      `Core definition: ${verifiedEntry.definition}\n`
    : '';
  const verseWordAnchor = (!verifiedEntry && !isPassageMode && verseStrongs && Object.keys(verseStrongs).length)
    ? `\n\nVERIFIED ORIGINAL LANGUAGE WORDS IN THIS VERSE (Greek NT tagging):\n` +
      Object.entries(verseStrongs).map(([lemma, num]) => `  ${num}: ${lemma}`).join('\n') +
      `\nYou must choose the underlying word from this list and must not invent Strong's numbers outside this set.\n`
    : '';

  // ── Build prompts ──────────────────────────────────────────────────────────
  const systemPrompt = isPassageMode
    ? `You are a Biblical Hebrew and Greek scholar. Given a Bible passage, identify the 3–5 most \
theologically significant words where knowing the original language deepens understanding.\
${verseAnchor}\
CRITICAL RULES: (1) The "english" field MUST be the exact word as it appears in the English Bible text — NOT "key", "concept", or "theme". \
(2) If a VERIFIED WORDS list is provided above, you MUST use ONLY those Strong's numbers — do not invent any others. \
(3) For each word provide original Hebrew/Greek script, transliteration, its Strong's number, and a rich explanation (about 90-150 words) that includes lexical meaning, passage context, and theological implications. \
Respond ONLY with valid JSON matching exactly this schema: \
{ "mode": "passage", "words": [ { "english": "<exact word from the verse>", "original": "<Hebrew or Greek script>", \
"transliteration": "...", "strongsNumber": "<G#### or H####>", "language": "Hebrew|Greek", \
"summary": "..." } ] }`
    : `You are a Biblical Hebrew and Greek lexicon expert and theologian writing for a thoughtful, \
curious Christian reader who wants genuine depth — not a dictionary entry.\n\n\
When given an English word from a Bible passage:\n\
1. Identify the underlying Hebrew (OT) or Greek (NT) word, its transliteration, Strong's number, and literal meaning\n\
2. Explain its range of meaning and how it differs from the simple English translation\n\
3. Explain its theological significance in this specific passage\n\
4. Where illuminating, briefly note how this word is used elsewhere in Scripture\n\n\
Write exactly 2 rich, substantive paragraphs in clear engaging prose. Use **bold** for key terms. \
Be thorough but not exhaustive — quality over length.\n\n\
Respond ONLY with valid JSON: \
{ "mode": "word", "reply": "<2 paragraph markdown>", "word": "<original script>", \
"transliteration": "...", "strongsNumber": "<H#### or G####>", "language": "Hebrew|Greek|Unknown" }\n\
The reply field is plain Markdown prose — no code blocks, no JSON inside it.${strongsAnchor}${verseWordAnchor}`;

  // ── Build the message list for this turn ──────────────────────────────────
  // Mode A (passage): always single-turn JSON
  // Mode B first turn: JSON response with word/transliteration/strongsNumber fields
  // Mode B follow-up: plain markdown reply; pass full history as conversation context
  const firstUserMsg = isPassageMode
    ? `Passage — ${context.reference || ''}:\n"${context.verseText || ''}"\n\nIdentify the 3–5 key Hebrew or Greek words that would most deepen a reader's understanding of this passage.`
    : `In ${context.reference || 'this passage'}: "${context.verseText || ''}" — explain the word "${word}". \
${verifiedEntry ? `The verified Strong's entry is ${verifiedEntry.strongsNumber} (${verifiedEntry.lemma}, "${verifiedEntry.translit}"). ` : ''}\
Write 2 rich paragraphs explaining its theological significance in this passage, its range of meaning, and how it is used elsewhere in Scripture.`;

  // For follow-up turns, build a full chat history: [system, user, assistant, user, ...]
  // history = [{role:'user',content:...},{role:'assistant',content:...}, ...]
  const conversationMessages = (!isPassageMode && !isFirstTurn)
    ? [
        { role: 'system', content: systemPrompt },
        ...history.map(h => ({ role: h.role, content: h.content })),
      ]
    : null; // null = use default systemPrompt+firstUserMsg construction

  // ── Provider chain: Groq (70B) → OpenRouter (24B) → Gemini ───────────────
  const useJsonMode = isPassageMode || isFirstTurn; // follow-ups respond with plain markdown
  const providers = [
    {
      name: 'groq',
      run: () => runGroq(env, {
        systemPrompt,
        userPrompt: firstUserMsg,
        messages: conversationMessages || undefined,
        temperature: 0.25,
        maxOutputTokens: 2000,
        jsonMode: useJsonMode,
        preferredModel: 'llama-3.3-70b-versatile', // force 70B — much richer output
      }),
    },
    {
      name: 'openrouter',
      run: () => runOpenRouter(env, {
        systemPrompt,
        userPrompt: firstUserMsg,
        messages: conversationMessages || undefined,
        temperature: 0.25,
        maxOutputTokens: 2000,
        jsonMode: useJsonMode,
        preferredModel: 'mistralai/mistral-small-3.1-24b-instruct:free', // 24B free model
      }),
    },
    {
      name: 'gemini',
      run: async () => {
        if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
        const discoveredModels = await listGeminiGenerateModels(env);
        const modelCandidates = buildModelCandidates(env, discoveredModels, '');
        for (const model of modelCandidates) {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
          // For follow-up turns, build multi-turn Gemini contents array
          const contents = conversationMessages
            ? conversationMessages
                .filter(m => m.role !== 'system')
                .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
            : [{ role: 'user', parts: [{ text: firstUserMsg }] }];
          const payload = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              temperature: 0.25,
              maxOutputTokens: 2000,
              ...(useJsonMode ? { responseMimeType: 'application/json' } : {}),
            },
          };
          const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          if (!res.ok) { const t = await res.text(); console.warn(`Gemini(${model}) word lookup ${res.status}: ${t.slice(0, 200)}`); continue; }
          const data = await res.json();
          const text = (data?.candidates || []).flatMap(c => c?.content?.parts || []).map(p => p?.text || '').join('\n').trim();
          if (text) return { text, model, provider: 'gemini' };
        }
        throw new Error('All Gemini models returned empty');
      },
    },
  ];

  let result = null;
  let lastErr = null;

  for (const provider of providers) {
    try {
      const response = await provider.run();

      if (isPassageMode) {
        const parsed = parseJsonBlock(response.text);
        result = {
          mode: 'passage',
          words: Array.isArray(parsed.words) ? parsed.words.slice(0, 5) : [],
          provider: response.provider || provider.name,
        };
        if (!result.words.length) throw new Error('Empty words array from ' + provider.name);
      } else if (isFirstTurn) {
        // First turn: expect JSON with word/transliteration/strongsNumber/reply
        const parsed = parseJsonBlock(response.text);
        // Use parsed.word only if it looks like non-Latin script (Greek/Hebrew).
        // Models often echo the English word back — we prefer the original script.
        const hasOriginalScript = /[\u0370-\u03FF\u05D0-\u05EA\u0590-\u05CF\u1F00-\u1FFF]/.test(parsed.word || '');
        result = {
          mode: 'word',
          reply: sanitizeWordLookupReply(parsed.reply || response.text),
          word: hasOriginalScript ? parsed.word : (verifiedEntry?.lemma || parsed.word || word),
          transliteration: parsed.transliteration || verifiedEntry?.translit || '',
          strongsNumber: parsed.strongsNumber || '',
          language: parsed.language || verifiedEntry?.language || 'Unknown',
          lexicalSource: 'model-inferred',
          provider: response.provider || provider.name,
        };
        if (!verifiedEntry && verseStrongs && Object.keys(verseStrongs).length) {
          const allowed = new Set(Object.values(verseStrongs).map((v) => String(v || '').toUpperCase()).filter(Boolean));
          const claimed = String(result.strongsNumber || '').toUpperCase();
          if (claimed && !allowed.has(claimed)) {
            result.strongsNumber = '';
            result.language = 'Unknown';
          } else if (claimed && allowed.has(claimed)) {
            result.lexicalSource = 'verse-verified';
          }
        }
      } else {
        // Follow-up turn: plain markdown reply, preserve lexical data from context
        result = {
          mode: 'word',
          reply: sanitizeWordLookupReply(response.text),
          // Carry forward the verified lexical data from the original context
          word: verifiedEntry ? verifiedEntry.lemma : (context.originalWord || word),
          transliteration: verifiedEntry ? verifiedEntry.translit : (context.transliteration || ''),
          strongsNumber: context.strongsNumber || '',
          language: verifiedEntry ? verifiedEntry.language : (context.language || 'Unknown'),
          lexicalSource: context.lexicalSource || (verifiedEntry ? 'strongs-verified' : 'model-inferred'),
          provider: response.provider || provider.name,
        };
        if (!result.reply?.trim()) throw new Error('Empty follow-up reply from ' + provider.name);
      }
      break;
    } catch (err) {
      console.warn(`Word lookup ${provider.name} failed:`, err.message);
      lastErr = err;
    }
  }

  if (!result) {
    return json({
      error: lastErr?.message || 'All providers failed',
      mode: isPassageMode ? 'passage' : 'word',
      words: [],
      reply: 'Could not look up this passage right now. Please try again.',
    }, 500, origin);
  }

  // ── Mode A: verify AI-proposed Strong's numbers against the real dictionary ─
  // Only keep chips whose proposed Strong's number resolves to a real entry.
  // Chips with hallucinated/invented numbers are DROPPED entirely — a chip with
  // a fabricated Greek word is worse than no chip.
  if (isPassageMode && result.words.length) {
    result.words = (await Promise.all(result.words.map(async (w) => {
      if (!w.strongsNumber) return null; // no number → unverifiable → drop
      const entry = await lookupStrongs(env, w.strongsNumber).catch(() => null);
      if (!entry) return null; // not in Strong's dictionary → hallucinated → drop
      return {
        ...w,
        original:        entry.lemma    || w.original,
        transliteration: entry.translit || w.transliteration,
        language:        entry.language || w.language,
      };
    }))).filter(Boolean);
  }

  // ── Mode B: override lexical fields with verified Strong's data ────────────
  // The AI writes the theological commentary; the dictionary owns the lemma.
  if (!isPassageMode && verifiedEntry) {
    result.word            = verifiedEntry.lemma;
    result.transliteration = verifiedEntry.translit;
    result.strongsNumber   = verifiedEntry.strongsNumber;
    result.language        = verifiedEntry.language;
    result.lexicalSource   = 'strongs-verified';
  }

  // Cache: passage 24h, first-turn word lookup 30 days
  if (isFirstTurn && env.ABIDE_KV) {
    const ttl = isPassageMode ? 24 * 60 * 60 : 30 * 24 * 60 * 60;
    await env.ABIDE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: ttl });
  }

  return json(result, 200, origin);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ask-Anything Bible Chat
// POST /ai/ask  { question, history: [{role,content}] }
// Returns: { reply: "<markdown>" }
// ─────────────────────────────────────────────────────────────────────────────
export async function handleAIAsk(request, url, env, origin, json) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405, origin);

  let body = {};
  try { body = await request.json(); } catch {}

  const question = (body.question || '').trim();
  if (!question) return json({ error: 'question is required' }, 400, origin);

  const history = Array.isArray(body.history) ? body.history : [];

  const systemPrompt = `You are a knowledgeable, warm, evangelical Protestant Bible teacher. \
A Christian is asking you a sincere question about Scripture or theology. \

Rules:
1. Ground every answer in Scripture — cite at least 2 specific Bible verses (book, chapter:verse).
2. Write in clear, accessible prose — not bullet points unless listing multiple passages.
3. Stay within historic evangelical Protestant orthodoxy. Do not speculate beyond Scripture.
4. Keep answers focused and substantive — around 150–250 words.
5. Do not engage with political topics, denominational disputes, or extra-biblical claims.
6. If the question is outside the Bible's scope, gently redirect to what Scripture does say.
7. Format citations as (John 3:16) inline. Use **bold** for key terms sparingly.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
    { role: 'user', content: question },
  ];

  const providerOrder = [
    {
      name: 'groq',
      run: () => runGroq(env, {
        systemPrompt,
        userPrompt: question,
        messages,
        temperature: 0.4,
        maxOutputTokens: 1200,
        jsonMode: false,
        preferredModel: 'llama-3.3-70b-versatile',
      }),
    },
    {
      name: 'openrouter',
      run: () => runOpenRouter(env, {
        systemPrompt,
        userPrompt: question,
        messages,
        temperature: 0.4,
        maxOutputTokens: 1200,
        jsonMode: false,
      }),
    },
    {
      name: 'gemini',
      run: () => runGemini(env, {
        systemPrompt,
        userPrompt: question,
        temperature: 0.4,
        maxOutputTokens: 1200,
        jsonMode: false,
      }),
    },
  ];

  let lastErr;
  for (const provider of providerOrder) {
    try {
      const { text, model, provider: pName } = await provider.run();
      return json({ reply: text.trim(), provider: pName, model }, 200, origin);
    } catch (err) {
      console.error(`[ask] ${provider.name} failed:`, err.message);
      lastErr = err;
    }
  }

  return json({ error: `All AI providers failed: ${lastErr?.message}` }, 503, origin);
}
