// Content Script for The CANADA List Extension
// Injects product badges and tooltips on e-commerce sites

const BADGE_CLASS = 'canada-list-badge';
const SCANNED_ATTRIBUTE = 'data-canada-list-scanned';
// Bounded LRU-ish cache: simple Map with size cap. Evicts oldest entries on
// overflow so a long infinite-scroll session can't grow memory unbounded.
const PRODUCT_NAME_CACHE = new Map();
const PRODUCT_NAME_CACHE_MAX = 1500;
let FLOATING_TOOLTIP = null;
let ACTIVE_NOTIFICATION = null;
let SITE_NOTIFICATION = null;
let SITE_NOTIFICATION_SHOWN = false;

// Session storage key to track notification per domain per tab session
const NOTIFICATION_SESSION_KEY = 'canada-list-notification-shown';
const SITE_NOTIFICATION_SESSION_KEY = 'canada-list-site-notification-shown';

// Check if notification was already shown in this tab session for this domain
function wasNotificationShownThisSession() {
  try {
    const shownDomains = sessionStorage.getItem(NOTIFICATION_SESSION_KEY);
    if (!shownDomains) return false;
    const domains = JSON.parse(shownDomains);
    return domains.includes(window.location.hostname);
  } catch (e) {
    return false;
  }
}

// Mark notification as shown for this domain in this tab session
function markNotificationShown() {
  try {
    const shownDomains = sessionStorage.getItem(NOTIFICATION_SESSION_KEY);
    let domains = shownDomains ? JSON.parse(shownDomains) : [];
    if (!domains.includes(window.location.hostname)) {
      domains.push(window.location.hostname);
      sessionStorage.setItem(NOTIFICATION_SESSION_KEY, JSON.stringify(domains));
    }
  } catch (e) {
    // sessionStorage not available, silently fail
  }
}

// Check if site notification was already shown in this tab session for this domain
function wasSiteNotificationShownThisSession() {
  try {
    const shownDomains = sessionStorage.getItem(SITE_NOTIFICATION_SESSION_KEY);
    if (!shownDomains) return false;
    const domains = JSON.parse(shownDomains);
    return domains.includes(window.location.hostname);
  } catch (e) {
    return false;
  }
}

// Mark site notification as shown for this domain in this tab session
function markSiteNotificationShown() {
  try {
    const shownDomains = sessionStorage.getItem(SITE_NOTIFICATION_SESSION_KEY);
    let domains = shownDomains ? JSON.parse(shownDomains) : [];
    if (!domains.includes(window.location.hostname)) {
      domains.push(window.location.hostname);
      sessionStorage.setItem(SITE_NOTIFICATION_SESSION_KEY, JSON.stringify(domains));
    }
  } catch (e) {
    // sessionStorage not available, silently fail
  }
}

/**
 * Update notification positions to stack like iOS notification center
 */
function updateNotificationPositions() {
  const gap = 12; // Gap between notifications
  const topStart = 20; // Starting top position
  
  const notifications = [];
  if (ACTIVE_NOTIFICATION && ACTIVE_NOTIFICATION.classList.contains('show')) {
    notifications.push(ACTIVE_NOTIFICATION);
  }
  if (SITE_NOTIFICATION && SITE_NOTIFICATION.classList.contains('show')) {
    notifications.push(SITE_NOTIFICATION);
  }
  
  let currentTop = topStart;
  notifications.forEach((notification) => {
    notification.style.setProperty('top', `${currentTop}px`, 'important');
    const height = notification.offsetHeight;
    currentTop += height + gap;
  });
}

/**
 * Check if current website domain is in CANADA List
 */
async function checkSiteInCanadaList() {
  // Check if already shown in this tab session
  if (wasSiteNotificationShownThisSession() || SITE_NOTIFICATION_SHOWN || SITE_NOTIFICATION) return;
  
  const hostname = window.location.hostname;
  // Extract main domain name (remove www, .com, .ca, etc.)
  const domainParts = hostname.replace(/^www\./, '').split('.');
  const siteName = domainParts[0]; // e.g., "acadianmaple" from "acadianmaple.com"
  
  if (!siteName || siteName.length < 3) return;
  
  // Ask background to check if this site name matches any company/brand
  return new Promise((resolve) => {
    if (!chrome.runtime?.id) {
      resolve(null);
      return;
    }
    
    chrome.runtime.sendMessage(
      { action: 'checkSiteName', siteName, hostname },
      (response) => {
        if (response && response.score) {
          showSiteNotification(response);
        }
        resolve(response);
      }
    );
  });
}

