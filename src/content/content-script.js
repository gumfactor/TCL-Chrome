// Content Script for The CANADA List Extension
// Injects product badges and tooltips on e-commerce sites

const BADGE_CLASS = 'canada-list-badge';
const SCANNED_ATTRIBUTE = 'data-canada-list-scanned';
const PRODUCT_NAME_CACHE = new Map();
let FLOATING_TOOLTIP = null;

// Debug logging configuration
const DEBUG_CONFIG = {
  enabled: true,
  logPerformance: true,
  logSuccessfulInjections: true,
  logApiCalls: true
};

// Performance tracking
const PERFORMANCE_TRACKER = {
  badgeLoadTimes: [],
  totalBadgesInjected: 0,
  apiCallTimes: [],
  pageLoadStart: performance.now(),
  
  startTimer: function(label) {
    return { label, start: performance.now() };
  },
  
  endTimer: function(timer) {
    const duration = performance.now() - timer.start;
    return { label: timer.label, duration };
  },
  
  logBadgeInjection: function(duration, productName, success) {
    if (!DEBUG_CONFIG.enabled) return;
    
    if (success) {
      this.badgeLoadTimes.push(duration);
      this.totalBadgesInjected++;
      
      if (DEBUG_CONFIG.logSuccessfulInjections) {
        console.log(`[CANADA-LIST] Badge injected successfully in ${duration.toFixed(2)}ms for: ${productName}`);
      }
    }
  },
  
  logApiCall: function(duration, productName, success) {
    if (!DEBUG_CONFIG.enabled || !DEBUG_CONFIG.logApiCalls) return;
    
    this.apiCallTimes.push(duration);
    console.log(`[CANADA-LIST] API call completed in ${duration.toFixed(2)}ms for: ${productName} (success: ${success})`);
  },
  
  getStats: function() {
    if (this.badgeLoadTimes.length === 0) return null;
    
    const sorted = [...this.badgeLoadTimes].sort((a, b) => a - b);
    return {
      totalBadges: this.totalBadgesInjected,
      avgLoadTime: this.badgeLoadTimes.reduce((a, b) => a + b, 0) / this.badgeLoadTimes.length,
      medianLoadTime: sorted[Math.floor(sorted.length / 2)],
      minLoadTime: Math.min(...this.badgeLoadTimes),
      maxLoadTime: Math.max(...this.badgeLoadTimes),
      totalPageTime: performance.now() - this.pageLoadStart,
      apiCalls: this.apiCallTimes.length,
      avgApiTime: this.apiCallTimes.length > 0 ? this.apiCallTimes.reduce((a, b) => a + b, 0) / this.apiCallTimes.length : 0
    };
  },
  
  logPerformanceSummary: function() {
    if (!DEBUG_CONFIG.enabled || !DEBUG_CONFIG.logPerformance) return;
    
    const stats = this.getStats();
    if (!stats) return;
    
    console.log(`[CANADA-LIST] Performance Summary:
  - Total badges injected: ${stats.totalBadges}
  - Average badge load time: ${stats.avgLoadTime.toFixed(2)}ms
  - Median badge load time: ${stats.medianLoadTime.toFixed(2)}ms
  - Min/Max load time: ${stats.minLoadTime.toFixed(2)}ms / ${stats.maxLoadTime.toFixed(2)}ms
  - Total page processing time: ${stats.totalPageTime.toFixed(2)}ms
  - API calls made: ${stats.apiCalls}
  - Average API response time: ${stats.avgApiTime.toFixed(2)}ms`);
  }
};

