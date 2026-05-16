// Base matcher with common product detection logic

const BASE_SELECTORS = {
  // Generic product containers
  productContainers: [
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
  ],
  
  // Generic product name selectors
  productNames: [
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
  ],
  
  // Generic brand selectors
  brands: [
    '[itemprop="brand"]',
    '[data-testid*="brand" i]',
    '[class*="brand" i]',
    '[class*="manufacturer" i]'
  ]
};

function collectGenericProductContainers() {
  const containers = [];
  const seen = new Set();

  for (const selector of BASE_SELECTORS.productContainers) {
    const matches = document.querySelectorAll(selector);
    for (const match of matches) {
      if (seen.has(match)) continue;
      seen.add(match);
      containers.push(match);
    }
  }

  return containers.slice(0, 120); // Limit to prevent performance issues
}

function getGenericProductName(container) {
  for (const selector of BASE_SELECTORS.productNames) {
    const candidate = container.querySelector(selector);
    if (!candidate) continue;

    const text = candidate.textContent || candidate.getAttribute('title');
    if (text && text.trim().length > 3) {
      return text.trim();
    }
  }
  
  // Fallback to container text
  const ownText = container.textContent?.slice(0, 220).trim();
  return ownText && ownText.length > 3 ? ownText : null;
}

function getGenericBrandHint(container) {
  for (const selector of BASE_SELECTORS.brands) {
    const element = container.querySelector(selector);
    if (element && element.textContent?.trim()) {
      return element.textContent.trim();
    }
  }
  return null;
}

function getGenericBadgeAnchor(container) {
  const imageContainer = container.querySelector('img')?.parentElement;
  return imageContainer || container;
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BASE_SELECTORS,
    collectGenericProductContainers,
    getGenericProductName,
    getGenericBrandHint,
    getGenericBadgeAnchor
  };
}