/**
 * Show site notification for Canadian websites
 */
function showSiteNotification(siteInfo) {
  // Check again in case of race conditions
  if (wasSiteNotificationShownThisSession() || SITE_NOTIFICATION_SHOWN || SITE_NOTIFICATION) return;
  
  const notification = document.createElement('div');
  notification.className = 'canada-site-notification';
  notification.setAttribute('role', 'alert');
  notification.setAttribute('aria-live', 'polite');
  
  const score = siteInfo.score;
  const companyName = siteInfo.companyName || 'This website';
  
  notification.innerHTML = `
    <div class="canada-notification-content">
      <div class="canada-notification-icon"></div>
      <div class="canada-notification-body">
        <div class="canada-notification-title">Site on The CANADA List</div>
        <div class="canada-notification-message">${companyName} - ${score}/10 Score</div>
      </div>
      <button class="canada-notification-close" aria-label="Close notification">×</button>
    </div>
  `;
  
  document.body.appendChild(notification);
  SITE_NOTIFICATION = notification;
  SITE_NOTIFICATION_SHOWN = true;
  
  // Mark as shown for this session
  markSiteNotificationShown();
  
  // Add close button handler
  const closeBtn = notification.querySelector('.canada-notification-close');
  closeBtn.addEventListener('click', () => {
    hideSiteNotification();
  });
  
  // Update positions to stack notifications
  updateNotificationPositions();
  
  // Show notification with animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      notification.classList.add('show');
      // Update positions again after animation starts
      setTimeout(() => updateNotificationPositions(), 50);
    });
  });
  
  // Auto-hide after 6 seconds
  setTimeout(() => {
    hideSiteNotification();
  }, 6000);
}

/**
 * Hide site notification
 */
function hideSiteNotification() {
  if (!SITE_NOTIFICATION) return;
  
  SITE_NOTIFICATION.classList.remove('show');
  SITE_NOTIFICATION.classList.add('hide');
  
  // Update positions to shift remaining notifications up
  setTimeout(() => updateNotificationPositions(), 50);
  
  // Remove from DOM after animation completes
  setTimeout(() => {
    if (SITE_NOTIFICATION && SITE_NOTIFICATION.parentElement) {
      SITE_NOTIFICATION.remove();
      SITE_NOTIFICATION = null;
      updateNotificationPositions();
    }
  }, 400);
}

/**
 * Create and show active notification
 */
function createActiveNotification() {
  // Check if already shown in this tab session
  if (wasNotificationShownThisSession() || ACTIVE_NOTIFICATION) return;
  
  const notification = document.createElement('div');
  notification.className = 'canada-active-notification';
  notification.setAttribute('role', 'alert');
  notification.setAttribute('aria-live', 'polite');
  
  notification.innerHTML = `
    <div class="canada-notification-content">
      <div class="canada-notification-icon"></div>
      <div class="canada-notification-body">
        <div class="canada-notification-title">The CANADA List is Active</div>
        <div class="canada-notification-message">Scanning for Canadian products on this page</div>
      </div>
      <button class="canada-notification-close" aria-label="Close notification">×</button>
    </div>
  `;
  
  document.body.appendChild(notification);
  ACTIVE_NOTIFICATION = notification;
  
  // Mark as shown for this session
  markNotificationShown();
  
  // Add close button handler
  const closeBtn = notification.querySelector('.canada-notification-close');
  closeBtn.addEventListener('click', () => {
    hideActiveNotification();
  });
  
  // Update positions to stack notifications
  updateNotificationPositions();
  
  // Show notification with animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      notification.classList.add('show');
      // Update positions again after animation starts
      setTimeout(() => updateNotificationPositions(), 50);
    });
  });
  
  // Auto-hide after 4 seconds
  setTimeout(() => {
    hideActiveNotification();
  }, 4000);
}

/**
 * Hide active notification
 */
function hideActiveNotification() {
  if (!ACTIVE_NOTIFICATION) return;
  
  ACTIVE_NOTIFICATION.classList.remove('show');
  ACTIVE_NOTIFICATION.classList.add('hide');
  
  // Update positions to shift remaining notifications up
  setTimeout(() => updateNotificationPositions(), 50);
  
  // Remove from DOM after animation completes
  setTimeout(() => {
    if (ACTIVE_NOTIFICATION && ACTIVE_NOTIFICATION.parentElement) {
      ACTIVE_NOTIFICATION.remove();
      ACTIVE_NOTIFICATION = null;
      updateNotificationPositions();
    }
  }, 400);
}

