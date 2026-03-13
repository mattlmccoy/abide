/* ============================================================
   ABIDE - Google Drive Sync (Saved Devotions + Journal)
   ============================================================ */

const Sync = (() => {
  const LEGACY_FILE_NAME = 'abide-saved-devotions.json';
  const DEVOTIONS_FILE_NAME = 'abide-devotions.json';
  const JOURNALS_FILE_NAME = 'abide-journals.json';
  const ASK_CHATS_FILE_NAME = 'abide-ask-chats.json';
  const SETTINGS_FILE_NAME = 'abide-settings.json';
  const HIGHLIGHTS_FILE_NAME = 'abide-highlights.json';
  const PROGRESS_FILE_NAME = 'abide-progress.json';
  const PLAN_FILE_NAME = 'abide-plan.json';
  const SHARES_FOLDER_NAME = 'abide-shares';
  const FOLDER_NAME = 'abidefaith-docs';
  const LEGACY_FOLDER_NAMES = ['abide-devotions', 'abide-devotions-docs', 'abidefaith'];
  const DEVOTIONS_FILE_CANDIDATES = [DEVOTIONS_FILE_NAME, 'abide-devotions', LEGACY_FILE_NAME, 'abide-saved-devotions'];
  const JOURNALS_FILE_CANDIDATES = [JOURNALS_FILE_NAME, 'abide-journals'];
  const ASK_CHATS_FILE_CANDIDATES = [ASK_CHATS_FILE_NAME, 'abide-ask-chats'];
  const SETTINGS_FILE_CANDIDATES = [SETTINGS_FILE_NAME, 'abide-settings'];
  const HIGHLIGHTS_FILE_CANDIDATES = [HIGHLIGHTS_FILE_NAME, 'abide-highlights'];
  const PROGRESS_FILE_CANDIDATES = [PROGRESS_FILE_NAME, 'abide-progress'];
  const PLAN_FILE_CANDIDATES = [PLAN_FILE_NAME, 'abide-plan'];
  const LEGACY_SNAPSHOT_FILE_CANDIDATES = [LEGACY_FILE_NAME, 'abide-saved-devotions', 'abide-devotions.json', 'abide-devotions'];
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const PROFILE_SCOPE = 'openid email profile';
  const DEFAULT_GOOGLE_CLIENT_ID = '1098652353842-ve34jqhnsqda5v9n1d7455n2kka9k0ek.apps.googleusercontent.com';
  let _accessToken = '';
  let _accessTokenExpiresAt = 0;
  let _tokenClient = null;
  let _googleScriptPromise = null;

  function hasGoogleClient() {
    return !!window.google?.accounts?.oauth2;
  }

  function loadGoogleScript() {
    if (hasGoogleClient()) return Promise.resolve();
    if (_googleScriptPromise) return _googleScriptPromise;

    _googleScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-google-gsi="1"]');
      if (existing) {
        const start = Date.now();
        const timer = setInterval(() => {
          if (hasGoogleClient()) {
            clearInterval(timer);
            resolve();
            return;
          }
          if (Date.now() - start > 8000) {
            clearInterval(timer);
            reject(new Error('Google Sign-In script not loaded'));
          }
        }, 120);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleGsi = '1';
      script.onload = () => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (hasGoogleClient()) {
            clearInterval(timer);
            resolve();
            return;
          }
          if (Date.now() - start > 8000) {
            clearInterval(timer);
            reject(new Error('Google Sign-In script not loaded'));
          }
        }, 120);
      };
      script.onerror = () => reject(new Error('Could not load Google Sign-In script'));
      document.head.appendChild(script);
    }).finally(() => {
      if (hasGoogleClient()) return;
      _googleScriptPromise = null;
    });

    return _googleScriptPromise;
  }

  function getClientId() {
    return (Store.get('googleClientId') || DEFAULT_GOOGLE_CLIENT_ID || '').trim();
  }

  async function ensureClientConfig() {
    const clientId = getClientId();
    if (!clientId) throw new Error('Missing Google Client ID in Settings → Advanced');
    if (!hasGoogleClient()) await loadGoogleScript();
    if (!hasGoogleClient()) throw new Error('Google Sign-In script not loaded');
    return clientId;
  }

  async function requestToken(interactive = true) {
    if (_accessToken && Date.now() < (_accessTokenExpiresAt - 30_000)) return _accessToken;

    // Fail fast when offline — Google Identity Services callbacks hang indefinitely
    // without network connectivity, causing the UI to freeze with no feedback.
    if (!navigator.onLine) {
      throw Object.assign(
        new Error('No internet connection. Connect to sync.'),
        { code: 'OFFLINE' }
      );
    }

    const clientId = await ensureClientConfig();

    if (!_tokenClient) {
      _tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: `${DRIVE_SCOPE} ${PROFILE_SCOPE}`,
        callback: () => {},
      });
    }

    // Wrap a token request Promise with a 12-second timeout. When the network is
    // degraded (but technically "online"), GIS callbacks can silently never fire.
    function withTimeout(promiseFn) {
      return Promise.race([
        new Promise(promiseFn),
        new Promise((_, reject) =>
          setTimeout(() =>
            reject(Object.assign(
              new Error('Sync timed out. Check your connection and try again.'),
              { code: 'OFFLINE' }
            )), 12_000)
        ),
      ]);
    }

    // Try silent refresh first to avoid unnecessary consent prompts.
    // If silent fails (no active Google session), fall back to interactive.
    if (interactive) {
      try {
        const silentToken = await withTimeout((resolve, reject) => {
          _tokenClient.callback = (resp) => {
            if (resp?.error) return reject(new Error(resp.error));
            if (!resp?.access_token) return reject(new Error('No access token'));
            resolve(resp);
          };
          _tokenClient.requestAccessToken({ prompt: '' });
        });
        _accessToken = silentToken.access_token;
        _accessTokenExpiresAt = Date.now() + (Number(silentToken.expires_in || 3600) * 1000);
        return _accessToken;
      } catch (err) {
        if (err.code === 'OFFLINE') throw err; // don't try interactive when offline/timed-out
        // Silent failed — fall through to interactive below
      }
    }

    const token = await withTimeout((resolve, reject) => {
      _tokenClient.callback = (resp) => {
        if (resp?.error) return reject(new Error(resp.error));
        if (!resp?.access_token) return reject(new Error('No access token returned'));
        resolve(resp);
      };
      _tokenClient.requestAccessToken({ prompt: interactive ? 'select_account' : '' });
    });

    _accessToken = token.access_token;
    _accessTokenExpiresAt = Date.now() + (Number(token.expires_in || 3600) * 1000);
    return _accessToken;
  }

  function clearToken() {
    _accessToken = '';
    _accessTokenExpiresAt = 0;
  }

  async function driveFetch(url, options = {}, retry = true) {
    const token = await requestToken(true);
    const headers = {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    };
    const res = await fetch(url, { ...options, headers });
    if ((res.status === 401 || res.status === 403) && retry) {
      clearToken();
      return driveFetch(url, options, false);
    }
    if ((res.status === 401 || res.status === 403) && !retry) {
      // Both attempts failed — Google session is fully expired.
      // Tag the error so callers can show a reconnect prompt.
      clearSession();
      throw Object.assign(
        new Error('Google session expired. Please reconnect your account.'),
        { code: 'AUTH_EXPIRED' }
      );
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Drive API ${res.status}: ${body.slice(0, 180)}`);
    }
    return res;
  }

  async function fetchGoogleProfile() {
    const token = await requestToken(true);
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google profile fetch failed: ${res.status} ${body.slice(0, 120)}`);
    }
    const profile = await res.json();
    const normalized = {
      sub: profile.sub || '',
      email: profile.email || '',
      name: profile.name || '',
      picture: profile.picture || '',
    };
    const patch = {
      googleProfile: normalized,
      googleConnectedAt: new Date().toISOString(),
    };
    const firstName = extractFirstName(normalized.name, normalized.email);
    if (firstName) patch.userName = firstName;
    Store.update(patch);
    return normalized;
  }

  function extractFirstName(fullName = '', email = '') {
    const cleanName = String(fullName || '').trim();
    if (cleanName) {
      const first = cleanName.split(/\s+/)[0] || '';
      return first.trim();
    }
    const local = String(email || '').split('@')[0] || '';
    return local.trim();
  }

  async function connectGoogle() {
    await requestToken(true);
    return fetchGoogleProfile();
  }

  async function ensureGoogleClient() {
    await ensureClientConfig();
    return true;
  }

  function escapeQueryValue(value = '') {
    return String(value).replace(/'/g, "\\'");
  }

  async function findFolderId() {
    const q = encodeURIComponent(
      `name='${escapeQueryValue(FOLDER_NAME)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime)&pageSize=1&orderBy=modifiedTime desc`;
    const res = await driveFetch(url);
    const data = await res.json();
    return data?.files?.[0]?.id || '';
  }

  async function findFolderIdByName(folderName) {
    const q = encodeURIComponent(
      `name='${escapeQueryValue(folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime)&pageSize=1&orderBy=modifiedTime desc`;
    const res = await driveFetch(url);
    const data = await res.json();
    return data?.files?.[0]?.id || '';
  }

  async function createFolder() {
    const metadata = {
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    };
    const res = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(metadata),
    });
    const data = await res.json();
    return data?.id || '';
  }

  async function findOrCreateFolderId() {
    // Always do a fresh Drive search first so we never pass a stale cached folder
    // ID into file operations (which would get a 403 → false AUTH_EXPIRED error).
    // The drive.file scope means the search returns only folders this app created,
    // so the result is always authoritative and safe to use as the parent for writes.
    let folderId = await findFolderId();
    if (!folderId) folderId = await createFolder();
    if (folderId) Store.update({ googleDriveFolderId: folderId });
    return folderId;
  }

  async function findSubfolderId(parentFolderId, folderName) {
    if (!parentFolderId || !folderName) return '';
    const q = encodeURIComponent(
      `name='${escapeQueryValue(folderName)}' and '${escapeQueryValue(parentFolderId)}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime)&pageSize=1&orderBy=modifiedTime desc`;
    const res = await driveFetch(url);
    const data = await res.json();
    return data?.files?.[0]?.id || '';
  }

  async function createSubfolder(parentFolderId, folderName) {
    const metadata = {
      name: folderName,
      parents: [parentFolderId],
      mimeType: 'application/vnd.google-apps.folder',
    };
    const res = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(metadata),
    });
    const data = await res.json();
    return data?.id || '';
  }

  async function findOrCreateSharesFolderId(rootFolderId) {
    let shareFolderId = String((Store.get('googleDriveFiles') || {}).shares || '').trim();
    if (shareFolderId) return shareFolderId;
    shareFolderId = await findSubfolderId(rootFolderId, SHARES_FOLDER_NAME);
    if (!shareFolderId) shareFolderId = await createSubfolder(rootFolderId, SHARES_FOLDER_NAME);
    if (shareFolderId) {
      const files = Store.get('googleDriveFiles') || {};
      Store.update({
        googleDriveFiles: {
          devotions: String(files.devotions || ''),
          journals: String(files.journals || ''),
          settings: String(files.settings || ''),
          shares: shareFolderId,
          askChats: String(files.askChats || ''),
          highlights: String(files.highlights || ''),
          progress: String(files.progress || ''),
          plan: String(files.plan || ''),
        },
      });
    }
    return shareFolderId;
  }

  async function findExistingFolderId() {
    let folderId = (Store.get('googleDriveFolderId') || '').trim();
    if (!folderId) folderId = await findFolderId();
    if (!folderId) {
      for (const name of LEGACY_FOLDER_NAMES) {
        folderId = await findFolderIdByName(name);
        if (folderId) break;
      }
    }
    if (folderId) Store.update({ googleDriveFolderId: folderId });
    return folderId;
  }

  async function findLegacyFolderIds() {
    const found = [];
    for (const name of LEGACY_FOLDER_NAMES) {
      const folderId = await findFolderIdByName(name);
      if (folderId && !found.includes(folderId)) found.push(folderId);
    }
    return found;
  }

  async function findFileIdByName(folderId, fileName) {
    if (!folderId) return '';
    const q = encodeURIComponent(
      `name='${escapeQueryValue(fileName)}' and '${escapeQueryValue(folderId)}' in parents and trashed=false`
    );
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime)&pageSize=1&orderBy=modifiedTime desc`;
    const res = await driveFetch(url);
    const data = await res.json();
    return data?.files?.[0]?.id || '';
  }

  async function findAnyFileIdByNames(folderId, names = []) {
    for (const name of names) {
      const fileId = await findFileIdByName(folderId, name);
      if (fileId) return { fileId, fileName: name };
    }
    return { fileId: '', fileName: '' };
  }

  async function createFile(jsonBody, folderId, fileName) {
    const boundary = 'abide_boundary_' + Date.now();
    const metadata = {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/json',
    };
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(jsonBody),
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const res = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    const data = await res.json();
    return data?.id || '';
  }

  async function updateFile(fileId, jsonBody) {
    const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`;
    await driveFetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(jsonBody),
    });
    return fileId;
  }

  async function readJsonFileById(fileId) {
    if (!fileId) return { found: false, fileId: '', fileName: '', data: null };
    try {
      const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
      const res = await driveFetch(url);
      const contentType = String(res.headers.get('content-type') || '').toLowerCase();
      const raw = contentType.includes('application/json')
        ? await res.json()
        : await res.text();
      const data = normalizeJsonPayload(raw);
      return { found: true, fileId, fileName: '', data };
    } catch (_) {
      return { found: false, fileId: '', fileName: '', data: null };
    }
  }

  async function upsertJsonFile(folderId, fileName, jsonBody, preferredFileId = '') {
    let fileId = String(preferredFileId || '').trim();
    if (fileId) {
      try {
        await updateFile(fileId, jsonBody);
        return fileId;
      } catch (_) {
        fileId = '';
      }
    }
    fileId = await findFileIdByName(folderId, fileName);
    if (fileId) {
      await updateFile(fileId, jsonBody);
      return fileId;
    }
    return createFile(jsonBody, folderId, fileName);
  }

  async function readJsonFile(folderId, fileName) {
    const fileId = await findFileIdByName(folderId, fileName);
    if (!fileId) return { found: false, fileId: '', data: null };
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await driveFetch(url);
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const raw = contentType.includes('application/json') ? await res.json() : await res.text();
    const data = normalizeJsonPayload(raw);
    return { found: true, fileId, data };
  }

  function normalizeJsonPayload(data) {
    let value = data;
    for (let i = 0; i < 2; i += 1) {
      if (typeof value !== 'string') break;
      const trimmed = value.trim();
      if (!trimmed) break;
      try {
        value = JSON.parse(trimmed);
      } catch {
        break;
      }
    }
    return value;
  }

  async function readJsonFileByCandidates(folderId, fileNames = []) {
    const { fileId, fileName } = await findAnyFileIdByNames(folderId, fileNames);
    if (!fileId) return { found: false, fileId: '', fileName: '', data: null };
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await driveFetch(url);
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const raw = contentType.includes('application/json') ? await res.json() : await res.text();
    return {
      found: true,
      fileId,
      fileName,
      data: normalizeJsonPayload(raw),
    };
  }

  function parseDriveShareReference(linkOrId = '') {
    const value = String(linkOrId || '').trim();
    if (!value) return { fileId: '', resourceKey: '' };
    if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return { fileId: value, resourceKey: '' };
    let resourceKey = '';
    try {
      const u = new URL(value);
      resourceKey = String(u.searchParams.get('resourcekey') || u.searchParams.get('resourceKey') || '').trim();
    } catch (_) {}
    const patterns = [
      /\/d\/([A-Za-z0-9_-]{20,})/i,
      /[?&]id=([A-Za-z0-9_-]{20,})/i,
      /\/file\/d\/([A-Za-z0-9_-]{20,})/i,
    ];
    for (const re of patterns) {
      const match = value.match(re);
      if (match?.[1]) return { fileId: match[1], resourceKey };
    }
    return { fileId: '', resourceKey };
  }

  async function getFileLinks(fileId) {
    const fields = encodeURIComponent('id,name,webViewLink,webContentLink,resourceKey');
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${fields}`;
    const res = await driveFetch(url);
    return res.json();
  }

  async function setAnyoneReaderPermission(fileId) {
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false`;
    await driveFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
      }),
    });
  }

  function slugify(value = '') {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48);
  }

  function entryToSavedShape(entry = {}) {
    const devotionData = entry.devotionData && typeof entry.devotionData === 'object' ? entry.devotionData : {};
    const session = entry.session === 'evening' ? 'evening' : 'morning';
    const sessionData = devotionData?.[session] || {};
    const id = String(entry.id || `${entry.dateKey || DateUtils.today()}-${session}`);
    const weekKey = String(entry.weekKey || DateUtils.weekStart(entry.dateKey || DateUtils.today()));
    const seriesTheme = String(
      entry.seriesTheme
      || devotionData.seriesTheme
      || entry.theme
      || devotionData.theme
      || ''
    ).trim();
    const dayTheme = String(entry.dayTheme || devotionData.dayTheme || '').trim();
    return {
      id,
      dateKey: String(entry.dateKey || DateUtils.today()),
      session,
      savedAt: String(entry.savedAt || new Date().toISOString()),
      weekKey,
      seriesId: String(entry.seriesId || devotionData.seriesId || ''),
      seriesTheme,
      dayTheme,
      theme: seriesTheme || dayTheme || '',
      title: String(entry.title || sessionData.title || ''),
      openingVerse: sessionData.opening_verse || entry.openingVerse || null,
      body: Array.isArray(sessionData.body) && sessionData.body.length ? sessionData.body : (Array.isArray(entry.body) ? entry.body : []),
      reflectionPrompts: Array.isArray(sessionData.reflection_prompts) && sessionData.reflection_prompts.length
        ? sessionData.reflection_prompts
        : (Array.isArray(entry.reflectionPrompts) ? entry.reflectionPrompts : []),
      prayer: String(sessionData.prayer || entry.prayer || ''),
      inspiredBy: Array.isArray(sessionData.inspired_by) && sessionData.inspired_by.length
        ? sessionData.inspired_by
        : (Array.isArray(entry.inspiredBy) ? entry.inspiredBy : []),
      devotionData: {
        theme: seriesTheme || dayTheme || '',
        seriesId: String(entry.seriesId || devotionData.seriesId || ''),
        seriesTheme,
        dayTheme,
        sources: Array.isArray(devotionData.sources) ? devotionData.sources : [],
        faith_stretch: devotionData.faith_stretch || null,
        morning: devotionData.morning || null,
        evening: devotionData.evening || null,
      },
    };
  }

  function normalizeShareEntries(entries = []) {
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => entryToSavedShape(entry));
  }

  function buildCurrentWeekShareEntries() {
    const plan = Store.getPlan();
    const days = plan?.days && typeof plan.days === 'object' ? plan.days : {};
    const dayKeys = Object.keys(days).sort((a, b) => a.localeCompare(b));
    const entries = [];

    dayKeys.forEach((dateKey) => {
      const day = days[dateKey] || {};
      ['morning', 'evening'].forEach((session) => {
        const sessionData = day?.[session];
        if (!sessionData) return;
        entries.push(entryToSavedShape({
          id: `${dateKey}-${session}`,
          dateKey,
          weekKey: DateUtils.weekStart(dateKey),
          seriesTheme: plan?.theme || day.theme || '',
          dayTheme: day.theme || '',
          session,
          theme: plan?.theme || day.theme || '',
          title: sessionData.title || '',
          openingVerse: sessionData.opening_verse || null,
          body: Array.isArray(sessionData.body) ? sessionData.body : [],
          reflectionPrompts: Array.isArray(sessionData.reflection_prompts) ? sessionData.reflection_prompts : [],
          prayer: sessionData.prayer || '',
          inspiredBy: Array.isArray(sessionData.inspired_by) ? sessionData.inspired_by : [],
          devotionData: {
            theme: day.theme || plan?.theme || '',
            sources: Array.isArray(day.sources) ? day.sources : [],
            faith_stretch: day.faith_stretch || null,
            morning: day.morning || null,
            evening: day.evening || null,
          },
        }));
      });
    });

    return entries;
  }

  async function createSharedSeriesLink(series = {}) {
    const rootFolderId = await findOrCreateFolderId();
    if (!rootFolderId) throw new Error('Could not create/find Google Drive folder');
    const sharesFolderId = await findOrCreateSharesFolderId(rootFolderId);
    if (!sharesFolderId) throw new Error('Could not create/find share folder');

    const profile = Store.get('googleProfile') || {};
    const entries = normalizeShareEntries(series.entries || []);
    if (!entries.length) throw new Error('No devotion entries found for this series');

    const weekKey = String(series.weekKey || DateUtils.weekStart(entries[0].dateKey || DateUtils.today()));
    const theme = String(series.theme || entries[0].theme || 'Shared Week').trim() || 'Shared Week';
    const seriesSlug = slugify(`${weekKey}-${theme}`) || `week-${weekKey}`;
    const fileName = `abide-share-week-${seriesSlug}.json`;

    const payload = {
      type: 'abide-shared-series',
      version: 2,
      sharedAt: new Date().toISOString(),
      from: {
        name: profile.name || '',
        email: profile.email || '',
        sub: profile.sub || '',
      },
      series: {
        id: String(series.id || `${weekKey}::${theme.toLowerCase()}`),
        weekKey,
        theme,
        entryCount: entries.length,
      },
      entries,
    };

    const fileId = await upsertJsonFile(sharesFolderId, fileName, payload);
    if (!fileId) throw new Error('Could not create shared series file');
    await setAnyoneReaderPermission(fileId);
    const links = await getFileLinks(fileId);

    const resourceKey = String(links.resourceKey || '').trim();
    const canonicalShareUrl = `https://drive.google.com/file/d/${fileId}/view${resourceKey ? `?resourcekey=${encodeURIComponent(resourceKey)}` : ''}`;
    return {
      fileId,
      fileName,
      shareUrl: canonicalShareUrl || links.webViewLink || links.webContentLink || `https://drive.google.com/file/d/${fileId}/view`,
    };
  }

  async function createSharedCurrentWeekLink() {
    const entries = buildCurrentWeekShareEntries();
    if (!entries.length) throw new Error('No weekly devotion plan available to share yet');
    const firstDate = entries[0].dateKey || DateUtils.today();
    const plan = Store.getPlan() || {};
    return createSharedSeriesLink({
      id: `${DateUtils.weekStart(firstDate)}::${String(plan.theme || entries[0].theme || 'shared').toLowerCase()}`,
      weekKey: DateUtils.weekStart(firstDate),
      theme: String(plan.theme || entries[0].theme || 'Shared Week'),
      entries,
    });
  }

  async function createSharedDevotionLink(entry = {}) {
    const normalized = entryToSavedShape(entry || {});
    return createSharedSeriesLink({
      id: `${DateUtils.weekStart(normalized.dateKey)}::${String(normalized.theme || 'shared').toLowerCase()}`,
      weekKey: DateUtils.weekStart(normalized.dateKey),
      theme: normalized.theme || 'Shared Week',
      entries: [normalized],
    });
  }

  async function importSharedDevotion(linkOrId = '') {
    const { fileId, resourceKey } = parseDriveShareReference(linkOrId);
    if (!fileId) throw new Error('Could not parse a Google Drive file ID from that link');

    // ── Strategy 1: Route through the Cloudflare Worker as a server-side proxy.
    // The Worker fetches the file without any user OAuth token, which is the only
    // reliable way to read files from another user's Drive when using
    // "Anyone with the link" permission (Drive API v3 cross-account reads are
    // blocked even for public files when the recipient's own token is attached).
    let payload = null;
    const DEFAULT_WORKER = 'https://abide-worker.mattlmccoy.workers.dev';
    const workerBase = String(Store.get('workerUrl') || DEFAULT_WORKER).replace(/\/$/, '');

    try {
      const proxyRes = await fetch(`${workerBase}/drive/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, resourceKey: resourceKey || undefined }),
      });
      if (proxyRes.ok) {
        const data = await proxyRes.json();
        if (data && typeof data === 'object' && !data.error) {
          payload = data;
        }
      }
    } catch (_) {}

    // ── Strategy 2: Direct unauthenticated fetch (no Drive API, no OAuth).
    // Works if the browser isn't blocking cross-origin and Google serves the file.
    if (!payload) {
      const publicUrls = [
        `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download${resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : ''}`,
        `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}${resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : ''}`,
      ];
      for (const u of publicUrls) {
        try {
          const r = await fetch(u, { method: 'GET' });
          if (!r.ok) continue;
          const ct = String(r.headers.get('content-type') || '');
          if (ct.includes('text/html')) continue; // login redirect
          payload = normalizeJsonPayload(await r.text());
          if (payload && typeof payload === 'object') break;
          payload = null;
        } catch (_) {}
      }
    }

    // ── Strategy 3: Authenticated Drive API (only works if recipient happens to
    // have access, e.g. same Google Workspace domain or explicit share).
    if (!payload) {
      try {
        const rkParam = resourceKey ? `&resourceKey=${encodeURIComponent(resourceKey)}` : '';
        const apiUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true${rkParam}`;
        const res = await driveFetch(apiUrl);
        payload = normalizeJsonPayload(await res.text());
      } catch (_) {}
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error(
        'Could not access the shared file. Make sure the sender shared it with "Anyone with the link" access, then try again.'
      );
    }

    let entries = [];
    let shareMeta = {};
    if (payload.type === 'abide-shared-series' && Array.isArray(payload.entries)) {
      entries = payload.entries;
      shareMeta = payload.series || {};
    } else if (payload.type === 'abide-shared-devotion' && payload.entry && typeof payload.entry === 'object') {
      entries = [payload.entry];
    } else if (payload.devotion && typeof payload.devotion === 'object') {
      entries = [payload.devotion];
    } else if (payload.id && typeof payload === 'object') {
      entries = [payload];
    }

    if (!entries.length) throw new Error('This file is not a supported shared devotional format');
    const normalizedEntries = normalizeShareEntries(entries).map((entry, index) => {
      const baseId = String(entry.id || `${entry.dateKey || DateUtils.today()}-${entry.session || 'morning'}`);
      const hasExisting = !!Store.getSavedDevotionById(baseId);
      const safeId = hasExisting ? `${baseId}-shared-${fileId.slice(-6)}-${index + 1}` : baseId;
      return { ...entry, id: safeId, importedFromShare: fileId };
    });
    const ids = normalizedEntries.map((entry) => entry.id);
    const lib = {};
    normalizedEntries.forEach((entry) => { lib[entry.id] = entry; });

    Store.importSavedDevotionsSnapshot({
      savedDevotions: ids,
      savedDevotionLibrary: lib,
    });

    return {
      imported: true,
      id: ids[0] || '',
      importedCount: ids.length,
      fileId,
      title: String(shareMeta.theme || normalizedEntries[0]?.title || normalizedEntries[0]?.openingVerse?.reference || 'Shared devotion'),
      from: payload.from || null,
    };
  }

  async function pushSavedDevotions() {
    const devotions = Store.exportDevotionsSnapshot();
    const journals = Store.exportJournalSnapshot();
    const askChats = Store.exportAskBibleChatsSnapshot();
    const settings = Store.exportSettingsSnapshot();
    const highlights = Store.exportHighlightsSnapshot();
    const progress = Store.exportProgressSnapshot();
    // Plan is now its own file — current week plan changes weekly but the devotion
    // archive grows forever, so keeping them separate avoids re-uploading the full
    // history on every new plan generation.
    const plan = Store.exportPlanSnapshot();
    const folderId = await findOrCreateFolderId();
    if (!folderId) throw new Error('Could not create/find Google Drive folder');

    const state = Store.get();
    const knownFiles = state.googleDriveFiles || { devotions: '', journals: '', settings: '', shares: '', askChats: '', highlights: '', progress: '', plan: '' };
    const [devotionsFileId, journalsFileId, askChatsFileId, settingsFileId, highlightsFileId, progressFileId, planFileId] = await Promise.all([
      upsertJsonFile(folderId, DEVOTIONS_FILE_NAME, devotions, knownFiles.devotions || ''),
      upsertJsonFile(folderId, JOURNALS_FILE_NAME, journals, knownFiles.journals || ''),
      upsertJsonFile(folderId, ASK_CHATS_FILE_NAME, askChats, knownFiles.askChats || ''),
      upsertJsonFile(folderId, SETTINGS_FILE_NAME, settings, knownFiles.settings || ''),
      upsertJsonFile(folderId, HIGHLIGHTS_FILE_NAME, highlights, knownFiles.highlights || ''),
      upsertJsonFile(folderId, PROGRESS_FILE_NAME, progress, knownFiles.progress || ''),
      upsertJsonFile(folderId, PLAN_FILE_NAME, plan, knownFiles.plan || ''),
    ]);

    Store.update({
      googleDriveFolderId: folderId,
      googleDriveFileId: devotionsFileId,
      googleDriveFiles: {
        devotions: devotionsFileId,
        journals: journalsFileId,
        askChats: askChatsFileId,
        settings: settingsFileId,
        shares: String(knownFiles.shares || ''),
        highlights: highlightsFileId,
        progress: progressFileId,
        plan: planFileId,
      },
      lastDriveSyncAt: new Date().toISOString(),
    });
    return {
      fileId: devotionsFileId,
      count: (devotions.savedDevotions || []).length,
      journals: Object.keys(journals.journalEntries || {}).length,
      askChats: Object.keys(askChats.askBibleChats || {}).length,
      pastors: Array.isArray(settings.trustedPastors) ? settings.trustedPastors.length : 0,
      highlights: Object.keys(highlights.verseHighlights || {}).length,
      progress: Object.keys(progress.readingProgress || {}).length,
      files: 7,
    };
  }

  async function pullSavedDevotions() {
    const folderId = await findExistingFolderId();
    if (!folderId) return { fileId: '', count: 0, imported: false };

    const state = Store.get();
    const knownFiles = state.googleDriveFiles || { devotions: '', journals: '', settings: '', shares: '', askChats: '', highlights: '', progress: '', plan: '' };
    const [knownDevotions, knownJournals, knownAskChats, knownSettings, knownHighlights, knownProgress, knownPlan] = await Promise.all([
      readJsonFileById(knownFiles.devotions || ''),
      readJsonFileById(knownFiles.journals || ''),
      readJsonFileById(knownFiles.askChats || ''),
      readJsonFileById(knownFiles.settings || ''),
      readJsonFileById(knownFiles.highlights || ''),
      readJsonFileById(knownFiles.progress || ''),
      readJsonFileById(knownFiles.plan || ''),
    ]);

    let [devotionsFile, journalsFile, askChatsFile, settingsFile, highlightsFile, progressFile, planFile] = await Promise.all([
      knownDevotions.found ? knownDevotions : readJsonFileByCandidates(folderId, DEVOTIONS_FILE_CANDIDATES),
      knownJournals.found ? knownJournals : readJsonFileByCandidates(folderId, JOURNALS_FILE_CANDIDATES),
      knownAskChats.found ? knownAskChats : readJsonFileByCandidates(folderId, ASK_CHATS_FILE_CANDIDATES),
      knownSettings.found ? knownSettings : readJsonFileByCandidates(folderId, SETTINGS_FILE_CANDIDATES),
      knownHighlights.found ? knownHighlights : readJsonFileByCandidates(folderId, HIGHLIGHTS_FILE_CANDIDATES),
      knownProgress.found ? knownProgress : readJsonFileByCandidates(folderId, PROGRESS_FILE_CANDIDATES),
      // Prefer dedicated plan file; backward compat — older Drive snapshots that
      // embedded currentWeekPlan inside abide-devotions.json still work via
      // importDevotionsSnapshot's mergePlan call below.
      knownPlan.found ? knownPlan : readJsonFileByCandidates(folderId, PLAN_FILE_CANDIDATES),
    ]);

    // Backward compatibility: older installs may store data in legacy folder names.
    if (!devotionsFile.found || !journalsFile.found || !settingsFile.found) {
      const legacyFolderIds = await findLegacyFolderIds();
      for (const legacyFolderId of legacyFolderIds) {
        if (!devotionsFile.found) {
          const candidate = await readJsonFileByCandidates(legacyFolderId, DEVOTIONS_FILE_CANDIDATES);
          if (candidate.found) devotionsFile = candidate;
        }
        if (!journalsFile.found) {
          const candidate = await readJsonFileByCandidates(legacyFolderId, JOURNALS_FILE_CANDIDATES);
          if (candidate.found) journalsFile = candidate;
        }
        if (!settingsFile.found) {
          const candidate = await readJsonFileByCandidates(legacyFolderId, SETTINGS_FILE_CANDIDATES);
          if (candidate.found) settingsFile = candidate;
        }
        if (devotionsFile.found && journalsFile.found && settingsFile.found) break;
      }
    }

    let imported = false;
    let devResult = { count: 0, importedIds: 0, importedLibrary: 0, importedPlanDays: 0 };
    let journalResult = { importedJournal: 0 };
    let askChatsResult = { importedAskBibleChats: 0 };
    let settingsResult = { importedSettings: false, importedPastors: 0 };
    let highlightsResult = { imported: 0 };
    let progressResult = { imported: 0 };

    if (devotionsFile.found && devotionsFile.data && typeof devotionsFile.data === 'object') {
      devResult = Store.importDevotionsSnapshot(devotionsFile.data || {}, { replaceSaved: true });
      imported = true;
    }
    if (journalsFile.found && journalsFile.data && typeof journalsFile.data === 'object') {
      journalResult = Store.importJournalSnapshot(journalsFile.data || {});
      imported = true;
    }
    if (askChatsFile.found && askChatsFile.data && typeof askChatsFile.data === 'object') {
      askChatsResult = Store.importAskBibleChatsSnapshot(askChatsFile.data || {});
      imported = true;
    }
    if (settingsFile.found && settingsFile.data && typeof settingsFile.data === 'object') {
      settingsResult = Store.importSettingsSnapshot(settingsFile.data || {});
      imported = true;
    }
    if (highlightsFile.found && highlightsFile.data && typeof highlightsFile.data === 'object') {
      highlightsResult = Store.importHighlightsSnapshot(highlightsFile.data || {});
      imported = true;
    }
    if (progressFile.found && progressFile.data && typeof progressFile.data === 'object') {
      progressResult = Store.importProgressSnapshot(progressFile.data || {});
      imported = true;
    }
    // Import plan from dedicated abide-plan.json (new format).
    // Backward compat: if abide-plan.json is missing, the plan is still merged from
    // abide-devotions.json via importDevotionsSnapshot's mergePlan call above.
    if (planFile.found && planFile.data && typeof planFile.data === 'object') {
      const planResult = Store.importPlanSnapshot(planFile.data);
      devResult = {
        ...devResult,
        importedPlanDays: Math.max(Number(devResult.importedPlanDays || 0), Number(planResult.importedPlanDays || 0)),
      };
      imported = true;
    }

    // Backward compatibility with old single-file sync.
    // Import it when modern devotions were not found OR when nothing imported.
    if (!devotionsFile.found || !imported) {
      let legacy = await readJsonFileByCandidates(folderId, LEGACY_SNAPSHOT_FILE_CANDIDATES);
      if (!legacy.found) {
        const legacyFolderIds = await findLegacyFolderIds();
        for (const legacyFolderId of legacyFolderIds) {
          legacy = await readJsonFileByCandidates(legacyFolderId, LEGACY_SNAPSHOT_FILE_CANDIDATES);
          if (legacy.found) break;
        }
      }
      if (legacy.found && legacy.data && typeof legacy.data === 'object') {
        const legacyResult = Store.importSavedDevotionsSnapshot(legacy.data || {}, {
          replace: !devotionsFile.found,
        });
        devResult = {
          ...devResult,
          count: Math.max(Number(devResult.count || 0), Number(legacyResult.count || 0)),
          importedIds: Number(devResult.importedIds || 0) + Number(legacyResult.importedIds || 0),
          importedLibrary: Number(devResult.importedLibrary || 0) + Number(legacyResult.importedLibrary || 0),
          importedJournal: Number(devResult.importedJournal || 0) + Number(legacyResult.importedJournal || 0),
        };
        journalResult = {
          ...journalResult,
          importedJournal: Number(journalResult.importedJournal || 0) + Number(legacyResult.importedJournal || 0),
        };
        imported = true;
      }
    }

    if (!imported) return { fileId: '', count: 0, imported: false };

    Store.update({
      googleDriveFolderId: folderId,
      googleDriveFileId: devotionsFile.fileId || '',
      googleDriveFiles: {
        devotions: devotionsFile.fileId || '',
        journals: journalsFile.fileId || '',
        askChats: askChatsFile.fileId || '',
        settings: settingsFile.fileId || '',
        shares: String(knownFiles.shares || ''),
        highlights: highlightsFile.fileId || '',
        progress: progressFile.fileId || '',
        plan: planFile.fileId || '',
      },
      lastDriveSyncAt: new Date().toISOString(),
    });
    return {
      fileId: devotionsFile.fileId || '',
      count: devResult.count || 0,
      importedIds: devResult.importedIds || 0,
      importedLibrary: devResult.importedLibrary || 0,
      importedJournal: journalResult.importedJournal || devResult.importedJournal || 0,
      importedAskBibleChats: askChatsResult.importedAskBibleChats || 0,
      importedPastors: settingsResult.importedPastors || 0,
      importedPlanDays: devResult.importedPlanDays || 0,
      importedHighlights: highlightsResult.imported || 0,
      importedProgress: progressResult.imported || 0,
      sourceFolderId: folderId,
      sourceFiles: {
        devotions: devotionsFile.fileName || '',
        journals: journalsFile.fileName || '',
        askChats: askChatsFile.fileName || '',
        settings: settingsFile.fileName || '',
        highlights: highlightsFile.fileName || '',
        progress: progressFile.fileName || '',
        plan: planFile.fileName || '',
      },
      imported: true,
    };
  }

  function clearSession() {
    clearToken();
    // Also clear stale Drive folder/file IDs so a future reconnect starts fresh.
    // Leaving these set can cause new uploads to use an inaccessible folder (403 →
    // false AUTH_EXPIRED) if the cached IDs were from a different OAuth client or
    // a previous install.
    Store.update({
      googleProfile: null,
      googleConnectedAt: null,
      googleDriveFolderId: null,
      googleDriveFileId: null,
      googleDriveFiles: { devotions: '', journals: '', settings: '', shares: '', askChats: '', highlights: '', progress: '', plan: '' },
    });
  }

  function getDebugState() {
    const state = Store.get();
    return {
      hasGoogleClient: hasGoogleClient(),
      scriptTagPresent: !!document.querySelector('script[data-google-gsi="1"]'),
      clientIdConfigured: !!getClientId(),
      tokenCached: !!_accessToken,
      tokenExpiresInSec: _accessTokenExpiresAt ? Math.max(0, Math.round((_accessTokenExpiresAt - Date.now()) / 1000)) : 0,
      connectedProfile: !!state.googleProfile,
      googleDriveFolderId: state.googleDriveFolderId || '',
      googleDriveFiles: state.googleDriveFiles || { devotions: '', journals: '', settings: '', shares: '', askChats: '', highlights: '', progress: '', plan: '' },
      lastDriveSyncAt: state.lastDriveSyncAt || null,
    };
  }

  // Used by pull-to-refresh: silently validate auth first (no popup), then
  // upload local changes before downloading from Drive. If the Google session
  // has expired, throws AUTH_EXPIRED immediately so the caller can show a
  // banner instead of freezing the UI while waiting for a popup.
  async function syncForPullToRefresh() {
    // Silent-only token check — requestToken(false) skips the interactive popup.
    // GIS responds quickly with either a valid token or an error (e.g.
    // "interaction_required") when the session is expired.
    try {
      await requestToken(false);
    } catch (silentErr) {
      if (silentErr.code === 'OFFLINE') throw silentErr; // truly offline
      // Any other failure (interaction_required, access_denied, timeout while
      // online) means the session is expired and the user must reconnect.
      throw Object.assign(
        new Error('Google session expired. Please reconnect your account.'),
        { code: 'AUTH_EXPIRED' }
      );
    }
    // Token is now cached and valid — upload local changes first, then pull.
    await pushSavedDevotions();
    await pullSavedDevotions();
  }

  return {
    requestToken,
    fetchGoogleProfile,
    connectGoogle,
    ensureGoogleClient,
    pushSavedDevotions,
    pullSavedDevotions,
    syncForPullToRefresh,
    createSharedDevotionLink,
    createSharedSeriesLink,
    createSharedCurrentWeekLink,
    importSharedDevotion,
    clearSession,
    getDebugState,
  };
})();

window.Sync = Sync;