function getProductInfo(productName, containerText) {
  if (!productName && !containerText) {
    return Promise.resolve(null);
  }

  // Cache key uses name + a short fingerprint of containerText to avoid bloating the map
  const cacheKey = (productName || '') + '|||' + (containerText ? containerText.slice(0, 80) : '');
  if (PRODUCT_NAME_CACHE.has(cacheKey)) {
    return PRODUCT_NAME_CACHE.get(cacheKey);
  }

  const apiTimer = PERFORMANCE_TRACKER.startTimer('api-call');

  const pendingRequest = new Promise((resolve) => {
    if (!chrome.runtime?.id) {
      const timing = PERFORMANCE_TRACKER.endTimer(apiTimer);
      PERFORMANCE_TRACKER.logApiCall(timing.duration, productName || 'unknown', false);
      resolve(null);
      return;
    }

    chrome.runtime.sendMessage(
      { action: 'getProductInfo', productName, containerText },
      (response) => {
        const timing = PERFORMANCE_TRACKER.endTimer(apiTimer);
        const success = response && response['CANADIAN Score (out of 10)'];
        PERFORMANCE_TRACKER.logApiCall(timing.duration, productName || 'unknown', !!success);
        resolve(response || null);
      }
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
  if (!container || container.querySelector(`.${BADGE_CLASS}`)) return false;
  if (container.getAttribute(SCANNED_ATTRIBUTE) === '1') return false;

  const badgeTimer = PERFORMANCE_TRACKER.startTimer('badge-injection');

  const productName = getCandidateProductName(container);
  // Capture full container text (truncated) so the background AC scanner has a fallback signal
  const containerText = ((container.innerText || container.textContent || '') + '').slice(0, 800);
  container.setAttribute(SCANNED_ATTRIBUTE, '1');

  if (!isReasonableProductText(productName) && !containerText.trim()) {
    const timing = PERFORMANCE_TRACKER.endTimer(badgeTimer);
    if (DEBUG_CONFIG.enabled) {
      console.log(`[CANADA-LIST] Skipped container (no valid product text) in ${timing.duration.toFixed(2)}ms`);
    }
    return false;
  }

  try {
    const productInfo = await getProductInfo(productName, containerText);
    const score = Number(productInfo?.['CANADIAN Score (out of 10)']);

    if (!productInfo || Number.isNaN(score) || score < 1 || score > 10) {
      const timing = PERFORMANCE_TRACKER.endTimer(badgeTimer);
      if (DEBUG_CONFIG.enabled && productName) {
        console.log(`[CANADA-LIST] No match found for "${productName}" in ${timing.duration.toFixed(2)}ms`);
      }
      return false;
    }

    const badge = createBadge(productInfo);
    const anchor = findBadgeAnchor(container);
    attachBadge(anchor, badge);

    const timing = PERFORMANCE_TRACKER.endTimer(badgeTimer);
    PERFORMANCE_TRACKER.logBadgeInjection(timing.duration, productName || 'unknown', true);
    
    return true; // Success

  } catch (error) {
    const timing = PERFORMANCE_TRACKER.endTimer(badgeTimer);
    if (DEBUG_CONFIG.enabled) {
      console.log(`[CANADA-LIST] Error injecting badge in ${timing.duration.toFixed(2)}ms:`, error);
    }
    return false;
  }
}

// Enhanced Heuristic Product Container Detection System
// Uses layout analysis, DOM similarity, and content patterns for universal e-commerce detection

// E-commerce site detection - exit early if not a shopping site
function isEcommerceSite() {
  const hostname = window.location.hostname.toLowerCase();
  
  // 1. Known e-commerce domains (fastest check)
  const knownEcommerce = [
    'amazon', 'walmart', 'bestbuy', 'canadiantire', 'shopify', 'etsy', 'ebay',
    'target', 'costco', 'homedepot', 'lowes', 'wayfair', 'overstock', 'newegg',
    'alibaba', 'aliexpress', 'wish', 'temu', 'shein', 'zalando', 'asos'
  ];
  
  if (knownEcommerce.some(domain => hostname.includes(domain))) {
    return true;
  }
  
  // 2. Quick DOM indicators (very fast)
  const ecommerceIndicators = [
    '[itemtype*="Product"]',
    '[class*="add-to-cart" i]', 
    '[class*="addtocart" i]',
    '[class*="buy-now" i]',
    '[class*="price" i]',
    '[class*="product" i]',
    '[class*="cart" i]',
    'meta[property="product:price"]',
    'meta[property="og:type"][content="product"]',
    '[data-testid*="product" i]',
    '[data-cy*="product" i]'
  ];
  
  for (const selector of ecommerceIndicators) {
    try {
      if (document.querySelector(selector)) {
        return true;
      }
    } catch (e) {
      // Skip invalid selectors
    }
  }
  
  // 3. Text-based indicators (price patterns, shopping terms)
  const bodyText = document.body.textContent || '';
  const pricePattern = /[\$£€¥₹¢₩₪₽₨₦₡₵₴₸₺₼₾₿]\s*\d+|\d+\s*(CAD|USD|EUR|GBP|JPY|AUD|CHF|CNY|INR)/i;
  const shoppingTerms = /(add to cart|buy now|shop now|purchase|checkout|shopping cart|wishlist|compare)/i;
  
  if (pricePattern.test(bodyText) || shoppingTerms.test(bodyText)) {
    return true;
  }
  
  return false;
}

// Exit early if not an e-commerce site
if (!isEcommerceSite()) {
  if (DEBUG_CONFIG.enabled) {
    console.log(`[CANADA-LIST] Not an e-commerce site: ${window.location.hostname}`);
  }
  // Stop execution completely
  throw new Error('Not an e-commerce site');
}

const HEURISTIC_CONFIG = {
  // Confidence scoring weights (dynamically adjusted)
  weights: {
    repeatedSiblings: 0.40,    // Elevated - strongest signal
    pricePattern: 0.35,        // High confidence indicator
    imageContent: 0.15,        // Visual product indicator
    clickableElements: 0.10    // Interactive elements
  },
  
  // Minimum confidence threshold for container acceptance
  minConfidence: 0.6,
  
  // Performance limits
  maxContainers: 120,
  maxDepth: 8,
  
  // Exclusion zones
  exclusionSelectors: [
    'nav', 'header', 'footer', '[role="navigation"]',
    '[class*="menu"]', '[class*="nav"]', '[class*="breadcrumb"]',
    '[class*="filter"]', '[class*="sidebar"]', '[class*="recommendation"]',
    '[class*="review"]', '[class*="ad"]', '[class*="banner"]'
  ]
};

// International price pattern detection
const PRICE_PATTERNS = {
  // Currency symbols with various formats
  currencies: /[\$£€¥₹¢₩₪₽₨₦₡₵₴₸₺₼₾₿]/,
  
  // Price formats: $19.99, 19,99€, ¥1,999, 19.99 CAD, etc.
  formats: [
    /[\$£€¥₹¢₩₪₽₨₦₡₵₴₸₺₼₾₿]\s*\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?/g,
    /\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?\s*[\$£€¥₹¢₩₪₽₨₦₡₵₴₸₺₼₾₿]/g,
    /\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?\s*(CAD|USD|EUR|GBP|JPY|AUD|CHF|CNY|INR)/gi,
    /(?:was|orig|msrp|retail)[\s:]*[\$£€¥₹]\s*\d+/gi, // Sale price indicators
  ],
  
  // Exclusion patterns (phone numbers, dates, etc.)
  exclusions: /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/
};

// DOM similarity analysis for repeated sibling detection
function calculateDOMSimilarity(element1, element2) {
  if (!element1 || !element2) return 0;
  
  // Compare tag structure
  const tagSimilarity = element1.tagName === element2.tagName ? 0.3 : 0;
  
  // Compare child count and structure
  const childCount1 = element1.children.length;
  const childCount2 = element2.children.length;
  const childSimilarity = childCount1 === childCount2 ? 0.2 : 
    Math.max(0, 0.2 - Math.abs(childCount1 - childCount2) * 0.05);
  
  // Compare class patterns (not exact matches)
  const classes1 = Array.from(element1.classList);
  const classes2 = Array.from(element2.classList);
  const classOverlap = classes1.filter(c => classes2.some(c2 => 
    c.includes(c2) || c2.includes(c) || c === c2)).length;
  const classSimilarity = Math.min(0.3, classOverlap * 0.1);
  
  // Compare bounding box similarity (aspect ratio, size)
  try {
    const rect1 = element1.getBoundingClientRect();
    const rect2 = element2.getBoundingClientRect();
    
    if (rect1.width > 0 && rect1.height > 0 && rect2.width > 0 && rect2.height > 0) {
      const aspectRatio1 = rect1.width / rect1.height;
      const aspectRatio2 = rect2.width / rect2.height;
      const aspectSimilarity = Math.max(0, 0.2 - Math.abs(aspectRatio1 - aspectRatio2) * 0.1);
      
      return tagSimilarity + childSimilarity + classSimilarity + aspectSimilarity;
    }
  } catch (e) {
    // Fallback if getBoundingClientRect fails
  }
  
  return tagSimilarity + childSimilarity + classSimilarity;
}

// Detect repeated sibling patterns (primary signal)
function analyzeRepeatedSiblings(element) {
  const parent = element.parentElement;
  if (!parent) return 0;
  
  const siblings = Array.from(parent.children).filter(child => 
    child !== element && child.nodeType === Node.ELEMENT_NODE);
  
  if (siblings.length < 2) return 0;
  
  // Calculate similarity with siblings
  let maxSimilarity = 0;
  let similarCount = 0;
  
  for (const sibling of siblings) {
    const similarity = calculateDOMSimilarity(element, sibling);
    if (similarity > 0.6) {
      similarCount++;
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }
  }
  
  // Score based on number of similar siblings and similarity strength
  const repetitionScore = Math.min(1, similarCount / 3); // 3+ similar siblings = max score
  return repetitionScore * maxSimilarity;
}

// Enhanced price detection with internationalization
function detectPricePatterns(element) {
  const text = element.textContent || '';
  
  // Quick currency symbol check
  if (!PRICE_PATTERNS.currencies.test(text)) return 0;
  
  let priceMatches = 0;
  let totalMatches = 0;
  
  // Test each price format
  for (const pattern of PRICE_PATTERNS.formats) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        totalMatches++;
        // Exclude false positives (phone numbers, dates)
        if (!PRICE_PATTERNS.exclusions.test(match.trim())) {
          priceMatches++;
        }
      }
    }
  }
  
  if (totalMatches === 0) return 0;
  
  // Score based on valid price matches vs total matches
  const accuracy = priceMatches / totalMatches;
  const frequency = Math.min(1, priceMatches / 2); // 2+ prices = max score
  
  return accuracy * frequency;
}

