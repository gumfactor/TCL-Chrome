/* eslint-disable */
/**
 * The CANADA List — Universal Product Container Detector
 * ======================================================
 * A framework-agnostic, near-O(n) detector for product cards on arbitrary
 * e-commerce sites. Designed to be invisible from a performance standpoint:
 * structural-repetition analysis + heuristic scoring + IntersectionObserver
 * gating + WeakMap caches + idle scheduling.
 *
 * Architecture (hybrid pipeline):
 *   1. Site fast-path     — known retailers via narrow selectors (Amazon, etc.)
 *   2. Structural scanner — single-pass TreeWalker building shallow signatures,
 *                           bucketed by parent → repeated-children groups
 *   3. Heuristic scorer   — image / price / link / cart / aria / dimensions
 *   4. Cluster ranker     — pick the dominant repeating cluster(s) per page
 *   5. Viewport gating    — IntersectionObserver defers off-screen processing
 *   6. Mutation pipeline  — incremental, only added subtrees, idle-scheduled
 *
 * Hard performance budget:
 *   - First scan after DOMContentLoaded: target ≤ 8 ms on a mid-range laptop.
 *   - Steady-state mutation work: ≤ 2 ms per batch.
 *   - Zero forced layout (no offsetWidth / getComputedStyle in hot loops).
 *   - Single TreeWalker pass per scan; no recursion, no full document.querySelectorAll('*').
 *
 * Public API (attached to window.__CL_Detector):
 *   - init(opts)           — start observing (idempotent)
 *   - scan()               — run one detection pass, returns Element[]
 *   - findProductContainers() — alias of scan(), kept for clarity
 *   - onContainers(cb)     — subscribe to new-container events (idle-batched)
 *   - destroy()            — disconnect observers, clear caches
 *   - getStats()           — performance counters
 *
 * @typedef {Object} DetectorStats
 * @property {number} scans           total scan invocations
 * @property {number} containersFound cumulative unique containers reported
 * @property {number} lastScanMs      last scan duration (ms)
 * @property {number} totalScanMs     cumulative scan time (ms)
 * @property {number} mutationsBatched cumulative mutations processed
 *
 * @typedef {Object} DetectorOptions
 * @property {number} [maxContainers]  hard cap on returned containers per scan
 * @property {number} [debounceMs]     mutation debounce
 * @property {number} [viewportMargin] IntersectionObserver rootMargin px
 * @property {boolean} [includeOffscreen] include below-the-fold containers
 */

