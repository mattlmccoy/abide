/* ============================================================
   ABIDE - Settings View (Primary)
   ============================================================ */

const SettingsView = (() => {
  function escapeHtml(text = '') {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const PALETTES = [
    { id: 'tuscan-sunset',   name: 'Tuscan',    dots: ['#E35336', '#FFD3AC', '#9988A1'] },
    { id: 'desert-dusk',     name: 'Desert',    dots: ['#E68057', '#993A8B', '#BF7587'] },
    { id: 'lavender-fields', name: 'Lavender',  dots: ['#CF6DFC', '#C1BFFF', '#BDB96A'] },
    { id: 'cactus-flower',   name: 'Cactus',    dots: ['#92E4BA', '#E491A6', '#845763'] },
    { id: 'mountain-mist',   name: 'Mountain',  dots: ['#6D8196', '#B0C4DE', '#01796F'] },
    { id: 'evergreen',       name: 'Evergreen', dots: ['#1F8A70', '#A8D5BA', '#2D4A3A'] },
    { id: 'sage-paper',      name: 'Sage',      dots: ['#5F8D7A', '#C8D8C4', '#8FA7A0'] },
    { id: 'riverstone',      name: 'River',     dots: ['#3A6EA5', '#8FB3D9', '#2F4858'] },
    { id: 'slate-rose',      name: 'Slate',     dots: ['#4A5568', '#A0AEC0', '#7F9AA2'] },
    { id: 'graphite',        name: 'Graphite',  dots: ['#4A90D9', '#8C9BAB', '#C8D2DC'] },
    { id: 'ocean-glass',     name: 'Ocean',     dots: ['#0EA5E9', '#22D3EE', '#64748B'] },
    { id: 'mono',            name: 'Mono',      dots: ['#6B7280', '#9CA3AF', '#D1D5DB'] },
  ];

  function render(container) {
    Router.setTitle('Settings');
    Router.clearHeaderActions();

    const state = Store.get();
    const trustedPastors = Store.getTrustedPastors();
    const appVersion = window.__ABIDE_VERSION__ || 'dev';
    const currentPalette = state.palette || 'mountain-mist';
    const googlePicture = state.googleProfile?.picture || '';
    const nameIconHtml = googlePicture
      ? `<img src="${escapeHtml(googlePicture)}" width="32" height="32" style="border-radius:50%;object-fit:cover;display:block;" alt="Google profile" />`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

    const div = document.createElement('div');
    div.className = 'view-content tab-switch-enter';

    div.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">1) Your Name</div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-row__icon">
              ${nameIconHtml}
            </div>
            <div class="settings-row__content">
              <div class="settings-row__label">Your Name</div>
              <input id="settings-name" class="input" type="text" placeholder="What's your name?" value="${escapeHtml(state.userName || '')}" style="margin-top:8px;" />
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section" id="settings-pastors-section">
        <div class="settings-section-title">2) Trusted Pastors & Teachers</div>
        <div class="settings-group">
          <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
            <div class="settings-row__value">Select who can influence AI-generated devotions.</div>
            <div id="trusted-pastor-list" style="width:100%;display:flex;flex-direction:column;gap:8px;">
              ${trustedPastors.map((pastor) => `
                <div data-pastor-row style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--bg-sunken);">
                  <label style="display:flex;align-items:center;gap:10px;min-width:0;">
                    <input class="pastor-enabled" type="checkbox" ${pastor.enabled ? 'checked' : ''} />
                    <span class="pastor-name" style="font-size:var(--text-sm);line-height:1.4;">${escapeHtml(pastor.name)}</span>
                  </label>
                  <button type="button" class="btn btn-ghost btn-sm pastor-remove">Remove</button>
                </div>
              `).join('')}
            </div>
            <div style="display:flex;gap:8px;width:100%;">
              <input id="pastor-new-name" class="input" type="text" placeholder="Add a pastor/teacher" style="margin:0;" />
              <button type="button" class="btn btn-secondary btn-sm" id="add-pastor-btn">Add</button>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">3) Devotion Content</div>
        <div class="settings-group">
          <div class="settings-row" style="cursor:pointer;" onclick="Router.navigate('/plan')">
            <div class="settings-row__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div class="settings-row__content">
              <div class="settings-row__label">Build This Week's Plan</div>
              <div class="settings-row__value">Choose a theme and generate this week</div>
            </div>
          </div>
          <div class="settings-row" style="cursor:pointer;" onclick="PlanView.loadSeedPlan()">
            <div class="settings-row__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
            </div>
            <div class="settings-row__content">
              <div class="settings-row__label">Load Sample Week</div>
              <div class="settings-row__value">Fallback if providers are rate limited</div>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section" id="settings-appearance-section">
        <div class="settings-section-title">4) Appearance</div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-row__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/></svg>
            </div>
            <div class="settings-row__content"><div class="settings-row__label">Mode</div></div>
            <div class="settings-row__action">
              <select id="theme-select" class="input" style="width:auto;padding:6px 12px;">
                <option value="auto" ${state.theme === 'auto' ? 'selected' : ''}>Auto</option>
                <option value="light" ${state.theme === 'light' ? 'selected' : ''}>Light</option>
                <option value="dark" ${state.theme === 'dark' ? 'selected' : ''}>Dark</option>
              </select>
            </div>
          </div>
          <div class="settings-row" id="settings-appearance-row" style="flex-direction:column;align-items:flex-start;">
            <div style="display:flex;align-items:center;gap:var(--space-3);width:100%;margin-bottom:var(--space-3);">
              <div class="settings-row__label">Color Theme</div>
            </div>
            <div class="palette-grid" id="palette-grid">
              ${PALETTES.map(p => `
                <button class="palette-card ${currentPalette === p.id ? 'selected' : ''}" data-palette="${p.id}" type="button" aria-label="${p.name} theme">
                  <div class="palette-dots">${p.dots.map(c => `<span style="background:${c}"></span>`).join('')}</div>
                  <span class="palette-name">${p.name}</span>
                </button>
              `).join('')}
            </div>
          </div>
          <div class="settings-row" id="settings-translation-row">
            <div class="settings-row__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            </div>
            <div class="settings-row__content">
              <div class="settings-row__label">Bible Translation</div>
            </div>
            <div class="settings-row__action">
              <select id="translation-select" class="input" style="width:auto;padding:6px 12px;">
                <option value="web" ${(state.bibleTranslation || 'web') === 'web' ? 'selected' : ''}>WEB — World English Bible</option>
                <option value="esv" ${state.bibleTranslation === 'esv' ? 'selected' : ''}>ESV — English Standard Version</option>
                <option value="niv" ${state.bibleTranslation === 'niv' ? 'selected' : ''}>NIV — New International Version</option>
                <option value="nlt" ${state.bibleTranslation === 'nlt' ? 'selected' : ''}>NLT — New Living Translation</option>
                <option value="bsb" ${state.bibleTranslation === 'bsb' ? 'selected' : ''}>BSB — Berean Standard Bible</option>
                <option value="lsv" ${state.bibleTranslation === 'lsv' ? 'selected' : ''}>LSV — Literal Standard Version</option>
                <option value="kjv" ${state.bibleTranslation === 'kjv' ? 'selected' : ''}>KJV — King James Version</option>
                <option value="asv" ${state.bibleTranslation === 'asv' ? 'selected' : ''}>ASV — American Standard Version</option>
                <option value="bbe" ${state.bibleTranslation === 'bbe' ? 'selected' : ''}>BBE — Bible in Basic English</option>
                <option value="darby" ${state.bibleTranslation === 'darby' ? 'selected' : ''}>DARBY — Darby Translation</option>
              </select>
            </div>
          </div>
          <div id="translation-notice" style="display:${['esv','niv','nlt','bsb','lsv'].includes(state.bibleTranslation) ? 'flex' : 'none'};background:var(--accent-soft);border-radius:var(--radius-sm);padding:var(--space-3);margin:0 var(--space-1);">
            <div style="font-size:var(--text-xs);line-height:1.6;color:var(--text-secondary);">
              ESV, NIV, and NLT are served via the Cloudflare Worker. BSB and LSV are freely licensed (CC BY-SA 4.0).
            </div>
          </div>
          <div class="settings-row" id="settings-devotion-length-row">
            <div class="settings-row__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </div>
            <div class="settings-row__content">
              <div class="settings-row__label">Devotion Length</div>
            </div>
            <div class="settings-row__action">
              <select id="devotion-length-select" class="input" style="width:auto;padding:6px 12px;">
                <option value="short" ${(state.devotionLength || 'standard') === 'short' ? 'selected' : ''}>Brief</option>
                <option value="standard" ${(state.devotionLength || 'standard') === 'standard' ? 'selected' : ''}>Standard</option>
                <option value="long" ${(state.devotionLength || 'standard') === 'long' ? 'selected' : ''}>Deep Study</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section" id="settings-notifications-section">
        <div class="settings-section-title">5) Notifications</div>
        <div class="settings-group">
          <div class="settings-row" id="settings-notifications-row">
            <div class="settings-row__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </div>
            <div class="settings-row__content">
              <div class="settings-row__label">Morning & Evening Reminders</div>
              <div class="settings-row__value" id="notif-status-msg">${/iPhone|iPad|iPod/.test(navigator.userAgent) && !window.navigator.standalone ? 'Install to Home Screen first to enable iOS push.' : 'Sends reminders at your chosen times'}</div>
            </div>
            <div class="settings-row__action settings-row__action--toggle">
              <label class="toggle__switch">
                <input type="checkbox" id="notif-toggle" ${state.notificationsEnabled ? 'checked' : ''} />
                <div class="toggle__track"></div>
              </label>
            </div>
          </div>
          <div class="settings-row settings-row--stacked">
            <div class="settings-row__content">
              <div class="settings-row__label">Morning Reminder</div>
            </div>
            <div class="settings-row__action settings-row__action--time">
              <input type="time" id="morning-time" class="settings-time-input" value="${String(state.morningHour).padStart(2, '0')}:${String(state.morningMinute).padStart(2, '0')}" />
            </div>
          </div>
          <div class="settings-row settings-row--stacked">
            <div class="settings-row__content">
              <div class="settings-row__label">Evening Reminder</div>
            </div>
            <div class="settings-row__action settings-row__action--time">
              <input type="time" id="evening-time" class="settings-time-input" value="${String(state.eveningHour).padStart(2, '0')}:${String(state.eveningMinute).padStart(2, '0')}" />
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/></svg>
            </div>
            <div class="settings-row__content">
              <div class="settings-row__label">Sunday New Week Reminder</div>
              <div class="settings-row__value">Prompt to generate next week’s devotion plan</div>
            </div>
            <div class="settings-row__action settings-row__action--toggle">
              <label class="toggle__switch">
                <input type="checkbox" id="sunday-reminder-toggle" ${state.sundayReminderEnabled !== false ? 'checked' : ''} />
                <div class="toggle__track"></div>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">6) App Data</div>
        <div class="settings-group">
          <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
            <div class="settings-row__value">
              Saved devotions, journal entries, and saved Ask the Bible chats are stored locally on this device in browser storage. Use Advanced to sync to your visible Google Drive folder <strong>abidefaith-docs</strong> for cross-device access.
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" onclick="Router.navigate('/saved')" type="button">Open Saved Devotionals</button>
              <button class="btn btn-secondary btn-sm" onclick="Router.navigate('/progress')" type="button">Reading Progress</button>
              <button class="btn btn-secondary btn-sm" onclick="Router.navigate('/settings-advanced')" type="button">Open Sync & Backup</button>
              <button class="btn btn-secondary btn-sm" onclick="Router.navigate('/feedback')" type="button">Send Feedback</button>
              <button class="btn btn-secondary btn-sm" id="btn-view-tutorial" type="button">View Tutorial</button>
              <button class="btn btn-secondary btn-sm" id="clear-site-data-btn" type="button">Clear Local Site Data</button>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">7) Advanced</div>
        <div class="settings-group">
          <div class="settings-row" style="cursor:pointer;" onclick="Router.navigate('/settings-advanced')">
            <div class="settings-row__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06"/></svg>
            </div>
            <div class="settings-row__content">
              <div class="settings-row__label">Open Advanced Settings</div>
              <div class="settings-row__value">Usage, provider routing checks, worker URL, Google Drive sync</div>
            </div>
          </div>
          <div class="settings-row" style="cursor:pointer;" onclick="Router.navigate('/debug')">
            <div class="settings-row__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v10H4z"/><path d="M8 20h8"/><path d="M12 14v6"/></svg>
            </div>
            <div class="settings-row__content">
              <div class="settings-row__label">Open Debug Tools</div>
              <div class="settings-row__value">Notification tests, worker health, copy diagnostics JSON</div>
            </div>
          </div>
        </div>
      </div>

      <div style="text-align:center;padding:var(--space-5) 0 var(--space-3);">
        <p class="text-xs text-muted">Abide · Personal Daily Devotion</p>
        <p class="text-xs text-muted settings-version-footer" id="settings-version" style="margin-top:4px;cursor:default;">${(() => { const swv = window.__ABIDE_SW_VERSION__ || ''; return `v${appVersion}${swv ? ' · SW ' + swv : ''}`; })()}</p>
        <button class="btn btn-ghost btn-sm" id="check-updates-btn" type="button" style="margin-top:var(--space-3);font-size:var(--text-xs);padding:6px 16px;">Check for Updates</button>
        <p id="check-updates-status" class="text-xs text-muted" style="margin-top:6px;min-height:1.2em;"></p>
      </div>

      <button class="btn btn-primary btn-full" id="save-settings">Save Settings</button>
      <p id="settings-save-hint" class="text-xs text-muted" style="margin:8px 2px var(--space-6);">Saving here updates this device. Use Upload in Saved Devotionals or Advanced Sync to back up to Drive.</p>
    `;

    container.innerHTML = '';
    container.appendChild(div);
    setupSettingsListeners(div);
  }

  function setupSettingsListeners(root) {
    setupPastorListListeners(root);

    root.querySelectorAll('.palette-card').forEach(card => {
      card.addEventListener('click', () => {
        const palette = card.dataset.palette;
        root.querySelectorAll('.palette-card').forEach(c => c.classList.toggle('selected', c.dataset.palette === palette));
        document.documentElement.dataset.palette = palette;
      });
    });

    root.querySelector('#theme-select')?.addEventListener('change', (e) => applyTheme(e.target.value));
    root.querySelector('#translation-select')?.addEventListener('change', (e) => {
      const notice = root.querySelector('#translation-notice');
      if (notice) notice.style.display = ['esv', 'niv', 'nlt', 'bsb', 'lsv'].includes(e.target.value) ? 'flex' : 'none';
    });

    root.querySelector('#save-settings')?.addEventListener('click', async () => {
      const name = root.querySelector('#settings-name')?.value?.trim() || '';
      const theme = root.querySelector('#theme-select')?.value || 'auto';
      const bibleTranslation = root.querySelector('#translation-select')?.value || 'web';
      const notifEnabled = root.querySelector('#notif-toggle')?.checked || false;
      const sundayReminderEnabled = root.querySelector('#sunday-reminder-toggle')?.checked || false;
      const morningTime = root.querySelector('#morning-time')?.value || '06:30';
      const eveningTime = root.querySelector('#evening-time')?.value || '20:00';
      const selectedPalette = document.documentElement.dataset.palette || 'mountain-mist';
      const [mh, mm] = morningTime.split(':').map(Number);
      const [eh, em] = eveningTime.split(':').map(Number);
      const trustedPastors = Array.from(root.querySelectorAll('[data-pastor-row]'))
        .map(row => ({
          name: row.querySelector('.pastor-name')?.textContent?.trim() || '',
          enabled: !!row.querySelector('.pastor-enabled')?.checked,
        }))
        .filter(p => p.name);

      if (!trustedPastors.some(p => p.enabled)) {
        alert('Enable at least one trusted pastor/teacher.');
        return;
      }

      const devotionLength = root.querySelector('#devotion-length-select')?.value || 'standard';

      Store.update({
        userName: name,
        theme,
        bibleTranslation,
        morningHour: mh,
        morningMinute: mm,
        eveningHour: eh,
        eveningMinute: em,
        notificationsEnabled: notifEnabled,
        sundayReminderEnabled,
        palette: selectedPalette,
        devotionLength,
      });
      Store.setTrustedPastors(trustedPastors);
      applyTheme(theme);

      if (notifEnabled) {
        try {
          const sub = await Notifications.subscribeToPush();
          const msgEl = root.querySelector('#notif-status-msg');
          if (msgEl) msgEl.textContent = sub ? 'Reminders active.' : 'Could not fully enable reminders on this device.';
        } catch (err) {
          console.warn('Notification setup error:', err);
        }
      } else {
        Notifications.unsubscribe().catch(console.error);
      }

      const btn = root.querySelector('#save-settings');
      const hint = root.querySelector('#settings-save-hint');
      if (btn) {
        btn.textContent = 'Saved ✓';
        btn.style.background = 'var(--color-success)';
        if (hint) hint.textContent = 'Saved locally. Upload to Drive to sync this metadata across devices.';
        setTimeout(() => {
          btn.textContent = 'Save Settings';
          btn.style.background = '';
          if (hint) hint.textContent = 'Saving here updates this device. Use Upload in Saved Devotionals or Advanced Sync to back up to Drive.';
        }, 1400);
      }
    });

    root.querySelector('#clear-site-data-btn')?.addEventListener('click', async () => {
      const ok = window.confirm('Clear local app data on this device and reload?');
      if (!ok) return;
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
      } catch (err) {
        console.warn('Could not fully clear site data:', err);
      }
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}
      window.location.reload();
    });

    root.querySelector('#btn-view-tutorial')?.addEventListener('click', () => {
      Store.set('tutorialSeen', false);
      window.location.hash = '#/';
    });

    const versionEl = root.querySelector('#settings-version');
    if (versionEl) {
      let taps = 0;
      let tapStart = 0;
      versionEl.addEventListener('click', () => {
        const now = Date.now();
        if (!tapStart || (now - tapStart) > 2200) {
          tapStart = now;
          taps = 1;
          return;
        }
        taps += 1;
        if (taps >= 7) {
          Router.navigate('/debug');
        }
      });
    }

    root.querySelector('#check-updates-btn')?.addEventListener('click', async () => {
      const btn = root.querySelector('#check-updates-btn');
      const statusEl = root.querySelector('#check-updates-status');
      if (!btn || !statusEl) return;

      btn.disabled = true;
      btn.textContent = 'Checking…';
      statusEl.textContent = '';

      if (!('serviceWorker' in navigator)) {
        statusEl.textContent = 'Service worker not supported in this browser.';
        btn.disabled = false;
        btn.textContent = 'Check for Updates';
        return;
      }

      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.update();

        if (reg.waiting || reg.installing) {
          // A new SW was found — it will activate, write the meta cache stamp,
          // and the visibilitychange handler will reload the page automatically.
          statusEl.textContent = 'Update found — applying now…';
          btn.textContent = 'Updating…';
          // Nudge it to skip waiting immediately rather than waiting for a restart.
          const sw = reg.waiting || reg.installing;
          sw.postMessage({ type: 'SKIP_WAITING' });
          setTimeout(() => window.location.reload(), 1400);
        } else {
          const v = window.__ABIDE_VERSION__ || 'current';
          statusEl.textContent = `You're on the latest version (${v}).`;
          btn.textContent = 'Up to date ✓';
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = 'Check for Updates';
            statusEl.textContent = '';
          }, 2800);
        }
      } catch (err) {
        console.warn('[Abide] Update check failed:', err);
        statusEl.textContent = 'Could not check for updates. Try again when online.';
        btn.disabled = false;
        btn.textContent = 'Check for Updates';
      }
    });
  }

  function applyTheme(theme) {
    const html = document.documentElement;
    if (theme === 'dark') html.setAttribute('data-theme', 'dark');
    else if (theme === 'light') html.setAttribute('data-theme', 'light');
    else html.setAttribute('data-theme', DateUtils.isDarkModeTime() ? 'dark' : 'light');
  }

  function setupPastorListListeners(root) {
    const list = root.querySelector('#trusted-pastor-list');
    const addBtn = root.querySelector('#add-pastor-btn');
    const input = root.querySelector('#pastor-new-name');
    if (!list || !addBtn || !input) return;

    function bindRemoveHandlers() {
      list.querySelectorAll('.pastor-remove').forEach(btn => {
        btn.onclick = () => {
          const row = btn.closest('[data-pastor-row]');
          if (row) row.remove();
        };
      });
    }

    function appendPastor(name) {
      const clean = String(name || '').trim();
      if (!clean) return;
      const duplicate = Array.from(list.querySelectorAll('.pastor-name'))
        .some(el => el.textContent?.trim().toLowerCase() === clean.toLowerCase());
      if (duplicate) return;

      const row = document.createElement('div');
      row.setAttribute('data-pastor-row', '');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--bg-sunken);';
      row.innerHTML = `
        <label style="display:flex;align-items:center;gap:10px;min-width:0;">
          <input class="pastor-enabled" type="checkbox" checked />
          <span class="pastor-name" style="font-size:var(--text-sm);line-height:1.4;">${escapeHtml(clean)}</span>
        </label>
        <button type="button" class="btn btn-ghost btn-sm pastor-remove">Remove</button>
      `;
      list.appendChild(row);
      bindRemoveHandlers();
    }

    addBtn.addEventListener('click', () => {
      appendPastor(input.value);
      input.value = '';
      input.focus();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addBtn.click();
      }
    });

    bindRemoveHandlers();
  }

  return { render, applyTheme };
})();

window.SettingsView = SettingsView;