// Analyze image content for product indicators
function analyzeImageContent(element) {
  const images = element.querySelectorAll('img');
  if (images.length === 0) return 0;
  
  let productImageScore = 0;
  
  for (const img of images) {
    let imageScore = 0.3; // Base score for having an image
    
    // Check image attributes for product indicators
    const src = img.src || '';
    const alt = img.alt || '';
    const className = img.className || '';
    
    // Product-related keywords in image attributes
    const productKeywords = ['product', 'item', 'goods', 'merchandise'];
    if (productKeywords.some(keyword => 
      src.toLowerCase().includes(keyword) || 
      alt.toLowerCase().includes(keyword) ||
      className.toLowerCase().includes(keyword))) {
      imageScore += 0.2;
    }
    
    // Check image dimensions (product images typically have certain aspect ratios)
    try {
      const rect = img.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 50) {
        const aspectRatio = rect.width / rect.height;
        // Square to slightly rectangular images are common for products
        if (aspectRatio >= 0.7 && aspectRatio <= 1.5) {
          imageScore += 0.2;
        }
      }
    } catch (e) {
      // Ignore dimension check errors
    }
    
    productImageScore = Math.max(productImageScore, imageScore);
  }
  
  return Math.min(1, productImageScore);
}

// Detect clickable elements and interactive patterns
function analyzeClickableElements(element) {
  const links = element.querySelectorAll('a[href]');
  const buttons = element.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]');
  
  let clickableScore = 0;
  
  // Score based on presence of links (product titles are often links)
  if (links.length > 0) {
    clickableScore += 0.4;
    
    // Check for product-related link text
    for (const link of links) {
      const linkText = link.textContent?.toLowerCase() || '';
      if (linkText.length > 10 && linkText.length < 200) { // Reasonable product title length
        clickableScore += 0.2;
        break;
      }
    }
  }
  
  // Score based on presence of action buttons
  if (buttons.length > 0) {
    clickableScore += 0.2;
    
    // Check for e-commerce action buttons
    const actionKeywords = ['add', 'buy', 'cart', 'purchase', 'order', 'shop'];
    for (const button of buttons) {
      const buttonText = button.textContent?.toLowerCase() || '';
      if (actionKeywords.some(keyword => buttonText.includes(keyword))) {
        clickableScore += 0.2;
        break;
      }
    }
  }
  
  return Math.min(1, clickableScore);
}

