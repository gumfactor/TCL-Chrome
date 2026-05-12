// Content Script for The CANADA List Extension
// Injects product badges and tooltips on e-commerce sites

const BADGE_CLASS = 'canada-list-badge';
const SCANNED_ATTRIBUTE = 'data-canada-list-scanned';
const PRODUCT_NAME_CACHE = new Map();
let FLOATING_TOOLTIP = null;

function getProductInfo(productName, containerText) {
  if (!productName && !containerText) {
    return Promise.resolve(null);
  }

  // Cache key uses name + a short fingerprint of containerText to avoid bloating the map
  const cacheKey = (productName || '') + '|||' + (containerText ? containerText.slice(0, 80) : '');
  if (PRODUCT_NAME_CACHE.has(cacheKey)) {
    return PRODUCT_NAME_CACHE.get(cacheKey);
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

function findBadgeAnchor(container) {
  const imageContainer = container.querySelector('img')?.parentElement;
  return imageContainer || container;
}

function attachBadge(anchorElement, badge) {
  const computed = window.getComputedStyle(anchorElement).position;
  if (computed === 'static') {
    anchorElement.style.position = 'relative';
  }
  anchorElement.appendChild(badge);
}

function getTooltipHtml(product, score) {
  const matchType = product?.['__matchType'] === 'brand' ? 'Brand match' : 'Direct match';
  const matchedBrand = product?.['__matchedBrand'] ? ` (${product['__matchedBrand']})` : '';
  const notes = product['Notes'] ? `<small>${product['Notes']}</small>` : '';
  const color = getScoreColor(score);

  return `
    <div class="canada-badge-tooltip-inner">
      <strong>${product['Product Name']}</strong>
      <div class="tcl-score-row">
        <span class="tcl-score-pill" style="background:${color}">${score}/10</span>
        <span style="font-size:12px;color:#555;font-family:inherit">${getScoreLabel(score)} Canadian contribution</span>
      </div>
      <div class="tcl-meta">
        <span class="tcl-meta-label">Match</span>
        <span class="tcl-meta-value">${matchType}${matchedBrand}</span>
        <span class="tcl-meta-label">Ownership</span>
        <span class="tcl-meta-value">${product['Ownership (Country)']}</span>
        <span class="tcl-meta-label">Made in</span>
        <span class="tcl-meta-value">${product['Manufacturing (Countries)']}</span>
      </div>
      ${notes}
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

async function injectBadgeForContainer(container) {
  if (!container || container.querySelector(`.${BADGE_CLASS}`)) return;
  if (container.getAttribute(SCANNED_ATTRIBUTE) === '1') return;

  const productName = getCandidateProductName(container);
  // Capture full container text (truncated) so the background AC scanner has a fallback signal
  const containerText = ((container.innerText || container.textContent || '') + '').slice(0, 800);
  container.setAttribute(SCANNED_ATTRIBUTE, '1');

  if (!isReasonableProductText(productName) && !containerText.trim()) return;

  const productInfo = await getProductInfo(productName, containerText);
  const score = Number(productInfo?.['CANADIAN Score (out of 10)']);

  if (!productInfo || Number.isNaN(score) || score < 1 || score > 10) {
    return;
  }

  const badge = createBadge(productInfo);
  const anchor = findBadgeAnchor(container);
  attachBadge(anchor, badge);
}

function collectProductContainers() {
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

  return containers.slice(0, 120);
}

async function injectListingBadges() {
  const containers = collectProductContainers();
  // Fire all matches in parallel; SCANNED_ATTRIBUTE is set synchronously inside each call so
  // race conditions (e.g. overlapping MutationObserver bursts) self-deduplicate.
  await Promise.all(containers.map((c) => injectBadgeForContainer(c)));
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

/**
 * Main initialization - detect which retailer and inject badges
 */
function init() {
  const host = window.location.hostname;
  console.log(`🍁 The CANADA List extension active on: ${host}`);
  try {
    injectBadges();
  } catch (error) {
    console.error('Error injecting badges:', error);
  }
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Re-inject badges when new products load (for infinite scroll, pagination, etc.)
let observerTimer = null;
const observer = new MutationObserver(() => {
  if (observerTimer) {
    clearTimeout(observerTimer);
  }

  observerTimer = setTimeout(() => {
    init();
  }, 350);
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
