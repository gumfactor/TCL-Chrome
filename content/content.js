// Content script: reads site-configs.js, walks the DOM for product cards, batches lookups,
// talks to the background worker, injects badges. SessionStorage remembers titles we already looked up this tab.

(function () {
  'use strict';

  console.log('[TCL] Content script loaded on', location.hostname);

  if (window.__tclContentLoaded) {
    console.log('[TCL] Already loaded, skipping');
    return;
  }
  window.__tclContentLoaded = true;

  const BATCH_SIZE        = 20;
  const BATCH_WINDOW_MS   = 200;   // small pause so we lump scroll bursts together
  const DEBOUNCE_MS       = 400;
  const SCAN_INTERVAL_MS  = 2500; // some SPAs barely fire mutations
  const MAX_ATTEMPTS      = 8;    // stop hammering a stubborn card
  const SESSION_CACHE_KEY = 'tcl_session_v1';
  const PAGE_MATCH_BROWSE = true;

  const config = (globalThis.TCL_SITE_CONFIGS || [])
    .find(c => c.match(location.hostname));

  if (!config) {
    console.warn('[TCL] No site config matched for', location.hostname);
    return;
  }
  console.log(`[TCL] Active config: ${config.name}`);
  console.log('[TCL] TCLBadge available:', typeof TCLBadge !== 'undefined');

  const sessionCache = (() => {
    let _map = null;

    function _load() {
      if (_map) return _map;
      try {
        _map = new Map(JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) || '[]'));
      } catch {
        _map = new Map();
      }
      return _map;
    }

    function _persist() {
      try {
        sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify([..._map.entries()]));
      } catch { /* quota — ignore */ }
    }

    return {
      get(title) {
        return _load().get(_norm(title)) ?? null;
      },
      set(title, products) {
        _load().set(_norm(title), products);
        _persist();
      },
    };
  })();

  function _norm(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  const GLOBAL_TITLE_STRIP = [
    /[®™©]/g,
    /\s*\|\s*.+$/,
    /,?\s*\$[\d.]+\s*\/\s*[\d.]+\s*(ml|g|kg|L|oz|lb)/gi,
    /(?<![a-zA-Z%])\d+(\.\d+)?\s*(kg|ml|mL|ltr?|litres?|liters?)\b/gi,
    /(?<![a-zA-Z%])\d+(\.\d+)?\s*(g|oz)\b/gi,
    /\b\d+\s*(Pack|pack|packs|Count|count|ct|Pk|pk)\b/g,
    /\(\s*\d+\s*(Pack|pack|Count|count|pk)\s*\)/g,
  ];

  function cleanTitle(raw) {
    if (!raw) return raw;
    let t = raw;

    for (const re of GLOBAL_TITLE_STRIP) {
      t = t.replace(re, ' ');
    }

    for (const patStr of (config.options.titleStripPatterns || [])) {
      try {
        t = t.replace(new RegExp(patStr, 'gi'), ' ');
      } catch { /* bad regex in config */ }
    }

    return t.replace(/\s+/g, ' ').trim();
  }

  function findProductLinks() {
    const { selectors, options } = config;
    const root = document.querySelector(selectors.root) || document.body;
    const links = [...root.querySelectorAll(selectors.productLink)];

    if (!options.dedupeByPathname) return links;

    const seen = new Set();
    return links.filter(a => {
      try {
        const path = new URL(a.href).pathname;
        if (seen.has(path)) return false;
        seen.add(path);
        return true;
      } catch {
        return false;
      }
    });
  }

  function cardFromLink(link) {
    for (const sel of config.selectors.cardCandidates) {
      const el = link.closest(sel);
      if (el) return el;
    }
    return link.parentElement?.parentElement || link;
  }

  function extractTitle(link, card) {
    const { selectors, options } = config;
    const candidates = [];

    if (options.titleAttribute) {
      const attrTitle = card.getAttribute?.(options.titleAttribute);
      if (attrTitle?.trim()) candidates.push(attrTitle.trim());
    }

    for (const source of (options.titleSources || ['aria', 'text', 'card'])) {
      if (source === 'aria') {
        const a = link.getAttribute('aria-label');
        if (a?.trim()) candidates.push(a.trim());
      } else if (source === 'text') {
        const t = link.textContent?.trim();
        if (t) candidates.push(t);
      } else if (source === 'inner') {
        const inner = link.querySelector('span[dir], span');
        if (inner?.textContent.trim()) candidates.push(inner.textContent.trim());
      } else if (source === 'card') {
        for (const sel of (selectors.titleOnCard || [])) {
          const el = card.querySelector?.(sel);
          if (el?.textContent.trim()) {
            candidates.push(el.textContent.trim());
            break;
          }
        }
      }
    }

    const best = candidates
      .filter(c => c && c.length >= 3)
      .sort((a, b) => b.length - a.length)[0];

    if (!best) return null;

    if (options.prependBrand && selectors.brand) {
      const brandEl = card.querySelector?.(selectors.brand);
      const brand   = card.getAttribute?.(options.brandAttribute || '')?.trim()
        || brandEl?.textContent.trim()
        || '';
      if (brand && !best.toLowerCase().includes(brand.toLowerCase())) {
        return cleanTitle(`${brand} ${best}`);
      }
    }

    return cleanTitle(best);
  }

  function extractItemId(card, link) {
    const { options } = config;

    if (options.itemIdAttribute) {
      const val = card.getAttribute?.(options.itemIdAttribute);
      if (val) return val;
    }

    if (options.itemIdFromUrl && link?.href) {
      try {
        const match = link.href.match(new RegExp(options.itemIdFromUrl));
        if (match?.[1]) return match[1];
      } catch { /* bad regex in config */ }
    }

    return null;
  }

  function findInsertTarget(card, link) {
    for (const sel of (config.selectors.insertTarget || [])) {
      const el = card.querySelector(sel);
      if (el) return el;
    }
    return link.querySelector('span') || link;
  }

  function getListingCards() {
    const cards = [];
    for (const link of findProductLinks()) {
      const el = cardFromLink(link);
      if (el.querySelector('tcl-score, tcl-score-mini')) continue;

      const title = extractTitle(link, el);
      if (!title) continue;

      cards.push({
        element:        el,
        title,
        itemId:         extractItemId(el, link),
        insertTarget:   findInsertTarget(el, link),
        insertPosition: config.options.insertPosition || 'afterend',
        type:           'listing',
      });
    }
    return cards;
  }

  function getDetailCard() {
    const isDetail = (config.options.detailPagePatterns || [])
      .some(p => location.pathname.includes(p));
    if (!isDetail) return null;

    for (const sel of (config.selectors.detailTitle || [])) {
      const h = document.querySelector(sel);
      if (!h?.textContent.trim()) continue;
      if (h.parentElement?.querySelector('tcl-score')) continue;

      return {
        element:        h.closest('section') || h.parentElement || h,
        title:          cleanTitle(h.textContent.trim()),
        itemId:         extractItemId(h, { href: location.href }),
        insertTarget:   h,
        insertPosition: 'afterend',
        type:           'detail',
      };
    }
    return null;
  }

  function getProductCards() {
    const cards = getListingCards();
    const detail = getDetailCard();
    if (detail) cards.push(detail);
    return cards;
  }

  function injectBadge(card, product) {
    if (!card.insertTarget?.parentNode) return;
    if (typeof TCLBadge === 'undefined' || !product) {
      console.warn('[TCL] Cannot inject badge: TCLBadge or product missing');
      return;
    }

    let badge;
    try {
      badge = card.type === 'detail'
        ? TCLBadge.create(product)
        : TCLBadge.createCompact(product);
    } catch (err) {
      console.warn('[TCL] Badge build failed:', err);
      return;
    }

    const style = card.type === 'detail'
      ? config.options.badgeStyle.detail
      : config.options.badgeStyle.listing;
    Object.assign(badge.style, style);

    try {
      if (card.insertPosition === 'afterend') {
        card.insertTarget.parentNode.insertBefore(badge, card.insertTarget.nextSibling);
      } else {
        card.insertTarget.parentNode.insertBefore(badge, card.insertTarget);
      }
    } catch (err) {
      console.warn('[TCL] Badge insertion failed:', err);
    }
  }

  const pendingQueue = [];
  let flushTimer = null;

  function sendBatch(queries) {
    return new Promise((resolve) => {
      if (!chrome?.runtime?.sendMessage || queries.length === 0) {
        resolve({});
        return;
      }
      chrome.runtime.sendMessage(
        { type: 'TCL_LOOKUP_BATCH', queries, browse: PAGE_MATCH_BROWSE },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[TCL] Batch error:', chrome.runtime.lastError.message);
            resolve({});
            return;
          }
          if (!response?.success) {
            console.warn('[TCL] Batch failed:', response?.error || 'unknown');
            resolve({});
            return;
          }
          const map = {};
          for (const r of response.results) map[r.key] = r.products;
          resolve(map);
        }
      );
    });
  }

  async function flushQueue() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (pendingQueue.length === 0) return;

    const batch   = pendingQueue.splice(0, BATCH_SIZE);
    const queries = batch.map((item, i) => ({
      key:    String(i),
      query:  item.card.title,
      itemId: item.card.itemId || null,
    }));
    const results = await sendBatch(queries);

    for (let i = 0; i < batch.length; i++) {
      const products = results[String(i)] || [];
      if (products.length > 0) sessionCache.set(batch[i].card.title, products);
      batch[i].resolve(products);
    }

    if (pendingQueue.length > 0) {
      flushTimer = setTimeout(flushQueue, BATCH_WINDOW_MS);
    }
  }

  function queueLookup(card) {
    return new Promise((resolve) => {
      pendingQueue.push({ card, resolve });
      if (pendingQueue.length >= BATCH_SIZE) {
        flushQueue();
      } else {
        clearTimeout(flushTimer);
        flushTimer = setTimeout(flushQueue, BATCH_WINDOW_MS);
      }
    });
  }

  const processedElements = new WeakSet();
  const lookupAttempts    = new WeakMap();
  let isScanning = false;
  let scanTimer  = null;

  async function scanAndInject() {
    if (isScanning) return;
    isScanning = true;

    try {
      let rawCards;
      try {
        rawCards = getProductCards();
      } catch (err) {
        console.error('[TCL] getProductCards failed:', err?.message || err);
        return;
      }

      const cards = rawCards.filter(c => {
        if (!c?.element) return false;
        if (processedElements.has(c.element)) return false;
        return (lookupAttempts.get(c.element) || 0) < MAX_ATTEMPTS;
      });

      if (cards.length > 0) {
        console.log(`[TCL] Found ${cards.length} new cards`);
        cards.slice(0, 3).forEach(c => console.log('[TCL]   →', c.title?.substring(0, 60)));
      }
      if (cards.length === 0) return;

      const lookupPromises = cards.map(card => {
        const cached = sessionCache.get(card.title);
        if (cached !== null) {
          return Promise.resolve({ card, products: cached, fromCache: true });
        }
        return queueLookup(card).then(products => ({ card, products, fromCache: false }));
      });

      const settled = await Promise.all(lookupPromises);

      for (const { card, products, fromCache } of settled) {
        lookupAttempts.set(card.element, (lookupAttempts.get(card.element) || 0) + 1);

        if (products.length > 0) {
          injectBadge(card, products[0]);
          processedElements.add(card.element);
          if (fromCache) console.log('[TCL] Session cache hit:', card.title.substring(0, 60));
        } else if (card.title && !fromCache) {
          console.log('[TCL] No match for:', card.title.substring(0, 80));
        }
      }
    } catch (err) {
      console.error('[TCL] Scan error:', err?.message || err, err?.stack || '');
    } finally {
      isScanning = false;
    }
  }

  function debouncedScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanAndInject, DEBOUNCE_MS);
  }

  function isOurBadgeNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = (node.tagName || '').toUpperCase();
    if (tag === 'TCL-SCORE' || tag === 'TCL-SCORE-MINI') return true;
    try { return node.closest?.('tcl-score, tcl-score-mini') != null; } catch { return false; }
  }

  scanAndInject();
  setTimeout(() => scanAndInject(), 1500);
  setTimeout(() => scanAndInject(), 4000);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!isOurBadgeNode(node)) {
          debouncedScan();
          return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(debouncedScan, SCAN_INTERVAL_MS);

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      debouncedScan();
    }
  }).observe(document.querySelector('head > title') || document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });

})();