// Check if element is in an exclusion zone
function isInExclusionZone(element) {
  // Check if element or any parent matches exclusion selectors
  let current = element;
  while (current && current !== document.body) {
    for (const selector of HEURISTIC_CONFIG.exclusionSelectors) {
      try {
        if (current.matches && current.matches(selector)) {
          return true;
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }
    current = current.parentElement;
  }
  
  // Check position-based exclusions (top navigation, footer areas)
  try {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    
    // Exclude elements in top 10% (likely navigation) or bottom 5% (likely footer)
    if (rect.top < viewportHeight * 0.1 || rect.top > viewportHeight * 0.95) {
      return true;
    }
  } catch (e) {
    // Ignore positioning errors
  }
  
  return false;
}

// Calculate overall confidence score for a container
function calculateContainerConfidence(element) {
  if (isInExclusionZone(element)) {
    return 0; // Immediate exclusion
  }
  
  const scores = {
    repeatedSiblings: analyzeRepeatedSiblings(element),
    pricePattern: detectPricePatterns(element),
    imageContent: analyzeImageContent(element),
    clickableElements: analyzeClickableElements(element)
  };
  
  // Calculate weighted confidence score
  let confidence = 0;
  for (const [factor, weight] of Object.entries(HEURISTIC_CONFIG.weights)) {
    confidence += (scores[factor] || 0) * weight;
  }
  
  return Math.min(1, confidence);
}

// Main heuristic product container collection function
function collectProductContainers() {
  const containerTimer = PERFORMANCE_TRACKER.startTimer('heuristic-detection');
  
  // Start with elements that have basic product indicators
  const candidates = new Set();
  
  // Phase 1: Price-first strategy - find elements with price patterns
  const priceElements = document.querySelectorAll('*');
  for (const element of priceElements) {
    if (element.textContent && PRICE_PATTERNS.currencies.test(element.textContent)) {
      // Add the element and its reasonable ancestors as candidates
      let current = element;
      let depth = 0;
      while (current && depth < HEURISTIC_CONFIG.maxDepth) {
        candidates.add(current);
        current = current.parentElement;
        depth++;
      }
    }
  }
  
  // Phase 2: Add elements with product-related attributes (fallback)
  const fallbackSelectors = [
    '[itemtype*="Product"]',
    '[data-testid*="product" i]',
    '[class*="product" i]',
    '[class*="item" i]'
  ];
  
  for (const selector of fallbackSelectors) {
    try {
      const matches = document.querySelectorAll(selector);
      for (const match of matches) {
        candidates.add(match);
      }
    } catch (e) {
      // Skip invalid selectors
    }
  }
  
  // Phase 3: Score and filter candidates
  const scoredContainers = [];
  
  for (const candidate of candidates) {
    if (candidate.nodeType !== Node.ELEMENT_NODE) continue;
    
    const confidence = calculateContainerConfidence(candidate);
    
    if (confidence >= HEURISTIC_CONFIG.minConfidence) {
      scoredContainers.push({
        element: candidate,
        confidence: confidence
      });
    }
  }
  
  // Sort by confidence and return top containers
  scoredContainers.sort((a, b) => b.confidence - a.confidence);
  const finalContainers = scoredContainers
    .slice(0, HEURISTIC_CONFIG.maxContainers)
    .map(item => item.element);
  
  const timing = PERFORMANCE_TRACKER.endTimer(containerTimer);
  
  if (DEBUG_CONFIG.enabled) {
    console.log(`[CANADA-LIST] Heuristic detection found ${finalContainers.length} containers in ${timing.duration.toFixed(2)}ms`);
    console.log(`[CANADA-LIST] Confidence scores: ${scoredContainers.slice(0, 5).map(c => c.confidence.toFixed(2)).join(', ')}`);
  }
  
  return finalContainers;
}

// Dynamic rendering pipeline for modern SPA support
const DYNAMIC_DETECTION = {
  // Adaptive weight adjustment based on successful detections
  siteWeights: new Map(),
  
  // Performance tracking for weight optimization
  detectionHistory: [],
  
  // Mutation observer configuration
  observerConfig: {
    childList: true,
    subtree: true,
    attributes: false, // Reduce noise
    attributeOldValue: false
  },
  
  // Throttling for performance
  lastScan: 0,
  scanCooldown: 200, // ms
  
  // Intersection observer for viewport-based detection
  intersectionObserver: null
};

// Adaptive weight adjustment based on site performance
function adjustWeightsForSite() {
  const hostname = window.location.hostname;
  
  if (!DYNAMIC_DETECTION.siteWeights.has(hostname)) {
    // Initialize with default weights
    DYNAMIC_DETECTION.siteWeights.set(hostname, { ...HEURISTIC_CONFIG.weights });
    return;
  }
  
  const siteHistory = DYNAMIC_DETECTION.detectionHistory.filter(h => h.hostname === hostname);
  if (siteHistory.length < 5) return; // Need minimum data
  
  // Analyze which factors led to successful badge injections
  const successfulDetections = siteHistory.filter(h => h.badgeInjected);
  if (successfulDetections.length === 0) return;
  
  // Calculate average factor scores for successful detections
  const avgScores = {
    repeatedSiblings: 0,
    pricePattern: 0,
    imageContent: 0,
    clickableElements: 0
  };
  
  for (const detection of successfulDetections) {
    for (const [factor, score] of Object.entries(detection.factorScores)) {
      avgScores[factor] += score;
    }
  }
  
  // Normalize and adjust weights based on what works for this site
  const totalSuccessful = successfulDetections.length;
  for (const factor of Object.keys(avgScores)) {
    avgScores[factor] /= totalSuccessful;
  }
  
  // Update site-specific weights (gradual adjustment)
  const siteWeights = DYNAMIC_DETECTION.siteWeights.get(hostname);
  const adjustmentRate = 0.1; // 10% adjustment per update
  
  for (const [factor, avgScore] of Object.entries(avgScores)) {
    if (avgScore > 0.7) {
      // This factor is highly predictive for this site
      siteWeights[factor] = Math.min(0.6, siteWeights[factor] + adjustmentRate);
    } else if (avgScore < 0.3) {
      // This factor is not useful for this site
      siteWeights[factor] = Math.max(0.05, siteWeights[factor] - adjustmentRate);
    }
  }
  
  // Normalize weights to sum to 1.0
  const totalWeight = Object.values(siteWeights).reduce((sum, w) => sum + w, 0);
  for (const factor of Object.keys(siteWeights)) {
    siteWeights[factor] /= totalWeight;
  }
  
  if (DEBUG_CONFIG.enabled) {
    console.log(`[CANADA-LIST] Adjusted weights for ${hostname}:`, siteWeights);
  }
}

// Get current weights (site-specific or default)
function getCurrentWeights() {
  const hostname = window.location.hostname;
  return DYNAMIC_DETECTION.siteWeights.get(hostname) || HEURISTIC_CONFIG.weights;
}

// Record detection attempt for learning
function recordDetectionAttempt(element, factorScores, badgeInjected = false) {
  const hostname = window.location.hostname;
  
  DYNAMIC_DETECTION.detectionHistory.push({
    hostname,
    timestamp: Date.now(),
    factorScores,
    badgeInjected,
    elementInfo: {
      tagName: element.tagName,
      className: element.className,
      hasPrice: factorScores.pricePattern > 0,
      hasImage: factorScores.imageContent > 0
    }
  });
  
  // Keep history manageable (last 100 entries per site)
  const maxHistory = 100;
  if (DYNAMIC_DETECTION.detectionHistory.length > maxHistory * 3) {
    DYNAMIC_DETECTION.detectionHistory = DYNAMIC_DETECTION.detectionHistory.slice(-maxHistory);
  }
  
  // Trigger weight adjustment periodically
  if (DYNAMIC_DETECTION.detectionHistory.length % 10 === 0) {
    adjustWeightsForSite();
  }
}

// Enhanced container confidence calculation with adaptive weights
function calculateContainerConfidenceAdaptive(element) {
  if (isInExclusionZone(element)) {
    return { confidence: 0, factorScores: {} };
  }
  
  const factorScores = {
    repeatedSiblings: analyzeRepeatedSiblings(element),
    pricePattern: detectPricePatterns(element),
    imageContent: analyzeImageContent(element),
    clickableElements: analyzeClickableElements(element)
  };
  
  // Use site-specific weights
  const weights = getCurrentWeights();
  
  // Calculate weighted confidence score
  let confidence = 0;
  for (const [factor, weight] of Object.entries(weights)) {
    confidence += (factorScores[factor] || 0) * weight;
  }
  
  return {
    confidence: Math.min(1, confidence),
    factorScores
  };
}

// Intersection Observer for viewport-based progressive scanning
function initializeIntersectionObserver() {
  if (DYNAMIC_DETECTION.intersectionObserver) return;
  
  DYNAMIC_DETECTION.intersectionObserver = new IntersectionObserver((entries) => {
    const visibleElements = entries
      .filter(entry => entry.isIntersecting)
      .map(entry => entry.target);
    
    if (visibleElements.length > 0 && DEBUG_CONFIG.enabled) {
      console.log(`[CANADA-LIST] ${visibleElements.length} new elements entered viewport`);
    }
    
    // Process visible elements for badge injection
    processVisibleElements(visibleElements);
  }, {
    rootMargin: '50px', // Start processing slightly before elements are visible
    threshold: 0.1
  });
}

// Process elements that have become visible
async function processVisibleElements(elements) {
  const processTimer = PERFORMANCE_TRACKER.startTimer('viewport-processing');
  
  for (const element of elements) {
    // Skip if already processed
    if (element.getAttribute(SCANNED_ATTRIBUTE) === '1') continue;
    
    const result = calculateContainerConfidenceAdaptive(element);
    
    if (result.confidence >= HEURISTIC_CONFIG.minConfidence) {
      await injectBadgeForContainer(element);
      recordDetectionAttempt(element, result.factorScores, true);
    } else {
      recordDetectionAttempt(element, result.factorScores, false);
    }
  }
  
  const timing = PERFORMANCE_TRACKER.endTimer(processTimer);
  if (DEBUG_CONFIG.enabled && elements.length > 0) {
    console.log(`[CANADA-LIST] Processed ${elements.length} viewport elements in ${timing.duration.toFixed(2)}ms`);
  }
}

async function injectListingBadges() {
  const listingTimer = PERFORMANCE_TRACKER.startTimer('listing-badges');
  
  // Initialize intersection observer for progressive scanning
  initializeIntersectionObserver();
  
  const containers = collectProductContainers();
  if (DEBUG_CONFIG.enabled) {
    console.log(`[CANADA-LIST] Heuristic detection found ${containers.length} product containers`);
  }
  
  // Process containers with adaptive confidence scoring
  const processedContainers = [];
  
  for (const container of containers) {
    const result = calculateContainerConfidenceAdaptive(container);
    
    if (result.confidence >= HEURISTIC_CONFIG.minConfidence) {
      processedContainers.push({
        container,
        confidence: result.confidence,
        factorScores: result.factorScores
      });
    }
  }
  
  // Sort by confidence and process in parallel
  processedContainers.sort((a, b) => b.confidence - a.confidence);
  
  // Fire all matches in parallel; SCANNED_ATTRIBUTE is set synchronously inside each call so
  // race conditions (e.g. overlapping MutationObserver bursts) self-deduplicate.
  const injectionPromises = processedContainers.map(async (item) => {
    const success = await injectBadgeForContainer(item.container);
    recordDetectionAttempt(item.container, item.factorScores, success);
    return success;
  });
  
  await Promise.all(injectionPromises);
  
  const timing = PERFORMANCE_TRACKER.endTimer(listingTimer);
  if (DEBUG_CONFIG.enabled && DEBUG_CONFIG.logPerformance) {
    console.log(`[CANADA-LIST] Processed ${processedContainers.length}/${containers.length} containers in ${timing.duration.toFixed(2)}ms`);
    
    // Log confidence distribution
    const confidences = processedContainers.map(c => c.confidence.toFixed(2));
    console.log(`[CANADA-LIST] Confidence range: ${Math.min(...confidences)} - ${Math.max(...confidences)}`);
  }
}

async function injectProductDetailBadge() {
  if (document.body.getAttribute('data-canada-list-page-scanned') === '1') return;

  const detailTimer = PERFORMANCE_TRACKER.startTimer('detail-badge');

  const detailName = normalizeCandidateText(
    document.querySelector('[property="og:title"]')?.getAttribute('content') ||
    document.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ||
    document.querySelector('[itemprop="name"]')?.textContent ||
    document.querySelector('h1')?.textContent ||
    document.title
  );

  if (!isReasonableProductText(detailName)) {
    const timing = PERFORMANCE_TRACKER.endTimer(detailTimer);
    if (DEBUG_CONFIG.enabled) {
      console.log(`[CANADA-LIST] Skipped product detail page (no valid product name) in ${timing.duration.toFixed(2)}ms`);
    }
    return;
  }

  try {
    const productInfo = await getProductInfo(detailName);
    const score = Number(productInfo?.['CANADIAN Score (out of 10)']);
    if (!productInfo || Number.isNaN(score) || score < 1 || score > 10) {
      const timing = PERFORMANCE_TRACKER.endTimer(detailTimer);
      if (DEBUG_CONFIG.enabled) {
        console.log(`[CANADA-LIST] No match found for product detail "${detailName}" in ${timing.duration.toFixed(2)}ms`);
      }
      return;
    }

    if (document.querySelector(`body > .${BADGE_CLASS}.canada-page-badge`)) return;

    const badge = createBadge(productInfo);
    badge.classList.add('canada-page-badge');
    badge.style.position = 'fixed';
    badge.style.top = '16px';
    badge.style.right = '16px';
    badge.style.zIndex = '2147483647';
    document.body.appendChild(badge);
    document.body.setAttribute('data-canada-list-page-scanned', '1');

    const timing = PERFORMANCE_TRACKER.endTimer(detailTimer);
    PERFORMANCE_TRACKER.logBadgeInjection(timing.duration, detailName, true);

  } catch (error) {
    const timing = PERFORMANCE_TRACKER.endTimer(detailTimer);
    if (DEBUG_CONFIG.enabled) {
      console.log(`[CANADA-LIST] Error injecting product detail badge in ${timing.duration.toFixed(2)}ms:`, error);
    }
  }
}

async function injectBadges() {
  const totalTimer = PERFORMANCE_TRACKER.startTimer('total-injection');
  
  await injectListingBadges();
  
  const timing = PERFORMANCE_TRACKER.endTimer(totalTimer);
  if (DEBUG_CONFIG.enabled && DEBUG_CONFIG.logPerformance) {
    console.log(`[CANADA-LIST] Total badge injection process completed in ${timing.duration.toFixed(2)}ms`);
  }
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
  console.log(`[CANADA-LIST] Extension active on: ${host}`);
  
  const initTimer = PERFORMANCE_TRACKER.startTimer('initialization');
  
  try {
    injectBadges().then(() => {
      const timing = PERFORMANCE_TRACKER.endTimer(initTimer);
      if (DEBUG_CONFIG.enabled) {
        console.log(`[CANADA-LIST] Initialization completed in ${timing.duration.toFixed(2)}ms`);
        // Log performance summary after a short delay to capture all async operations
        setTimeout(() => PERFORMANCE_TRACKER.logPerformanceSummary(), 100);
      }
    });
  } catch (error) {
    const timing = PERFORMANCE_TRACKER.endTimer(initTimer);
    console.error(`[CANADA-LIST] Error during initialization (${timing.duration.toFixed(2)}ms):`, error);
  }
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Enhanced mutation observer with performance optimizations
function setupEnhancedMutationObserver() {
  let mutationTimer = null;
  let pendingMutations = [];
  
  const observer = new MutationObserver((mutations) => {
    // Collect mutations for batch processing
    pendingMutations.push(...mutations);
    
    // Throttle processing
    if (mutationTimer) {
      clearTimeout(mutationTimer);
    }
    
    mutationTimer = setTimeout(() => {
      processMutationBatch(pendingMutations);
      pendingMutations = [];
    }, DYNAMIC_DETECTION.scanCooldown);
  });
  
  observer.observe(document.body, DYNAMIC_DETECTION.observerConfig);
  return observer;
}

// Process batched mutations efficiently
function processMutationBatch(mutations) {
  const now = performance.now();
  
  // Throttle based on last scan time
  if (now - DYNAMIC_DETECTION.lastScan < DYNAMIC_DETECTION.scanCooldown) {
    return;
  }
  
  DYNAMIC_DETECTION.lastScan = now;
  
  const addedElements = new Set();
  
  // Collect all added elements from mutations
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          addedElements.add(node);
          
          // Also add child elements that might be product containers
          const children = node.querySelectorAll('*');
          for (const child of children) {
            addedElements.add(child);
          }
        }
      }
    }
  }
  
  if (addedElements.size === 0) return;
  
  if (DEBUG_CONFIG.enabled) {
    console.log(`[CANADA-LIST] Processing ${addedElements.size} elements from DOM mutations`);
  }
  
  // Set up intersection observer for new elements
  if (DYNAMIC_DETECTION.intersectionObserver) {
    for (const element of addedElements) {
      DYNAMIC_DETECTION.intersectionObserver.observe(element);
    }
  }
}

// Initialize enhanced mutation observer system
const enhancedObserver = setupEnhancedMutationObserver();

// Expose performance tracker and heuristic system for debugging
if (DEBUG_CONFIG.enabled) {
  window.CANADA_LIST_DEBUG = {
    getStats: () => PERFORMANCE_TRACKER.getStats(),
    logSummary: () => PERFORMANCE_TRACKER.logPerformanceSummary(),
    config: DEBUG_CONFIG,
    heuristics: {
      weights: getCurrentWeights(),
      detectionHistory: DYNAMIC_DETECTION.detectionHistory.slice(-10), // Last 10 attempts
      adjustWeights: adjustWeightsForSite,
      testContainer: (element) => calculateContainerConfidenceAdaptive(element)
    }
  };
}
