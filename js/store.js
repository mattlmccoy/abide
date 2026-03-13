/* ============================================================
   ABIDE - State Management (localStorage)
   ============================================================ */

const Store = (() => {
  const KEY = 'abide_state';
  const DEFAULT_GOOGLE_CLIENT_ID = '1098652353842-ve34jqhnsqda5v9n1d7455n2kka9k0ek.apps.googleusercontent.com';
  const USAGE_METRICS = [
    'bibleQueries',
    'esvQueries',
    'aiPlanRequests',
    'aiPhraseQueries',
    'devotionalSearchQueries',
    'pushTestRequests',
    'wordLookupQueries',
  ];
  const DEFAULT_TRUSTED_PASTORS = [
    { name: 'Tim Keller', enabled: true },
    { name: 'John Mark Comer', enabled: true },
    { name: 'Jonathan "JP" Pokluda', enabled: true },
    { name: 'Louie Giglio', enabled: true },
    { name: 'John Piper', enabled: true },
    { name: 'Ben Stuart', enabled: true },
    { name: 'Dallas Willard', enabled: true },
    { name: 'Charles Spurgeon', enabled: true },
    { name: 'C.S. Lewis', enabled: true },
  ];

  const defaults = {
    userName: '',
    theme: 'auto',            // 'auto' | 'light' | 'dark'
    morningHour: 6,
    morningMinute: 30,
    eveningHour: 20,
    eveningMinute: 0,
    notificationsEnabled: false,
    sundayReminderEnabled: true,
    pushSubscription: null,
    currentWeekPlan: null,    // Full week plan object from plan builder
    pendingWeekPlan: null,    // { activationDate, createdAt, plan }
    planHistory: [],          // [{ id, savedAt, reason, plan, selectedDate, sessionOverride }]
    journalEntries: {},       // { 'YYYY-MM-DD': { prompt, text, savedAt } }
    askBibleChats: {},        // { chatId: { id, title, subtitle, messages, createdAt, updatedAt, savedAt } }
    completedDevotions: [],   // ['YYYY-MM-DD-morning', 'YYYY-MM-DD-evening']
    savedDevotions: [],       // ['YYYY-MM-DD-morning', 'YYYY-MM-DD-evening']
    savedDevotionLibrary: {}, // { id: { ...devotion snapshot... } }
    selectedDevotionDate: null,
    currentStreak: 0,
    lastOpenedDate: null,
    workerUrl: '',            // Set in settings after deploying worker
    onboardingDone: false,
    tutorialSeen: false,
    bibleTranslation: 'esv',  // 'web' | 'kjv' | 'net' | 'bbe' | 'darby' | 'esv'
    palette: 'mountain-mist', // Color palette / theme
    trustedPastors: DEFAULT_TRUSTED_PASTORS,
    usageStats: {
      monthKey: '',
      bibleQueries: 0,
      esvQueries: 0,
      aiPlanRequests: 0,
      aiPhraseQueries: 0,
      devotionalSearchQueries: 0,
      pushTestRequests: 0,
    },
    usageLimits: {
      esvQueries: 500,
      aiPlanRequests: 120,
      aiPhraseQueries: 400,
      bibleQueries: 3000,
    },
    lastAIPlanMeta: null,
    lastAIPhraseMeta: null,
    googleClientId: DEFAULT_GOOGLE_CLIENT_ID,
    googleDriveFolderId: '',
    googleDriveFileId: '',
    googleDriveFiles: { devotions: '', journals: '', settings: '', shares: '', askChats: '' },
    lastDriveSyncAt: null,
    googleProfile: null,      // { sub, email, name, picture }
    googleConnectedAt: null,
    planBuildStartMode: '',   // '' | 'today' | 'tomorrow'
    devotionLength: 'standard', // 'short' | 'standard' | 'long'
    verseHighlights: {},      // { 'BookName C:V': { color: '#hex', note: '' } }
    readingProgress: {},      // { 'BookName': [chapterNumbers...] }
    _defaultsVersion: 4,
  };

  let _state = null;

  function load() {
    let migrated = false;
    try {
      const raw = localStorage.getItem(KEY);
      _state = raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
      _state.trustedPastors = normalizeTrustedPastors(_state.trustedPastors);
      if (!_state.savedDevotions || !Array.isArray(_state.savedDevotions)) {
        _state.savedDevotions = [];
      }
      if (!_state.planHistory || !Array.isArray(_state.planHistory)) {
        _state.planHistory = [];
      }
      if (!_state.savedDevotionLibrary || typeof _state.savedDevotionLibrary !== 'object') {
        _state.savedDevotionLibrary = {};
      }
      if (!_state.askBibleChats || typeof _state.askBibleChats !== 'object') {
        _state.askBibleChats = {};
      }
      _state.usageStats = normalizeUsageStats(_state.usageStats);
      _state.usageLimits = normalizeUsageLimits(_state.usageLimits);
      if (!_state.googleClientId || !_state.googleClientId.trim()) {
        _state.googleClientId = DEFAULT_GOOGLE_CLIENT_ID;
      }
      if (!_state.googleDriveFiles || typeof _state.googleDriveFiles !== 'object') {
        _state.googleDriveFiles = { devotions: '', journals: '', settings: '', shares: '', askChats: '', highlights: '', progress: '', plan: '' };
      } else {
        _state.googleDriveFiles = {
          devotions: String(_state.googleDriveFiles.devotions || ''),
          journals: String(_state.googleDriveFiles.journals || ''),
          settings: String(_state.googleDriveFiles.settings || ''),
          shares: String(_state.googleDriveFiles.shares || ''),
          askChats: String(_state.googleDriveFiles.askChats || ''),
          highlights: String(_state.googleDriveFiles.highlights || ''),
          progress: String(_state.googleDriveFiles.progress || ''),
          plan: String(_state.googleDriveFiles.plan || ''),
        };
      }
      if (Number(_state._defaultsVersion || 0) < 3) {
        if (!_state.bibleTranslation || _state.bibleTranslation === 'web') {
          _state.bibleTranslation = 'esv';
          migrated = true;
        }
        if (!_state.palette || _state.palette === 'tuscan-sunset' || _state.palette === 'cactus-flower') {
          _state.palette = 'mountain-mist';
          migrated = true;
        }
        _state._defaultsVersion = 3;
        migrated = true;
      }
      if (Number(_state._defaultsVersion || 0) < 4) {
        _state._defaultsVersion = 4;
        migrated = true;
      }
    } catch (e) {
      _state = { ...defaults };
    }
    if (migrated) save();
    return _state;
  }

  function normalizeTrustedPastors(input) {
    const canonicalPastorName = (name = '') => {
      const clean = String(name || '').trim();
      if (!clean) return '';
      if (clean.toLowerCase() === 'jon pokluda') return 'Jonathan "JP" Pokluda';
      return clean;
    };

    const source = Array.isArray(input) ? input : DEFAULT_TRUSTED_PASTORS;
    const names = new Set();
    const normalized = [];

    source.forEach((entry) => {
      const name = typeof entry === 'string' ? entry : entry?.name;
      if (!name) return;
      const clean = canonicalPastorName(name);
      if (!clean) return;
      const key = clean.toLowerCase();
      if (names.has(key)) return;
      names.add(key);
      normalized.push({
        name: clean,
        enabled: typeof entry === 'object' ? entry.enabled !== false : true,
      });
    });

    return normalized.length ? normalized : DEFAULT_TRUSTED_PASTORS.map(p => ({ ...p }));
  }

  function currentMonthKey() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${m}`;
  }

  function normalizeUsageStats(input) {
    const monthKey = currentMonthKey();
    const base = { ...defaults.usageStats, monthKey };
    const merged = { ...base, ...(input || {}) };

    if (merged.monthKey !== monthKey) {
      merged.monthKey = monthKey;
      USAGE_METRICS.forEach((k) => { merged[k] = 0; });
    } else {
      USAGE_METRICS.forEach((k) => {
        const value = Number(merged[k]);
        merged[k] = Number.isFinite(value) && value >= 0 ? value : 0;
      });
    }
    return merged;
  }

  function normalizeUsageLimits(input) {
    const merged = { ...defaults.usageLimits, ...(input || {}) };
    Object.keys(defaults.usageLimits).forEach((k) => {
      const value = Number(merged[k]);
      merged[k] = Number.isFinite(value) && value > 0 ? Math.round(value) : defaults.usageLimits[k];
    });
    return merged;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(_state));
    } catch (e) {
      console.warn('Store: could not save state', e);
    }
  }

  function ensureUsageState() {
    _state.usageStats = normalizeUsageStats(_state.usageStats);
    _state.usageLimits = normalizeUsageLimits(_state.usageLimits);
  }

  function get(key) {
    if (!_state) load();
    ensureUsageState();
    return key ? _state[key] : { ..._state };
  }

  function set(key, value) {
    if (!_state) load();
    ensureUsageState();
    _state[key] = value;
    save();
    return _state[key];
  }

  function update(patch) {
    if (!_state) load();
    ensureUsageState();
    Object.assign(_state, patch);
    save();
  }

  // --- Streak logic ---
  function updateStreak() {
    const today = DateUtils.today();
    const last = _state.lastOpenedDate;
    if (last === today) return _state.currentStreak;

    let streak = _state.currentStreak;
    if (last) {
      const diff = DateUtils.daysBetween(last, today);
      if (diff === 1) {
        streak += 1;
      } else if (diff > 1) {
        streak = 1;
      }
    } else {
      streak = 1;
    }

    update({ currentStreak: streak, lastOpenedDate: today });
    return streak;
  }

  // --- Devotion completion ---
  function markCompleted(dateKey, session) {
    const id = `${dateKey}-${session}`;
    if (!_state.completedDevotions.includes(id)) {
      _state.completedDevotions = [..._state.completedDevotions, id];
      save();
    }
  }

  function isCompleted(dateKey, session) {
    return _state.completedDevotions.includes(`${dateKey}-${session}`);
  }

  // --- Journal ---
  function saveJournalEntry(dateKey, prompt, text) {
    if (!_state.journalEntries) _state.journalEntries = {};
    _state.journalEntries[dateKey] = { prompt, text, savedAt: new Date().toISOString() };
    save();
  }

  function getJournalEntry(dateKey) {
    return _state.journalEntries?.[dateKey] || null;
  }

  function getRecentJournalEntries(limit = 10) {
    const entries = _state.journalEntries || {};
    return Object.entries(entries)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, limit)
      .map(([date, entry]) => ({ date, ...entry }));
  }

  function getAllJournalEntries() {
    const entries = _state.journalEntries || {};
    return Object.entries(entries)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, entry]) => ({ date, ...entry }));
  }

  function deleteJournalEntry(dateKey) {
    const key = String(dateKey || '').trim();
    if (!key || !_state.journalEntries || !_state.journalEntries[key]) return { removed: 0 };
    delete _state.journalEntries[key];
    save();
    return { removed: 1 };
  }

  function normalizeAskBibleMessage(message = {}, fallbackRole = 'assistant') {
    const role = message?.role === 'user' ? 'user' : fallbackRole;
    const content = String(message?.content || '').trim();
    return content ? { role, content } : null;
  }

  function normalizeAskBibleChat(chat = {}, fallbackId = '') {
    const id = String(chat?.id || fallbackId || '').trim();
    if (!id) return null;
    const rawMessages = Array.isArray(chat?.messages) ? chat.messages : [];
    const messages = rawMessages
      .map((message) => normalizeAskBibleMessage(message, message?.role === 'user' ? 'user' : 'assistant'))
      .filter(Boolean);
    if (!messages.length) return null;
    const createdAt = String(chat?.createdAt || chat?.savedAt || chat?.updatedAt || new Date().toISOString());
    const updatedAt = String(chat?.updatedAt || chat?.savedAt || createdAt);
    return {
      id,
      title: String(chat?.title || '').trim(),
      subtitle: String(chat?.subtitle || '').trim(),
      createdAt,
      updatedAt,
      savedAt: String(chat?.savedAt || updatedAt || createdAt),
      dateKey: String(chat?.dateKey || '').trim() || DateUtils.toKey(new Date(createdAt)),
      messages,
    };
  }

  function saveAskBibleChat(chat = {}) {
    if (!_state.askBibleChats || typeof _state.askBibleChats !== 'object') _state.askBibleChats = {};
    const fallbackId = String(chat?.id || `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`).trim();
    const existing = _state.askBibleChats[fallbackId];
    const normalized = normalizeAskBibleChat({
      ...existing,
      ...chat,
      id: fallbackId,
      createdAt: chat?.createdAt || existing?.createdAt || new Date().toISOString(),
      updatedAt: chat?.updatedAt || new Date().toISOString(),
      savedAt: new Date().toISOString(),
    }, fallbackId);
    if (!normalized) return null;
    _state.askBibleChats[fallbackId] = normalized;
    save();
    return cloneValue(normalized);
  }

  function getAskBibleChat(chatId) {
    const key = String(chatId || '').trim();
    if (!key) return null;
    return cloneValue(_state.askBibleChats?.[key] || null);
  }

  function getAllAskBibleChats() {
    const chats = _state.askBibleChats && typeof _state.askBibleChats === 'object'
      ? _state.askBibleChats
      : {};
    return Object.values(chats)
      .map(chat => cloneValue(chat))
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt || b.savedAt || '').localeCompare(String(a.updatedAt || a.savedAt || '')));
  }

  function deleteAskBibleChat(chatId) {
    const key = String(chatId || '').trim();
    if (!key || !_state.askBibleChats || !_state.askBibleChats[key]) return { removed: 0 };
    delete _state.askBibleChats[key];
    save();
    return { removed: 1 };
  }

  // --- Plan ---
  function activatePendingPlanIfDue() {
    const pending = _state.pendingWeekPlan;
    if (!pending || typeof pending !== 'object') return false;

    const activationDate = String(pending.activationDate || '').trim();
    if (!activationDate) return false;
    const today = DateUtils.today();
    if (activationDate > today) return false;

    const queuedPlan = pending.plan && typeof pending.plan === 'object'
      ? cloneValue(pending.plan)
      : null;
    if (!queuedPlan) {
      _state.pendingWeekPlan = null;
      save();
      return false;
    }

    pushCurrentPlanToHistory('activate-pending-plan');
    _state.currentWeekPlan = queuedPlan;
    _state.pendingWeekPlan = null;
    const keys = Object.keys(_state.currentWeekPlan?.days || {}).sort((a, b) => a.localeCompare(b));
    _state.selectedDevotionDate = keys.includes(today) ? today : (keys[0] || today);
    save();
    return true;
  }

  function savePlan(plan) {
    activatePendingPlanIfDue();
    pushCurrentPlanToHistory('save-plan');
    const nextPlan = plan && typeof plan === 'object' ? { ...plan } : plan;
    if (nextPlan && typeof nextPlan === 'object' && nextPlan.seedDefault !== true) {
      nextPlan.seedDefault = false;
    }
    // Stamp a unique planId if not already present — used by mergePlan() to
    // definitively detect when local and Drive plans are different devotions.
    if (nextPlan && typeof nextPlan === 'object' && !nextPlan.planId) {
      const weekKey = nextPlan.week || DateUtils.weekStart(DateUtils.today());
      nextPlan.planId = `plan-${weekKey}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    }
    set('currentWeekPlan', nextPlan);
    _state.pendingWeekPlan = null;
    const keys = getPlanDayKeys();
    if (!keys.length) return;
    const today = DateUtils.today();
    _state.selectedDevotionDate = keys.includes(today) ? today : keys[0];
    save();
  }

  function queuePlanForDate(plan, activationDateKey) {
    const nextPlan = plan && typeof plan === 'object' ? cloneValue(plan) : null;
    const activationDate = String(activationDateKey || '').trim();
    if (!nextPlan || !activationDate) return { ok: false };
    _state.pendingWeekPlan = {
      activationDate,
      createdAt: new Date().toISOString(),
      plan: nextPlan,
    };
    save();
    return { ok: true, activationDate };
  }

  function getPendingPlanInfo() {
    activatePendingPlanIfDue();
    const pending = _state.pendingWeekPlan;
    if (!pending || typeof pending !== 'object') return null;
    return {
      activationDate: String(pending.activationDate || ''),
      createdAt: String(pending.createdAt || ''),
      theme: String(pending.plan?.theme || ''),
    };
  }

  function pushCurrentPlanToHistory(reason = 'replace-plan') {
    if (!_state?.currentWeekPlan || typeof _state.currentWeekPlan !== 'object') return;
    const snapshot = {
      id: `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      savedAt: new Date().toISOString(),
      reason: String(reason || 'replace-plan'),
      plan: cloneValue(_state.currentWeekPlan),
      selectedDate: _state.selectedDevotionDate || null,
      sessionOverride: _state._sessionOverride || null,
    };
    const history = Array.isArray(_state.planHistory) ? _state.planHistory : [];
    _state.planHistory = [snapshot, ...history].slice(0, 12);
  }

  function hasPlanHistory() {
    return Array.isArray(_state.planHistory) && _state.planHistory.length > 0;
  }

  function restorePreviousPlan() {
    const history = Array.isArray(_state.planHistory) ? _state.planHistory : [];
    if (!history.length) return { ok: false };

    const [previous, ...rest] = history;
    if (!previous?.plan || typeof previous.plan !== 'object') {
      _state.planHistory = rest;
      save();
      return { ok: false };
    }

    _state.currentWeekPlan = cloneValue(previous.plan);
    _state.planHistory = rest;

    const keys = Object.keys(_state.currentWeekPlan?.days || {}).sort((a, b) => a.localeCompare(b));
    const today = DateUtils.today();
    const preferredDate = previous.selectedDate || null;
    _state.selectedDevotionDate = keys.includes(preferredDate)
      ? preferredDate
      : (keys.includes(today) ? today : (keys[0] || today));
    _state._sessionOverride = previous.sessionOverride === 'evening' ? 'evening' : 'morning';
    save();
    return { ok: true, theme: _state.currentWeekPlan?.theme || '' };
  }

  function getPlan() {
    activatePendingPlanIfDue();
    return get('currentWeekPlan');
  }

  function getPlanDayKeys() {
    activatePendingPlanIfDue();
    const plan = getPlan();
    const keys = Object.keys(plan?.days || {});
    return keys.sort((a, b) => a.localeCompare(b));
  }

  function getDevotionData(dateKey) {
    activatePendingPlanIfDue();
    const plan = getPlan();
    return plan?.days?.[dateKey] || null;
  }

  function getSelectedDevotionDate() {
    activatePendingPlanIfDue();
    const keys = getPlanDayKeys();
    if (!keys.length) return DateUtils.today();
    const current = _state.selectedDevotionDate;
    if (current && keys.includes(current)) return current;
    const today = DateUtils.today();
    return keys.includes(today) ? today : keys[0];
  }

  function setSelectedDevotionDate(dateKey) {
    if (!dateKey) return;
    _state.selectedDevotionDate = dateKey;
    save();
  }

  function shiftSelectedDevotionDay(offset) {
    const keys = getPlanDayKeys();
    if (!keys.length) return null;
    const current = getSelectedDevotionDate();
    const idx = Math.max(0, keys.indexOf(current));
    const nextIdx = Math.min(keys.length - 1, Math.max(0, idx + offset));
    _state.selectedDevotionDate = keys[nextIdx];
    save();
    return _state.selectedDevotionDate;
  }

  function getTodayDevotionData() {
    const plan = getPlan();
    const today = DateUtils.today();
    return plan?.days?.[today] || null;
  }

  // --- Saved devotions ---
  function toggleSavedDevotion(dateKey, session) {
    const id = `${dateKey}-${session}`;
    const has = _state.savedDevotions.includes(id);
    if (has) {
      _state.savedDevotions = _state.savedDevotions.filter(x => x !== id);
      if (_state.savedDevotionLibrary && _state.savedDevotionLibrary[id]) {
        delete _state.savedDevotionLibrary[id];
      }
    } else {
      _state.savedDevotions = [..._state.savedDevotions, id];
      const day = getDevotionData(dateKey) || {};
      const sessionData = day?.[session] || null;
      if (sessionData) {
        _state.savedDevotionLibrary[id] = buildSavedEntry(id, dateKey, session, day, sessionData);
      }
    }
    save();
    return !has;
  }

  function slugify(value = '') {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
  }

  function saveDevotion(dateKey, session, options = {}) {
    const opts = (typeof options === 'boolean') ? { persist: options } : (options || {});
    const persist = opts.persist !== false;
    const markerId = `${dateKey}-${session}`;
    const id = opts.uniqueId && opts.seriesId
      ? `${opts.seriesId}::${markerId}`
      : markerId;
    const day = getDevotionData(dateKey) || {};
    const sessionData = day?.[session] || null;
    const plan = getPlan() || {};
    const seriesTheme = String(plan?.theme || '').trim() || String(day?.theme || '').trim();
    if (!sessionData) return false;

    if (opts.includeSavedMarker !== false && !_state.savedDevotions.includes(markerId)) {
      _state.savedDevotions = [..._state.savedDevotions, markerId];
    }
    const existingSavedAt = _state.savedDevotionLibrary?.[id]?.savedAt || '';
    _state.savedDevotionLibrary[id] = buildSavedEntry(id, dateKey, session, day, sessionData, existingSavedAt, seriesTheme, opts.seriesId || '');
    if (persist) save();
    return true;
  }

  function markerIdFromSavedId(id = '') {
    const value = String(id || '').trim();
    if (!value) return '';
    return value.includes('::') ? value.split('::').pop() : value;
  }

  function saveEntirePlan() {
    const plan = getPlan();
    const keys = Object.keys(plan?.days || {}).sort((a, b) => a.localeCompare(b));
    if (!keys.length) return { added: 0, total: 0, saved: (_state.savedDevotions || []).length };

    let added = 0;
    const total = keys.length * 2;
    const nowIso = new Date().toISOString();
    const weekKey = String(plan.week || DateUtils.weekStart(keys[0] || DateUtils.today()));
    const theme = String(plan.theme || '').trim() || 'Saved Week';
    const seriesId = `${weekKey}::${slugify(theme)}::${nowIso.replace(/[-:.TZ]/g, '')}`;

    keys.forEach((dateKey) => {
      ['morning', 'evening'].forEach((session) => {
        const markerId = `${dateKey}-${session}`;
        const alreadySaved = _state.savedDevotions.includes(markerId);
        const ok = saveDevotion(dateKey, session, {
          persist: false,
          uniqueId: true,
          seriesId,
          includeSavedMarker: true,
        });
        if (ok && !alreadySaved) added += 1;
      });
    });
    save();
    return { added, total, saved: (_state.savedDevotions || []).length, seriesId };
  }

  function isSavedDevotion(dateKey, session) {
    return _state.savedDevotions.includes(`${dateKey}-${session}`);
  }

  function deleteSavedDevotionById(id) {
    const key = String(id || '').trim();
    if (!key) return { removed: 0 };
    const marker = key.includes('::') ? key.split('::').pop() : key;
    let removedLibrary = 0;
    _state.savedDevotions = (Array.isArray(_state.savedDevotions) ? _state.savedDevotions : []).filter((x) => x !== key);
    if (_state.savedDevotionLibrary && Object.prototype.hasOwnProperty.call(_state.savedDevotionLibrary, key)) {
      delete _state.savedDevotionLibrary[key];
      removedLibrary = 1;
    }
    if (marker && marker !== key) {
      const stillHasMarker = Object.values(_state.savedDevotionLibrary || {}).some((entry) => {
        if (!entry?.id) return false;
        const entryMarker = String(entry.id).includes('::') ? String(entry.id).split('::').pop() : String(entry.id);
        return entryMarker === marker;
      });
      if (!stillHasMarker) {
        _state.savedDevotions = (Array.isArray(_state.savedDevotions) ? _state.savedDevotions : []).filter((x) => x !== marker);
      }
    }
    save();
    return { removed: removedLibrary };
  }

  function deleteSavedDevotionsByIds(ids = []) {
    const unique = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!unique.length) return { removed: 0 };
    const set = new Set(unique);
    const markers = unique.map((id) => (id.includes('::') ? id.split('::').pop() : id)).filter(Boolean);
    let removedLibrary = 0;
    _state.savedDevotions = (Array.isArray(_state.savedDevotions) ? _state.savedDevotions : []).filter((id) => !set.has(id));
    if (_state.savedDevotionLibrary && typeof _state.savedDevotionLibrary === 'object') {
      unique.forEach((id) => {
        if (Object.prototype.hasOwnProperty.call(_state.savedDevotionLibrary, id)) {
          delete _state.savedDevotionLibrary[id];
          removedLibrary += 1;
        }
      });
    }
    const activeMarkers = new Set(
      Object.values(_state.savedDevotionLibrary || {}).map((entry) => {
        const id = String(entry?.id || '');
        return id.includes('::') ? id.split('::').pop() : id;
      }).filter(Boolean)
    );
    _state.savedDevotions = (Array.isArray(_state.savedDevotions) ? _state.savedDevotions : []).filter((id) => {
      if (!markers.includes(id)) return true;
      return activeMarkers.has(id);
    });
    save();
    return { removed: removedLibrary };
  }

  function getSavedDevotionLibrary() {
    const lib = _state.savedDevotionLibrary || {};
    return Object.values(lib)
      .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }

  function getSavedDevotionById(id) {
    if (!id) return null;
    return (_state.savedDevotionLibrary || {})[id] || null;
  }

  function buildSavedEntry(id, dateKey, session, day, sessionData, existingSavedAt = '', seriesTheme = '', seriesId = '') {
    const normalizedSeriesTheme = String(seriesTheme || day.theme || '').trim();
    const dayTheme = String(day.theme || '').trim();
    return {
      id,
      dateKey,
      session,
      savedAt: existingSavedAt || new Date().toISOString(),
      weekKey: DateUtils.weekStart(dateKey),
      seriesId: String(seriesId || ''),
      seriesTheme: normalizedSeriesTheme,
      dayTheme,
      theme: normalizedSeriesTheme || dayTheme || '',
      title: sessionData.title || '',
      openingVerse: sessionData.opening_verse || null,
      body: Array.isArray(sessionData.body) ? sessionData.body : [],
      reflectionPrompts: Array.isArray(sessionData.reflection_prompts) ? sessionData.reflection_prompts : [],
      prayer: sessionData.prayer || '',
      inspiredBy: Array.isArray(sessionData.inspired_by) ? sessionData.inspired_by : [],
      devotionData: JSON.parse(JSON.stringify({
        theme: normalizedSeriesTheme || dayTheme || '',
        seriesId: String(seriesId || ''),
        seriesTheme: normalizedSeriesTheme,
        dayTheme,
        sources: Array.isArray(day.sources) ? day.sources : [],
        faith_stretch: day.faith_stretch || null,
        morning: day.morning || null,
        evening: day.evening || null,
      })),
    };
  }

  function cloneValue(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  }

  function normalizeDayFromSavedEntries(entries = [], fallbackTheme = 'Saved Week') {
    const dayMap = {};
    let theme = String(fallbackTheme || '').trim() || 'Saved Week';

    entries.forEach((entry) => {
      const dateKey = String(entry?.dateKey || '').trim();
      if (!dateKey) return;

      const session = entry?.session === 'evening' ? 'evening' : 'morning';
      const devotionData = entry?.devotionData && typeof entry.devotionData === 'object' ? entry.devotionData : {};
      const fromDay = devotionData && typeof devotionData === 'object' ? devotionData : {};
      const fromTheme = String(entry?.theme || fromDay.theme || '').trim();
      if (fromTheme) theme = fromTheme;

      if (!dayMap[dateKey]) {
        dayMap[dateKey] = {
          theme: fromTheme || theme,
          morning: null,
          evening: null,
          faith_stretch: null,
          sources: [],
        };
      }

      const target = dayMap[dateKey];
      if (fromDay.theme && !target.theme) target.theme = String(fromDay.theme);
      if (fromDay.faith_stretch && !target.faith_stretch) target.faith_stretch = cloneValue(fromDay.faith_stretch);
      if (Array.isArray(fromDay.sources) && fromDay.sources.length) target.sources = cloneValue(fromDay.sources);
      if (fromDay.morning && !target.morning) target.morning = cloneValue(fromDay.morning);
      if (fromDay.evening && !target.evening) target.evening = cloneValue(fromDay.evening);

      if (!target[session]) {
        target[session] = {
          title: entry?.title || '',
          opening_verse: cloneValue(entry?.openingVerse || null),
          body: Array.isArray(entry?.body) ? cloneValue(entry.body) : [],
          reflection_prompts: Array.isArray(entry?.reflectionPrompts) ? cloneValue(entry.reflectionPrompts) : [],
          prayer: String(entry?.prayer || ''),
          inspired_by: Array.isArray(entry?.inspiredBy) ? cloneValue(entry.inspiredBy) : [],
        };
      }

      if (!target.theme) target.theme = fromTheme || theme;
    });

    Object.keys(dayMap).forEach((dateKey) => {
      if (!dayMap[dateKey].theme) dayMap[dateKey].theme = theme;
    });

    return { days: dayMap, theme: theme || 'Saved Week' };
  }

  function useSavedSeries(entries = [], preferredDate = '', preferredSession = 'morning') {
    const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!list.length) return { ok: false, reason: 'empty' };

    const { days, theme } = normalizeDayFromSavedEntries(list, list[0]?.theme || 'Saved Week');
    const dayKeys = Object.keys(days).sort((a, b) => a.localeCompare(b));
    if (!dayKeys.length) return { ok: false, reason: 'no-days' };

    const week = DateUtils.weekStart(dayKeys[0]);
    pushCurrentPlanToHistory('use-saved-series');
    _state.currentWeekPlan = {
      week,
      theme,
      aiGenerated: false,
      seedDefault: false,
      fromSavedSeries: true,
      createdAt: new Date().toISOString(),
      planId: `plan-${week}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      days,
    };

    _state.selectedDevotionDate = dayKeys.includes(preferredDate) ? preferredDate : dayKeys[0];
    _state._sessionOverride = preferredSession === 'evening' ? 'evening' : 'morning';
    save();
    return { ok: true, week, theme, dayCount: dayKeys.length };
  }

  function exportSavedDevotionsSnapshot() {
    const list = Array.isArray(_state.savedDevotions) ? _state.savedDevotions : [];
    const lib = { ...(_state.savedDevotionLibrary || {}) };

    Object.keys(lib).forEach((id) => {
      const entry = lib[id] || {};
      if (entry.devotionData && entry.body?.length) return;
      const parts = String(id).split('-');
      const session = parts.pop();
      const dateKey = parts.join('-');
      if (!dateKey || !session) return;
      const day = getDevotionData(dateKey) || {};
      const sessionData = day?.[session];
      if (!sessionData) return;
      lib[id] = buildSavedEntry(id, dateKey, session, day, sessionData, entry.savedAt || '');
    });

    list.forEach((id) => {
      if (lib[id]) return;
      const parts = String(id).split('-');
      const session = parts.pop();
      const dateKey = parts.join('-');
      if (!dateKey || !session) return;
      const day = getDevotionData(dateKey) || {};
      const sessionData = day?.[session];
      if (!sessionData) return;
      lib[id] = buildSavedEntry(id, dateKey, session, day, sessionData, lib[id]?.savedAt || '');
    });

    // Persist marker IDs for "saved" state; avoid mixing marker + series IDs.
    const uniqueIds = Array.from(new Set([
      ...list.map(markerIdFromSavedId).filter(Boolean),
      ...Object.keys(lib).map(markerIdFromSavedId).filter(Boolean),
    ]));

    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      profile: {
        userName: _state.userName || '',
        bibleTranslation: _state.bibleTranslation || 'web',
        palette: _state.palette || 'mountain-mist',
        trustedPastors: getTrustedPastors(),
      },
      savedDevotions: uniqueIds,
      savedDevotionLibrary: lib,
      journalEntries: _state.journalEntries || {},
    };
  }

  function importSavedDevotionsSnapshot(snapshot = {}, options = {}) {
    if (Array.isArray(snapshot)) {
      snapshot = { savedDevotionLibrary: snapshot };
    }
    if (snapshot && typeof snapshot === 'object' && snapshot.data && typeof snapshot.data === 'object') {
      snapshot = snapshot.data;
    }

    let normalizedSnapshot = snapshot && typeof snapshot === 'object' ? { ...snapshot } : {};
    if (normalizedSnapshot.saved && !normalizedSnapshot.savedDevotions) {
      normalizedSnapshot.savedDevotions = normalizedSnapshot.saved;
    }
    if (normalizedSnapshot.items && !normalizedSnapshot.savedDevotionLibrary) {
      normalizedSnapshot.savedDevotionLibrary = normalizedSnapshot.items;
    }

    if (Array.isArray(normalizedSnapshot.savedDevotionLibrary)) {
      const arrayLib = {};
      normalizedSnapshot.savedDevotionLibrary.forEach((entry) => {
        const id = String(entry?.id || '').trim();
        if (!id) return;
        arrayLib[id] = { ...entry };
      });
      normalizedSnapshot.savedDevotionLibrary = arrayLib;
    }

    const replaceExisting = options && options.replace === true;
    const list = (Array.isArray(normalizedSnapshot.savedDevotions) ? normalizedSnapshot.savedDevotions : [])
      .map(markerIdFromSavedId)
      .filter(Boolean);
    const lib = normalizedSnapshot.savedDevotionLibrary && typeof normalizedSnapshot.savedDevotionLibrary === 'object'
      ? normalizedSnapshot.savedDevotionLibrary
      : {};

    // If both series IDs and marker IDs exist for the same marker, drop marker-only clones.
    const byMarker = {};
    Object.entries(lib).forEach(([id, entry]) => {
      const marker = markerIdFromSavedId(id) || markerIdFromSavedId(entry?.id || '');
      if (!marker) return;
      if (!byMarker[marker]) byMarker[marker] = [];
      byMarker[marker].push(id);
    });
    Object.values(byMarker).forEach((ids) => {
      if (ids.length < 2) return;
      const seriesIds = ids.filter((id) => String(id).includes('::'));
      if (!seriesIds.length) return;
      ids.forEach((id) => {
        if (!String(id).includes('::')) delete lib[id];
      });
    });

    const mergedIds = new Set(replaceExisting
      ? [...list, ...Object.keys(lib).map(markerIdFromSavedId).filter(Boolean)]
      : [
        ...(Array.isArray(_state.savedDevotions) ? _state.savedDevotions.map(markerIdFromSavedId) : []),
        ...list,
        ...Object.keys(lib).map(markerIdFromSavedId).filter(Boolean),
      ]);
    _state.savedDevotions = [...mergedIds];
    _state.savedDevotionLibrary = replaceExisting
      ? { ...lib }
      : { ...(_state.savedDevotionLibrary || {}), ...lib };
    const incomingProfile = normalizedSnapshot.profile && typeof normalizedSnapshot.profile === 'object' ? normalizedSnapshot.profile : {};
    if (incomingProfile.userName && !_state.userName) {
      _state.userName = String(incomingProfile.userName).trim();
    }
    if (incomingProfile.bibleTranslation && !_state.bibleTranslation) {
      _state.bibleTranslation = String(incomingProfile.bibleTranslation).toLowerCase();
    }
    if (incomingProfile.palette && !_state.palette) {
      _state.palette = String(incomingProfile.palette);
    }
    if (Array.isArray(incomingProfile.trustedPastors) && incomingProfile.trustedPastors.length) {
      const mergedPastors = [...getTrustedPastors(), ...incomingProfile.trustedPastors];
      _state.trustedPastors = normalizeTrustedPastors(mergedPastors);
    }
    // Backfill library entries from current plan when older snapshots only contain IDs.
    const libraryMarkers = new Set(Object.keys(_state.savedDevotionLibrary || {}).map(markerIdFromSavedId).filter(Boolean));
    _state.savedDevotions.forEach((id) => {
      if (libraryMarkers.has(id)) return;
      if (_state.savedDevotionLibrary[id]) return;
      const parts = String(id).split('-');
      const session = parts.pop();
      const dateKey = parts.join('-');
      if (!dateKey || !session) return;
      const day = getDevotionData(dateKey) || {};
      const sessionData = day?.[session];
      if (!sessionData) return;
      _state.savedDevotionLibrary[id] = buildSavedEntry(id, dateKey, session, day, sessionData);
    });
    const incomingJournal = normalizedSnapshot.journalEntries && typeof normalizedSnapshot.journalEntries === 'object'
      ? normalizedSnapshot.journalEntries
      : {};
    const currentJournal = _state.journalEntries && typeof _state.journalEntries === 'object'
      ? _state.journalEntries
      : {};
    Object.entries(incomingJournal).forEach(([dateKey, entry]) => {
      const existing = currentJournal[dateKey];
      const inSavedAt = String(entry?.savedAt || '');
      const exSavedAt = String(existing?.savedAt || '');
      if (!existing || inSavedAt > exSavedAt) {
        currentJournal[dateKey] = {
          prompt: String(entry?.prompt || ''),
          text: String(entry?.text || ''),
          savedAt: inSavedAt || new Date().toISOString(),
        };
      }
    });
    _state.journalEntries = currentJournal;
    _state.lastDriveSyncAt = new Date().toISOString();
    save();
    return {
      count: _state.savedDevotions.length,
      importedIds: list.length,
      importedLibrary: Object.keys(lib).length,
      importedJournal: Object.keys(incomingJournal).length,
    };
  }

  function exportDevotionsSnapshot() {
    // Pure archive of saved entries only — plan fields move to exportPlanSnapshot().
    // Keeping this lean means generating a new weekly plan never forces a re-upload
    // of the entire devotion history.
    const base = exportSavedDevotionsSnapshot();
    return {
      version: 1,
      exportedAt: base.exportedAt,
      savedDevotions: base.savedDevotions,
      savedDevotionLibrary: base.savedDevotionLibrary,
    };
  }

  function exportPlanSnapshot() {
    // Never upload a seed/fallback plan to Drive — it is a local placeholder only.
    // Uploading it would corrupt other devices by replacing their real plans.
    const planToExport = (_state.currentWeekPlan?.seedDefault === true)
      ? null
      : (_state.currentWeekPlan || null);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      currentWeekPlan: planToExport,
      selectedDevotionDate: _state.selectedDevotionDate || null,
      sessionOverride: _state._sessionOverride || null,
    };
  }

  function importPlanSnapshot(snapshot = {}) {
    if (!snapshot || typeof snapshot !== 'object') return { importedPlanDays: 0 };
    const incoming = snapshot.currentWeekPlan || null;
    const merged = mergePlan(_state.currentWeekPlan, incoming);
    const patch = {};
    let importedPlanDays = 0;
    if (merged && merged !== _state.currentWeekPlan) {
      patch.currentWeekPlan = merged;
      importedPlanDays = Object.keys(merged?.days || {}).length;
    }
    if (snapshot.selectedDevotionDate && !_state.selectedDevotionDate) {
      patch.selectedDevotionDate = String(snapshot.selectedDevotionDate);
    }
    if (snapshot.sessionOverride && !_state._sessionOverride) {
      patch._sessionOverride = String(snapshot.sessionOverride);
    }
    if (Object.keys(patch).length) {
      Object.assign(_state, patch);
      save();
    }
    return { importedPlanDays };
  }

  // Trim a plan's days object to only the 7 date keys declared by its .week string.
  // Prevents a Drive-cached plan corrupted by a prior merge bug (e.g. 13 days) from
  // expanding the current plan on every pull. Safe to call on any plan: if it already
  // has ≤7 days or lacks a parseable week key, it is returned unchanged.
  function sanitizePlanDays(plan) {
    if (!plan || typeof plan !== 'object') return plan;
    const days = plan.days && typeof plan.days === 'object' ? plan.days : {};
    const keys = Object.keys(days);
    if (keys.length <= 7) return plan; // already clean, skip work

    // Build the valid 7-day key set from the plan's declared week string
    const weekStart = (typeof plan.week === 'string' && plan.week)
      ? plan.week
      : DateUtils.weekStart(keys.slice().sort()[0] || DateUtils.today());
    const validKeys = new Set(DateUtils.weekKeys(weekStart));
    const filteredDays = {};
    keys.forEach(k => { if (validKeys.has(k)) filteredDays[k] = days[k]; });

    // If the week string was stale and filtered everything out, fall back to the
    // 7 most-recent date keys — still far better than retaining all 13.
    if (!Object.keys(filteredDays).length) {
      keys.slice().sort().slice(-7).forEach(k => { filteredDays[k] = days[k]; });
    }

    return { ...plan, days: filteredDays };
  }

  function mergePlan(currentPlan, incomingPlan) {
    if (!incomingPlan || typeof incomingPlan !== 'object') return currentPlan || null;
    if (!currentPlan || typeof currentPlan !== 'object') {
      // Don't import a seed plan onto a blank device — return null so the device
      // generates its own placeholder rather than inheriting a Drive seed.
      if (incomingPlan.seedDefault === true) return null;
      return JSON.parse(JSON.stringify(incomingPlan));
    }

    // Seed/fallback plans are local placeholders only — never let one replace a
    // real plan in either direction.
    if (incomingPlan.seedDefault === true) return currentPlan;
    if (currentPlan.seedDefault === true)  return JSON.parse(JSON.stringify(incomingPlan));

    // Sanitize both plans up-front — repairs corruption from the pre-planId merge bug.
    // A Drive file saved before planId was introduced may still contain 13 days; this
    // trims it to the 7 days that belong to its declared week before we ever compare.
    currentPlan  = sanitizePlanDays(currentPlan);
    incomingPlan = sanitizePlanDays(incomingPlan);

    const currentDays = currentPlan.days && typeof currentPlan.days === 'object' ? currentPlan.days : {};
    const incomingDays = incomingPlan.days && typeof incomingPlan.days === 'object' ? incomingPlan.days : {};

    // Detect plans that are different devotions. Three independent signals,
    // checked in order of reliability:
    //
    // Signal 0 — planId mismatch: strongest signal. Every plan generated after
    //            this update carries a unique planId. If both exist and differ,
    //            these are categorically different devotionals — never merge.
    // Signal 1 — explicit week string mismatch (fast path when both present)
    // Signal 2 — zero day-key overlap (date keys like "2026-02-24" never collide
    //            across different weeks, so no overlap = definitely different weeks)
    const currentId  = currentPlan.planId  || '';
    const incomingId = incomingPlan.planId || '';
    const idMismatch = !!(currentId && incomingId && currentId !== incomingId);

    const currentWeek  = currentPlan.week  || '';
    const incomingWeek = incomingPlan.week || '';
    const weekMismatch = currentWeek && incomingWeek && currentWeek !== incomingWeek;

    const currentKeys  = Object.keys(currentDays);
    const incomingKeys = Object.keys(incomingDays);
    const noKeyOverlap = currentKeys.length > 0 && incomingKeys.length > 0 &&
                         !currentKeys.some(k => Object.prototype.hasOwnProperty.call(incomingDays, k));

    if (idMismatch || weekMismatch || noKeyOverlap) {
      // Plans are definitively different devotions — never merge days.
      // Pick by the following priority:
      //
      // 1. Week recency — never let a plan for a PAST week replace one for the
      //    current or a future week. This is the key guard against stale Drive
      //    content clobbering an active local plan (e.g. the sanitised Drive plan
      //    ends up for last week after trimming, while local is this week).
      // 2. Later week wins (both in the future, or both in the past).
      // 3. createdAt tiebreak when effective weeks are equal, preferring local.
      const thisWeekStart = DateUtils.weekStart(DateUtils.today());

      // Derive each plan's effective week: use the .week field, or fall back to
      // the latest date key so we don't treat a missing field as "no week".
      const cWeek = currentPlan.week  || ([...currentKeys].sort().pop()  || '');
      const iWeek = incomingPlan.week || ([...incomingKeys].sort().pop() || '');

      if (cWeek && iWeek && cWeek !== iWeek) {
        const cIsCurrent = cWeek >= thisWeekStart;
        const iIsCurrent = iWeek >= thisWeekStart;

        // Local is current/future, Drive is past → always keep local
        if (cIsCurrent && !iIsCurrent) return currentPlan;
        // Drive is current/future, local is past → take Drive
        if (iIsCurrent && !cIsCurrent) return JSON.parse(JSON.stringify(incomingPlan));
        // Both current/future, or both past → prefer the later week
        return cWeek > iWeek
          ? currentPlan
          : JSON.parse(JSON.stringify(incomingPlan));
      }

      // Same effective week (or week info absent on one/both sides) —
      // prefer local unless Drive was clearly created more recently.
      const ct = new Date(currentPlan.createdAt  || 0).getTime();
      const it = new Date(incomingPlan.createdAt || 0).getTime();
      return it > ct ? JSON.parse(JSON.stringify(incomingPlan)) : currentPlan;
    }

    // Same week — merge, keeping local completions/edits when keys overlap.
    const mergedDays = { ...incomingDays, ...currentDays };
    const merged = {
      ...incomingPlan,
      ...currentPlan,
      days: mergedDays,
      sources: Array.isArray(currentPlan.sources) && currentPlan.sources.length
        ? currentPlan.sources
        : (Array.isArray(incomingPlan.sources) ? incomingPlan.sources : []),
    };
    // Final sanitize: guards against edge cases where same-week merge still
    // produces >7 days (e.g. start-of-week boundary overlap).
    return sanitizePlanDays(merged);
  }

  function importDevotionsSnapshot(snapshot = {}, options = {}) {
    if (snapshot && typeof snapshot === 'object' && snapshot.data && typeof snapshot.data === 'object') {
      snapshot = snapshot.data;
    }
    if (snapshot && typeof snapshot === 'object' && snapshot.devotions && typeof snapshot.devotions === 'object') {
      snapshot = snapshot.devotions;
    }
    const base = importSavedDevotionsSnapshot({
      savedDevotions: snapshot.savedDevotions,
      savedDevotionLibrary: snapshot.savedDevotionLibrary,
    }, {
      replace: options && options.replaceSaved === true,
    });

    const mergedPlan = mergePlan(_state.currentWeekPlan, snapshot.currentWeekPlan);
    if (mergedPlan) _state.currentWeekPlan = mergedPlan;

    if (!_state.selectedDevotionDate && snapshot.selectedDevotionDate) {
      _state.selectedDevotionDate = String(snapshot.selectedDevotionDate);
    }
    if (!_state._sessionOverride && snapshot.sessionOverride) {
      _state._sessionOverride = String(snapshot.sessionOverride);
    }

    save();
    return {
      ...base,
      importedPlanDays: Object.keys(snapshot.currentWeekPlan?.days || {}).length,
    };
  }

  function exportJournalSnapshot() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      journalEntries: _state.journalEntries || {},
    };
  }

  function exportAskBibleChatsSnapshot() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      askBibleChats: _state.askBibleChats || {},
    };
  }

  function importAskBibleChatsSnapshot(snapshot = {}) {
    const incomingChats = snapshot.askBibleChats && typeof snapshot.askBibleChats === 'object'
      ? snapshot.askBibleChats
      : {};
    const currentChats = _state.askBibleChats && typeof _state.askBibleChats === 'object'
      ? _state.askBibleChats
      : {};
    Object.entries(incomingChats).forEach(([chatId, chat]) => {
      const normalized = normalizeAskBibleChat(chat, chatId);
      if (!normalized) return;
      const existing = currentChats[normalized.id];
      const incomingStamp = String(normalized.updatedAt || normalized.savedAt || '');
      const existingStamp = String(existing?.updatedAt || existing?.savedAt || '');
      if (!existing || incomingStamp > existingStamp) {
        currentChats[normalized.id] = normalized;
      }
    });
    _state.askBibleChats = currentChats;
    save();
    return { importedAskBibleChats: Object.keys(incomingChats).length };
  }

  function importJournalSnapshot(snapshot = {}) {
    const incomingJournal = snapshot.journalEntries && typeof snapshot.journalEntries === 'object'
      ? snapshot.journalEntries
      : {};
    const currentJournal = _state.journalEntries && typeof _state.journalEntries === 'object'
      ? _state.journalEntries
      : {};
    Object.entries(incomingJournal).forEach(([dateKey, entry]) => {
      const existing = currentJournal[dateKey];
      const inSavedAt = String(entry?.savedAt || '');
      const exSavedAt = String(existing?.savedAt || '');
      if (!existing || inSavedAt > exSavedAt) {
        currentJournal[dateKey] = {
          prompt: String(entry?.prompt || ''),
          text: String(entry?.text || ''),
          savedAt: inSavedAt || new Date().toISOString(),
        };
      }
    });
    _state.journalEntries = currentJournal;
    save();
    return { importedJournal: Object.keys(incomingJournal).length };
  }

  function exportSettingsSnapshot() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        userName: _state.userName || '',
        bibleTranslation: _state.bibleTranslation || 'web',
        palette: _state.palette || 'mountain-mist',
        theme: _state.theme || 'auto',
        morningHour: _state.morningHour,
        morningMinute: _state.morningMinute,
        eveningHour: _state.eveningHour,
        eveningMinute: _state.eveningMinute,
        notificationsEnabled: !!_state.notificationsEnabled,
        sundayReminderEnabled: _state.sundayReminderEnabled !== false,
      },
      trustedPastors: getTrustedPastors(),
    };
  }

  function importSettingsSnapshot(snapshot = {}) {
    const s = snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings : {};
    const has = (key) => Object.prototype.hasOwnProperty.call(s, key);
    const normalizeHour = (value, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(0, Math.min(23, Math.round(n))) : fallback;
    };
    const normalizeMinute = (value, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(0, Math.min(59, Math.round(n))) : fallback;
    };

    const merged = {
      userName: has('userName') && String(s.userName || '').trim()
        ? String(s.userName || '').trim()
        : (_state.userName || ''),
      bibleTranslation: has('bibleTranslation') && s.bibleTranslation
        ? String(s.bibleTranslation || 'web').toLowerCase()
        : (_state.bibleTranslation || 'web'),
      palette: has('palette') && s.palette
        ? String(s.palette || 'mountain-mist')
        : (_state.palette || 'mountain-mist'),
      theme: has('theme') && s.theme
        ? String(s.theme || 'auto')
        : (_state.theme || 'auto'),
      morningHour: has('morningHour')
        ? normalizeHour(s.morningHour, Number(_state.morningHour || 6))
        : Number(_state.morningHour || 6),
      morningMinute: has('morningMinute')
        ? normalizeMinute(s.morningMinute, Number(_state.morningMinute || 30))
        : Number(_state.morningMinute || 30),
      eveningHour: has('eveningHour')
        ? normalizeHour(s.eveningHour, Number(_state.eveningHour || 20))
        : Number(_state.eveningHour || 20),
      eveningMinute: has('eveningMinute')
        ? normalizeMinute(s.eveningMinute, Number(_state.eveningMinute || 0))
        : Number(_state.eveningMinute || 0),
      notificationsEnabled: has('notificationsEnabled')
        ? !!s.notificationsEnabled
        : !!_state.notificationsEnabled,
      sundayReminderEnabled: has('sundayReminderEnabled')
        ? s.sundayReminderEnabled !== false
        : _state.sundayReminderEnabled !== false,
    };
    Object.assign(_state, merged);

    if (Array.isArray(snapshot.trustedPastors) && snapshot.trustedPastors.length) {
      // Preserve locally-added pastors/flags first, then merge in Drive pastors.
      _state.trustedPastors = normalizeTrustedPastors([...getTrustedPastors(), ...(snapshot.trustedPastors || [])]);
    }
    save();
    return { importedSettings: true, importedPastors: Array.isArray(snapshot.trustedPastors) ? snapshot.trustedPastors.length : 0 };
  }

  // --- Pastors ---
  function getTrustedPastors() {
    return normalizeTrustedPastors(_state.trustedPastors);
  }

  function setTrustedPastors(pastors) {
    _state.trustedPastors = normalizeTrustedPastors(pastors);
    save();
  }

  // --- Usage tracking ---
  function trackUsage(metric, amount = 1) {
    if (!_state) load();
    ensureUsageState();
    if (!USAGE_METRICS.includes(metric)) return;
    const inc = Number(amount) || 1;
    _state.usageStats[metric] = Math.max(0, (_state.usageStats[metric] || 0) + inc);
    save();
  }

  function getUsageStats() {
    if (!_state) load();
    ensureUsageState();
    return { ..._state.usageStats };
  }

  function getUsageLimits() {
    if (!_state) load();
    ensureUsageState();
    return { ..._state.usageLimits };
  }

  function setUsageLimits(limits = {}) {
    if (!_state) load();
    _state.usageLimits = normalizeUsageLimits({ ..._state.usageLimits, ...limits });
    save();
  }

  function resetUsageStats() {
    if (!_state) load();
    _state.usageStats = normalizeUsageStats({ monthKey: '' });
    save();
  }

  // --- Verse Highlights ---

  function getVerseHighlights() {
    if (!_state) load();
    return _state.verseHighlights && typeof _state.verseHighlights === 'object'
      ? _state.verseHighlights : {};
  }

  function setVerseHighlight(verseKey, color, note = '') {
    if (!_state) load();
    if (!_state.verseHighlights) _state.verseHighlights = {};
    if (!color) {
      delete _state.verseHighlights[verseKey];
    } else {
      _state.verseHighlights[verseKey] = { color, note: String(note || '') };
    }
    save();
  }

  function clearVerseHighlight(verseKey) {
    if (!_state) load();
    if (_state.verseHighlights) delete _state.verseHighlights[verseKey];
    save();
  }

  // --- Reading Progress ---

  function getReadingProgress() {
    if (!_state) load();
    return _state.readingProgress && typeof _state.readingProgress === 'object'
      ? _state.readingProgress : {};
  }

  function markChapterRead(bookName, chapter) {
    if (!_state) load();
    if (!_state.readingProgress) _state.readingProgress = {};
    const key = String(bookName).trim();
    if (!Array.isArray(_state.readingProgress[key])) _state.readingProgress[key] = [];
    const ch = parseInt(chapter);
    if (!isNaN(ch) && !_state.readingProgress[key].includes(ch)) {
      _state.readingProgress[key].push(ch);
      _state.readingProgress[key].sort((a, b) => a - b);
      save();
    }
  }

  // --- Verse Highlights sync snapshots ---

  function exportHighlightsSnapshot() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      verseHighlights: getVerseHighlights(),
    };
  }

  function importHighlightsSnapshot(snapshot = {}) {
    if (!_state) load();
    const incoming = snapshot.verseHighlights && typeof snapshot.verseHighlights === 'object'
      ? snapshot.verseHighlights : {};
    const existing = _state.verseHighlights && typeof _state.verseHighlights === 'object'
      ? _state.verseHighlights : {};
    // Union merge — remote wins on conflicts (more recent sync wins)
    _state.verseHighlights = { ...existing, ...incoming };
    save();
    return { imported: Object.keys(incoming).length };
  }

  // --- Reading Progress sync snapshots ---

  function exportProgressSnapshot() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      readingProgress: getReadingProgress(),
    };
  }

  function importProgressSnapshot(snapshot = {}) {
    if (!_state) load();
    const incoming = snapshot.readingProgress && typeof snapshot.readingProgress === 'object'
      ? snapshot.readingProgress : {};
    if (!_state.readingProgress || typeof _state.readingProgress !== 'object') {
      _state.readingProgress = {};
    }
    // Union merge — combine chapter arrays, never lose locally-read chapters
    Object.entries(incoming).forEach(([book, chapters]) => {
      if (!Array.isArray(chapters)) return;
      if (!Array.isArray(_state.readingProgress[book])) _state.readingProgress[book] = [];
      chapters.forEach(ch => {
        const n = parseInt(ch);
        if (!isNaN(n) && !_state.readingProgress[book].includes(n)) {
          _state.readingProgress[book].push(n);
        }
      });
      _state.readingProgress[book].sort((a, b) => a - b);
    });
    save();
    return { imported: Object.keys(incoming).length };
  }

  // Initialize
  load();

  return {
    get,
    set,
    update,
    updateStreak,
    markCompleted,
    isCompleted,
    saveJournalEntry,
    deleteJournalEntry,
    getJournalEntry,
    getRecentJournalEntries,
    getAllJournalEntries,
    saveAskBibleChat,
    getAskBibleChat,
    getAllAskBibleChats,
    deleteAskBibleChat,
    savePlan,
    queuePlanForDate,
    getPendingPlanInfo,
    hasPlanHistory,
    restorePreviousPlan,
    getPlan,
    getPlanDayKeys,
    getDevotionData,
    getSelectedDevotionDate,
    setSelectedDevotionDate,
    shiftSelectedDevotionDay,
    getTodayDevotionData,
    toggleSavedDevotion,
    saveDevotion,
    saveEntirePlan,
    isSavedDevotion,
    deleteSavedDevotionById,
    deleteSavedDevotionsByIds,
    getSavedDevotionLibrary,
    getSavedDevotionById,
    exportSavedDevotionsSnapshot,
    importSavedDevotionsSnapshot,
    useSavedSeries,
    exportDevotionsSnapshot,
    importDevotionsSnapshot,
    exportPlanSnapshot,
    importPlanSnapshot,
    exportJournalSnapshot,
    importJournalSnapshot,
    exportAskBibleChatsSnapshot,
    importAskBibleChatsSnapshot,
    exportSettingsSnapshot,
    importSettingsSnapshot,
    getTrustedPastors,
    setTrustedPastors,
    getVerseHighlights,
    setVerseHighlight,
    clearVerseHighlight,
    getReadingProgress,
    markChapterRead,
    exportHighlightsSnapshot,
    importHighlightsSnapshot,
    exportProgressSnapshot,
    importProgressSnapshot,
    trackUsage,
    getUsageStats,
    getUsageLimits,
    setUsageLimits,
    resetUsageStats,
    load,
  };
})();

window.Store = Store;