function getProductInfo(productName, containerText) {
  if (!productName && !containerText) {
    return Promise.resolve(null);
  }

  // Cache key uses name + a short fingerprint of containerText to avoid bloating the map
  const cacheKey = (productName || '') + '|||' + (containerText ? containerText.slice(0, 80) : '');
  if (PRODUCT_NAME_CACHE.has(cacheKey)) {
    // Touch entry: re-insert so it becomes most recent (Map preserves insertion order).
    const cached = PRODUCT_NAME_CACHE.get(cacheKey);
    PRODUCT_NAME_CACHE.delete(cacheKey);
    PRODUCT_NAME_CACHE.set(cacheKey, cached);
    return cached;
  }

  const pendingRequest = new Promise((resolve) => {
    if (!chrome.runtime?.id) {
      resolve(null);
      return;
    }

    chrome.runtime.sendMessage(
      { action: 'getProductInfo', productName, containerText },
      (response) => resolve(response || null)
    );
  });

  PRODUCT_NAME_CACHE.set(cacheKey, pendingRequest);
  // Evict oldest entries if the cache is over capacity.
  if (PRODUCT_NAME_CACHE.size > PRODUCT_NAME_CACHE_MAX) {
    const firstKey = PRODUCT_NAME_CACHE.keys().next().value;
    if (firstKey !== undefined) PRODUCT_NAME_CACHE.delete(firstKey);
  }
  return pendingRequest;
}

function normalizeCandidateText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\|.*$/, ' ')
    .trim();
}

function isReasonableProductText(text) {
  if (!text) return false;
  if (text.length < 3 || text.length > 220) return false;
  if (/^(home|menu|shop|search|cart|account|wishlist)$/i.test(text)) return false;
  if (/^(add to cart|buy now|view details|quick view)$/i.test(text)) return false;
  return true;
}

function getCandidateProductName(container) {
  const textSelectors = [
    '[itemprop="name"]',
    '[data-testid*="title" i]',
    '[data-automation*="title" i]',
    '[class*="product-name" i]',
    '[class*="product_title" i]',
    '[class*="product-title" i]',
    '[class*="title" i]',
    'h1',
    'h2',
    'h3',
    'a[title]'
  ];

  for (const selector of textSelectors) {
    const candidate = container.querySelector(selector);
    if (!candidate) continue;

    const label = normalizeCandidateText(candidate.textContent || candidate.getAttribute('title'));
    if (isReasonableProductText(label)) {
      return label;
    }
  }

  const ownText = normalizeCandidateText(container.textContent?.slice(0, 220));
  return isReasonableProductText(ownText) ? ownText : null;
}

// An anchor is "safe" when it scrolls with the page normally. Sticky / fixed
// elements break this: a badge placed inside a sticky image wrapper would
// stay on screen as the user scrolls and overlap site headers / search bars.
function isSafeAnchor(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  const pos = window.getComputedStyle(el).position;
  return pos !== 'fixed' && pos !== 'sticky';
}

function findBadgeAnchor(container) {
  const imageContainer = container.querySelector('img')?.parentElement;
  // Only use the image's parent if (a) it lives inside the product container,
  // and (b) it isn't itself fixed/sticky — otherwise the badge floats free
  // and overlaps the site header on scroll.
  if (imageContainer && container.contains(imageContainer) && isSafeAnchor(imageContainer)) {
    return imageContainer;
  }
  // Fall back to the container itself only if IT is also safe; otherwise walk
  // up looking for the first non-sticky ancestor still inside the tile.
  if (isSafeAnchor(container)) return container;
  let p = container.parentElement;
  while (p && p !== document.body) {
    if (isSafeAnchor(p)) return p;
    p = p.parentElement;
  }
  return container; // last-ditch
}

// Reject non-product containers (nav/header/filter/sort/breadcrumb ancestors, no image, etc.)
// to stop badges from being injected on search bars, sort dropdowns, or random page chrome.
const NON_PRODUCT_ANCESTOR_SELECTOR = [
  'header', 'nav', 'aside', 'footer',
  'form[role="search"]', '[role="search"]', '[role="banner"]', '[role="navigation"]',
  '[class*="breadcrumb" i]',
  '[class*="filter" i]', '[class*="facet" i]', '[class*="sort" i]',
  '[class*="header" i]', '[class*="navbar" i]', '[class*="navigation" i]',
  '[class*="sidebar" i]', '[class*="menu" i]', '[class*="footer" i]',
  '[id*="header" i]', '[id*="nav" i]', '[id*="footer" i]'
].join(',');

