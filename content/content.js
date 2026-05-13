/**
 * Universal content-script engine.
 *
 * Reads TCL_SITE_CONFIGS to detect the current site, then drives all DOM
 * traversal, product-title extraction, and badge injection through that
 * configuration — zero site-specific logic lives here.
 *
 * BATCHING
 * Newly-discovered cards are pushed into a pending queue. The queue is
 * flushed as a single bulk message to the service worker after BATCH_WINDOW_MS
 * of inactivity, or immediately when BATCH_SIZE cards have accumulated.
 * This keeps round-trips low as the page fills with products.
 *
 * SESSION CACHE
 * Already-resolved title → products pairs are stored in sessionStorage for
 * the life of the tab. Repeated appearances of the same product (e.g. infinite
 * scroll cycling) are injected synchronously without a worker round-trip.
 * When Harris's live API is wired in on the service-worker side, the session
 * cache here continues to work without any changes.
 */

(function () {
  'use strict';

  console.log('[TCL] Content script loaded on', location.hostname);

  if (window.__tclContentLoaded) {
    console.log('[TCL] Already loaded, skipping');
    return;
  }
  window.__tclContentLoaded = true;

  // ─── Constants ─────────────────────────────────────────────────────────────

  const BATCH_SIZE        = 20;    // max cards per worker message
  const BATCH_WINDOW_MS   = 200;   // ms to wait before flushing an incomplete batch
  const DEBOUNCE_MS       = 400;   // DOM mutation debounce
  const SCAN_INTERVAL_MS  = 2500;  // periodic safety re-scan for SPAs
  const MAX_ATTEMPTS      = 8;     // give up on a card after this many scan cycles
  const SESSION_CACHE_KEY = 'tcl_session_v1';
  const PAGE_MATCH_BROWSE = true;

  // ─── Site config ───────────────────────────────────────────────────────────

  const config = (globalThis.TCL_SITE_CONFIGS || [])
    .find(c => c.match(location.hostname));

  if (!config) {
    console.warn('[TCL] No site config matched for', location.hostname);
    return;
  }
  console.log(`[TCL] Active config: ${config.name}`);
  console.log('[TCL] TCLBadge available:', typeof TCLBadge !== 'undefined');

  // ─── Session cache ─────────────────────────────────────────────────────────
  // Keyed by normalised title string; cleared automatically when the tab closes.

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
      } catch { /* storage full – best effort */ }
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

  // ─── Title cleaning ─────────────────────────────────────────────────────────
  // Strips universal e-commerce noise before a title is sent to the API.
  // Cleaner titles → higher match rates on Harris's side.

  const GLOBAL_TITLE_STRIP = [
    /[®™©]/g,                                                          // trademark symbols
    /\s*\|\s*.+$/,                                                     // "| Brand" pipe suffix
    /,?\s*\$[\d.]+\s*\/\s*[\d.]+\s*(ml|g|kg|L|oz|lb)/gi,             // unit price ", $0.44/100ml"
    /(?<![a-zA-Z%])\d+(\.\d+)?\s*(kg|ml|mL|ltr?|litres?|liters?)\b/gi, // metric volume/mass
    /(?<![a-zA-Z%])\d+(\.\d+)?\s*(g|oz)\b/gi,                        // grams, ounces
    /\b\d+\s*(Pack|pack|packs|Count|count|ct|Pk|pk)\b/g,              // pack counts "3 Pack"
    /\(\s*\d+\s*(Pack|pack|Count|count|pk)\s*\)/g,                    // "(3 Pack)" in parens
  ];

  /**
   * Strip e-commerce noise from a raw product title.
   * Global patterns run first, then any site-specific patterns from
   * config.options.titleStripPatterns (array of regex strings).
   */
  function cleanTitle(raw) {
    if (!raw) return raw;
    let t = raw;

    for (const re of GLOBAL_TITLE_STRIP) {
      t = t.replace(re, ' ');
    }

    for (const patStr of (config.options.titleStripPatterns || [])) {
      try {
        t = t.replace(new RegExp(patStr, 'gi'), ' ');
      } catch { /* skip invalid regex in config */ }
    }

    return t.replace(/\s+/g, ' ').trim();
  }

  // ─── Config-driven DOM helpers ─────────────────────────────────────────────

  /** All product anchor elements within the configured root scope. */
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

  /** Climb the DOM from a link anchor to the nearest stable card container. */
  function cardFromLink(link) {
    for (const sel of config.selectors.cardCandidates) {
      const el = link.closest(sel);
      if (el) return el;
    }
    return link.parentElement?.parentElement || link;
  }

  /**
   * Extract the best product title from a link + its resolved card container.
   * Candidates are gathered in the order declared in options.titleSources and
   * the longest non-trivial string wins (longer = more descriptive).
   */
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
            break; // first match from card selectors is enough
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

  /**
   * Extract a product identifier (item ID, SKU, or UPC) to send alongside
   * the title query, giving Harris's API a precise lookup key when available.
   *
   * Two strategies, controlled per-site in config.options:
   *   itemIdAttribute  – read a data attribute directly off the card element
   *                      e.g. Walmart's data-item-id="12345678"
   *   itemIdFromUrl    – regex with one capture group run against the link href
   *                      e.g. Loblaws "/p/21657456_EA" → "21657456_EA"
   *
   * Pass { href: location.href } as `link` for PDP pages where no anchor exists.
   */
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
      } catch { /* skip invalid regex in config */ }
    }

    return null;
  }

  /** Find the DOM element used as the badge insertion anchor inside a card. */
  function findInsertTarget(card, link) {
    for (const sel of (config.selectors.insertTarget || [])) {
      const el = card.querySelector(sel);
      if (el) return el;
    }
    return link.querySelector('span') || link;
  }

  /** Build card descriptors for all product tiles on a listing page. */
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

  /** Build a single card descriptor for a Product Detail Page, or null. */
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

  // ─── Badge injection ────────────────────────────────────────────────────────

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

  // ─── Batching accumulator ───────────────────────────────────────────────────
  // Cards are pushed here from scanAndInject(). A 200 ms timer (or BATCH_SIZE
  // threshold) triggers a single bulk message to the service worker.

  const pendingQueue = []; // [{ card, resolve }]
  let flushTimer = null;

  /** Send one batch of queries to the service worker; returns key → products. */
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

    // Take up to BATCH_SIZE items; leave the rest for a follow-up flush.
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

    // If more cards arrived while we were awaiting, schedule the next flush.
    if (pendingQueue.length > 0) {
      flushTimer = setTimeout(flushQueue, BATCH_WINDOW_MS);
    }
  }

  /**
   * Push a card onto the pending queue.
   * Returns a Promise that resolves with the matched products array (may be []).
   * Force-flushes immediately when the batch is full; otherwise (re)starts the
   * accumulation timer.
   */
  function queueLookup(card) {
    return new Promise((resolve) => {
      pendingQueue.push({ card, resolve });
      if (pendingQueue.length >= BATCH_SIZE) {
        flushQueue(); // don't wait for the timer
      } else {
        clearTimeout(flushTimer);
        flushTimer = setTimeout(flushQueue, BATCH_WINDOW_MS);
      }
    });
  }

  // ─── Scan loop ──────────────────────────────────────────────────────────────

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

      // Dispatch each card: session cache hit → synchronous; miss → queued.
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

  // ─── Bootstrap ─────────────────────────────────────────────────────────────

  // Run immediately, then again at 1.5 s and 4 s to catch late-hydrating grids.
  scanAndInject();
  setTimeout(() => scanAndInject(), 1500);
  setTimeout(() => scanAndInject(), 4000);

  // DOM mutation observer — fires debouncedScan for any non-TCL node additions.
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

  // Periodic safety net for SPAs that don't always fire clean mutations.
  setInterval(debouncedScan, SCAN_INTERVAL_MS);

  // URL-change observer for SPA navigation (Walmart is a SPA).
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