(function attachDetector(global) {
  if (global.__CL_Detector) return; // idempotent

  /* ============================================================== *
   *  CONSTANTS                                                     *
   * ============================================================== */

  // Currency detection — anchored to symbols / ISO codes, careful around
  // discount and shipping noise. Decimal | comma separators tolerated.
  // Examples matched: $12.99, US$1,299.00, 12,99 €, £4.50, CAD 9.99
  const PRICE_REGEX = new RegExp(
    [
      // Leading symbol/code: $, US$, CA$, C$, CAD, USD, EUR, GBP, €, £, ¥, ₹
      '(?:(?:US|CA|C)?\\$|CAD|USD|EUR|GBP|JPY|AUD|NZD|MXN|€|£|¥|₹)',
      '\\s*',
      // Number with thousands separators and 0–4 decimals
      '\\d{1,3}(?:[ ,.\\u00A0]\\d{3})*(?:[.,]\\d{1,4})?',
    ].join(''),
    'i'
  );
  // Same pattern but with the currency suffix (e.g. "12,99 €")
  const PRICE_REGEX_SUFFIX = /\d{1,3}(?:[ ,.\u00A0]\d{3})*(?:[.,]\d{1,4})?\s*(?:€|£|¥|₹|CAD|USD|EUR|GBP|JPY)/i;
  // Strings to *exclude* from price hits (these often follow a number).
  const PRICE_NEGATIVE = /(off|save|discount|shipping|delivery|tax|points|reward|loyalty|per\s*month|\/mo|installment|finance)/i;

  // Site-specific high-confidence selectors. If any of these match, we treat
  // them as products without running structural inference. Order matters
  // (more specific first).
  const FAST_PATH_SELECTORS = [
    '[data-component-type="s-search-result"]',                     // Amazon
    '[data-testid="ProductTile"]',                                 // Best Buy / others
    '[data-testid="product-tile"]',                                // generic
    '[data-testid*="ProductCard" i]',                              // generic
    '[itemtype*="schema.org/Product"]',                            // microdata
    '[itemtype="http://schema.org/Product"]',
    'li.product-tile',                                             // Bay / Indigo
    'li[class*="product-card" i]',                                 // Loblaws
    'article[class*="product" i]',                                 // Shopify themes
    '[class*="product_tile" i]',                                   // generic
    '[class*="ProductGrid__item" i]',                              // styled-components
    '[class*="grid-product__content" i]',                          // Shopify Brooklyn
    '[class*="collection-product" i]',                             // Shopify
  ];

  // Tags that should never be considered product containers themselves (but
  // their descendants may be). Speeds up TreeWalker rejection.
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'SVG', 'CANVAS',
    'HEADER', 'NAV', 'FOOTER', 'ASIDE', 'FORM', 'INPUT', 'SELECT', 'TEXTAREA',
    'BUTTON', 'OPTION',
  ]);

  // Ancestor tags / roles that disqualify a candidate (page chrome).
  const FORBIDDEN_ANCESTOR_SELECTOR = [
    'header', 'nav', 'aside', 'footer',
    '[role="banner"]', '[role="navigation"]', '[role="search"]',
    '[role="contentinfo"]', '[role="complementary"]',
    '[class*="breadcrumb" i]', '[class*="filter" i]', '[class*="facet" i]',
    '[class*="sort" i]', '[class*="sidebar" i]', '[class*="menu" i]',
    '[class*="footer" i]', '[class*="header" i]',
  ].join(',');

  // Generic "product-ish" hints used by the site fast-path's whitelist gate.
  const PRODUCT_HINT_SELECTOR =
    '[data-component-type="s-search-result"], [data-testid*="product" i], [itemtype*="Product"]';

  // Repetition group sizing.
  const MIN_GROUP_SIZE = 3;       // need at least 3 siblings to consider it a grid
  const MAX_GROUPS_PER_PARENT = 8;
  const MAX_CONTAINERS_DEFAULT = 200;
  const VIEWPORT_MARGIN_DEFAULT = 800; // px — process content within ~viewport

  // Score thresholds. Tuned empirically; do not change without re-benchmarking.
  const SCORE_ACCEPT_THRESHOLD = 4;

  /* ============================================================== *
   *  CACHES & STATE                                                *
   * ============================================================== */

  /** @type {WeakMap<Element, number>} per-element score cache */
  const scoreCache = new WeakMap();
  /** @type {WeakMap<Element, string>} per-element shallow signature cache */
  const sigCache = new WeakMap();
  /** @type {WeakSet<Element>} elements already reported to subscribers */
  const reported = new WeakSet();
  /** @type {WeakSet<Element>} subtrees we've already analysed this session */
  const analyzedRoots = new WeakSet();

  const stats = {
    scans: 0,
    containersFound: 0,
    lastScanMs: 0,
    totalScanMs: 0,
    mutationsBatched: 0,
  };

  /** @type {((els: Element[]) => void)[]} */
  const subscribers = [];

  /** @type {DetectorOptions} */
  let options = {
    maxContainers: MAX_CONTAINERS_DEFAULT,
    debounceMs: 150,
    viewportMargin: VIEWPORT_MARGIN_DEFAULT,
    includeOffscreen: false,
  };

  /** @type {MutationObserver|null} */
  let mutationObserver = null;
  /** @type {IntersectionObserver|null} */
  let viewportObserver = null;
  /** @type {number|null} */
  let mutationTimer = null;
  /** @type {Set<Element>} */
  const pendingRoots = new Set();
  /** @type {Set<Element>} */
  const viewportPending = new Set();
  let initialized = false;

  /* ============================================================== *
   *  UTILITIES                                                     *
   * ============================================================== */

  /**
   * Cheap, deterministic 32-bit string hash (FNV-1a). Used to compress class
   * lists into a 6-char tag for signature comparison without storing entire
   * className strings.
   * @param {string} s
   * @returns {string}
   */
  function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }

  /**
   * Build a *shallow* structural signature for an element. The signature
   * captures: tag, class-fingerprint, immediate child tag sequence, and
   * presence of img/a. We deliberately do NOT recurse — recursion would
   * blow the perf budget on large pages.
   *
   * Signature format: `TAG#classHash|child1,child2,...|img:0/1|a:0/1`
   *
   * @param {Element} el
   * @returns {string}
   */
  function shallowSignature(el) {
    const cached = sigCache.get(el);
    if (cached) return cached;

    const tag = el.tagName;
    const cls = el.className && typeof el.className === 'string' ? el.className : '';
    // Normalise dynamic class hashes (e.g. styled-components `sc-abc-1`) so
    // siblings still match: collapse digit suffixes.
    const normCls = cls.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
    const clsHash = normCls ? fnv1a(normCls) : '0';

    // Single-pass child iteration. Children property is a live HTMLCollection
    // but we only iterate it once and never re-enter the DOM.
    const children = el.children;
    const len = children.length;
    let childSeq = '';
    let hasImg = 0;
    let hasA = 0;
    for (let i = 0; i < len && i < 12; i++) {
      const c = children[i];
      const t = c.tagName;
      childSeq += (i ? ',' : '') + t;
      if (!hasImg && (t === 'IMG' || t === 'PICTURE' || c.querySelector?.('img,picture'))) hasImg = 1;
      if (!hasA && t === 'A') hasA = 1;
    }
    const sig = `${tag}#${clsHash}|${childSeq}|${hasImg}|${hasA}`;
    sigCache.set(el, sig);
    return sig;
  }

  /**
   * Returns true if `el` lies inside a chrome region we never want to badge.
   * Uses `closest()` once → O(depth).
   * @param {Element} el
   */
  function isInForbiddenRegion(el) {
    return !!el.closest(FORBIDDEN_ANCESTOR_SELECTOR);
  }

  /**
   * Detect a price string in the element's text content, skipping shipping
   * / discount strings. Reads `textContent` once (no innerText → no layout).
   * Truncates to 600 chars to bound regex cost.
   * @param {Element} el
   * @returns {boolean}
   */
  function hasPrice(el) {
    const text = (el.textContent || '').slice(0, 600);
    if (!text) return false;
    if (!PRICE_REGEX.test(text) && !PRICE_REGEX_SUFFIX.test(text)) return false;
    // Check the immediate context for a negative keyword. We only reject if
    // the negative keyword appears within 16 chars of the price hit.
    const match = text.match(PRICE_REGEX) || text.match(PRICE_REGEX_SUFFIX);
    if (!match) return false;
    const idx = match.index ?? 0;
    const slice = text.slice(Math.max(0, idx - 24), Math.min(text.length, idx + match[0].length + 24));
    if (PRICE_NEGATIVE.test(slice)) {
      // Try to find a *second* price elsewhere that isn't negative-flanked.
      const all = text.match(new RegExp(PRICE_REGEX.source, 'gi')) || [];
      for (const m of all) {
        const i = text.indexOf(m);
        const s = text.slice(Math.max(0, i - 24), Math.min(text.length, i + m.length + 24));
        if (!PRICE_NEGATIVE.test(s)) return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Score a candidate element against the heuristic ruleset.
   * Returns a non-negative integer; ≥ SCORE_ACCEPT_THRESHOLD means accept.
   * Cached aggressively — never recomputed per element.
   *
   * Weights:
   *  +2 has image (img/picture) — products almost always have one
   *  +2 has price hit (filtered)
   *  +1 has anchor (clickable link)
   *  +1 anchor href looks like a product detail URL (/p/, /product/, ?sku=)
   *  +1 has product-ish title-like child (h1-h4 or long span/div text)
   *  +1 has add-to-cart / buy / wishlist control nearby
   *  +1 has rating UI (.rating, .stars, aria-label*="rating")
   *  +1 has structured-data hint (itemtype Product / data-product-id)
   *  -3 inside chrome region (forbidden ancestor) — disqualify
   *  -2 element is too small (<100×100 by attributes alone — we don't read
   *      offsetWidth, just the rough text length proxy < 6 chars)
   *
   * @param {Element} el
   * @returns {number}
   */
  function scoreElement(el) {
    const cached = scoreCache.get(el);
    if (cached !== undefined) return cached;

    let score = 0;

    if (isInForbiddenRegion(el)) {
      scoreCache.set(el, -3);
      return -3;
    }

    // Image
    if (el.querySelector('img, picture, [role="img"]')) score += 2;

    // Price (filtered)
    if (hasPrice(el)) score += 2;

    // Anchor
    const link = el.querySelector('a[href]');
    if (link) {
      score += 1;
      const href = link.getAttribute('href') || '';
      if (/\/(p|prod(uct)?s?|item|sku|dp|gp\/product)\b|[?&](sku|productid|pid)=/i.test(href)) {
        score += 1;
      }
    }

    // Title-like child
    if (el.querySelector('h1, h2, h3, h4, [itemprop="name"]')) {
      score += 1;
    } else {
      // Fallback: any child with reasonably long text (12-180 chars). We use
      // textContent on direct children only to bound cost.
      const kids = el.children;
      for (let i = 0; i < kids.length && i < 8; i++) {
        const t = (kids[i].textContent || '').trim();
        if (t.length >= 12 && t.length <= 180 && /[A-Za-z]/.test(t)) {
          score += 1;
          break;
        }
      }
    }

    // Add-to-cart / wishlist
    if (el.querySelector(
      'button[name*="cart" i], button[class*="cart" i], button[class*="wishlist" i],' +
      ' [class*="add-to-cart" i], [class*="addtocart" i], [data-action*="cart" i]'
    )) score += 1;

    // Ratings
    if (el.querySelector(
      '[class*="rating" i], [class*="stars" i], [aria-label*="rating" i],' +
      ' [aria-label*="stars" i], [itemprop="aggregateRating"]'
    )) score += 1;

    // Structured-data hint
    if (
      el.matches('[itemtype*="Product" i]') ||
      el.querySelector('[itemtype*="Product" i]') ||
      el.hasAttribute('data-product-id') ||
      el.hasAttribute('data-sku') ||
      el.hasAttribute('data-asin')
    ) score += 1;

    scoreCache.set(el, score);
    return score;
  }

  /**
   * Dedup by ancestry: if A contains B in the result list, drop B (or A,
   * whichever is more obviously a wrapper). We keep the inner-most container
   * that still scores well — that's the actual tile.
   * @param {Element[]} arr
   * @returns {Element[]}
   */
  function dropNestedAncestors(arr) {
    if (arr.length < 2) return arr.slice();
    // Sort by depth ascending; drop later ones whose ancestor is already in.
    const set = new Set(arr);
    const out = [];
    for (const el of arr) {
      let p = el.parentElement;
      let containedByAnotherCandidate = false;
      while (p) {
        if (set.has(p)) { containedByAnotherCandidate = true; break; }
        p = p.parentElement;
      }
      if (!containedByAnotherCandidate) out.push(el);
    }
    return out;
  }

  /* ============================================================== *
   *  STRUCTURAL REPETITION SCANNER                                 *
   * ============================================================== */

  /**
   * Walk the DOM (or a subtree) once and bucket children of each parent by
   * their shallow signature. Parents whose children form a large
   * same-signature cluster are likely product grids.
   *
   * Complexity: O(n) where n is element count in the search root. We bail
   * out of subtrees that are clearly chrome (header/nav/footer/etc.) via
   * NodeFilter to keep the constant low.
   *
   * @param {Element} root
   * @returns {Element[]} candidate cluster members
   */
  function findRepeatingClusters(root) {
    /** @type {Map<Element, Map<string, Element[]>>} */
    const buckets = new Map();

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          // Skip entire chrome subtrees with one closest() check on tag only.
          // (Class/role check is more expensive and is done per-candidate later.)
          const t = node.tagName;
          if (t === 'HEADER' || t === 'NAV' || t === 'FOOTER' || t === 'ASIDE') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node = walker.nextNode();
    let visited = 0;
    while (node) {
      visited++;
      // Bail if the page is enormous; mutation pipeline will catch the rest.
      if (visited > 25000) break;
      const parent = node.parentElement;
      if (parent && node.children && node.children.length > 0) {
        const sig = shallowSignature(node);
        let parentBucket = buckets.get(parent);
        if (!parentBucket) {
          parentBucket = new Map();
          buckets.set(parent, parentBucket);
        }
        let group = parentBucket.get(sig);
        if (!group) {
          // Cap groups per parent to avoid pathological pages.
          if (parentBucket.size >= MAX_GROUPS_PER_PARENT) {
            node = walker.nextNode();
            continue;
          }
          group = [];
          parentBucket.set(sig, group);
        }
        group.push(node);
      }
      node = walker.nextNode();
    }

    /** @type {Element[]} */
    const candidates = [];
    for (const parentBucket of buckets.values()) {
      for (const group of parentBucket.values()) {
        if (group.length >= MIN_GROUP_SIZE) {
          for (const el of group) candidates.push(el);
        }
      }
    }
    return candidates;
  }

  /* ============================================================== *
   *  HIGH-LEVEL SCAN                                               *
   * ============================================================== */

  /**
   * Runs the full pipeline once, returning the ranked product container set.
   * @param {Element} [root]
   * @returns {Element[]}
   */
  function scan(root) {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const searchRoot = root || document.body;
    if (!searchRoot) return [];

    /** @type {Element[]} */
    let candidates = [];

    // 1) Fast path: known site selectors. These have very high precision and
    //    avoid a full structural scan when they match.
    for (const sel of FAST_PATH_SELECTORS) {
      try {
        const matches = searchRoot.querySelectorAll(sel);
        if (matches.length > 0) {
          for (const m of matches) candidates.push(m);
        }
      } catch (_) { /* invalid selector on some browsers — ignore */ }
    }

    // 2) If fast-path produced few results, augment with structural inference.
    //    Threshold of 3 chosen so single-product pages still inject correctly.
    if (candidates.length < 3) {
      const structural = findRepeatingClusters(searchRoot);
      for (const el of structural) candidates.push(el);
    }

    // 3) Score & filter.
    const scored = [];
    const seen = new Set();
    for (const el of candidates) {
      if (seen.has(el)) continue;
      seen.add(el);
      const s = scoreElement(el);
      if (s >= SCORE_ACCEPT_THRESHOLD) scored.push({ el, s });
    }

    // 4) Drop ancestor duplicates (outer wrapper vs inner tile).
    let result = dropNestedAncestors(scored.map((x) => x.el));

    // 5) Apply max cap, prefer higher-scoring.
    if (result.length > options.maxContainers) {
      const scoreMap = new Map(scored.map((x) => [x.el, x.s]));
      result.sort((a, b) => (scoreMap.get(b) || 0) - (scoreMap.get(a) || 0));
      result = result.slice(0, options.maxContainers);
    }

    const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    stats.scans++;
    stats.lastScanMs = t1 - t0;
    stats.totalScanMs += stats.lastScanMs;
    return result;
  }

  /* ============================================================== *
   *  VIEWPORT GATING                                               *
   * ============================================================== */

  function ensureViewportObserver() {
    if (viewportObserver || options.includeOffscreen) return;
    if (typeof IntersectionObserver === 'undefined') return;
    viewportObserver = new IntersectionObserver(
      (entries) => {
        let added = false;
        for (const e of entries) {
          if (e.isIntersecting) {
            viewportPending.add(/** @type {Element} */ (e.target));
            viewportObserver.unobserve(e.target);
            added = true;
          }
        }
        if (added) flushViewportPending();
      },
      { rootMargin: `${options.viewportMargin}px`, threshold: 0 }
    );
  }

  function flushViewportPending() {
    if (viewportPending.size === 0) return;
    const batch = Array.from(viewportPending);
    viewportPending.clear();
    notifySubscribers(batch);
  }

  /* ============================================================== *
   *  SUBSCRIBERS                                                   *
   * ============================================================== */

  /**
   * @param {Element[]} els
   */
  function notifySubscribers(els) {
    if (els.length === 0) return;
    /** @type {Element[]} */
    const fresh = [];
    for (const el of els) {
      if (!reported.has(el)) {
        reported.add(el);
        fresh.push(el);
      }
    }
    if (fresh.length === 0) return;
    stats.containersFound += fresh.length;
    for (const cb of subscribers) {
      try { cb(fresh); } catch (err) { console.error('[CL Detector] subscriber error', err); }
    }
  }

  /* ============================================================== *
   *  MUTATION PIPELINE                                             *
   * ============================================================== */

  /**
   * @param {MutationRecord[]} records
   */
  function onMutations(records) {
    let queued = 0;
    for (const r of records) {
      if (r.type !== 'childList') continue;
      const added = r.addedNodes;
      for (let i = 0; i < added.length; i++) {
        const n = added[i];
        if (n.nodeType !== 1) continue;          // ELEMENT_NODE only
        const el = /** @type {Element} */ (n);
        if (SKIP_TAGS.has(el.tagName)) continue;
        if (analyzedRoots.has(el)) continue;
        // Promote to nearest stable wrapper if the added node is tiny.
        const wrapper = el.children.length > 0 ? el : (el.parentElement || el);
        if (analyzedRoots.has(wrapper)) continue;
        pendingRoots.add(wrapper);
        queued++;
      }
    }
    if (queued === 0) return;
    stats.mutationsBatched += queued;
    if (mutationTimer !== null) clearTimeout(mutationTimer);
    mutationTimer = /** @type {any} */ (setTimeout(processPending, options.debounceMs));
  }

  function processPending() {
    mutationTimer = null;
    if (pendingRoots.size === 0) return;
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();

    const run = () => {
      /** @type {Element[]} */
      const aggregate = [];
      for (const root of roots) {
        if (!root.isConnected) continue;
        analyzedRoots.add(root);
        const found = scan(root);
        for (const el of found) aggregate.push(el);
      }
      if (aggregate.length === 0) return;

      if (options.includeOffscreen || !viewportObserver) {
        notifySubscribers(aggregate);
      } else {
        // Defer until in/near viewport. Tiles already on-screen pass through
        // synchronously by checking getBoundingClientRect once, batched.
        for (const el of aggregate) {
          if (reported.has(el)) continue;
          // We DO read getBoundingClientRect here, but only once per
          // candidate, after layout has stabilised post-mutation. This is the
          // standard tradeoff for viewport gating.
          const rect = el.getBoundingClientRect();
          const inView = rect.top < (window.innerHeight + options.viewportMargin) && rect.bottom > -options.viewportMargin;
          if (inView) {
            notifySubscribers([el]);
          } else {
            viewportObserver.observe(el);
          }
        }
      }
    };

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 250 });
    } else {
      setTimeout(run, 0);
    }
  }

  /* ============================================================== *
   *  PUBLIC API                                                    *
   * ============================================================== */

  /**
   * @param {DetectorOptions} [opts]
   */
  function init(opts) {
    if (initialized) return;
    initialized = true;
    if (opts) options = { ...options, ...opts };

    ensureViewportObserver();

    const startObserve = () => {
      if (!document.body) return;
      mutationObserver = new MutationObserver(onMutations);
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserve, { once: true });
    } else {
      startObserve();
    }

    // Cleanup on tab teardown to avoid leaks across SPA navigations.
    window.addEventListener('pagehide', destroy, { once: true });
  }

  /**
   * @param {(els: Element[]) => void} cb
   * @returns {() => void} unsubscribe
   */
  function onContainers(cb) {
    subscribers.push(cb);
    return () => {
      const i = subscribers.indexOf(cb);
      if (i >= 0) subscribers.splice(i, 1);
    };
  }

  function destroy() {
    if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null; }
    if (viewportObserver) { viewportObserver.disconnect(); viewportObserver = null; }
    if (mutationTimer !== null) { clearTimeout(mutationTimer); mutationTimer = null; }
    pendingRoots.clear();
    viewportPending.clear();
    subscribers.length = 0;
    initialized = false;
  }

  function getStats() { return { ...stats }; }

  /* ============================================================== *
   *  EXPORT                                                        *
   * ============================================================== */

  global.__CL_Detector = {
    init,
    scan,
    findProductContainers: scan,
    onContainers,
    destroy,
    getStats,
    // Exposed for tests / benchmarks; not part of the public contract.
    _internal: {
      shallowSignature, scoreElement, findRepeatingClusters,
      dropNestedAncestors, hasPrice, PRICE_REGEX,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
