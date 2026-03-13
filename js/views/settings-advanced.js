/* ============================================================
   ABIDE - Advanced Settings
   ============================================================ */

const SettingsAdvancedView = (() => {
  function escapeHtml(text = '') {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function render(container) {
    Router.setTitle('Advanced');
    Router.clearHeaderActions();

    const state = Store.get();
    const usageStats = Store.getUsageStats();
    const usageLimits = Store.getUsageLimits();
    const lastAIPlanMeta = state.lastAIPlanMeta || null;
    const lastAIPhraseMeta = state.lastAIPhraseMeta || null;
    const savedCount = (state.savedDevotions || []).length;

    const div = document.createElement('div');
    div.className = 'view-content tab-switch-enter';
    div.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">Usage & Limits</div>
        <div class="settings-group">
          <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
            <div class="settings-row__value">Tracking month: <strong>${usageStats.monthKey || 'n/a'}</strong></div>
            <div style="width:100%;padding:var(--space-3);background:var(--bg-sunken);border-radius:var(--radius-sm);font-size:var(--text-sm);line-height:1.65;">
              <div>Bible passage queries: <strong>${usageStats.bibleQueries}</strong> / ${usageLimits.bibleQueries}</div>
              <div>ESV passage queries: <strong>${usageStats.esvQueries}</strong> / ${usageLimits.esvQueries}</div>
              <div>AI plan builds: <strong>${usageStats.aiPlanRequests}</strong> / ${usageLimits.aiPlanRequests}</div>
              <div>AI phrase searches: <strong>${usageStats.aiPhraseQueries}</strong> / ${usageLimits.aiPhraseQueries}</div>
            </div>
            <div style="width:100%;padding:var(--space-3);background:var(--bg-sunken);border-radius:var(--radius-sm);font-size:var(--text-sm);line-height:1.6;">
              <div><strong>Latest AI Plan:</strong> ${escapeHtml(lastAIPlanMeta?.provider || 'n/a')} ${Array.isArray(lastAIPlanMeta?.models) ? escapeHtml(lastAIPlanMeta.models.join(', ')) : ''}</div>
              <div><strong>Latest Phrase Search:</strong> ${escapeHtml(lastAIPhraseMeta?.provider || 'n/a')} ${escapeHtml(lastAIPhraseMeta?.model || '')}</div>
            </div>
          </div>
          <div class="settings-row settings-row--stacked"><div class="settings-row__content"><div class="settings-row__label">Soft Limit: Bible Queries / month</div></div><div class="settings-row__action"><input id="limit-bible" class="input" type="number" min="1" step="1" value="${usageLimits.bibleQueries}" /></div></div>
          <div class="settings-row settings-row--stacked"><div class="settings-row__content"><div class="settings-row__label">Soft Limit: ESV Queries / month</div></div><div class="settings-row__action"><input id="limit-esv" class="input" type="number" min="1" step="1" value="${usageLimits.esvQueries}" /></div></div>
          <div class="settings-row settings-row--stacked"><div class="settings-row__content"><div class="settings-row__label">Soft Limit: AI Plan Builds / month</div></div><div class="settings-row__action"><input id="limit-ai-plan" class="input" type="number" min="1" step="1" value="${usageLimits.aiPlanRequests}" /></div></div>
          <div class="settings-row settings-row--stacked"><div class="settings-row__content"><div class="settings-row__label">Soft Limit: AI Phrase Searches / month</div></div><div class="settings-row__action"><input id="limit-ai-phrase" class="input" type="number" min="1" step="1" value="${usageLimits.aiPhraseQueries}" /></div></div>
          <div class="settings-row" style="justify-content:flex-end;"><button class="btn btn-ghost btn-sm" id="reset-usage-btn" type="button">Reset Usage Counters</button></div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Worker</div>
        <div class="settings-group">
          <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
            <div class="settings-row__value">Default: <code>https://abide-worker.mattlmccoy.workers.dev</code></div>
            <input id="worker-url" class="input" type="url" placeholder="Override URL (optional)" value="${escapeHtml(state.workerUrl || '')}" />
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">AI Routing Checks</div>
        <div class="settings-group">
          <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
            <div id="routing-status" class="settings-row__value">Loading provider status...</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" id="refresh-routing-btn">Refresh</button>
              <button class="btn btn-secondary btn-sm" id="probe-routing-btn">Run Probe</button>
            </div>
            <div id="routing-results" style="width:100%;font-size:var(--text-xs);color:var(--text-secondary);line-height:1.6;"></div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Google Drive Sync</div>
        <div class="settings-group">
          <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
            <div class="settings-row__value">Saved devotions on this device: <strong>${savedCount}</strong></div>
            <div class="text-xs text-muted">Sync file is stored in a visible Google Drive folder named <strong>abidefaith-docs</strong>.</div>
            <input id="google-client-id" class="input" type="text" placeholder="Google OAuth Client ID" value="${escapeHtml(state.googleClientId || '')}" />
            <div class="text-xs text-muted">Default client ID is preconfigured for all users. Override only if you host your own OAuth app.</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" id="connect-google-btn">Sign In Google</button>
              <button class="btn btn-secondary btn-sm" id="push-sync-btn">Upload Devotions + Journal</button>
              <button class="btn btn-secondary btn-sm" id="pull-sync-btn">Download Devotions + Journal</button>
            </div>
            <div id="sync-status" class="text-xs text-muted">
              Last sync: ${state.lastDriveSyncAt ? escapeHtml(new Date(state.lastDriveSyncAt).toLocaleString()) : 'Never'}
            </div>
          </div>
        </div>
      </div>

      <button class="btn btn-primary btn-full" id="save-advanced-settings" style="margin-bottom:var(--space-3);">Save Advanced Settings</button>
      <button class="btn btn-ghost btn-full" onclick="Router.navigate('/settings')" style="margin-bottom:var(--space-6);">Back to Settings</button>
    `;

    container.innerHTML = '';
    container.appendChild(div);
    setupListeners(div);
    refreshRouting(div);
  }

  async function refreshRouting(root) {
    const statusEl = root.querySelector('#routing-status');
    const resultsEl = root.querySelector('#routing-results');
    try {
      const [providers, routing] = await Promise.all([
        API.getAIProviders(),
        API.getAIRouting(),
      ]);
      const configured = providers.providers || {};
      const lines = (routing.providerOrder || []).map((p) => {
        const c = configured[p];
        const r = routing.providers?.[p] || {};
        return `${p}: ${c?.configured ? 'configured' : 'not configured'} | score ${Number(r.score || 0).toFixed(2)} | 429 streak ${r.consecutive429 || 0}${r.coolingDown ? ' | cooling down' : ''}`;
      });
      if (statusEl) statusEl.textContent = `Best route right now: ${routing.bestProvider || 'n/a'}`;
      if (resultsEl) resultsEl.innerHTML = lines.map(l => `<div>${escapeHtml(l)}</div>`).join('');
    } catch (err) {
      if (statusEl) statusEl.textContent = `Could not load routing info: ${err.message}`;
      if (resultsEl) resultsEl.textContent = '';
    }
  }

  function setupListeners(root) {
    root.querySelector('#save-advanced-settings')?.addEventListener('click', () => {
      const workerUrl = root.querySelector('#worker-url')?.value?.trim() || '';
      const googleClientId = root.querySelector('#google-client-id')?.value?.trim() || '';

      Store.update({ workerUrl, googleClientId });
      Store.setUsageLimits({
        bibleQueries: Number(root.querySelector('#limit-bible')?.value || 0),
        esvQueries: Number(root.querySelector('#limit-esv')?.value || 0),
        aiPlanRequests: Number(root.querySelector('#limit-ai-plan')?.value || 0),
        aiPhraseQueries: Number(root.querySelector('#limit-ai-phrase')?.value || 0),
      });
      const btn = root.querySelector('#save-advanced-settings');
      if (btn) {
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.textContent = 'Save Advanced Settings'; }, 1200);
      }
    });

    root.querySelector('#reset-usage-btn')?.addEventListener('click', () => {
      Store.resetUsageStats();
      render(document.getElementById('view-container'));
    });

    root.querySelector('#refresh-routing-btn')?.addEventListener('click', () => refreshRouting(root));
    root.querySelector('#probe-routing-btn')?.addEventListener('click', async () => {
      const statusEl = root.querySelector('#routing-status');
      if (statusEl) statusEl.textContent = 'Running provider probe...';
      try {
        const result = await API.probeAIProviders();
        if (statusEl) statusEl.textContent = `Probe completed (${(result.results || []).length} providers).`;
      } catch (err) {
        if (statusEl) statusEl.textContent = `Probe failed: ${err.message}`;
      }
      await refreshRouting(root);
    });

    root.querySelector('#connect-google-btn')?.addEventListener('click', async () => {
      const statusEl = root.querySelector('#sync-status');
      try {
        const profile = await Sync.connectGoogle();
        if (statusEl) statusEl.textContent = `Google connected: ${profile.name || profile.email || 'Account linked'}.`;
      } catch (err) {
        if (statusEl) statusEl.textContent = `Google sign-in failed: ${err.message}`;
      }
    });

    root.querySelector('#push-sync-btn')?.addEventListener('click', async () => {
      const statusEl = root.querySelector('#sync-status');
      try {
        const result = await Sync.pushSavedDevotions();
        if (statusEl) statusEl.textContent = `Uploaded ${result.count} saved devotions, ${result.journals || 0} journal entries, ${result.askChats || 0} saved Bible chats, and settings metadata to ${result.files || 7} files in "abidefaith-docs".`;
      } catch (err) {
        if (statusEl) statusEl.textContent = `Upload failed: ${err.message}`;
      }
    });

    root.querySelector('#pull-sync-btn')?.addEventListener('click', async () => {
      const statusEl = root.querySelector('#sync-status');
      try {
        const result = await Sync.pullSavedDevotions();
        if (!result.imported) {
          if (statusEl) statusEl.textContent = 'No existing Drive file found yet.';
          return;
        }
        if (statusEl) statusEl.textContent = `Downloaded ${result.importedLibrary || 0} saved devotional records, ${result.importedJournal || 0} journal entries, ${result.importedAskBibleChats || 0} saved Bible chats, ${result.importedPastors || 0} pastors, ${result.importedPlanDays || 0} plan days. Library total: ${result.count}.`;
      } catch (err) {
        if (statusEl) statusEl.textContent = `Download failed: ${err.message}`;
      }
    });
  }

  return { render };
})();

window.SettingsAdvancedView = SettingsAdvancedView;