function isLikelyProductContainer(el) {
  if (!el || !el.isConnected) return false;
  if (el.closest(NON_PRODUCT_ANCESTOR_SELECTOR)) {
    // Allow if the container itself is an explicit Product schema item — Amazon's
    // s-search-result lives inside a-section etc., so the strict ancestor check
    // shouldn't fight specific product markers.
    if (!el.matches('[itemtype*="Product"],[data-component-type="s-search-result"],[data-testid*="product" i],[data-testid*="ProductTile" i]')) {
      return false;
    }
  }

  const hasImage = !!el.querySelector('img, picture, [role="img"], [style*="background-image" i]');
  const hasProductSchema = el.matches('[itemtype*="Product"]') || !!el.querySelector('[itemtype*="Product"]');
  if (!hasImage && !hasProductSchema) return false;

  return true;
}

// Drop containers whose ancestor is also in the set — keeps the outermost match
// (which on Amazon/Walmart/etc. is the actual product tile) and prevents the
// "two badges, one above and one below the tile" duplicate-injection bug.
function dropNestedContainers(elements) {
  const set = new Set(elements);
  const result = [];
  for (const el of elements) {
    let ancestor = el.parentElement;
    let nested = false;
    while (ancestor) {
      if (set.has(ancestor)) { nested = true; break; }
      ancestor = ancestor.parentElement;
    }
    if (!nested) result.push(el);
  }
  return result;
}

function attachBadge(anchorElement, badge) {
  const computed = window.getComputedStyle(anchorElement).position;
  if (computed === 'static') {
    anchorElement.style.position = 'relative';
  }
  anchorElement.appendChild(badge);
}

function getTooltipHtml(product, score) {
  const color = getScoreColor(score);
  const scoreLabel = getScoreLabel(score);
  
  return `
    <div class="canada-badge-tooltip-inner">
      <div class="tcl-score-row">
        <span class="tcl-score-pill" style="background:${color}">${score}/10</span>
        <span style="font-size:12px;color:#555;font-family:inherit">${scoreLabel} Canadian Contribution</span>
      </div>
      <div class="tcl-meta">
        <span class="tcl-meta-label">Product</span>
        <span class="tcl-meta-value">${product['Product Name']}</span>
        <span class="tcl-meta-label">Ownership</span>
        <span class="tcl-meta-value">${product['Ownership (Country)']}</span>
        <span class="tcl-meta-label">Made in</span>
        <span class="tcl-meta-value">${product['Manufacturing (Countries)']}</span>
      </div>
    </div>
  `;
}

function getFloatingTooltip() {
  if (FLOATING_TOOLTIP && document.body.contains(FLOATING_TOOLTIP)) {
    return FLOATING_TOOLTIP;
  }

  FLOATING_TOOLTIP = document.createElement('div');
  FLOATING_TOOLTIP.className = 'canada-badge-tooltip canada-badge-tooltip-floating';
  FLOATING_TOOLTIP.setAttribute('role', 'tooltip');
  document.body.appendChild(FLOATING_TOOLTIP);
  return FLOATING_TOOLTIP;
}

function positionTooltipNearBadge(tooltip, badge) {
  const rect = badge.getBoundingClientRect();
  const margin = 10;
  tooltip.style.setProperty('left', '0px', 'important');
  tooltip.style.setProperty('top', '0px', 'important');
  tooltip.style.setProperty('opacity', '1', 'important');

  const tooltipRect = tooltip.getBoundingClientRect();
  let left = rect.right - tooltipRect.width;
  let top = rect.top - tooltipRect.height - margin;

  if (left < 8) left = 8;
  if (left + tooltipRect.width > window.innerWidth - 8) {
    left = window.innerWidth - tooltipRect.width - 8;
  }

  if (top < 8) {
    top = rect.bottom + margin;
  }

  if (top + tooltipRect.height > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - tooltipRect.height - 8);
  }

  tooltip.style.setProperty('left', `${left}px`, 'important');
  tooltip.style.setProperty('top', `${top}px`, 'important');
}

