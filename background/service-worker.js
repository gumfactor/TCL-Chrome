// Background worker — talks to the TCL API and caches results.
// If the API errors or batch isn't ready yet, we hit GET /search per row or fall back to sample-products.json.
//
// Batch API (preferred): POST /v1/search/batch
//   body: { queries: [{ key, query, itemId? }] }
//   returns: { results: [{ key, products: [...] }] }
// Single search: GET /v1/search?q=...&browse=1&item_id=... → { products } or { results }

import { TCLCache } from '../lib/cache.js';

const API_BASE          = 'https://api.thecanadalist.ca/v1';
const FALLBACK_DATA_URL = chrome.runtime.getURL('data/sample-products.json');
const UNINSTALL_FEEDBACK_URL = 'https://thecanadalist.ca/uninstall';
const TIMEOUT_MS        = 8000;

// Send people to the marketing site when they uninstall (Chrome can't open extension pages after removal).
function registerUninstallFeedbackPage() {
  chrome.runtime.setUninstallURL(UNINSTALL_FEEDBACK_URL, () => {
    if (chrome.runtime.lastError) {
      console.warn('[TCL] Failed to set uninstall URL:', chrome.runtime.lastError.message);
    }
  });
}

async function apiBatchSearch(queries) {
  try {
    const resp = await fetch(`${API_BASE}/search/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ queries }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn(`[TCL] Batch API ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    return Array.isArray(data.results) ? data.results : null;
  } catch (err) {
    console.warn('[TCL] Batch API error:', err?.message || err);
    return null;
  }
}

async function apiSearch(query, browse = false, itemId = null) {
  try {
    const url = new URL(`${API_BASE}/search`);
    url.searchParams.set('q', query);
    if (browse)  url.searchParams.set('browse', '1');
    if (itemId)  url.searchParams.set('item_id', itemId);

    const resp = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn(`[TCL] Search API ${resp.status} for "${query}"`);
      return null;
    }
    const data = await resp.json();
    return data.products || data.results || null;
  } catch (err) {
    console.warn('[TCL] Search API error:', err?.message || err);
    return null;
  }
}

let _fallbackProducts = null;

async function getFallbackProducts() {
  if (_fallbackProducts) return _fallbackProducts;
  try {
    const resp = await fetch(FALLBACK_DATA_URL);
    const json = await resp.json();
    _fallbackProducts = json.products || [];
    console.log(`[TCL] Fallback: loaded ${_fallbackProducts.length} sample products`);
  } catch {
    _fallbackProducts = [];
    console.warn('[TCL] Fallback: could not load sample-products.json');
  }
  return _fallbackProducts;
}

function normText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2018\u2019\u02BC]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fallbackSearch(query) {
  const products = await getFallbackProducts();
  if (!products.length) return [];

  const q = normText(query);
  const qTokens = new Set(q.split(' ').filter(t => t.length >= 3));
  const matches = products
    .map(p => {
    const n = normText(p.name);
    const b = normText(p.brand || '');
      const keywordTokens = (p.keywords || [])
        .flatMap(k => normText(k).split(' '))
        .filter(t => t.length >= 3);

      let score = 0;
      if (n === q) score += 100;
      if (q.includes(n) || n.includes(q)) score += 80;
      if (b && (b === q || q.includes(b))) score += 40;

      for (const token of keywordTokens) {
        if (qTokens.has(token) || q.includes(token)) score += 10;
      }

      return { product: p, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ product }) => product);

  console.log(`[TCL] Fallback matched ${matches.length} for "${query}"`);
  return matches.slice(0, 3);
}

// Listing pages: batch message from content script — try cache, then API batch, then one GET per row, then sample JSON.
async function handleBatch(queries, browse) {
  const results   = [];
  const uncached  = [];

  // cached lookups first (same key we used last time)
  for (const q of queries) {
    const cacheKey = `${browse ? 'b' : 's'}:${q.query}`;
    const cached   = await TCLCache.get(cacheKey);
    if (cached !== null) {
      results.push({ key: q.key, products: cached });
    } else {
      uncached.push(q);
    }
  }

  if (uncached.length === 0) return results;

  // one POST for the whole batch when the endpoint exists
  let apiResults = await apiBatchSearch(uncached);

  // no batch? spam parallel GETs instead (uglier but works)
  if (!apiResults) {
    console.log('[TCL] Batch endpoint unavailable, falling back to individual queries');
    apiResults = await Promise.all(
      uncached.map(async (q) => {
      const products = (await apiSearch(q.query, browse, q.itemId || null))
                    ?? (await fallbackSearch(q.query));
        return { key: q.key, products: products || [] };
      })
    );
  }

  // write hits to storage; empty API rows get one more shot from local sample
  for (const r of apiResults) {
    if (r.products?.length > 0) {
      const orig = uncached.find(q => q.key === r.key);
      if (orig) {
        await TCLCache.set(`${browse ? 'b' : 's'}:${orig.query}`, r.products);
      }
    } else {
      // dev/demo: maybe the sample file still has this product
      const orig = uncached.find(q => q.key === r.key);
      if (orig) {
        const fallback = await fallbackSearch(orig.query);
        if (fallback.length > 0) r.products = fallback;
      }
    }
    results.push(r);
  }

  return results;
}

async function handleLookup(query, browse) {
  const cacheKey = `${browse ? 'b' : 's'}:${query}`;
  const cached   = await TCLCache.get(cacheKey);
  if (cached !== null) {
    console.log(`[TCL] Cache hit for "${query}"`);
    return cached;
  }

  let products = await apiSearch(query, browse);

  if (!products?.length) {
    products = await fallbackSearch(query);
  }

  if (products?.length > 0) {
    await TCLCache.set(cacheKey, products);
  }

  return products || [];
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  if (message.type === 'TCL_LOOKUP') {
    handleLookup(message.query, message.browse === true)
      .then(products => sendResponse({ success: true, products }))
      .catch(err    => sendResponse({ success: false, error: err.message, products: [] }));
    return true;
  }

  if (message.type === 'TCL_LOOKUP_BATCH') {
    handleBatch(message.queries || [], message.browse === true)
      .then(results => sendResponse({ success: true, results }))
      .catch(err    => sendResponse({ success: false, error: String(err?.message || err), results: [] }));
    return true;
  }

  if (message.type === 'TCL_CLEAR_CACHE') {
    TCLCache.clear().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'TCL_GET_STATS') {
    chrome.storage.local.get(null, (all) => {
      const cacheKeys = Object.keys(all).filter(k => k.startsWith('tcl_cache_'));
      sendResponse({
        success: true,
        stats: {
          cachedProducts: cacheKeys.length,
          dataSource: 'Live API',
        },
      });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  registerUninstallFeedbackPage();
});

chrome.runtime.onStartup?.addListener(() => {
  registerUninstallFeedbackPage();
});

registerUninstallFeedbackPage();

chrome.alarms.create('tcl-cache-cleanup', { periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'tcl-cache-cleanup') TCLCache.evict();
});
