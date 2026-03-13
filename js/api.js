/* ============================================================
   ABIDE - API Client
   All external calls: Bible, search, push, AI
   ============================================================ */

const API = (() => {
  // Direct Bible API (CORS-enabled, no key needed) — for non-ESV translations
  const BIBLE_BASE = 'https://bible-api.com';

  // Default Worker URL — baked in. Users don't need to configure this.
  // Override in Settings → Advanced only if self-hosting.
  const DEFAULT_WORKER_URL = 'https://abide-worker.mattlmccoy.workers.dev';

  // Translations that MUST go through the worker (require server-side API keys)
  // ESV: api.esv.org token  NIV: YouVersion (Biblica Fast-track License)
  // NLT: api.nlt.to (Tyndale)  BSB/LSV: YouVersion (CC BY-SA, free)
  const WORKER_TRANSLATIONS = ['esv', 'niv', 'nlt', 'bsb', 'lsv'];

  function bibleTranslation() {
    return Store.get('bibleTranslation') || 'web';
  }

  // Worker URL: use stored override if set, else fall back to default
  function workerUrl() {
    return Store.get('workerUrl') || DEFAULT_WORKER_URL;
  }

  function hasWorker() {
    const url = workerUrl();
    return !!url && url !== '';
  }

  // --- Bible API ---

  async function getPassage(ref) {
    const translation = bibleTranslation();
    const cacheKey = `bible:${ref}:${translation}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;

    let data;

    // ESV goes through worker (API token kept server-side)
    if (WORKER_TRANSLATIONS.includes(translation)) {
      const url = `${workerUrl()}/bible?ref=${encodeURIComponent(ref)}&translation=${translation}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Bible API error: ${res.status}`);
      data = await res.json();
    } else {
      // All others: call bible-api.com directly (free, CORS-enabled)
      const url = `${BIBLE_BASE}/${encodeURIComponent(ref)}?translation=${translation}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Bible API error: ${res.status}`);
      data = await res.json();
    }

    if (data.error) throw new Error(data.error);

    Store.trackUsage('bibleQueries', 1);
    if (translation === 'esv') {
      Store.trackUsage('esvQueries', 1);
    }

    Cache.set(cacheKey, data, 7 * 24 * 60 * 60 * 1000); // 7 days
    return data;
  }

  async function getVerses(ref) {
    const data = await getPassage(ref);
    return data.verses || [{ book_name: '', chapter: 1, verse: 1, text: data.text || '' }];
  }

  // --- Autocomplete Suggestions ---

  const BIBLE_BOOKS = [
    'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
    'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
    '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
    'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
    'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
    'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
    'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah',
    'Haggai', 'Zechariah', 'Malachi',
    'Matthew', 'Mark', 'Luke', 'John', 'Acts',
    'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
    'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
    '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews',
    'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
    'Jude', 'Revelation'
  ];

  const ABBREVS = {
    'gen': 'Genesis', 'ex': 'Exodus', 'lev': 'Leviticus', 'num': 'Numbers',
    'deut': 'Deuteronomy', 'dt': 'Deuteronomy', 'josh': 'Joshua', 'judg': 'Judges',
    'ruth': 'Ruth', '1sam': '1 Samuel', '2sam': '2 Samuel',
    '1kgs': '1 Kings', '2kgs': '2 Kings', '1chr': '1 Chronicles', '2chr': '2 Chronicles',
    'ezra': 'Ezra', 'neh': 'Nehemiah', 'esth': 'Esther', 'job': 'Job',
    'ps': 'Psalms', 'psa': 'Psalms', 'psalm': 'Psalms', 'prov': 'Proverbs',
    'eccl': 'Ecclesiastes', 'ecc': 'Ecclesiastes', 'sos': 'Song of Solomon',
    'isa': 'Isaiah', 'jer': 'Jeremiah', 'lam': 'Lamentations', 'ezek': 'Ezekiel',
    'dan': 'Daniel', 'hos': 'Hosea', 'joel': 'Joel', 'amos': 'Amos',
    'jon': 'Jonah', 'mic': 'Micah', 'nah': 'Nahum', 'hab': 'Habakkuk',
    'zeph': 'Zephaniah', 'hag': 'Haggai', 'zech': 'Zechariah', 'mal': 'Malachi',
    'matt': 'Matthew', 'mt': 'Matthew', 'mk': 'Mark', 'lk': 'Luke', 'jn': 'John',
    'acts': 'Acts', 'rom': 'Romans', '1cor': '1 Corinthians', '2cor': '2 Corinthians',
    'gal': 'Galatians', 'eph': 'Ephesians', 'phil': 'Philippians', 'col': 'Colossians',
    '1thess': '1 Thessalonians', '2thess': '2 Thessalonians',
    '1tim': '1 Timothy', '2tim': '2 Timothy', 'tit': 'Titus', 'phlm': 'Philemon',
    'heb': 'Hebrews', 'jas': 'James', '1pet': '1 Peter', '2pet': '2 Peter',
    '1jn': '1 John', '2jn': '2 John', '3jn': '3 John', 'jude': 'Jude',
    'rev': 'Revelation',
  };

  function getSuggestions(query) {
    if (!query || query.length < 2) return [];
    const q = query.trim().toLowerCase();
    const match = q.match(/^(\d?\s?[a-z]+)\s*(\d*)(:?)(\d*)$/);
    if (!match) return [];
    const bookPart = match[1].replace(/\s/g, '').toLowerCase();
    const chapterPart = match[2];
    const hasColon = match[3] === ':';
    const versePart = match[4];
    let resolvedBook = ABBREVS[bookPart] || null;
    if (!resolvedBook) {
      resolvedBook = BIBLE_BOOKS.find(b => b.toLowerCase().startsWith(bookPart)) || null;
    }
    const suggestions = [];
    if (!resolvedBook) {
      BIBLE_BOOKS.filter(b => b.toLowerCase().startsWith(bookPart))
        .slice(0, 5)
        .forEach(b => suggestions.push({ label: b, ref: b }));
      return suggestions;
    }
    if (!chapterPart) {
      for (let c = 1; c <= 5; c++) {
        suggestions.push({ label: `${resolvedBook} ${c}`, ref: `${resolvedBook} ${c}` });
      }
      return suggestions.slice(0, 5);
    }
    const ch = parseInt(chapterPart, 10);
    if (!hasColon) {
      suggestions.push({ label: `${resolvedBook} ${ch}`, ref: `${resolvedBook} ${ch}` });
      for (let c = ch + 1; c <= ch + 3; c++) {
        suggestions.push({ label: `${resolvedBook} ${c}`, ref: `${resolvedBook} ${c}` });
      }
      return suggestions.slice(0, 5);
    }
    const v = parseInt(versePart, 10) || 1;
    for (let i = 0; i < 5; i++) {
      suggestions.push({ label: `${resolvedBook} ${ch}:${v + i}`, ref: `${resolvedBook} ${ch}:${v + i}` });
    }
    return suggestions;
  }

  // --- AI Phrase Search (via Worker) ---

  async function searchPhrase(phrase) {
    const cacheKey = `phrase:${phrase.toLowerCase().trim()}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;

    try {
      const res = await fetch(`${workerUrl()}/ai/phrase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase }),
      });
      Store.trackUsage('aiPhraseQueries', 1);
      if (!res.ok) return { verses: [], fallback: true };
      const data = await res.json();
      if (!data.fallback) {
        Store.set('lastAIPhraseMeta', {
          provider: data.provider || '',
          model: data.model || '',
          at: new Date().toISOString(),
        });
      }
      if (!data.fallback && data.verses?.length) {
        Cache.set(cacheKey, data, 60 * 60 * 1000); // 1 hour
      }
      return data;
    } catch (err) {
      console.warn('AI phrase search failed, using fallback:', err);
      return { verses: [], fallback: true };
    }
  }

  // --- AI Plan Builder (via Worker) ---

  async function buildAIPlan(topic, pastors = [], options = {}) {
    // Map user's devotionLength preference to per-session word-count overrides
    const lengthMap = {
      short:    { minMorningWords: 180, minEveningWords: 130, minMorningParagraphs: 2, minEveningParagraphs: 2 },
      standard: {},  // worker defaults (260 morning / 190 evening)
      long:     { minMorningWords: 480, minEveningWords: 350, minMorningParagraphs: 5, minEveningParagraphs: 4 },
    };
    const devotionLength = Store.get('devotionLength') || 'standard';
    const lengthOverrides = lengthMap[devotionLength] || {};

    const res = await fetch(`${workerUrl()}/ai/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, pastors, ...lengthOverrides, ...options }),
    });
    Store.trackUsage('aiPlanRequests', 1);
    if (!res.ok) {
      const detail = await readErrorMessage(res, 'AI plan error');
      throw new Error(detail);
    }
    const data = await res.json();
    if (data?.ai_meta) {
      Store.set('lastAIPlanMeta', { ...data.ai_meta, at: new Date().toISOString() });
    }
    return data;
  }

  async function summarizeTopic(topic) {
    const res = await fetch(`${workerUrl()}/ai/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic }),
    });
    if (!res.ok) {
      const detail = await readErrorMessage(res, 'Topic summary error');
      throw new Error(detail);
    }
    return res.json();
  }

  async function askBibleQuestion(question, history = []) {
    const res = await fetch(`${workerUrl()}/ai/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, history }),
    });
    if (!res.ok) {
      const detail = await readErrorMessage(res, 'Ask error');
      throw new Error(detail);
    }
    return res.json();
  }

  async function summarizeAskBibleChat(messages = []) {
    const res = await fetch(`${workerUrl()}/ai/chat-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) {
      const detail = await readErrorMessage(res, 'Ask chat summary error');
      throw new Error(detail);
    }
    return res.json();
  }

  async function getAIProviders() {
    const res = await fetch(`${workerUrl()}/ai/providers`);
    if (!res.ok) {
      const detail = await readErrorMessage(res, 'AI providers error');
      throw new Error(detail);
    }
    return res.json();
  }

  async function getAIRouting() {
    const res = await fetch(`${workerUrl()}/ai/routing`);
    if (!res.ok) {
      const detail = await readErrorMessage(res, 'AI routing error');
      throw new Error(detail);
    }
    return res.json();
  }

  async function probeAIProviders() {
    const res = await fetch(`${workerUrl()}/ai/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const detail = await readErrorMessage(res, 'AI probe error');
      throw new Error(detail);
    }
    return res.json();
  }

  async function submitFeedback(payload = {}) {
    const res = await fetch(`${workerUrl()}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await readErrorMessage(res, 'Feedback submit error');
      throw new Error(detail);
    }
    return res.json();
  }

  function translationLabel(id) {
    const key = (id || '').toLowerCase();
    const labels = {
      web: 'WEB',
      asv: 'ASV',
      bbe: 'BBE',
      kjv: 'KJV',
      darby: 'DARBY',
      esv: 'ESV',
      net: 'NET',
    };
    return labels[key] || key.toUpperCase() || 'WEB';
  }

  // --- Devotional Search (via Worker → Serper) ---

  async function searchDevotional(topic, weekKey) {
    if (!hasWorker()) throw new Error('NO_WORKER');
    const url = `${workerUrl()}/search?topic=${encodeURIComponent(topic)}&week=${weekKey}`;
    const res = await fetch(url);
    Store.trackUsage('devotionalSearchQueries', 1);
    if (!res.ok) throw new Error(`Search error: ${res.status}`);
    return res.json();
  }

  // --- Push Notification Subscription (via Worker) ---

  async function subscribePush(subscription) {
    if (!hasWorker()) throw new Error('NO_WORKER');
    const res = await fetch(`${workerUrl()}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });
    if (!res.ok) throw new Error(`Push subscribe error: ${res.status}`);
    return res.json();
  }

  async function sendTestPush() {
    if (!hasWorker()) throw new Error('NO_WORKER');
    const res = await fetch(`${workerUrl()}/push/test`, { method: 'POST' });
    Store.trackUsage('pushTestRequests', 1);
    if (!res.ok) throw new Error(`Test push error: ${res.status}`);
    return res.json();
  }

  // --- Hebrew / Greek Word Deep Dive ---

  // Mode A: passage analysis — AI picks 3–5 key words for the whole passage
  async function wordLookupPassage(context) {
    const cacheKey = `wordpassage:v3:${(context.reference || '').toLowerCase().replace(/\s+/g, '')}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;

    const res = await fetch(`${workerUrl()}/word/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context }), // no `word` field → Mode A
    });

    if (!res.ok) {
      let msg = 'Passage analysis failed';
      try { const d = await res.json(); msg = d?.error || msg; } catch {}
      throw new Error(msg);
    }

    const data = await res.json();
    Store.trackUsage('wordLookupQueries', 1);
    Cache.set(cacheKey, data, 24 * 60 * 60 * 1000); // 24h
    return data;
  }

  // Mode B: single word follow-up conversation
  async function wordLookup(word, context = {}, history = []) {
    const isFirstTurn = history.length === 0;
    const cacheKey = `wordlookup:v4:${word.toLowerCase()}:${(context.reference || '').toLowerCase().replace(/\s+/g, '')}`;

    if (isFirstTurn) {
      const cached = Cache.get(cacheKey);
      if (cached) return cached;
    }

    const res = await fetch(`${workerUrl()}/word/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, context, history }),
    });

    if (!res.ok) {
      let msg = 'Word lookup failed';
      try { const d = await res.json(); msg = d?.error || msg; } catch {}
      throw new Error(msg);
    }

    const data = await res.json();
    Store.trackUsage('wordLookupQueries', 1);

    if (isFirstTurn) {
      Cache.set(cacheKey, data, 30 * 24 * 60 * 60 * 1000); // 30 days
    }
    return data;
  }

  // --- Fetch a passage in a specific translation (for parallel view) ---
  async function getPassage_translation(ref, translationId) {
    const cacheKey = `bible:${ref}:${translationId}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;
    let data;
    if (WORKER_TRANSLATIONS.includes(translationId)) {
      const url = `${workerUrl()}/bible?ref=${encodeURIComponent(ref)}&translation=${translationId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Bible API error: ${res.status}`);
      data = await res.json();
    } else {
      const url = `${BIBLE_BASE}/${encodeURIComponent(ref)}?translation=${translationId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Bible API error: ${res.status}`);
      data = await res.json();
    }
    Cache.set(cacheKey, data, 7 * 24 * 60 * 60 * 1000);
    return data;
  }

  // --- Historical / cultural context for a passage ---
  async function getPassageContext(reference) {
    const cacheKey = `context:v1:${reference.toLowerCase().replace(/\s+/g, '')}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;
    const res = await fetch(`${workerUrl()}/ai/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference }),
    });
    if (!res.ok) throw new Error(`Context error: ${res.status}`);
    const data = await res.json();
    // Cache 90 days client-side too
    Cache.set(cacheKey, data, 90 * 24 * 60 * 60 * 1000);
    return data;
  }

  // --- AI cross-references for a passage ---
  async function getPassageCrossRefs(reference) {
    const cacheKey = `crossrefs:v1:${reference.toLowerCase().replace(/\s+/g, '')}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;
    const res = await fetch(`${workerUrl()}/ai/crossrefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference }),
    });
    if (!res.ok) throw new Error(`Cross-ref error: ${res.status}`);
    const data = await res.json();
    Cache.set(cacheKey, data, 90 * 24 * 60 * 60 * 1000);
    return data;
  }

  return {
    getPassage,
    getVerses,
    getSuggestions,
    BIBLE_BOOKS,
    searchPhrase,
    buildAIPlan,
    summarizeTopic,
    getAIProviders,
    getAIRouting,
    probeAIProviders,
    submitFeedback,
    searchDevotional,
    subscribePush,
    sendTestPush,
    hasWorker,
    workerUrl,
    bibleTranslation,
    translationLabel,
    wordLookup,
    wordLookupPassage,
    askBibleQuestion,
    summarizeAskBibleChat,
    getPassageContext,
    getPassageCrossRefs,
    getPassage_translation,
  };
})();

// --- Simple in-memory cache ---
const Cache = (() => {
  const mem = new Map();
  function get(key) {
    const item = mem.get(key);
    if (!item) return null;
    if (Date.now() > item.exp) { mem.delete(key); return null; }
    return item.value;
  }
  function set(key, value, ttlMs = 60 * 60 * 1000) {
    mem.set(key, { value, exp: Date.now() + ttlMs });
  }
  return { get, set };
})();

window.API = API;
window.Cache = Cache;
  async function readErrorMessage(res, fallback = 'Request failed') {
    try {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        return data?.error || `${fallback}: ${res.status}`;
      }
      const text = await res.text();
      return text?.trim() || `${fallback}: ${res.status}`;
    } catch {
      return `${fallback}: ${res.status}`;
    }
  }