function bindTooltipEvents(badge, product, score) {
  badge.addEventListener('mouseenter', () => {
    const tooltip = getFloatingTooltip();
    tooltip.innerHTML = getTooltipHtml(product, score);
    positionTooltipNearBadge(tooltip, badge);
  });

  badge.addEventListener('mousemove', () => {
    const tooltip = getFloatingTooltip();
    if (tooltip.style.opacity === '1') {
      positionTooltipNearBadge(tooltip, badge);
    }
  });

  badge.addEventListener('mouseleave', () => {
    const tooltip = getFloatingTooltip();
    tooltip.style.setProperty('opacity', '0', 'important');
  });
}

let _retryScheduled = false;
function scheduleRetryWhenReady() {
  if (_retryScheduled) return;
  _retryScheduled = true;
  setTimeout(() => {
    _retryScheduled = false;
    scheduleRescan();
  }, 800);
}

async function injectBadgeForContainer(container) {
  if (!container || container.querySelector(`.${BADGE_CLASS}`)) return;
  if (container.getAttribute(SCANNED_ATTRIBUTE) === '1') return;

  const productName = getCandidateProductName(container);
  // Capture full container text (truncated) so the background AC scanner has a fallback signal
  const containerText = ((container.innerText || container.textContent || '') + '').slice(0, 800);
  container.setAttribute(SCANNED_ATTRIBUTE, '1');

  if (!isReasonableProductText(productName) && !containerText.trim()) return;

  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const productInfo = await getProductInfo(productName, containerText);
  const tMatched = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // Background tells us the cache isn't ready yet — clear the scanned flag and
  // evict our local cache entry so the next observer tick retries this tile.
  if (productInfo && productInfo.__notReady) {
    container.removeAttribute(SCANNED_ATTRIBUTE);
    const cacheKey = (productName || '') + '|||' + (containerText ? containerText.slice(0, 80) : '');
    PRODUCT_NAME_CACHE.delete(cacheKey);
    scheduleRetryWhenReady();
    return;
  }

  const score = Number(productInfo?.['CANADIAN Score (out of 10)']);
  if (!productInfo || Number.isNaN(score) || score < 1 || score > 10) {
    return;
  }

  const badge = createBadge(productInfo);
  const anchor = findBadgeAnchor(container);
  attachBadge(anchor, badge);

  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // Split timing: matchMs is round-trip to the service worker (the part we can
  // optimise via warm-up); domMs is local DOM work (should always be <1ms).
  const matchMs = Math.round(tMatched - t0);
  const domMs = Math.round(t1 - tMatched);
  const total = Math.round(t1 - t0);
  console.log(`🍁 Badge injected for "${productInfo['Product Name'] || productName}" in ${total}ms (match: ${matchMs}ms, dom: ${domMs}ms)`);
}

function collectProductContainers() {
  // Primary path: universal detector (universal-detector.js loaded before us).
  // It uses structural-repetition analysis + heuristic scoring + a fast-path
  // for known site selectors, and is much more accurate than the legacy
  // selector list below. We still keep the legacy path as a safety net in
  // case the detector module fails to load.
  if (window.__CL_Detector && typeof window.__CL_Detector.scan === 'function') {
    try {
      const found = window.__CL_Detector.scan(document.body);
      // Apply the existing nested-ancestor guard one more time as defence
      // in depth — the detector already does this, but double-checking
      // here is cheap (O(n²) on small n).
      return dropNestedContainers(found).slice(0, 200);
    } catch (err) {
      console.error('[CANADA List] universal detector failed, falling back', err);
      // fall through to legacy path
    }
  }

  // Legacy fallback (kept verbatim so existing Amazon/Best Buy behaviour is
  // preserved if the detector module fails to load for any reason).
  const selectors = [
    '[data-component-type="s-search-result"]',
    '[data-testid="ProductTile"]',
    '[data-testid="product-tile"]',
    '[class*="product-card" i]',
    '[class*="product_tile" i]',
    '[class*="product-item" i]',
    '[class*="product-item-card" i]',
    '[class*="collection-product" i]',
    'li[class*="product" i]',
    'article[class*="product" i]',
    '[itemtype*="Product"]'
  ];

  const containers = [];
  const seen = new Set();

  for (const selector of selectors) {
    const matches = document.querySelectorAll(selector);
    for (const match of matches) {
      if (seen.has(match)) continue;
      seen.add(match);
      containers.push(match);
    }
  }

  const cleaned = dropNestedContainers(containers.filter(isLikelyProductContainer));
  return cleaned.slice(0, 120);
}

