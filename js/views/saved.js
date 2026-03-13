/* ============================================================
   ABIDE - Saved Devotionals Library
   ============================================================ */

const SavedView = (() => {
  let openSavedId = '';
  let openSeriesId = '';
  let syncing = false;

  function escapeHtml(text = '') {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(text = '') {
    return escapeHtml(text).replace(/"/g, '&quot;');
  }

  function sessionSortValue(session = '') {
    return session === 'evening' ? 1 : 0;
  }

  function entryTheme(entry = {}) {
    const theme = String(
      entry.seriesTheme
      || entry?.devotionData?.seriesTheme
      || entry.theme
      || entry?.devotionData?.theme
      || ''
    ).trim();
    return theme || 'Untitled Series';
  }

  function entryWeekKey(entry = {}) {
    return String(entry.weekKey || DateUtils.weekStart(entry.dateKey || DateUtils.today()));
  }

  function seriesIdForEntry(entry = {}) {
    const explicit = String(entry.seriesId || entry?.devotionData?.seriesId || '').trim();
    if (explicit) return explicit;
    const weekKey = entryWeekKey(entry);
    return `${weekKey}::legacy`;
  }

  function buildSeries(entries = []) {
    const byId = {};

    entries.forEach((entry) => {
      const id = seriesIdForEntry(entry);
      if (!byId[id]) {
        byId[id] = {
          id,
          weekKey: entryWeekKey(entry),
          theme: entryTheme(entry),
          entries: [],
          lastSavedAt: '',
        };
      }
      byId[id].entries.push(entry);
      const savedAt = String(entry.savedAt || '');
      if (savedAt > byId[id].lastSavedAt) byId[id].lastSavedAt = savedAt;
    });

    const groups = Object.values(byId).map((group) => {
      group.entries.sort((a, b) => {
        const dateA = String(a.dateKey || '');
        const dateB = String(b.dateKey || '');
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return sessionSortValue(a.session) - sessionSortValue(b.session);
      });
      return group;
    });

    groups.sort((a, b) => {
      if (a.weekKey !== b.weekKey) return b.weekKey.localeCompare(a.weekKey);
      if (a.lastSavedAt !== b.lastSavedAt) return String(b.lastSavedAt).localeCompare(String(a.lastSavedAt));
      return a.theme.localeCompare(b.theme);
    });

    return groups;
  }

  function formatSeriesMeta(series) {
    const days = new Set(series.entries.map((e) => e.dateKey).filter(Boolean)).size;
    const sessions = series.entries.length;
    return `${DateUtils.format(series.weekKey)} · ${days} day${days === 1 ? '' : 's'} · ${sessions} devotion${sessions === 1 ? '' : 's'}`;
  }

  function render(container) {
    Router.setTitle('Saved Devotionals');
    Router.clearHeaderActions();

    const savedEntries = Store.getSavedDevotionLibrary();
    const seriesList = buildSeries(savedEntries);
    const googleConnected = !!Store.get('googleProfile');

    if (openSavedId && !Store.getSavedDevotionById(openSavedId)) {
      openSavedId = '';
    }
    if (openSeriesId && !seriesList.find((s) => s.id === openSeriesId)) {
      openSeriesId = '';
    }

    const div = document.createElement('div');
    div.className = 'view-content view-enter';
    div.innerHTML = `
      <div class="section-header">
        <span class="section-title">Saved Series (${seriesList.length})</span>
        <div style="display:flex;gap:8px;align-items:center;">
          ${syncing ? `<span class="text-xs text-secondary">Syncing...</span>` : ''}
          ${googleConnected ? `<button class="btn btn-ghost btn-sm" onclick="SavedView.importSharedLinkPrompt()">Import Shared</button>` : ''}
          ${googleConnected ? `<button class="btn btn-ghost btn-sm" onclick="SavedView.download()">Download</button>` : ''}
          ${googleConnected ? `<button class="btn btn-ghost btn-sm" onclick="SavedView.upload()">Upload</button>` : ''}
          ${!googleConnected ? `<button class="btn btn-ghost btn-sm" onclick="SavedView.connectGoogle()">Connect Google</button>` : ''}
        </div>
      </div>

      ${seriesList.length ? `
      <div class="devotion-library-list">
        ${seriesList.map((series) => {
          const isOpen = series.id === openSeriesId;
          return `
            <div class="devotion-library-item devotion-series">
              <div class="devotion-library-item__meta">${escapeHtml(formatSeriesMeta(series))}</div>
              <div class="devotion-library-item__title">${escapeHtml(series.theme)}</div>
              <div class="devotion-library-item__theme">Week of ${escapeHtml(DateUtils.format(series.weekKey))}</div>
              <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm" onclick="SavedView.useSeries('${escapeAttr(series.id)}')">Use This Week</button>
                <button class="btn btn-secondary btn-sm" onclick="SavedView.shareSeries('${escapeAttr(series.id)}')">Share Week</button>
                <button class="btn btn-secondary btn-sm" onclick="SavedView.deleteSeries('${escapeAttr(series.id)}')">Delete Series</button>
                <button class="btn btn-secondary btn-sm" onclick="SavedView.toggleSeries('${escapeAttr(series.id)}')">${isOpen ? 'Hide Series' : 'Open Series'}</button>
              </div>

              ${isOpen ? `
                <div class="devotion-series-entries">
                  ${series.entries.map((item) => {
                    const itemOpen = item.id === openSavedId;
                    const title = item.title || item.openingVerse?.reference || 'Saved devotion';
                    const when = `${DateUtils.format(item.dateKey || DateUtils.today(), 'short')} · ${item.session === 'evening' ? 'Evening' : 'Morning'}`;
                    const openEntry = itemOpen ? (Store.getSavedDevotionById(item.id) || item) : item;
                    return `
                      <div class="devotion-library-item devotion-series-entry">
                        <div class="devotion-library-item__meta">${escapeHtml(when)}</div>
                        <div class="devotion-library-item__title">${escapeHtml(title)}</div>
                        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                          <button class="btn btn-secondary btn-sm" onclick="SavedView.openSaved('${escapeAttr(item.id)}')">${itemOpen ? 'Hide' : 'Open'}</button>
                          <button class="btn btn-secondary btn-sm" onclick="SavedView.goToDay('${escapeAttr(item.dateKey)}','${escapeAttr(item.session || 'morning')}','${escapeAttr(series.id)}')">Go to day</button>
                          <button class="btn btn-secondary btn-sm" onclick="SavedView.deleteSaved('${escapeAttr(item.id)}')">Delete</button>
                        </div>
                        ${itemOpen ? renderSavedDetail(openEntry) : ''}
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
      ` : `
        <div class="empty-state">
          <div class="empty-state__icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <p class="empty-state__title">No saved devotionals</p>
          <p class="empty-state__description">Save a devotion from Today to start building your library.</p>
          <button class="btn btn-primary" onclick="Router.navigate('/')">Go to Today</button>
        </div>`}
    `;

    container.innerHTML = '';
    container.appendChild(div);
  }

  function renderSavedDetail(entry) {
    if (!entry) return '';
    const devotionData = entry.devotionData || {};
    const sessionData = devotionData[entry.session] || {};
    const prompts = Array.isArray(sessionData.reflection_prompts) ? sessionData.reflection_prompts : (entry.reflectionPrompts || []);
    const fallbackBody = Array.isArray(entry.body) ? entry.body : [];
    const body = Array.isArray(sessionData.body) && sessionData.body.length ? sessionData.body : fallbackBody;
    return `
      <div class="devotion-library-detail">
        ${sessionData.opening_verse?.text || entry.openingVerse?.text ? `
          <div class="scripture-card scripture-card--${entry.session === 'evening' ? 'evening' : 'morning'}" style="margin-top:10px;">
            <div class="scripture-card__text">${escapeHtml(sessionData.opening_verse?.text || entry.openingVerse?.text || '')}</div>
            <div class="scripture-card__reference">${escapeHtml(sessionData.opening_verse?.reference || entry.openingVerse?.reference || '')}</div>
          </div>
        ` : ''}
        ${body.length ? `<div class="devotion-body" style="margin-top:12px;">${renderBody(body)}</div>` : ''}
        ${prompts.length ? `
          <div class="devotion-reflection" style="margin-top:12px;">
            <div class="devotion-reflection-title">Questions</div>
            <div class="devotion-prompts-list">
              ${prompts.map((p, i) => `
                <div class="prompt-card">
                  <div class="prompt-card__number">${i + 1}</div>
                  <div class="prompt-card__text">${escapeHtml(p)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        ${(sessionData.prayer || entry.prayer) ? `
          <div class="prayer-card" style="margin-top:12px;">
            <div class="prayer-card__label">A Prayer</div>
            <div class="prayer-card__text">${escapeHtml(sessionData.prayer || entry.prayer || '')}</div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderBody(body) {
    return body.map((block) => {
      if (block.type === 'paragraph') {
        return `<p class="devotion-paragraph">${escapeHtml(block.content || '')}</p>`;
      }
      if (block.type === 'scripture_block') {
        return `
          <div class="devotion-scripture-block">
            <div class="devotion-scripture-block__text">"${escapeHtml(block.text || '')}"</div>
            ${block.reference ? `<div class="devotion-scripture-block__ref">— ${escapeHtml(block.reference)}</div>` : ''}
          </div>
        `;
      }
      if (block.type === 'heading') {
        return `<h3 class="text-xl font-serif" style="margin-bottom:12px;">${escapeHtml(block.content || '')}</h3>`;
      }
      return '';
    }).join('');
  }

  function toggleSeries(id) {
    if (!id) return;
    if (openSeriesId === id) {
      openSeriesId = '';
      openSavedId = '';
    } else {
      openSeriesId = id;
      openSavedId = '';
    }
    render(document.getElementById('view-container'));
  }

  function openSaved(id) {
    if (!id) return;
    const entry = Store.getSavedDevotionById(id);
    if (entry) {
      openSeriesId = seriesIdForEntry(entry);
    }
    openSavedId = openSavedId === id ? '' : id;
    render(document.getElementById('view-container'));
  }

  function goToDay(dateKey, session, seriesId = '') {
    const currentHasDate = !!Store.getDevotionData(dateKey);
    if (!currentHasDate) {
      const allSeries = buildSeries(Store.getSavedDevotionLibrary());
      const targetSeries = (seriesId
        ? allSeries.find((series) => series.id === seriesId)
        : null) || allSeries.find((series) => series.entries.some((entry) => entry.dateKey === dateKey && (entry.session || 'morning') === (session || 'morning')));
      if (targetSeries) {
        Store.useSavedSeries(targetSeries.entries, dateKey, session || 'morning');
      }
    }
    if (dateKey) Store.setSelectedDevotionDate(dateKey);
    Store.set('_sessionOverride', session || 'morning');
    Router.navigate('/');
  }

  function useSeries(seriesId) {
    const series = buildSeries(Store.getSavedDevotionLibrary()).find((s) => s.id === seriesId);
    if (!series) {
      alert('Could not find that saved devotional series.');
      return;
    }
    const result = Store.useSavedSeries(series.entries, series.entries[0]?.dateKey || '', series.entries[0]?.session || 'morning');
    if (!result.ok) {
      alert('Could not apply that saved series as your current week.');
      return;
    }
    alert(`Now using "${series.theme}" as this week's devotional.`);
    Router.navigate('/');
  }

  async function shareSaved(id) {
    const entry = Store.getSavedDevotionById(id);
    if (!entry) {
      alert('Could not find that saved devotion.');
      return;
    }
    const googleConnected = !!Store.get('googleProfile');
    if (googleConnected) {
      try {
        const shared = await Sync.createSharedDevotionLink(entry);
        const result = await DevotionShare.shareLink({
          title: entry.title || 'Shared Abide Devotion',
          text: 'Open this shared devotional from Abide',
          url: shared.shareUrl,
        });
        if (!result.ok && !result.aborted) {
          alert(`Share failed: ${result.error || 'Could not share devotion link.'}`);
          return;
        }
        if (result.method === 'clipboard') {
          alert('Share link copied to clipboard.');
        }
        return;
      } catch (err) {
        alert(`Google share failed: ${err.message}`);
        return;
      }
    }

    const payload = DevotionShare.fromSavedEntry(entry);
    const result = await DevotionShare.share(payload);
    if (!result.ok && !result.aborted) {
      alert(`Share failed: ${result.error || 'Could not share devotion.'}`);
      return;
    }
    if (result.method === 'clipboard') {
      alert('Devotion copied to clipboard.');
    }
  }

  async function shareSeries(seriesId) {
    const series = buildSeries(Store.getSavedDevotionLibrary()).find((s) => s.id === seriesId);
    if (!series) {
      alert('Could not find that saved devotional series.');
      return;
    }

    const googleConnected = !!Store.get('googleProfile');
    if (googleConnected) {
      try {
        const shared = await Sync.createSharedSeriesLink({
          id: series.id,
          weekKey: series.weekKey,
          theme: series.theme,
          entries: series.entries,
        });
        const result = await DevotionShare.shareLink({
          title: `${series.theme} — Shared Abide Week`,
          text: 'Open this shared weekly devotion series from Abide',
          url: shared.shareUrl,
        });
        if (!result.ok && !result.aborted) {
          alert(`Share failed: ${result.error || 'Could not share weekly link.'}`);
          return;
        }
        if (result.method === 'clipboard') alert('Share link copied to clipboard.');
        return;
      } catch (err) {
        alert(`Google share failed: ${err.message}`);
        return;
      }
    }

    const firstEntry = series.entries[0];
    const payload = firstEntry ? DevotionShare.fromSavedEntry(firstEntry) : null;
    const result = await DevotionShare.share(payload);
    if (!result.ok && !result.aborted) {
      alert(`Share failed: ${result.error || 'Could not share devotion.'}`);
      return;
    }
    if (result.method === 'clipboard') alert('Devotion copied to clipboard.');
  }

  async function importSharedLinkPrompt() {
    const link = window.prompt('Paste a Google Drive shared week/devotional link or file ID:');
    if (!link) return;
    try {
      const result = await Sync.importSharedDevotion(link);
      alert(`Imported shared devotion: ${result.title || 'Untitled'}`);
      render(document.getElementById('view-container'));
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  }

  async function upload() {
    if (syncing) return;
    syncing = true;
    render(document.getElementById('view-container'));
    try {
      const result = await Sync.pushSavedDevotions();
      alert(`Uploaded ${result.count || 0} saved devotionals, ${result.journals || 0} journal entries, ${result.askChats || 0} saved Bible chats, and settings metadata.`);
    } catch (err) {
      if (err.code === 'OFFLINE') { alert('No internet connection. Connect to sync.'); }
      else { alert(`Upload failed: ${err.message}`); }
    } finally {
      syncing = false;
      render(document.getElementById('view-container'));
    }
  }

  async function download() {
    if (syncing) return;
    syncing = true;
    render(document.getElementById('view-container'));
    try {
      const result = await Sync.pullSavedDevotions();
      if (!result.imported) {
        alert('No synced Drive file found yet.');
        return;
      }
      alert(`Downloaded ${result.importedLibrary || 0} saved devotionals, ${result.importedJournal || 0} journal entries, ${result.importedAskBibleChats || 0} saved Bible chats, and settings metadata.`);
    } catch (err) {
      if (err.code === 'OFFLINE') { alert('No internet connection. Connect to sync.'); }
      else { alert(`Download failed: ${err.message}`); }
    } finally {
      syncing = false;
      render(document.getElementById('view-container'));
    }
  }

  async function connectGoogle() {
    try {
      await Sync.connectGoogle();
      render(document.getElementById('view-container'));
    } catch (err) {
      alert(`Google sign-in failed: ${err.message}`);
    }
  }

  async function askDeleteScope(label = 'entry') {
    const googleConnected = !!Store.get('googleProfile');
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'abide-delete-dialog-backdrop';
      backdrop.innerHTML = `
        <div class="abide-delete-dialog" role="dialog" aria-modal="true" aria-label="Delete ${escapeAttr(label)}">
          <div class="abide-delete-dialog__title">Delete ${escapeHtml(label)}?</div>
          <div class="abide-delete-dialog__body">
            Choose where to remove this ${escapeHtml(label)}.
          </div>
          <div class="abide-delete-dialog__actions">
            <button class="btn btn-secondary btn-sm" data-delete-action="cancel">Cancel</button>
            <button class="btn btn-secondary btn-sm" data-delete-action="local">Delete locally</button>
            ${googleConnected ? `<button class="btn btn-primary btn-sm" data-delete-action="global">Delete locally &amp; from Drive</button>` : ''}
          </div>
        </div>
      `;

      function close(result = '') {
        backdrop.remove();
        resolve(result);
      }

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close('');
      });
      backdrop.querySelector('[data-delete-action="cancel"]')?.addEventListener('click', () => close(''));
      backdrop.querySelector('[data-delete-action="local"]')?.addEventListener('click', () => close('local'));
      backdrop.querySelector('[data-delete-action="global"]')?.addEventListener('click', () => close('global'));

      document.body.appendChild(backdrop);
    });
  }

  async function applyDeleteScope(scope) {
    if (scope !== 'global') return;
    await Sync.pushSavedDevotions();
  }

  async function deleteSaved(id) {
    const entry = Store.getSavedDevotionById(id);
    if (!entry) {
      alert('Could not find that saved devotion.');
      return;
    }
    const scope = await askDeleteScope('devotion');
    if (!scope) return;
    const removed = Store.deleteSavedDevotionById(id);
    if (!removed.removed) {
      alert('Could not delete that devotion.');
      return;
    }
    try {
      await applyDeleteScope(scope);
    } catch (err) {
      alert(`Deleted locally, but Drive sync failed: ${err.message}`);
    }
    if (openSavedId === id) openSavedId = '';
    render(document.getElementById('view-container'));
  }

  async function deleteSeries(seriesId) {
    const series = buildSeries(Store.getSavedDevotionLibrary()).find((s) => s.id === seriesId);
    if (!series) {
      alert('Could not find that series.');
      return;
    }
    const scope = await askDeleteScope('series');
    if (!scope) return;
    const ids = series.entries.map((e) => e.id).filter(Boolean);
    const removed = Store.deleteSavedDevotionsByIds(ids);
    if (!removed.removed) {
      alert('Could not delete that series.');
      return;
    }
    try {
      await applyDeleteScope(scope);
    } catch (err) {
      alert(`Deleted locally, but Drive sync failed: ${err.message}`);
    }
    if (openSeriesId === seriesId) openSeriesId = '';
    if (openSavedId && ids.includes(openSavedId)) openSavedId = '';
    render(document.getElementById('view-container'));
  }

  return {
    render,
    toggleSeries,
    useSeries,
    openSaved,
    goToDay,
      shareSaved,
      shareSeries,
    deleteSaved,
    deleteSeries,
    importSharedLinkPrompt,
    upload,
    download,
    connectGoogle,
  };
})();

window.SavedView = SavedView;
