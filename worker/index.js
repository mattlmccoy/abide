/**
 * ABIDE - Cloudflare Worker
 * Routes: /bible, /search, /ai/plan, /ai/phrase, /push/*
 *
 * Secrets (set with: wrangler secret put SECRET_NAME):
 *   ESV_API_TOKEN      - api.esv.org token
 *   YOUVERSION_API_KEY - App key from platform.YouVersion.com (for NIV, BSB, LSV)
 *   NLT_API_KEY        - License key from api.nlt.to (for NLT)
 *   SERPER_API_KEY     - Serper.dev search API key
 *   GEMINI_API_KEY     - Gemini API key for AI plan + phrase search
 *   GEMINI_MODEL       - Optional Gemini model name
 *   VAPID_PUBLIC_KEY   - VAPID public key for push
 *   VAPID_PRIVATE_KEY  - VAPID private key for push
 *   VAPID_SUBJECT      - mailto:your@email.com
 */

import { handleBible } from './bible.js';
import { handleSearch } from './search.js';
import { handlePush } from './push.js';
import { handleAIPlan, handleAIPhrase, handleAIModels, handleAIProviders, handleAIRouting, handleAIProbe, handleAISummarize, handleAIChatSummary, handleWordLookup, handleAIAsk, handleAIContext, handleAICrossRefs } from './ai.js';
import { handleFeedback } from './feedback.js';

// CORS — allow GitHub Pages origin + local dev
const ALLOWED_ORIGINS = [
  'https://mattlmccoy.github.io',
  'https://abidefaith.org',
  'https://www.abidefaith.org',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'null',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      if (url.pathname === '/health') {
        return json({ status: 'ok', version: '2.3.0', service: 'abide-worker' }, 200, origin);
      }

      if (url.pathname.startsWith('/bible')) {
        return handleBible(request, url, env, origin, json);
      }

      if (url.pathname.startsWith('/search')) {
        return handleSearch(request, url, env, origin, json);
      }

      // AI-powered devotional plan builder
      if (url.pathname === '/ai/plan') {
        return handleAIPlan(request, url, env, origin, json);
      }

      // AI-powered verse phrase search
      if (url.pathname === '/ai/phrase') {
        return handleAIPhrase(request, url, env, origin, json);
      }

      if (url.pathname === '/ai/summarize') {
        return handleAISummarize(request, url, env, origin, json);
      }

      if (url.pathname === '/ai/chat-summary') {
        return handleAIChatSummary(request, url, env, origin, json);
      }

      // Hebrew/Greek word deep dive
      if (url.pathname === '/word/lookup') {
        return handleWordLookup(request, url, env, origin, json);
      }

      // Ask-anything Bible chat
      if (url.pathname === '/ai/ask') {
        return handleAIAsk(request, url, env, origin, json);
      }

      // Historical/cultural context for a passage
      if (url.pathname === '/ai/context') {
        return handleAIContext(request, url, env, origin, json);
      }

      // AI-curated cross-references for a passage
      if (url.pathname === '/ai/crossrefs') {
        return handleAICrossRefs(request, url, env, origin, json);
      }

      // AI model diagnostics
      if (url.pathname === '/ai/models') {
        return handleAIModels(request, url, env, origin, json);
      }

      // AI provider diagnostics
      if (url.pathname === '/ai/providers') {
        return handleAIProviders(request, url, env, origin, json);
      }

      // AI routing diagnostics
      if (url.pathname === '/ai/routing') {
        return handleAIRouting(request, url, env, origin, json);
      }

      // AI probe checks
      if (url.pathname === '/ai/probe') {
        return handleAIProbe(request, url, env, origin, json);
      }

      if (url.pathname.startsWith('/push')) {
        return handlePush(request, url, env, origin, json, ctx);
      }

      if (url.pathname === '/feedback') {
        return handleFeedback(request, url, env, origin, json);
      }

      // Drive share proxy — fetches a public "anyoneWithLink" Drive file server-side
      // so the recipient doesn't need the sender's OAuth token.
      // POST /drive/proxy  body: { fileId, resourceKey? }
      if (url.pathname === '/drive/proxy' && request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch (_) { return json({ error: 'Invalid JSON' }, 400, origin); }
        const { fileId, resourceKey } = body || {};
        if (!fileId || typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{10,}$/.test(fileId)) {
          return json({ error: 'Missing or invalid fileId' }, 400, origin);
        }
        const rkParam = resourceKey ? `&resourceKey=${encodeURIComponent(resourceKey)}` : '';
        // Try Drive API v3 (works for public files without auth)
        const candidates = [
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true${rkParam}`,
          `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download${resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : ''}`,
          `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}${resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : ''}`,
        ];
        let text = null;
        for (const candidate of candidates) {
          try {
            const r = await fetch(candidate, { redirect: 'follow' });
            if (!r.ok) continue;
            const ct = String(r.headers.get('content-type') || '');
            if (ct.includes('text/html')) continue; // Drive login redirect
            text = await r.text();
            if (text && text.trim().startsWith('{')) break;
            text = null;
          } catch (_) {}
        }
        if (!text) return json({ error: 'Could not fetch shared file — check permissions' }, 502, origin);
        let data;
        try { data = JSON.parse(text); } catch (_) { return json({ error: 'Shared file is not valid JSON' }, 502, origin); }
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      return json({ error: 'Not found' }, 404, origin);
    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: err.message }, 500, origin);
    }
  },

  async scheduled(event, env, ctx) {
    const { handleScheduledPush } = await import('./push.js');
    ctx.waitUntil(handleScheduledPush(env));
  },
};