async function injectListingBadges() {
  const containers = collectProductContainers();
  if (containers.length === 0) return;
  // Pre-filter: containers already scanned (or already badged) short-circuit
  // inside injectBadgeForContainer. Filtering here avoids spawning
  // hundreds of resolved-immediately promises on every mutation tick on
  // long product pages — meaningful CPU saving on infinite scroll.
  const fresh = containers.filter((c) =>
    c.getAttribute(SCANNED_ATTRIBUTE) !== '1' && !c.querySelector(`.${BADGE_CLASS}`)
  );
  if (fresh.length === 0) return;
  // Fire all matches in parallel; SCANNED_ATTRIBUTE is set synchronously inside each call so
  // race conditions (e.g. overlapping MutationObserver bursts) self-deduplicate.
  await Promise.all(fresh.map((c) => injectBadgeForContainer(c)));
}

async function injectProductDetailBadge() {
  if (document.body.getAttribute('data-canada-list-page-scanned') === '1') return;

  const detailName = normalizeCandidateText(
    document.querySelector('[property="og:title"]')?.getAttribute('content') ||
    document.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ||
    document.querySelector('[itemprop="name"]')?.textContent ||
    document.querySelector('h1')?.textContent ||
    document.title
  );

  if (!isReasonableProductText(detailName)) return;

  const productInfo = await getProductInfo(detailName);
  const score = Number(productInfo?.['CANADIAN Score (out of 10)']);
  if (!productInfo || Number.isNaN(score) || score < 1 || score > 10) return;

  if (document.querySelector(`body > .${BADGE_CLASS}.canada-page-badge`)) return;

  const badge = createBadge(productInfo);
  badge.classList.add('canada-page-badge');
  badge.style.position = 'fixed';
  badge.style.top = '16px';
  badge.style.right = '16px';
  badge.style.zIndex = '2147483647';
  document.body.appendChild(badge);
  document.body.setAttribute('data-canada-list-page-scanned', '1');
}

async function injectBadges() {
  await injectListingBadges();
}

/**
 * Score to color mapping (accessibility-compliant)
 */
function getScoreColor(score) {
  if (score >= 9) return '#0d6e35'; // Canadian green (WCAG AAA)
  if (score >= 7) return '#2d5016'; // Darker green
  if (score >= 5) return '#b8860b'; // Goldenrod
  if (score >= 3) return '#c97d1a'; // Orange
  return '#8b0000'; // Dark red
}

function getScoreLabel(score) {
  if (score >= 9) return 'Excellent';
  if (score >= 7) return 'Good';
  if (score >= 5) return 'Moderate';
  if (score >= 3) return 'Limited';
  return 'Minimal';
}

/**
 * Create CANADA Score badge element
 */
function createBadge(product) {
  const score = Number(product['CANADIAN Score (out of 10)']);
  const badge = document.createElement('div');
  badge.className = BADGE_CLASS;
  badge.setAttribute('aria-label', `CANADA Score: ${score} out of 10`);
  badge.setAttribute('role', 'img');

  const color = getScoreColor(score);
  badge.style.backgroundColor = color;
  badge.innerHTML = `
    <div class="canada-score-number">${score}</div>
    <div class="canada-score-label">CA</div>
  `;

  bindTooltipEvents(badge, product, score);

  return badge;
}

// E-commerce heuristic: only run badge injection if the page has shopping-site
// signals. Prevents the extension from spamming work on news/blogs/social/etc.
// Re-evaluated on each scan because SPAs may add product markers later.
const ECOMMERCE_HOST_PATTERN = /(amazon|walmart|costco|bestbuy|canadiantire|nofrills|loblaws|shoppers|sobeys|metro\.ca|indigo|chapters|staples|homedepot|lowes|ikea|sportchek|hudsonsbay|simons|wellca|rexall|dollarama|saveonfoods|realcanadian|superstore|etsy|aliexpress|ebay|shopify|squarespace|bigcommerce|woocommerce)/i;
const ECOMMERCE_PATH_PATTERN = /(\/shop(\/|$)|\/store(\/|$)|\/cart(\/|$)|\/checkout(\/|$)|\/products?(\/|$)|\/collections?(\/|$)|\/catalog(\/|$))/i;

