// Amazon.ca specific selectors and extraction logic

const AMAZON_SELECTORS = {
  // Product containers
  productContainers: [
    '[data-component-type="s-search-result"]',
    '[data-testid="ProductTile"]',
    '[class*="s-result-item"]',
    '[class*="product-item"]'
  ],
  
  // Product name selectors (in order of preference)
  productNames: [
    '[data-cy="title-recipe-title"]',
    'h2 a span',
    'h2 span',
    '[data-testid="title"]',
    '.s-title-instructions-style span',
    'h1#productTitle',
    '[itemprop="name"]'
  ],
  
  // Brand selectors
  brands: [
    '#bylineInfo',
    '.a-row .a-size-base',
    '[data-testid="brand-name"]'
  ],
  
  // Image containers for badge placement
  imageContainers: [
    '.s-image',
    '.a-image-container',
    '[data-testid="image-container"]'
  ]
};

function isAmazonSite() {
  return window.location.hostname.includes('amazon.ca') || 
         window.location.hostname.includes('amazon.com');
}

function getAmazonProductName(container) {
  for (const selector of AMAZON_SELECTORS.productNames) {
    const element = container.querySelector(selector);
    if (element && element.textContent?.trim()) {
      return element.textContent.trim();
    }
  }
  return null;
}

function getAmazonBrandHint(container) {
  for (const selector of AMAZON_SELECTORS.brands) {
    const element = container.querySelector(selector);
    if (element && element.textContent?.trim()) {
      return element.textContent.trim();
    }
  }
  return null;
}

function getAmazonBadgeAnchor(container) {
  for (const selector of AMAZON_SELECTORS.imageContainers) {
    const element = container.querySelector(selector);
    if (element) {
      return element;
    }
  }
  return container;
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AMAZON_SELECTORS,
    isAmazonSite,
    getAmazonProductName,
    getAmazonBrandHint,
    getAmazonBadgeAnchor
  };
}