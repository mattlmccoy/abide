/* ============================================================
   ABIDE - Main Entry Point
   ============================================================ */

(function () {
  'use strict';
  const APP_VERSION = '2026.03.12.1';
  window.__ABIDE_VERSION__ = APP_VERSION;
  window.__ABIDE_SW_VERSION__ = 'abide-v80';

  function getBasePath() {
    const path = window.location.pathname || '/';
    if (path.endsWith('.html')) {
      return path.slice(0, path.lastIndexOf('/') + 1);
    }
    return path.endsWith('/') ? path : `${path}/`;
  }

  // --- Haptic feedback (Android vibration; silently ignored on iOS) ---
  window.haptic = function haptic(pattern = [8]) {
    try { navigator.vibrate?.(pattern); } catch (_) {}
  };

  // --- Theme init (before render, to prevent flash) ---
  function initTheme() {
    const theme = Store.get('theme') || 'auto';
    SettingsView.applyTheme(theme);
  }

  // --- Palette init (before render, prevent flash) ---
  function initPalette() {
    const palette = Store.get('palette') || 'tuscan-sunset';
    document.documentElement.dataset.palette = palette;
  }

  // --- Standalone detection (iOS PWA home-screen mode) ---
  function initStandalone() {
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) {
      document.documentElement.dataset.standalone = 'true';
    }
  }

  // --- Register service worker ---
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;

    const basePath = getBasePath();

    // Capture controller state BEFORE registering so we can distinguish a
    // genuine update (existing controller replaced) from a first-time install
    // (no previous controller), preventing a spurious reload on fresh installs.
    const hadController = !!navigator.serviceWorker.controller;
    let swReloading = false;

    function reloadForUpdate() {
      if (!swReloading && hadController) {
        swReloading = true;
        window.location.reload();
      }
    }

    // Primary path: new SW sends SW_UPDATED via postMessage after clients.claim().
    // More reliable on iOS Safari than waiting for the controllerchange event.
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SW_UPDATED') reloadForUpdate();
    });

    // Fallback: controllerchange fires when a new SW takes over the page.
    navigator.serviceWorker.addEventListener('controllerchange', reloadForUpdate);

    // iOS PWA: users background the app for days. On every foreground, do two things:
    //  1. reg.update() — triggers a fresh SW fetch; if a new SW is available it will
    //     install + activate and the SW_UPDATED postMessage path handles the reload.
    //  2. Cache version check — handles the case where the SW *already* updated while
    //     the app was backgrounded (JS was suspended, so SW_UPDATED was never received).
    //     The SW writes its version to 'abide-meta' on every activate; comparing that
    //     to the version baked into this page detects staleness without any message.
    function checkForSwUpdate(reg) {
      if (swReloading) return;
      reg.update().catch(() => {});
      if ('caches' in window) {
        caches.open('abide-meta')
          .then(cache  => cache.match('sw-version'))
          .then(resp   => resp ? resp.text() : null)
          .then(cachedVer => {
            if (cachedVer && cachedVer !== window.__ABIDE_SW_VERSION__) reloadForUpdate();
          })
          .catch(() => {});
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      navigator.serviceWorker.ready.then(reg => checkForSwUpdate(reg)).catch(() => {});
    });

    // Periodic check every 30 min — guards against iOS JS suspension killing
    // the visibilitychange handler, and covers apps left open in the foreground.
    navigator.serviceWorker.ready.then(reg => {
      setInterval(() => checkForSwUpdate(reg), 30 * 60 * 1000);
    }).catch(() => {});

    navigator.serviceWorker.register(`${basePath}sw.js?v=${encodeURIComponent(APP_VERSION)}`, {
      scope: basePath,
      updateViaCache: 'none',
    })
      .then(reg => {
        console.log('[Abide] SW registered:', reg.scope);
        // Proactively check for an updated SW every time the app loads.
        reg.update().catch(() => {});
      })
      .catch(err => {
        console.warn('[Abide] SW registration failed:', err);
      });
  }

  // --- Register routes ---
  function registerRoutes() {
    Router.register('/', (container) => {
      Router.setTitle('Abide');
      HomeView.render(container);
    });

    Router.register('/devotion', (container) => {
      Router.setTitle('Devotion');
      DevotionView.render(container);
    });

    Router.register('/saved', (container) => {
      Router.setTitle('Saved Devotionals');
      SavedView.render(container);
    });

    Router.register('/scripture', (container) => {
      Router.setTitle('Scripture');
      ScriptureView.render(container);
    });

    Router.register('/prayer', (container) => {
      Router.setTitle('Prayer');
      PrayerView.render(container);
    });

    Router.register('/journal', (container) => {
      Router.setTitle('Journal');
      JournalView.render(container);
    });

    Router.register('/plan', (container) => {
      Router.setTitle('Build This Week');
      PlanView.render(container);
    });

    Router.register('/ask', (container) => {
      Router.setTitle('Ask the Bible');
      AskView.render(container);
    });

    Router.register('/settings', (container) => {
      Router.setTitle('Settings');
      SettingsView.render(container);
    });

    Router.register('/settings-advanced', (container) => {
      Router.setTitle('Advanced');
      SettingsAdvancedView.render(container);
    });

    Router.register('/debug', (container) => {
      Router.setTitle('Debug');
      DebugView.render(container);
    });

    Router.register('/feedback', (container) => {
      Router.setTitle('Send Feedback');
      FeedbackView.render(container);
    });

    Router.register('/progress', (container) => {
      Router.setTitle('Reading Progress');
      ProgressView.render(container);
    });
  }

  // --- Auto theme based on time ---
  function startThemeWatcher() {
    // Check every 30 minutes
    setInterval(() => {
      const theme = Store.get('theme');
      if (theme === 'auto') {
        SettingsView.applyTheme('auto');
      }
    }, 30 * 60 * 1000);
  }

  // --- Streak update on open ---
  function checkStreak() {
    Store.updateStreak();
  }

  // --- Auto-load seed plan on first open ---
  async function autoLoadSeedIfNeeded() {
    if (!Store.getPlan()) {
      try {
        const res = await fetch(`${getBasePath()}content/seed/week-1.json`);
        if (res.ok) {
          const data = await res.json();
          Store.savePlan(data);
        }
      } catch (e) {
        // Seed not available - user will be prompted to build a plan
      }
    }
  }

  // --- Boot ---
  async function boot() {
    initStandalone();
    initPalette();
    initTheme();
    registerSW();
    registerRoutes();
    checkStreak();
    startThemeWatcher();

    // Load seed content in background before rendering
    await autoLoadSeedIfNeeded();

    Router.init();

    // Remove loading screen
    const loading = document.querySelector('.loading-screen');
    if (loading) {
      loading.style.animation = 'fadeOut 200ms ease forwards';
      setTimeout(() => loading.remove(), 200);
    }

    console.log('[Abide] App initialized');
  }

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