function looksLikeEcommercePage() {
  const host = window.location.hostname;
  const path = window.location.pathname;
  if (ECOMMERCE_HOST_PATTERN.test(host)) return true;
  if (ECOMMERCE_PATH_PATTERN.test(path)) return true;

  if (document.querySelector('[itemtype*="Product"]')) return true;

  const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute('content') || '';
  if (/product/i.test(ogType)) return true;

  if (typeof window !== 'undefined' && (window.Shopify || window.__NEXT_DATA__?.props?.pageProps?.product)) {
    return true;
  }
  if (document.querySelector('link[href*="shopify" i], script[src*="shopify" i], meta[name="generator"][content*="shopify" i], meta[name="generator"][content*="woocommerce" i]')) {
    return true;
  }

  if (document.querySelector([
    '[data-component-type="s-search-result"]',
    '[data-testid*="product" i]',
    '[data-testid*="ProductTile" i]',
    '[class*="product-card" i]',
    '[class*="product-tile" i]',
    '[class*="product-item" i]',
    '[class*="add-to-cart" i]',
    '[class*="addtocart" i]',
    '[class*="add_to_cart" i]',
    'button[name*="add-to-cart" i]',
    'form[action*="cart" i]'
  ].join(','))) return true;

  return false;
}

/**
 * Main initialization - detect which retailer and inject badges
 */
let _gateLogged = false;
async function init() {
  if (!looksLikeEcommercePage()) {
    if (!_gateLogged) {
      console.log('🍁 The CANADA List: no e-commerce signals on this page, skipping.');
      _gateLogged = true;
    }
    return;
  }
  if (document.hidden) return; // defer work for background tabs
  const host = window.location.hostname;
  if (!_gateLogged) {
    console.log(`🍁 The CANADA List extension active on: ${host}`);
    _gateLogged = true;
    
    // Show both notifications at the EXACT same time
    const showActive = document.body && !wasNotificationShownThisSession();
    
    // Fire both simultaneously - no waiting
    if (showActive) {
      createActiveNotification();
    }
    checkSiteInCanadaList(); // Non-blocking, will show when ready
  }
  try {
    injectBadges();
  } catch (error) {
    console.error('Error injecting badges:', error);
  }
}

// Wake-up ping. The MV3 service worker is killed after ~30s idle. When a fresh
// page asks for a product, the SW must boot AND rebuild its 7.5k-entry search
// index before it can answer — that's the 5-10s "first batch" stall. By sending
// a no-op ping as early as possible (BEFORE the page finishes hydrating, before
// any DOM scan runs) the SW boot and trie warm-up happen in parallel with the
// page's own startup work, so by the time we actually scan for tiles the
// background is already hot.
if (chrome.runtime?.id) {
  try {
    chrome.runtime.sendMessage({ action: 'ping' }, () => {
      // Discard reply / lastError — fire-and-forget.
      void chrome.runtime.lastError;
    });
  } catch (_) { /* extension context gone — ignore */ }
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Re-inject badges when new products load (for infinite scroll, pagination, etc.)
let observerTimer = null;
const scheduleRescan = () => {
  if (observerTimer) clearTimeout(observerTimer);
  observerTimer = setTimeout(() => {
    const run = () => init();
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 300 });
    } else {
      run();
    }
  }, 150);
};

// Observer feedback prevention: when we inject a badge, the MutationObserver
// fires for our own DOM addition. Without filtering, every badge injection
// would queue another rescan tick. We discard mutations whose addedNodes are
// exclusively our own badges/tooltips, eliminating the feedback loop.
const observer = new MutationObserver((records) => {
  for (const r of records) {
    if (r.type !== 'childList') continue;
    const added = r.addedNodes;
    for (let i = 0; i < added.length; i++) {
      const n = added[i];
      if (n.nodeType !== 1) continue; // ELEMENT_NODE
      // Ignore our own badges/tooltips so we don't rescan because of ourselves.
      if (
        n.classList && (
          n.classList.contains(BADGE_CLASS) ||
          n.classList.contains('canada-list-tooltip')
        )
      ) continue;
      // Genuine page mutation — schedule a rescan and bail.
      scheduleRescan();
      return;
    }
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
  // attributes/characterData NOT observed — they're cosmetic noise on most
  // SPAs (style/class flips during animations) and would cause excessive
  // mutation traffic without producing any new product tiles to badge.
});

// Re-scan when the tab becomes visible again (catches SPAs that mutated while hidden).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleRescan();
});
