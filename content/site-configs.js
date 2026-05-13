/**
 * Site adapter configurations.
 *
 * Each entry describes one supported retailer as pure data — no logic.
 * The universal engine in content.js reads these configs to drive all
 * DOM traversal, title extraction, and badge insertion.
 *
 * ADDING A NEW SITE
 * ─────────────────
 * 1. Copy the walmart block below, fill in the correct selectors/options.
 * 2. Add a new content_scripts entry in manifest.json (matches + host_permissions).
 * That's it — content.js needs no changes.
 */

const TCL_SITE_CONFIGS = [

  // ─── Walmart.ca ───────────────────────────────────────────────────────────
  {
    name: 'walmart',

    /**
     * Return true when this config should be active.
     * Called with window.location.hostname.
     */
    match(hostname) {
      return hostname.includes('walmart.ca');
    },

    selectors: {
      /**
       * Root element used to scope the product-link query.
       * Keeps the engine out of site-nav and footer links.
       */
      root: 'main',

      /**
       * CSS selector for an anchor element that identifies a product card.
       * The engine walks up from each matched anchor to locate its card container.
       */
      productLink: 'a[href*="/ip/"]',

      /**
       * Ordered list of selectors tried when climbing the DOM from the product
       * link to find the stable card container. First ancestor match wins.
       */
      cardCandidates: [
        '[data-item-id]',
        '[data-testid="product-card"]',
        '[data-testid="search-result-card"]',
        'article',
        'li',
      ],

      /**
       * Selectors tried inside the card to pull the product title text.
       * Only used when options.titleSources includes 'card'.
       * Tried in order; first non-empty match wins.
       */
      titleOnCard: [
        '[data-testid*="title"]',
        '[data-testid*="name"]',
        '[data-testid*="product-title"]',
        'h2',
        'h3',
        'h4',
      ],

      /**
       * Optional brand element inside the card.
       * When options.prependBrand is true and this element is found,
       * its text is prepended to the title if not already present.
       */
      brand: '[data-testid*="brand"], [itemprop="brand"]',

      /**
       * Selectors for the badge insertion anchor (typically the price line).
       * Tried in order inside the card; first match wins.
       * Falls back to a span inside the product link, then the link itself.
       */
      insertTarget: [
        '[data-testid*="price"]',
        '[aria-label*="price" i]',
      ],

      /**
       * Selectors for the title element on a Product Detail Page (PDP).
       * Tried in document order; first non-empty element wins.
       */
      detailTitle: [
        '[data-testid="product-title"]',
        'h1[itemprop="name"]',
        'h1[data-automation="product-title"]',
        'h1',
      ],
    },

    options: {
      /**
       * Skip duplicate product links that share the same URL pathname.
       * Prevents the same /ip/ product from being processed multiple times
       * when Walmart renders several links to the same item on one page.
       */
      dedupeByPathname: true,

      /**
       * Ordered list of strategies used to extract the product title from a link.
       *   'aria'  → link's aria-label attribute
       *   'text'  → link's visible textContent
       *   'inner' → first <span dir> or <span> inside the link
       *   'card'  → selectors.titleOnCard searched inside the card container
       * The engine collects all non-empty candidates and picks the longest one.
       */
      titleSources: ['aria', 'text', 'inner', 'card'],

      /**
       * When true, the brand text (from selectors.brand) is prepended to the
       * title if the title doesn't already contain it.
       */
      prependBrand: true,

      /**
       * URL pathname fragments that identify a Product Detail Page.
       * When any fragment matches location.pathname, the engine also looks for
       * the PDP title and injects a full-size badge.
       */
      detailPagePatterns: ['/ip/', '/product/'],

      /** DOM insertion position relative to the insertTarget element. */
      insertPosition: 'afterend',

      /** Inline styles applied to the badge host element. */
      badgeStyle: {
        listing: { display: 'block', margin: '6px 0 4px 0', position: 'relative', zIndex: '2147483646' },
        detail:  { display: 'block', margin: '10px 0',      position: 'relative', zIndex: '2147483646' },
      },

      /**
       * Walmart's internal item number lives on the card container as data-item-id.
       * Not a UPC, but Harris can cross-reference it in Supabase if he builds
       * a Walmart item ID → product mapping.
       */
      itemIdAttribute: 'data-item-id',

      /**
       * Regex (one capture group) run against the product link href to extract
       * the item number. Used on PDPs where data-item-id isn't on the title element.
       * Walmart PDPs: walmart.ca/en/ip/product-name/12345678
       */
      itemIdFromUrl: '\\/ip\\/[^/]+\\/(\\d+)',

      /**
       * Site-specific title noise stripped after the global patterns.
       * Walmart often shows bilingual titles: "Product Name / Nom du produit"
       * Pattern: strip " / " followed by a French/capitalized phrase at end of string.
       */
      titleStripPatterns: [
        '\\s*\\/\\s*[A-ZÀ-Ö][a-zà-öø-ÿ][^/]{2,}$',
      ],
    },
  },

  // ─── Loblaws.ca ───────────────────────────────────────────────────────────
  {
    name: 'loblaws',

    match(hostname) {
      return hostname.includes('loblaws.ca');
    },

    selectors: {
      root: 'main',

      // chakra-linkbox__overlay is the full-card overlay anchor — stable Chakra class
      productLink: 'a.chakra-linkbox__overlay',

      cardCandidates: [
        '.chakra-linkbox',
      ],

      // <h3 data-testid="product-title"> is the most reliable title source
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

      // The overlay anchor has no clean aria-label; card selectors give the cleanest title
      titleSources: ['card', 'aria'],

      prependBrand: true,

      // Product URLs follow /en/<slug>/p/<sku>
      detailPagePatterns: ['/p/'],

      insertPosition: 'afterend',

      badgeStyle: {
        listing: { display: 'block', margin: '6px 0 4px 0', position: 'relative', zIndex: '2147483646' },
        detail:  { display: 'block', margin: '10px 0',      position: 'relative', zIndex: '2147483646' },
      },

      /**
       * Loblaws SKU lives in the product URL: /en/<slug>/p/21657456_EA
       * Capture group 1 returns the full SKU including the _EA suffix.
       */
      itemIdFromUrl: '\\/p\\/([A-Za-z0-9_]+)(?:\\?|$)',

      /**
       * Loblaws shows bilingual titles and appends package size.
       * Strip bilingual slash suffix and any trailing size not caught by global patterns.
       */
      titleStripPatterns: [
        '\\s*\\/\\s*[A-ZÀ-Ö][a-zà-öø-ÿ][^/]{2,}$',  // bilingual "/ Crème glacée"
        '\\b\\d+\\s*(x|X)\\s*\\d+\\s*(ml|mL|g|L)\\b', // multipack "4 x 500ml"
      ],
    },
  },

  // ─── No Frills ─────────────────────────────────────────────────────────────
  {
    name: 'nofrills',

    match(hostname) {
      return hostname.includes('nofrills.ca');
    },

    selectors: {
      root: 'main',

      // No Frills uses the same PC Express/Chakra product-card structure as Loblaws.
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

  // ─── Metro.ca ──────────────────────────────────────────────────────────────
  {
    name: 'metro',

    match(hostname) {
      return hostname.includes('metro.ca');
    },

    selectors: {
      root: 'main',

      // Metro product URLs consistently end with /p/<product-code>.
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

      // Prefer Metro's clean data attribute over visible text.
      titleAttribute: 'data-product-name-en',
      brandAttribute: 'data-product-brand',
      titleSources: ['card', 'aria', 'text'],

      prependBrand: true,

      // Metro PDP/listing URLs use /p/<UPC-or-product-code>.
      detailPagePatterns: ['/p/'],

      insertPosition: 'afterend',

      badgeStyle: {
        listing: { display: 'block', margin: '6px 0 4px 0', position: 'relative', zIndex: '2147483646' },
        detail:  { display: 'block', margin: '10px 0',      position: 'relative', zIndex: '2147483646' },
      },

      // Metro exposes UPC/product code directly on the card.
      itemIdAttribute: 'data-product-code',
      itemIdFromUrl: '\\/p\\/([A-Za-z0-9_]+)(?:\\?|$)',

      titleStripPatterns: [
        '\\s*,\\s*Saucy Spots\\b.*$',
        '\\b\\d+\\s*(x|X)\\s*\\d+(\\.\\d+)?\\s*(ml|mL|g|L)\\b',
      ],
    },
  },

  // ─── Food Basics ───────────────────────────────────────────────────────────
  {
    name: 'foodbasics',

    match(hostname) {
      return hostname.includes('foodbasics.ca');
    },

    selectors: {
      root: 'main',

      // Food Basics is a Metro banner and commonly uses the same product tile markup.
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

  // ─── Sobeys / Voila ────────────────────────────────────────────────────────
  {
    name: 'sobeys',

    match(hostname) {
      return hostname.includes('sobeys.com') || hostname.includes('voila.ca');
    },

    selectors: {
      root: 'main',

      // Product card overlay link. Sobeys/Voila product pages use /products/<slug>.
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

      // The product title is cleanest from the visible card title or image alt.
      titleSources: ['card', 'aria'],

      prependBrand: false,

      detailPagePatterns: ['/products/'],

      insertPosition: 'afterend',

      badgeStyle: {
        listing: { display: 'block', margin: '6px 0 4px 0', position: 'relative', zIndex: '2147483646' },
        detail:  { display: 'block', margin: '10px 0',      position: 'relative', zIndex: '2147483646' },
      },

      // Example: data-object-id="887288_EA_4743"; data-id="887288".
      itemIdAttribute: 'data-object-id',

      titleStripPatterns: [
        '\\b\\d+\\s*(x|X)\\s*\\d+(\\.\\d+)?\\s*(ml|mL|g|L)\\b',
        '\\b\\d+(\\.\\d+)?\\s*(ml|mL|g|kg|L)\\b',
      ],
    },
  },

  // ─── Add more sites below ─────────────────────────────────────────────────

];

if (typeof globalThis !== 'undefined') {
  globalThis.TCL_SITE_CONFIGS = TCL_SITE_CONFIGS;
}
