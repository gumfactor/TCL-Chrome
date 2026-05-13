// Store finder markup here — content.js picks the first match() that fits hostname.
// New grocer: duplicate one block, fix selectors, add URLs to manifest.json.

const TCL_SITE_CONFIGS = [

  // Walmart
  {
    name: 'walmart',

    match(hostname) {
      return hostname.includes('walmart.ca');
    },

    selectors: {
      root: 'main',
      productLink: 'a[href*="/ip/"]',
      cardCandidates: [
        '[data-item-id]',
        '[data-testid="product-card"]',
        '[data-testid="search-result-card"]',
        'article',
        'li',
      ],
      titleOnCard: [
        '[data-testid*="title"]',
        '[data-testid*="name"]',
        '[data-testid*="product-title"]',
        'h2',
        'h3',
        'h4',
      ],
      brand: '[data-testid*="brand"], [itemprop="brand"]',
      insertTarget: [
        '[data-testid*="price"]',
        '[aria-label*="price" i]',
      ],
      detailTitle: [
        '[data-testid="product-title"]',
        'h1[itemprop="name"]',
        'h1[data-automation="product-title"]',
        'h1',
      ],
    },

    options: {
      dedupeByPathname: true,
      titleSources: ['aria', 'text', 'inner', 'card'],
      prependBrand: true,
      detailPagePatterns: ['/ip/', '/product/'],
      insertPosition: 'afterend',
      badgeStyle: {
        listing: { display: 'block', margin: '6px 0 4px 0', position: 'relative', zIndex: '2147483646' },
        detail:  { display: 'block', margin: '10px 0',      position: 'relative', zIndex: '2147483646' },
      },
      itemIdAttribute: 'data-item-id',
      itemIdFromUrl: '\\/ip\\/[^/]+\\/(\\d+)',
      titleStripPatterns: [
        '\\s*\\/\\s*[A-ZÀ-Ö][a-zà-öø-ÿ][^/]{2,}$',
      ],
    },
  },

  // Loblaws (same stack as PC Express / Chakra)
  {
    name: 'loblaws',

    match(hostname) {
      return hostname.includes('loblaws.ca');
    },

    selectors: {
      root: 'main',

      // big clickable overlay — hashed classes change but this sticks
      productLink: 'a.chakra-linkbox__overlay',

      cardCandidates: [
        '.chakra-linkbox',
      ],

      // title lives here on tiles
      titleOnCard: [
        '[data-testid="product-title"]',
        'h3',
        'h2',
      ],

      brand: '[data-testid="product-brand"]',

      insertTarget: [
        '[data-testid="price-product-tile"]',
        '[data-testid="regular-price"]',
      ],

      detailTitle: [
        '[data-testid="product-title"]',
        'h1',
      ],
    },

    options: {
      dedupeByPathname: true,

      // overlay link text is noisy — pull title from the card instead
      titleSources: ['card', 'aria'],

      prependBrand: true,

      // .../p/20323757004_EA style URLs
      detailPagePatterns: ['/p/'],

      insertPosition: 'afterend',

      badgeStyle: {
        listing: { display: 'block', margin: '6px 0 4px 0', position: 'relative', zIndex: '2147483646' },
        detail:  { display: 'block', margin: '10px 0',      position: 'relative', zIndex: '2147483646' },
      },

      itemIdFromUrl: '\\/p\\/([A-Za-z0-9_]+)(?:\\?|$)',

      titleStripPatterns: [
        '\\s*\\/\\s*[A-ZÀ-Ö][a-zà-öø-ÿ][^/]{2,}$',
        '\\b\\d+\\s*(x|X)\\s*\\d+\\s*(ml|mL|g|L)\\b',
      ],
    },
  },

  // No Frills (same card markup as Loblaws)
  {
    name: 'nofrills',

    match(hostname) {
      return hostname.includes('nofrills.ca');
    },

    selectors: {
      root: 'main',

      productLink: 'a.chakra-linkbox__overlay',

      cardCandidates: [
        '.chakra-linkbox',
      ],

      titleOnCard: [
        '[data-testid="product-title"]',
        'h3',
        'h2',
      ],

      brand: '[data-testid="product-brand"]',

      insertTarget: [
        '[data-testid="price-product-tile"]',
        '[data-testid="regular-price"]',
      ],

      detailTitle: [
        '[data-testid="product-title"]',
        'h1',
      ],
    },

    options: {
      dedupeByPathname: true,
      titleSources: ['card', 'aria'],
      prependBrand: true,
      detailPagePatterns: ['/p/'],
      insertPosition: 'afterend',

      badgeStyle: {
        listing: { display: 'block', margin: '6px 0 4px 0', position: 'relative', zIndex: '2147483646' },
        detail:  { display: 'block', margin: '10px 0',      position: 'relative', zIndex: '2147483646' },
      },

      itemIdFromUrl: '\\/p\\/([A-Za-z0-9_]+)(?:\\?|$)',

      titleStripPatterns: [
        '\\s*\\/\\s*[A-ZÀ-Ö][a-zà-öø-ÿ][^/]{2,}$',
        '\\b\\d+\\s*(x|X)\\s*\\d+\\s*(ml|mL|g|L)\\b',
      ],
    },
  },

  // Metro
  {
    name: 'metro',

    match(hostname) {
      return hostname.includes('metro.ca');
    },

    selectors: {
      root: 'main',

      productLink: 'a.product-details-link[href*="/p/"]',

      cardCandidates: [
        '.default-product-tile[data-product-code]',
        '[data-product-code]',
        '.default-product-tile',
      ],

      titleOnCard: [
        '.head__title',
        '[id^="itemTitle-"]',
      ],

      brand: '.head__brand',

      insertTarget: [
        '.content__pricing',
        '[data-main-price]',
        '.pricing__sale-price',
      ],

      detailTitle: [
        '.pi--title',
        '.head__title',
        'h1',
      ],
    },

    options: {
      dedupeByPathname: true,

      titleAttribute: 'data-product-name-en',
      brandAttribute: 'data-product-brand',
      titleSources: ['card', 'aria', 'text'],

      prependBrand: true,

      detailPagePatterns: ['/p/'],

      insertPosition: 'afterend',

      badgeStyle: {
        listing: { display: 'block', margin: '6px 0 4px 0', position: 'relative', zIndex: '2147483646' },
        detail:  { display: 'block', margin: '10px 0',      position: 'relative', zIndex: '2147483646' },
      },

      itemIdAttribute: 'data-product-code',
      itemIdFromUrl: '\\/p\\/([A-Za-z0-9_]+)(?:\\?|$)',

      titleStripPatterns: [
        '\\s*,\\s*Saucy Spots\\b.*$',
        '\\b\\d+\\s*(x|X)\\s*\\d+(\\.\\d+)?\\s*(ml|mL|g|L)\\b',
      ],
    },
  },

  // Food Basics (Metro-style tiles)
  {
    name: 'foodbasics',

    match(hostname) {
      return hostname.includes('foodbasics.ca');
    },

    selectors: {
      root: 'main',

      productLink: 'a.product-details-link[href*="/p/"]',

      cardCandidates: [
        '.default-product-tile[data-product-code]',
        '[data-product-code]',
        '.default-product-tile',
      ],

      titleOnCard: [
        '.head__title',
        '[id^="itemTitle-"]',
      ],

      brand: '.head__brand',

      insertTarget: [
        '.content__pricing',
        '[data-main-price]',
        '.pricing__sale-price',
      ],

      detailTitle: [
        '.pi--title',
        '.head__title',
        'h1',
      ],
    },

    options: {
      dedupeByPathname: true,
      titleAttribute: 'data-product-name-en',
      brandAttribute: 'data-product-brand',
      titleSources: ['card', 'aria', 'text'],
      prependBrand: true,
      detailPagePatterns: ['/p/'],
      insertPosition: 'afterend',

      badgeStyle: {
        listing: { display: 'block', margin: '6px 0 4px 0', position: 'relative', zIndex: '2147483646' },
        detail:  { display: 'block', margin: '10px 0',      position: 'relative', zIndex: '2147483646' },
      },

      itemIdAttribute: 'data-product-code',
      itemIdFromUrl: '\\/p\\/([A-Za-z0-9_]+)(?:\\?|$)',

      titleStripPatterns: [
        '\\s*,\\s*Saucy Spots\\b.*$',
        '\\b\\d+\\s*(x|X)\\s*\\d+(\\.\\d+)?\\s*(ml|mL|g|L)\\b',
      ],
    },
  },

  // Sobeys / Voila
  {
    name: 'sobeys',

    match(hostname) {
      return hostname.includes('sobeys.com') || hostname.includes('voila.ca');
    },

    selectors: {
      root: 'main',

      productLink: 'a[href^="/products/"], a[href*="/products/"]',

      cardCandidates: [
        '[data-object-id]',
        '[data-id]',
      ],

      titleOnCard: [
        '.card-title span',
        '.card-title',
        'img[alt]',
      ],

      brand: '',

      insertTarget: [
        '.card-title',
        'p.card-title',
      ],

      detailTitle: [
        'h1',
        '.card-title',
      ],
    },

    options: {
      dedupeByPathname: true,

      titleSources: ['card', 'aria'],

      prependBrand: false,

      detailPagePatterns: ['/products/'],

      insertPosition: 'afterend',

      badgeStyle: {
        listing: { display: 'block', margin: '6px 0 4px 0', position: 'relative', zIndex: '2147483646' },
        detail:  { display: 'block', margin: '10px 0',      position: 'relative', zIndex: '2147483646' },
      },

      itemIdAttribute: 'data-object-id',

      titleStripPatterns: [
        '\\b\\d+\\s*(x|X)\\s*\\d+(\\.\\d+)?\\s*(ml|mL|g|L)\\b',
        '\\b\\d+(\\.\\d+)?\\s*(ml|mL|g|kg|L)\\b',
      ],
    },
  },

];


if (typeof globalThis !== 'undefined') {
  globalThis.TCL_SITE_CONFIGS = TCL_SITE_CONFIGS;
}
