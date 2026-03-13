/* ============================================================
   ABIDE - Home View (Today's Devotion)
   ============================================================ */

const HomeView = (() => {
  let currentSession = DateUtils.session();
  let googlePanelExpanded = false;
  let _tourActive = false;

  function render(container) {
    Router.setTitle('Abide');
    const profile = Store.get('googleProfile');
    Router.setHeaderActions(renderHeaderActions(profile));

    currentSession = Store.get('_sessionOverride') || DateUtils.session();

    const selectedDate = Store.getSelectedDevotionDate();
    const devotionData = Store.getDevotionData(selectedDate);
    const userName = Store.get('userName');
    if (!devotionData && !Store.get('onboardingDone')) {
      renderSetup(container, userName);
      return;
    }

    const div = document.createElement('div');
    div.className = 'view-content tab-switch-enter home-view';

    if (devotionData) {
      renderDevotion(div, devotionData, userName, selectedDate);
    } else {
      renderNoPlan(div, selectedDate);
    }

    container.innerHTML = '';
    container.appendChild(div);

    // Update streak
    Store.updateStreak();

    // Pull-to-refresh (bind once per navigation)
    if (!container._pullBound) {
      container._pullBound = true;
      let _pullStartY = 0;
      let _pulling = false;
      let _refreshPill = null;

      container.addEventListener('touchstart', (e) => {
        // Only activate on the home view
        if (Router.current !== '/') return;
        if (container.scrollTop === 0) {
          _pullStartY = e.touches[0].clientY;
          _pulling = true;
        }
      }, { passive: true });

      container.addEventListener('touchmove', (e) => {
        if (!_pulling) return;
        const delta = e.touches[0].clientY - _pullStartY;
        if (delta > 8 && !_refreshPill) {
          _refreshPill = document.createElement('div');
          _refreshPill.className = 'pull-refresh-pill';
          _refreshPill.textContent = 'Pull to refresh…';
          container.prepend(_refreshPill);
        }
        if (_refreshPill) {
          _refreshPill.style.opacity = String(Math.min(delta / 70, 1));
        }
      }, { passive: true });

      container.addEventListener('touchend', async (e) => {
        if (!_pulling) return;
        _pulling = false;
        const delta = e.changedTouches[0].clientY - _pullStartY;
        if (delta > 60 && _refreshPill) {
          _refreshPill.textContent = 'Syncing…';
          try {
            const googleProfile = Store.get('googleProfile');
            if (googleProfile && window.Sync?.syncForPullToRefresh) {
              // syncForPullToRefresh: validates auth silently (no popup),
              // uploads local changes first, then downloads from Drive.
              await Sync.syncForPullToRefresh();
            }
          } catch (err) {
            if (_refreshPill) { _refreshPill.remove(); _refreshPill = null; }
            if (err.code === 'AUTH_EXPIRED') {
              // Google session expired — show reconnect banner instead of freezing
              _showAuthExpiredBanner(container);
              return;
            }
            if (err.code === 'OFFLINE') {
              if (navigator.onLine) {
                // Online but sync failed (e.g. auth popup timed out) — treat as auth issue
                _showAuthExpiredBanner(container);
              }
              // Truly offline: silently dismiss
              return;
            }
            // Other unexpected errors: dismiss pill, let render continue
          }
          if (_refreshPill) { _refreshPill.remove(); _refreshPill = null; }
          const vc = document.getElementById('view-container');
          if (vc) HomeView.render(vc);
          return;
        }
        if (_refreshPill) { _refreshPill.remove(); _refreshPill = null; }
      }, { passive: true });
    }

    // Auto tutorial only after today's content is actually present.
    const hasTodayContent = !!(devotionData && (devotionData.morning || devotionData.evening));
    if (!Store.get('tutorialSeen') && !_tourActive && hasTodayContent) {
      _tourActive = true;
      setTimeout(() => showTutorialWalkthrough(container), 200);
    }
  }

  function renderSetup(container, userName) {
    const div = document.createElement('div');
    div.className = 'view-content tab-switch-enter home-view';
    div.innerHTML = `
      <div class="setup-prompt">
        <div class="setup-prompt__cross">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect x="27" y="5" width="10" height="54" rx="5" fill="currentColor"/>
            <rect x="5" y="22" width="54" height="10" rx="5" fill="currentColor"/>
          </svg>
        </div>
        <h1 class="setup-prompt__title">Welcome to Abide</h1>
        <p class="setup-prompt__subtitle">A place to meet with God every morning and evening.</p>
        ${!userName ? `
        <div style="width:100%;max-width:300px;">
          <input id="setup-name" class="input" type="text" placeholder="What's your name?" autocomplete="given-name" style="margin-bottom:12px;text-align:center;" />
        </div>
        ` : ''}
        <button class="btn btn-primary" id="setup-start">
          Build Your First Week
        </button>
        <p class="text-sm text-secondary" style="max-width:260px;line-height:1.6;">
          Pick a theme for this week. We'll search for devotional content from trusted pastors and build your week automatically.
        </p>
      </div>
    `;

    container.innerHTML = '';
    container.appendChild(div);

    document.getElementById('setup-start')?.addEventListener('click', () => {
      const nameInput = document.getElementById('setup-name');
      if (nameInput && nameInput.value.trim()) {
        Store.set('userName', nameInput.value.trim());
      }
      Store.set('onboardingDone', true);
      Router.navigate('/plan');
    });
  }

  function renderNoPlan(div, selectedDate) {
    const googleCard = renderGooglePanel();
    div.innerHTML = `
      ${googleCard}
      <div class="empty-state">
        <div class="empty-state__icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
        </div>
        <h2 class="empty-state__title">No devotion for today</h2>
        <p class="empty-state__description">No devotion found for ${DateUtils.format(selectedDate)}. Build this week's plan to start your daily devotions.</p>
        <button class="btn btn-primary" onclick="Router.navigate('/plan')">Build This Week's Plan</button>
        <button class="btn btn-secondary" style="margin-top:10px;" onclick="Router.navigate('/saved')">View Saved Devotionals</button>
      </div>
    `;
  }

  function renderDevotion(div, data, userName, selectedDate) {
    const session = currentSession;
    const sessionData = data[session];
    if (!sessionData) { renderNoPlan(div, selectedDate); return; }

    const isCompleted = Store.isCompleted(selectedDate, session);
    const isSaved = Store.isSavedDevotion(selectedDate, session);
    const dayKeys = Store.getPlanDayKeys();
    const dayIndex = Math.max(0, dayKeys.indexOf(selectedDate));
    const hasPrev = dayIndex > 0;
    const hasNext = dayIndex < dayKeys.length - 1;
    const isFinalDay = dayIndex === dayKeys.length - 1;
    const pendingPlan = Store.getPendingPlanInfo();
    const googleCard = renderGooglePanel();

    div.innerHTML = `
      ${googleCard}
      ${pendingPlan?.activationDate ? `
      <div class="card-enter" style="margin-bottom:12px;">
        <div class="midday-banner">
          <div class="midday-banner__icon">📅</div>
          <div class="midday-banner__content">
            <div class="midday-banner__title">Next Study Queued</div>
            <div class="midday-banner__text">
              <strong>${pendingPlan.theme || 'Next Plan'}</strong> will start on ${DateUtils.format(pendingPlan.activationDate)}.
            </div>
          </div>
        </div>
      </div>` : ''}
      <!-- Greeting -->
      <div class="home-greeting card-enter">
        <div class="home-greeting__time">${DateUtils.format(selectedDate)}</div>
        <h2 class="home-greeting__name">${DateUtils.greeting(userName)}</h2>
      </div>

      <div class="home-session-toggle card-enter" style="margin-top:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <button class="btn btn-secondary btn-sm" ${hasPrev ? '' : 'disabled'} onclick="HomeView.shiftDay(-1)">← Previous</button>
          <div class="text-sm text-secondary">Day ${dayIndex + 1} of ${dayKeys.length || 7}</div>
          <button class="btn btn-secondary btn-sm" ${hasNext ? '' : 'disabled'} onclick="HomeView.shiftDay(1)">Next →</button>
        </div>
      </div>

      <!-- Date + series -->
      <div class="home-date-row card-enter" style="margin-top:6px;margin-bottom:20px;">
        ${data.theme ? `<span class="home-series">${data.theme}</span>` : ''}
        ${renderStreak()}
      </div>

      <!-- Session toggle -->
      <div class="home-session-toggle card-enter">
        <div class="session-toggle" id="home-session-toggle">
          <button class="session-toggle__btn ${session === 'morning' ? 'session-toggle__btn--active' : ''}" data-session="morning">
            ☀️ Morning
          </button>
          <button class="session-toggle__btn ${session === 'evening' ? 'session-toggle__btn--active' : ''}" data-session="evening">
            🌙 Evening
          </button>
        </div>
      </div>

      <!-- Key Verse -->
      <div class="home-verse card-enter">
        ${renderVerseCard(sessionData.opening_verse, session, selectedDate)}
      </div>

      <!-- Scripture splash -->
      <div class="home-devotion-excerpt card-enter">
        ${renderScriptureSplash(sessionData)}
      </div>

      <!-- Reflection prompts -->
      ${sessionData.reflection_prompts?.length ? `
      <div class="home-prompts card-enter">
        <div class="section-header">
          <span class="section-title">Reflect</span>
        </div>
        ${sessionData.reflection_prompts.slice(0, 3).map((p, i) => `
          <div class="prompt-card">
            <div class="prompt-card__number">${i + 1}</div>
            <div class="prompt-card__text">${p}</div>
          </div>
        `).join('')}
      </div>
      ` : ''}

      <!-- Midday prompt (morning only) -->
      ${session === 'morning' && sessionData.midday_prompt ? `
      <div class="home-midday card-enter">
        <div class="midday-banner">
          <div class="midday-banner__icon">⏰</div>
          <div class="midday-banner__content">
            <div class="midday-banner__title">Midday Check-in</div>
            <div class="midday-banner__text">${sessionData.midday_prompt}</div>
          </div>
        </div>
      </div>
      ` : ''}

      <!-- Prayer of the day -->
      ${sessionData.prayer ? `
      <div class="home-prayer card-enter">
        <div class="collapsible" id="prayer-collapsible">
          <button class="collapsible__trigger" onclick="toggleCollapsible('prayer-collapsible')">
            <span class="collapsible__trigger-text">Prayer of the Day</span>
            <svg class="collapsible__chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <div class="collapsible__content">
            <div class="prayer-card">
              <div class="prayer-card__label">A Prayer</div>
              <div class="prayer-card__text">${sessionData.prayer}</div>
            </div>
          </div>
        </div>
      </div>
      ` : ''}

      <!-- Lectio Divina (evening) -->
      ${session === 'evening' && sessionData.lectio_divina ? `
      <div class="card-enter">
        <div class="collapsible" id="lectio-collapsible">
          <button class="collapsible__trigger" onclick="toggleCollapsible('lectio-collapsible')">
            <span class="collapsible__trigger-text">Lectio Divina — ${sessionData.lectio_divina.passage || ''}</span>
            <svg class="collapsible__chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <div class="collapsible__content">
            ${sessionData.lectio_divina.steps.map(s => `
              <div class="lectio-step">
                <div class="lectio-step__name">${s.name}</div>
                <div class="lectio-step__instruction">${s.instruction}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      ` : ''}

      <!-- Faith Stretch -->
      ${data.faith_stretch ? `
      <div class="home-stretch card-enter">
        <div class="section-header">
          <span class="section-title">Faith Stretch</span>
        </div>
        <div class="stretch-card">
          <div class="stretch-card__label">Today's Challenge</div>
          <div class="stretch-card__title">${data.faith_stretch.title}</div>
          <div class="stretch-card__description">${data.faith_stretch.description}</div>
        </div>
      </div>
      ` : ''}

      <!-- Actions -->
      <div class="home-actions card-enter">
        <button class="btn btn-secondary" style="flex:1;" onclick="Router.navigate('/devotion')">
          Read Full Devotion
        </button>
        <button class="btn ${isSaved ? 'btn-primary' : 'btn-secondary'}" style="flex:1;" id="save-devotion-btn" onclick="HomeView.toggleSave()">
          ${isSaved ? 'Saved ✓' : 'Save Devotion'}
        </button>
      </div>

      <div class="home-complete-row card-enter" style="margin-top:10px;">
        <button class="btn btn-secondary btn-full" onclick="HomeView.shareCurrentDevotion()">
          Share Devotion
        </button>
      </div>

      <!-- Complete button -->
      <div class="home-complete-row card-enter">
        <button class="complete-btn ${isCompleted ? 'completed' : ''}" id="complete-btn" onclick="HomeView.toggleComplete()">
          ${isCompleted ? `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            Completed
          ` : `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>
            Mark as Done
          `}
        </button>
      </div>

      <div class="home-complete-row card-enter" style="margin-top:12px;">
        <button class="btn btn-secondary btn-full" onclick="Router.navigate('/saved')">
          View Saved Devotionals
        </button>
      </div>

      ${isFinalDay ? `
      <div class="home-complete-row card-enter" style="margin-top:12px;">
        <button class="btn btn-primary btn-full" onclick="HomeView.prepareNextStudy()">
          Prepare Next Study For Tomorrow
        </button>
      </div>` : ''}
    `;

    // Session toggle listeners
    div.querySelectorAll('.session-toggle__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = btn.dataset.session;
        currentSession = s;
        Store.set('_sessionOverride', s);
        render(document.getElementById('view-container'));
      });
    });

    hydrateOpeningVerse(div, sessionData, selectedDate);
  }

  function renderVerseCard(verse, session, selectedDate) {
    if (!verse) return '';
    const selectedTranslation = API.translationLabel(Store.get('bibleTranslation') || 'web');
    return `
      <div class="scripture-card scripture-card--${session}" data-opening-verse data-date="${selectedDate}">
        <div class="scripture-card__text" data-opening-text>${verse.text || ''}</div>
        <div class="scripture-card__reference" data-opening-ref>${verse.reference || ''}</div>
        <div class="scripture-card__translation" data-opening-translation>${selectedTranslation}</div>
      </div>
    `;
  }

  function renderScriptureSplash(sessionData) {
    const verse = sessionData.opening_verse || {};
    if (!verse.reference && !verse.text) return '';
    const text = verse.text || '';

    return `
      <div class="section-header">
        <span class="section-title">Scripture Splash</span>
        <button class="section-action" onclick="Router.navigate('/devotion')">Read all →</button>
      </div>
      <p class="home-devotion-text" data-splash-scripture>${text}</p>
      <p class="text-xs text-secondary" data-splash-reference>${verse.reference || ''}</p>
    `;
  }

  function renderStreak() {
    const streak = Store.get('currentStreak');
    if (!streak || streak < 2) return '';
    return `
      <div class="streak-badge heartbeat">
        <span class="streak-badge__flame">🔥</span>
        <span class="streak-badge__count">${streak}</span>
        <span class="streak-badge__label">day streak</span>
      </div>
    `;
  }

  function renderGooglePanel() {
    const profile = Store.get('googleProfile');
    if (profile?.email || profile?.name) {
      if (!googlePanelExpanded) return '';
      const avatar = profile.picture
        ? `<img src="${profile.picture}" alt="Google avatar" class="google-avatar" />`
        : `<div class="google-avatar google-avatar--fallback">${(profile.name || profile.email || 'U').slice(0,1).toUpperCase()}</div>`;
      const displayName = profile.name || profile.email || 'Google account';
      return `
        <div class="google-panel-wrap card-enter">
          <div class="google-panel">
            <div class="google-panel__left">
              ${avatar}
              <div class="google-panel__meta">
                <div class="google-panel__title">${displayName}</div>
                <div class="google-panel__email">Google Drive sync</div>
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="HomeView.toggleGooglePanel()">Close</button>
          </div>
          <div class="google-panel__actions">
            <button class="btn btn-ghost btn-sm" onclick="HomeView.syncDownloadNow()">Download</button>
            <button class="btn btn-ghost btn-sm" onclick="HomeView.syncSavedNow()">Upload</button>
          </div>
        </div>
      `;
    }
    return `
      <div class="google-panel card-enter">
        <div class="google-panel__meta">
          <div class="google-panel__title">Sign in with Google</div>
          <div class="google-panel__email">Sync saved devotions across devices.</div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="HomeView.connectGoogle()">Connect</button>
      </div>
    `;
  }

  async function connectGoogle() {
    try {
      await Sync.connectGoogle();
      googlePanelExpanded = true;
      render(document.getElementById('view-container'));
    } catch (err) {
      alert(`Google sign-in failed: ${err.message}`);
    }
  }

  function toggleGooglePanel() {
    googlePanelExpanded = !googlePanelExpanded;
    render(document.getElementById('view-container'));
  }

  function renderHeaderActions(profile) {
    const hasGoogle = !!(profile?.email || profile?.name);
    const avatar = hasGoogle
      ? (profile.picture
        ? `<img src="${profile.picture}" alt="Google account" class="header-google-avatar" />`
        : `<span class="header-google-avatar header-google-avatar--fallback">${(profile.name || profile.email || 'U').slice(0,1).toUpperCase()}</span>`)
      : `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M8 12h8"></path>
        </svg>
      `;

    const googleAction = hasGoogle
      ? `
      <button class="icon-btn" id="home-google-btn" title="Google Sync" onclick="HomeView.toggleGooglePanel()" aria-label="Google Sync">
        ${avatar}
      </button>
      `
      : `
      <button class="icon-btn" id="home-google-btn" title="Connect Google" onclick="HomeView.connectGoogle()" aria-label="Connect Google">
        ${avatar}
      </button>
      `;

    // Also update the desktop sidebar profile whenever home renders / sign-in state changes
    if (typeof Router !== 'undefined' && Router.updateSidebarProfile) {
      Router.updateSidebarProfile();
    }

    return `
      ${googleAction}
      <button class="icon-btn" id="home-build-btn" title="Build This Week" onclick="Router.navigate('/plan')" aria-label="Build This Week">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    `;
  }

  async function syncSavedNow() {
    try {
      const result = await Sync.pushSavedDevotions();
      alert(`Uploaded ${result.count || 0} saved devotionals, ${result.journals || 0} journal entries, ${result.askChats || 0} saved Bible chats, and settings metadata to Google Drive.`);
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    }
  }

  async function syncDownloadNow() {
    try {
      const result = await Sync.pullSavedDevotions();
      if (!result.imported) {
        alert('No synced Drive file found yet.');
        return;
      }
      alert(`Downloaded ${result.importedLibrary || 0} saved devotionals, ${result.importedJournal || 0} journal entries, ${result.importedAskBibleChats || 0} saved Bible chats, and settings metadata.`);
    } catch (err) {
      if (err.code === 'AUTH_EXPIRED') {
        const vc = document.getElementById('view-container');
        if (vc) _showAuthExpiredBanner(vc);
        return;
      }
      if (err.code === 'OFFLINE') {
        alert('No internet connection. Connect to Wi-Fi or cellular to sync.');
        return;
      }
      alert(`Download failed: ${err.message}`);
    }
  }

  function _showAuthExpiredBanner(container) {
    // Remove any existing banner
    container.querySelector('.auth-expired-banner')?.remove();
    const banner = document.createElement('div');
    banner.className = 'auth-expired-banner';
    banner.style.cssText = 'position:sticky;top:0;z-index:100;background:var(--color-warning-bg,#fff3cd);border-bottom:1px solid var(--color-warning-border,#ffc107);padding:10px 16px;display:flex;align-items:center;gap:12px;font-size:var(--text-sm);';
    banner.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:var(--color-warning,#856404)"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span style="flex:1;color:var(--color-warning,#856404)">Google session expired.</span>
      <button class="btn btn-sm btn-primary" onclick="HomeView.connectGoogle().then(()=>this.closest('.auth-expired-banner')?.remove())">Reconnect</button>
      <button onclick="this.closest('.auth-expired-banner').remove()" style="background:none;border:none;cursor:pointer;font-size:18px;line-height:1;color:var(--text-secondary);" aria-label="Dismiss">×</button>
    `;
    container.prepend(banner);
    if (typeof Router !== 'undefined' && Router.updateSidebarProfile) Router.updateSidebarProfile();
  }

  function toggleComplete() {
    const selectedDate = Store.getSelectedDevotionDate();
    const session = currentSession;
    const isNow = Store.isCompleted(selectedDate, session);
    if (!isNow) {
      Store.markCompleted(selectedDate, session);
      haptic([12]);
      const btn = document.getElementById('complete-btn');
      if (btn) {
        btn.classList.add('completed');
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          Completed
        `;
      }
    }
  }

  async function askSaveScope() {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'abide-delete-dialog-backdrop';
      backdrop.innerHTML = `
        <div class="abide-delete-dialog" role="dialog" aria-modal="true" aria-label="Save devotion">
          <div class="abide-delete-dialog__title">Save Devotion</div>
          <div class="abide-delete-dialog__body">
            Choose what to save from this week.
          </div>
          <div class="abide-delete-dialog__actions">
            <button class="btn btn-secondary btn-sm" data-save-action="cancel">Cancel</button>
            <button class="btn btn-secondary btn-sm" data-save-action="single">Save this devotion</button>
            <button class="btn btn-primary btn-sm" data-save-action="week">Save full week series</button>
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
      backdrop.querySelector('[data-save-action="cancel"]')?.addEventListener('click', () => close(''));
      backdrop.querySelector('[data-save-action="single"]')?.addEventListener('click', () => close('single'));
      backdrop.querySelector('[data-save-action="week"]')?.addEventListener('click', () => close('week'));

      document.body.appendChild(backdrop);
    });
  }

  async function toggleSave() {
    const selectedDate = Store.getSelectedDevotionDate();
    const isSaved = Store.isSavedDevotion(selectedDate, currentSession);
    let saved = isSaved;

    if (isSaved) {
      saved = Store.toggleSavedDevotion(selectedDate, currentSession);
    } else {
      const choice = await askSaveScope();
      if (!choice) return;
      if (choice === 'week') {
        Store.saveEntirePlan();
        saved = true;
      } else {
        saved = Store.toggleSavedDevotion(selectedDate, currentSession);
      }
    }

    haptic([8]);
    const btn = document.getElementById('save-devotion-btn');
    if (btn) {
      btn.className = `btn ${saved ? 'btn-primary' : 'btn-secondary'}`;
      btn.textContent = saved ? 'Saved ✓' : 'Save Devotion';
    }
  }

  function shiftDay(offset) {
    const next = Store.shiftSelectedDevotionDay(offset);
    if (!next) return;
    render(document.getElementById('view-container'));
  }

  function prepareNextStudy() {
    Store.set('planBuildStartMode', 'tomorrow');
    Router.navigate('/plan');
  }

  async function shareCurrentDevotion() {
    const dateKey = Store.getSelectedDevotionDate();
    const dayData = Store.getDevotionData(dateKey);
    const sessionData = dayData?.[currentSession];
    const payload = DevotionShare.fromCurrentDay(dayData, currentSession, dateKey);
    if (!payload) {
      alert('No devotion loaded to share yet.');
      return;
    }
    if (Store.get('googleProfile')) {
      try {
        const shared = await Sync.createSharedCurrentWeekLink();
        const linkShare = await DevotionShare.shareLink({
          title: `${dayData?.theme || 'Weekly Devotional'} — Shared Abide Week`,
          text: 'Open this shared weekly devotion series from Abide',
          url: shared.shareUrl,
        });
        if (!linkShare.ok && !linkShare.aborted) {
          alert(`Share failed: ${linkShare.error || 'Could not share devotion link.'}`);
          return;
        }
        if (linkShare.method === 'clipboard') alert('Share link copied to clipboard.');
        return;
      } catch (err) {
        alert(`Google share failed: ${err.message}`);
        return;
      }
    }
    const result = await DevotionShare.share(payload);
    if (!result.ok && !result.aborted) {
      alert(`Share failed: ${result.error || 'Could not share devotion.'}`);
      return;
    }
    if (result.method === 'clipboard') {
      alert('Devotion copied to clipboard.');
    }
  }

  async function hydrateOpeningVerse(root, sessionData, selectedDate) {
    const ref = sessionData?.opening_verse?.reference;
    if (!ref) return;
    const selectedRef = Store.getSelectedDevotionDate();
    if (selectedRef !== selectedDate) return;

    try {
      const data = await API.getPassage(ref);
      if (Store.getSelectedDevotionDate() !== selectedDate) return;
      const text = (data.text || '').trim();
      const translation = API.translationLabel(data.translation_id || Store.get('bibleTranslation'));
      const textEl = root.querySelector('[data-opening-text]');
      const refEl = root.querySelector('[data-opening-ref]');
      const translationEl = root.querySelector('[data-opening-translation]');
      const splashText = root.querySelector('[data-splash-scripture]');
      const splashRef = root.querySelector('[data-splash-reference]');
      if (textEl && text) textEl.textContent = text;
      if (refEl) refEl.textContent = ref;
      if (translationEl) translationEl.textContent = translation;
      if (splashText && text) splashText.textContent = text;
      if (splashRef) splashRef.textContent = ref;
    } catch (err) {
      console.warn('Could not hydrate opening verse:', err);
    }
  }

  function showTutorialWalkthrough(container) {
    const STEPS = [
      {
        route: '/', selector: '[data-tab="home"]', calloutPos: 'above', highlightPadding: 8,
        title: 'Start On Today',
        body: "The Today tab is your home base for daily devotion, scripture, and reflection.",
      },
      {
        route: '/', selector: '#home-build-btn', calloutPos: 'below', highlightPadding: 10,
        title: 'Build A Weekly Plan',
        body: "Tap + to generate a fresh 7-day plan. You can replace now, queue a plan for tomorrow, and keep plan history.",
      },
      {
        route: '/plan', selector: '#pastor-chips', calloutPos: 'below', highlightPadding: 10,
        title: 'Choose Pastor Influence',
        body: "Tap pastor chips to include/exclude who influences AI generation. These choices stay synced with Settings.",
      },
      {
        route: '/plan', selector: '.plan-dictation-row', calloutPos: 'below', highlightPadding: 10,
        title: 'Enter Your Topic',
        body: "Pick a suggested topic, type your own, or dictate with the mic. Long prompts are summarized into a short series title.",
      },
      {
        route: '/plan', selector: '#build-btn', calloutPos: 'above', highlightPadding: 10,
        title: 'Generate The Week',
        body: "Tap Build to generate a full week of morning and evening devotions. You can Save Full Week and restore from Saved Series later.",
      },
      {
        route: '/', selector: '#home-google-btn', calloutPos: 'below', highlightPadding: 10,
        title: 'Google Sync & Profile',
        body: "Tap your avatar/Google icon to connect Drive, then upload/download devotions, journal entries, saved Bible chats, and settings metadata across devices.",
      },
      {
        route: '/', selector: '#home-session-toggle', calloutPos: 'below', highlightPadding: 10,
        title: 'Navigate Your Week',
        body: "Use Previous/Next day and Morning/Evening toggles to move through each day of your active week.",
      },
      {
        route: '/scripture', selector: '[data-tab="scripture"]', calloutPos: 'above', highlightPadding: 8,
        title: 'Scripture Workspace',
        body: 'Scripture supports reference lookup, topic/phrase discovery, translation compare, highlights, memory practice, and deeper study tools.',
      },
      {
        route: '/scripture', selector: '#mode-phrase', calloutPos: 'below', highlightPadding: 10,
        title: 'Topic / Phrase Search',
        body: 'Switch to Topic/Phrase mode to find related passages. Results can be AI-ranked with reasoning and provider/model labels.',
      },
      {
        route: '/scripture', selector: '#passage-back-results-btn', calloutPos: 'above', highlightPadding: 10,
        title: 'Return To Search Results',
        body: 'After opening one result, use Back to Results to continue the same search without retyping the phrase.',
        setup: async () => {
          if (window.ScriptureView?.searchPhrase && window.ScriptureView?.loadPassageFromPhrase) {
            await window.ScriptureView.searchPhrase('abide in christ');
            await window.ScriptureView.loadPassageFromPhrase('John 15:5');
          }
        },
      },
      {
        route: '/scripture', selector: '#passage-dive-btn', calloutPos: 'below', highlightPadding: 10,
        title: 'Deep Dive Any Verse',
        body: "Dive Deeper works on any verse, with word-level study and context. John 15:5 is shown here because it inspired the name Abide.",
        setup: async () => {
          if (window.ScriptureView?.loadPassage) {
            await window.ScriptureView.loadPassage('John 15:5');
          }
        },
      },
      {
        route: '/scripture', selector: '#passage-parallel-btn', calloutPos: 'below', highlightPadding: 10,
        title: 'Compare + Context',
        body: "Use Compare for side-by-side translation reading, then open Historical Context and See Also for linked study.",
      },
      {
        route: '/prayer', selector: '[data-tab="prayer"]', calloutPos: 'above', highlightPadding: 8,
        title: 'Guided Prayer',
        body: "Use Prayer to walk through structured prayer frameworks and stay consistent when you don't know where to start.",
      },
      {
        route: '/journal', selector: '[data-tab="journal"]', calloutPos: 'above', highlightPadding: 8,
        title: 'Personal Journal',
        body: "Capture daily prompts, faith-stretch reflections, and past entries. Save locally, then sync to Drive when connected.",
      },
      {
        route: '/journal', selector: '#journal-ask-panel', calloutPos: 'above', highlightPadding: 10,
        title: 'Ask The Bible',
        body: "Use this built-in Bible Q&A panel for follow-up questions directly from the Journal page.",
      },
      {
        route: '/saved', selector: '.section-header', calloutPos: 'below', highlightPadding: 10,
        title: 'Saved Series Library',
        body: "Saved devotionals are grouped into series. Use This Week restores a saved series; Download/Upload keeps devices in sync.",
      },
      {
        route: '/settings', selector: '#settings-appearance-section .settings-group', calloutPos: 'below', highlightPadding: 10,
        title: 'Appearance & Translation',
        body: "Choose your color palette and app theme. You can also pick Bible translation: WEB is public-domain default; ESV is available for personal devotional use.",
      },
      {
        route: '/settings', selector: '#settings-notifications-section .settings-group', calloutPos: 'below', highlightPadding: 10,
        title: 'Daily Reminders',
        body: "Enable notifications for morning/evening reminders and Sunday plan prompts. iOS will ask for permission when you save.",
      },
      {
        route: '/settings', selector: '#settings-pastors-section .settings-group', calloutPos: 'below', highlightPadding: 10,
        title: 'Trusted Pastors & Teachers',
        body: "Add/remove teachers here. The plan builder only draws influence from who is enabled.",
      },
    ];

    let stepIndex = 0;

    // Spotlight div — box-shadow trick dims everything outside the highlighted rect
    const highlightEl = document.createElement('div');
    highlightEl.className = 'tour-highlight';
    document.body.appendChild(highlightEl);

    // Interaction blocker (prevents accidental taps on underlying UI)
    const blockerEl = document.createElement('div');
    blockerEl.className = 'tour-blocker';
    blockerEl.addEventListener('click', (e) => e.preventDefault());
    blockerEl.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    document.body.appendChild(blockerEl);

    // Callout tooltip div
    const calloutEl = document.createElement('div');
    calloutEl.className = 'tour-callout';
    document.body.appendChild(calloutEl);

    async function goToStep(index) {
      if (index >= STEPS.length) { dismissTour(); return; }
      stepIndex = index;
      const step = STEPS[index];
      const prevStep = index > 0 ? STEPS[index - 1] : null;
      const needsNav = !prevStep || prevStep.route !== step.route;

      // Hide callout/highlight while navigating
      calloutEl.classList.remove('tour-callout--visible');
      highlightEl.classList.remove('tour-highlight--visible');

      async function showStep() {
        try {
          if (typeof step.setup === 'function') {
            await step.setup();
          }
        } catch (err) {
          console.warn('Tutorial step setup failed:', err);
        }
        const target = await waitForTarget(step.selector, 8, 120);
        if (!target) {
          // Skip missing targets (prevents blank/odd states on dynamic views)
          await goToStep(stepIndex + 1);
          return;
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => positionCoachMark(step, target), 300);
      }

      if (needsNav) {
        Router.navigate(step.route);
        setTimeout(showStep, 450);
      } else {
        setTimeout(showStep, 80);
      }
    }

    async function waitForTarget(selector, tries = 8, delay = 120) {
      for (let i = 0; i < tries; i += 1) {
        const target = findTarget(selector);
        if (target) return target;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return null;
    }

    function findTarget(selector) {
      const scoped = Array.from(document.querySelectorAll(`#view-container ${selector}`))
        .filter(el => !el.closest('.view-exit'));
      if (scoped.length) return scoped[scoped.length - 1];
      return document.querySelector(selector);
    }

    function positionCoachMark(step, target) {
      const pad = step.highlightPadding || 8;
      const CALLOUT_WIDTH = Math.min(300, window.innerWidth - 24);

      // Treat target as absent if its rect falls outside the visible viewport —
      // this prevents the box-shadow from covering the whole screen when the
      // highlighted element (e.g. a tab icon) is below the Safari bottom bar.
      const rect = target ? target.getBoundingClientRect() : null;
      // Use visual viewport height when available (accounts for iOS Safari chrome).
      const vvHeight = (window.visualViewport ? window.visualViewport.height : window.innerHeight);
      const isVisible = rect &&
        rect.width > 0 && rect.height > 0 &&
        rect.top  < vvHeight && rect.bottom > 0 &&
        rect.left < window.innerWidth  && rect.right  > 0;

      if (target && isVisible) {
        // Position spotlight
        highlightEl.style.left   = (rect.left - pad) + 'px';
        highlightEl.style.top    = (rect.top - pad) + 'px';
        highlightEl.style.width  = (rect.width + pad * 2) + 'px';
        highlightEl.style.height = (rect.height + pad * 2) + 'px';
        highlightEl.classList.add('tour-highlight--visible');

        // Build callout HTML
        const isLast = stepIndex === STEPS.length - 1;
        calloutEl.className = 'tour-callout'; // reset modifier classes
        calloutEl.innerHTML = `
          <button class="tour-callout__skip" aria-label="Skip tutorial">Skip</button>
          <p class="tour-callout__step">${stepIndex + 1} of ${STEPS.length}</p>
          <h3 class="tour-callout__title">${step.title}</h3>
          <p class="tour-callout__body">${step.body}</p>
          <div class="tour-callout__dots">
            ${STEPS.map((_, i) => `<span class="tour-callout__dot${i === stepIndex ? ' active' : ''}"></span>`).join('')}
          </div>
          <div class="tour-callout__actions">
            <button class="btn btn-secondary tour-callout__back" ${stepIndex === 0 ? 'disabled' : ''}>
              ← Back
            </button>
            <button class="btn btn-primary tour-callout__next">
              ${isLast ? 'Done ✓' : 'Next →'}
            </button>
          </div>
        `;

        // Horizontal: centred on target, clamped to viewport edges
        let left = rect.left + rect.width / 2 - CALLOUT_WIDTH / 2;
        left = Math.max(12, Math.min(left, window.innerWidth - CALLOUT_WIDTH - 12));

        calloutEl.style.width = CALLOUT_WIDTH + 'px';
        calloutEl.style.left = left + 'px';
        calloutEl.style.removeProperty('bottom');
        calloutEl.style.top = '12px';

        const tabBarHeight = document.getElementById('tab-bar')?.offsetHeight || 0;
        const safeTop = 12;
        const iOSInset = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 20 : 0;
        const safeBottom = tabBarHeight + 16 + iOSInset;
        const maxHeight = Math.max(220, window.innerHeight - safeTop - safeBottom);
        calloutEl.style.maxHeight = `${maxHeight}px`;

        const calloutHeight = calloutEl.offsetHeight || 320;
        const preferAbove = step.calloutPos === 'above';
        const aboveTop = rect.top - calloutHeight - pad - 8;
        const belowTop = rect.bottom + pad + 8;

        let top = preferAbove ? aboveTop : belowTop;
        const minTop = safeTop;
        const maxTop = Math.max(minTop, window.innerHeight - safeBottom - calloutHeight);
        if (top > maxTop) top = maxTop;
        if (top < minTop) top = minTop;
        calloutEl.style.top = `${top}px`;
      } else {
        // No target found or target is off-screen — show centered callout, no spotlight
        highlightEl.classList.remove('tour-highlight--visible');

        const isLast = stepIndex === STEPS.length - 1;
        calloutEl.className = 'tour-callout tour-callout--centered';
        calloutEl.innerHTML = `
          <button class="tour-callout__skip" aria-label="Skip tutorial">Skip</button>
          <p class="tour-callout__step">${stepIndex + 1} of ${STEPS.length}</p>
          <h3 class="tour-callout__title">${step.title}</h3>
          <p class="tour-callout__body">${step.body}</p>
          <div class="tour-callout__dots">
            ${STEPS.map((_, i) => `<span class="tour-callout__dot${i === stepIndex ? ' active' : ''}"></span>`).join('')}
          </div>
          <div class="tour-callout__actions">
            <button class="btn btn-secondary tour-callout__back" ${stepIndex === 0 ? 'disabled' : ''}>
              ← Back
            </button>
            <button class="btn btn-primary tour-callout__next">
              ${isLast ? 'Done ✓' : 'Next →'}
            </button>
          </div>
        `;

        calloutEl.style.removeProperty('left');
        calloutEl.style.removeProperty('top');
        calloutEl.style.removeProperty('bottom');
        calloutEl.style.width = CALLOUT_WIDTH + 'px';
        const tabBarHeight = document.getElementById('tab-bar')?.offsetHeight || 0;
        const maxHeight = Math.max(220, window.innerHeight - tabBarHeight - 24);
        calloutEl.style.maxHeight = `${maxHeight}px`;
      }

      requestAnimationFrame(() => calloutEl.classList.add('tour-callout--visible'));

        calloutEl.querySelector('.tour-callout__skip').addEventListener('click', dismissTour);
        calloutEl.querySelector('.tour-callout__back')?.addEventListener('click', () => {
        if (stepIndex > 0) void goToStep(stepIndex - 1);
        });
      calloutEl.querySelector('.tour-callout__next').addEventListener('click', () => {
        if (stepIndex === STEPS.length - 1) haptic([15, 8, 15]); // celebratory on Done
        void goToStep(stepIndex + 1);
      });
    }

    function dismissTour() {
      _tourActive = false;
      Store.set('tutorialSeen', true);
      highlightEl.classList.remove('tour-highlight--visible');
      calloutEl.classList.remove('tour-callout--visible');
      setTimeout(() => {
        highlightEl.remove();
        blockerEl.remove();
        calloutEl.remove();
        Router.navigate('/');
        setTimeout(() => {
          const vc = document.getElementById('view-container');
          if (vc) render(vc);
        }, 350);
      }, 240);
    }

    // Kick off from step 0
    void goToStep(0);
  }

  return { render, toggleComplete, toggleSave, shiftDay, connectGoogle, syncSavedNow, syncDownloadNow, toggleGooglePanel, shareCurrentDevotion, prepareNextStudy };
})();

// Global collapsible toggle helper
function toggleCollapsible(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('open');
}

window.HomeView = HomeView;
