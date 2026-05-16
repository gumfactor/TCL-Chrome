// Background Service Worker for The CANADA List Extension

const API_URL = 'https://thecanadalist.ca/TheCanadaList.json';
const CACHE_KEY = 'canadaListData';
const CACHE_EXPIRY_KEY = 'canadaListDataExpiry';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const GENERIC_PRODUCT_TOKENS = new Set([
  'pack', 'packs', 'pcs', 'pc', 'count', 'ct', 'ml', 'l', 'g', 'kg', 'oz', 'lb',
  'size', 'small', 'medium', 'large', 'xlarge', 'xl', 'mini', 'regular', 'original',
  'new', 'style', 'flavour', 'flavor', 'assorted', 'variety', 'edition', 'the', 'and'
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !GENERIC_PRODUCT_TOKENS.has(token));
}

function buildWordPhrase(tokens, length) {
  if (tokens.length < length) return '';
  return tokens.slice(0, length).join(' ').trim();
}

// True if the column name represents a brand/company/owner/manufacturer field.
// Explicitly excludes country / countries fields (which match /owner/ in 'Ownership (Country)').
function isBrandFieldKey(key) {
  if (!key) return false;
  if (/countr/i.test(key)) return false; // 'Country', 'Countries'
  return /(brand|company|owner|manufacturer)/i.test(key);
}

function getCanonicalBrand(product) {
  for (const [key, value] of Object.entries(product || {})) {
    if (!isBrandFieldKey(key)) continue;
    const normalized = normalizeText(value);
    if (normalized.length >= 3) return normalized;
  }
  return null;
}

function buildBrandAliasesForProduct(product) {
  const aliases = new Set();

  for (const [key, value] of Object.entries(product || {})) {
    if (!isBrandFieldKey(key)) continue;
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const wordCount = normalized.split(' ').filter(Boolean).length;
    // Single-word brand: require >=4 chars to avoid generic English words
    // Multi-word brand: >=3 chars (already inherently specific)
    if (wordCount === 1 && normalized.length >= 4) aliases.add(normalized);
    else if (wordCount >= 2 && normalized.length >= 3) aliases.add(normalized);
  }

  const nameTokens = tokenize(product?.['Product Name']);
  const firstTwo = buildWordPhrase(nameTokens, 2);

  if (firstTwo.length >= 5) aliases.add(firstTwo);

  return aliases;
}

function phraseInText(text, phrase) {
  return ` ${text} `.includes(` ${phrase} `);
}

function buildBrandProfiles(data) {
  // profile is keyed by canonical brand identity so all products of one brand share a single profile
  const profilesByBrand = new Map();
  // alias -> profile lookup. If alias maps to >1 brand, value becomes null (ambiguous).
  const aliasToProfile = new Map();

  for (const product of data) {
    const productScore = Number(product?.['CANADIAN Score (out of 10)']);
    if (Number.isNaN(productScore) || productScore < 1 || productScore > 10) continue;

    const canonicalBrand = getCanonicalBrand(product);
    // Products without explicit brand get their own private profile keyed by name
    const productNameNorm = normalizeText(product?.['Product Name']);
    const brandKey = canonicalBrand || (productNameNorm ? `__product__${productNameNorm}` : null);
    if (!brandKey) continue;

    if (!profilesByBrand.has(brandKey)) {
      profilesByBrand.set(brandKey, {
        brandKey,
        canonicalBrand,
        products: [],
        scoreCounts: new Map(),
        aliases: new Set(),
      });
    }

    const profile = profilesByBrand.get(brandKey);
    profile.products.push(product);
    profile.scoreCounts.set(productScore, (profile.scoreCounts.get(productScore) || 0) + 1);

    const aliases = buildBrandAliasesForProduct(product);
    for (const alias of aliases) {
      profile.aliases.add(alias);
      const existing = aliasToProfile.get(alias);
      if (existing === undefined) {
        aliasToProfile.set(alias, profile);
      } else if (existing !== null && existing !== profile) {
        // Alias is shared by multiple brands - mark ambiguous so it can't false-positive
        aliasToProfile.set(alias, null);
      }
    }
  }

  return { profilesByBrand, aliasToProfile };
}

function getProfileMaxScore(profile) {
  const scores = [...profile.scoreCounts.keys()].filter(
    (s) => !Number.isNaN(s) && s >= 1 && s <= 10
  );
  if (scores.length === 0) return null;
  return Math.max(...scores);
}

function getStrictBrandFallback(queryName, brandData) {
  const { aliasToProfile } = brandData;
  const query = normalizeText(queryName);
  if (!query) return null;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return null;

  let bestProfile = null;
  let bestAlias = null;
  let bestAliasLength = 0;

  for (const [alias, profile] of aliasToProfile.entries()) {
    if (!profile) continue; // ambiguous alias
    if (!phraseInText(query, alias)) continue;

    const aliasTokens = alias.split(' ').filter((t) => t.length > 1);
    const isMultiWord = aliasTokens.length >= 2;

    if (!isMultiWord) {
      // Single-word aliases need stricter validation against generic-word false positives.
      // Require either >=50% coverage or that the alias starts the query (brand-position).
      const coverage = aliasTokens.length / queryTokens.length;
      const startsWithAlias = query === alias || query.startsWith(alias + ' ');
      if (coverage < 0.5 && !startsWithAlias) continue;
    }
    // Multi-word aliases: phrase containment is already specific enough; no coverage check.

    if (alias.length > bestAliasLength) {
      bestProfile = profile;
      bestAlias = alias;
      bestAliasLength = alias.length;
    }
  }

  if (!bestProfile) return null;

  const canonicalScore = getProfileMaxScore(bestProfile);
  if (canonicalScore === null) return null;

  const representative = bestProfile.products.find(
    (product) => Number(product?.['CANADIAN Score (out of 10)']) === canonicalScore
  ) || bestProfile.products[0];
  if (!representative) return null;

  return {
    ...representative,
    'Product Name': queryName,
    'CANADIAN Score (out of 10)': canonicalScore,
    '__matchType': 'brand',
    '__matchedBrand': bestProfile.canonicalBrand || bestAlias,
  };
}

function getBrandUmbrellaScore(product, brandData) {
  const { profilesByBrand } = brandData;
  const canonicalBrand = getCanonicalBrand(product);
  if (!canonicalBrand) return null;

  const profile = profilesByBrand.get(canonicalBrand);
  if (!profile) return null;

  return getProfileMaxScore(profile);
}

let _brandDataCache = null;
let _brandDataCacheRef = null;
function getBrandDataCached(data) {
  if (_brandDataCache && _brandDataCacheRef === data) return _brandDataCache;
  _brandDataCache = buildBrandProfiles(data);
  _brandDataCacheRef = data;
  return _brandDataCache;
}

function findBrandProfileByHint(brandHint, brandData) {
  const hintNorm = normalizeText(brandHint);
  if (!hintNorm) return null;

  // 1. Exact canonical brand match (e.g. hint='Dare Foods' -> profile keyed by 'dare foods')
  if (brandData.profilesByBrand.has(hintNorm)) {
    return brandData.profilesByBrand.get(hintNorm);
  }

  // 2. Direct alias map lookup. Catches Amazon's marketing-brand ('Bear Paws') -> canonical
  //    ownership-company profile ('Dare Foods') via name-derived aliases.
  const aliasMatch = brandData.aliasToProfile.get(hintNorm);
  if (aliasMatch) return aliasMatch;

  // 3. Canonical brand phrase containment (handles 'Dare Foods Limited' <-> 'dare foods')
  let best = null;
  let bestLen = 0;
  for (const [key, profile] of brandData.profilesByBrand) {
    if (key.startsWith('__product__')) continue;
    if (phraseInText(hintNorm, key) || phraseInText(key, hintNorm)) {
      if (key.length > bestLen) {
        best = profile;
        bestLen = key.length;
      }
    }
  }
  if (best) return best;

  // 4. Multi-word alias phrase containment (catch hint='Bear Paws Cookies' via alias 'bear paws')
  for (const [alias, profile] of brandData.aliasToProfile) {
    if (!profile) continue;
    const aliasTokens = alias.split(' ').filter((t) => t.length > 1);
    if (aliasTokens.length < 2) continue; // safety: skip single-word aliases
    if (phraseInText(hintNorm, alias) || phraseInText(alias, hintNorm)) {
      if (alias.length > bestLen) {
        best = profile;
        bestLen = alias.length;
      }
    }
  }
  return best;
}

function buildBrandHitResult(profile, queryName, brandHint) {
  const canonicalScore = getProfileMaxScore(profile);
  if (canonicalScore === null) return null;
  const representative = profile.products.find(
    (p) => Number(p?.['CANADIAN Score (out of 10)']) === canonicalScore
  ) || profile.products[0];
  if (!representative) return null;
  return {
    ...representative,
    'Product Name': queryName,
    'CANADIAN Score (out of 10)': canonicalScore,
    '__matchType': 'brand',
    '__matchedBrand': profile.canonicalBrand || brandHint || profile.brandKey,
  };
}

// ===== Aho-Corasick automaton =====
// Multi-pattern string matcher. Built once from the cache; finds every cache product or
// multi-word brand alias mentioned in a piece of text in a single linear scan.
function buildAhoTrie(entries) {
  const root = { children: new Map(), fail: null, output: [] };

  // Build trie of patterns
  for (const entry of entries) {
    let node = root;
    for (let i = 0; i < entry.pattern.length; i++) {
      const ch = entry.pattern[i];
      let next = node.children.get(ch);
      if (!next) {
        next = { children: new Map(), fail: null, output: [] };
        node.children.set(ch, next);
      }
      node = next;
    }
    node.output.push(entry);
  }

  // BFS to compute failure links
  const queue = [];
  for (const child of root.children.values()) {
    child.fail = root;
    queue.push(child);
  }
  while (queue.length > 0) {
    const node = queue.shift();
    for (const [ch, child] of node.children) {
      let f = node.fail;
      while (f !== null && !f.children.has(ch)) f = f.fail;
      child.fail = f ? f.children.get(ch) : root;
      child.output = child.output.concat(child.fail.output);
      queue.push(child);
    }
  }

  return root;
}

function searchAhoTrie(root, text) {
  const matches = [];
  let node = root;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    while (node !== root && !node.children.has(ch)) {
      node = node.fail;
    }
    const next = node.children.get(ch);
    node = next || root;
    if (node.output.length > 0) {
      for (const entry of node.output) {
        matches.push({ end: i, entry });
      }
    }
  }
  return matches;
}

function buildSearchIndex(data, brandData) {
  const entries = [];

  // Cache product names: multi-word, normalized length >= 6
  for (const product of data) {
    const name = normalizeText(product?.['Product Name']);
    if (!name || name.length < 6) continue;
    const wordCount = name.split(' ').filter((t) => t.length > 1).length;
    if (wordCount < 2) continue;
    entries.push({
      pattern: ` ${name} `,
      length: name.length,
      type: 'product',
      product,
    });
  }

  // Multi-word brand aliases (single-word ones still go through the strict-coverage path)
  for (const [alias, profile] of brandData.aliasToProfile) {
    if (!profile) continue;
    const wordCount = alias.split(' ').filter((t) => t.length > 1).length;
    if (wordCount < 2) continue;
    entries.push({
      pattern: ` ${alias} `,
      length: alias.length,
      type: 'brand',
      profile,
      alias,
    });
  }

  return buildAhoTrie(entries);
}

let _searchIndex = null;
let _searchIndexRef = null;
function getSearchIndex(data, brandData) {
  if (_searchIndex && _searchIndexRef === data) return _searchIndex;
  _searchIndex = buildSearchIndex(data, brandData);
  _searchIndexRef = data;
  return _searchIndex;
}

function findBestAhoMatch(text, trie) {
  if (!text || !trie) return null;
  const padded = ` ${normalizeText(text)} `;
  const matches = searchAhoTrie(trie, padded);
  if (matches.length === 0) return null;
  // Longest pattern wins; product type beats brand on tie (more specific).
  let best = matches[0];
  for (const m of matches) {
    if (m.entry.length > best.entry.length) best = m;
    else if (m.entry.length === best.entry.length && m.entry.type === 'product' && best.entry.type === 'brand') best = m;
  }
  return best;
}

function resolveAhoMatch(match, queryName, brandData) {
  if (match.entry.type === 'brand') {
    return buildBrandHitResult(match.entry.profile, queryName, match.entry.alias);
  }
  const product = match.entry.product;
  const umbrella = getBrandUmbrellaScore(product, brandData);
  const direct = Number(product['CANADIAN Score (out of 10)']);
  if (umbrella !== null && umbrella > direct) {
    return {
      ...product,
      'Product Name': queryName,
      'CANADIAN Score (out of 10)': umbrella,
      '__matchType': 'brand',
      '__matchedBrand': getCanonicalBrand(product) || product['Product Name'],
    };
  }
  return { ...product, 'Product Name': queryName };
}

// Legacy helper kept for compatibility; AC supersedes it in the live path.
function findContainedProductMatch(queryName, data) {
  const query = normalizeText(queryName);
  if (!query) return null;
  const paddedQuery = ` ${query} `;

  let best = null;
  let bestLen = 0;

  for (const product of data) {
    const name = normalizeText(product?.['Product Name']);
    if (!name || name.length < 6) continue;
    const tokens = name.split(' ').filter((t) => t.length > 1);
    if (tokens.length < 2) continue; // require multi-word for safety

    const paddedName = ` ${name} `;
    if (paddedQuery.includes(paddedName) || paddedName.includes(paddedQuery)) {
      if (name.length > bestLen) {
        best = product;
        bestLen = name.length;
      }
    }
  }

  return best;
}

function tokenOverlapScore(queryTokens, candidateTokens) {
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

  const querySet = new Set(queryTokens);
  const candidateSet = new Set(candidateTokens);
  let common = 0;

  for (const token of querySet) {
    if (candidateSet.has(token)) common++;
  }

  return common / Math.max(querySet.size, candidateSet.size);
}

function getProductBrandTokens(product) {
  const brandishValues = Object.entries(product || {})
    .filter(([key]) => /(brand|company|owner|manufacturer)/i.test(key))
    .map(([, value]) => value);

  const explicitBrandTokens = brandishValues.flatMap((value) => tokenize(value));
  if (explicitBrandTokens.length > 0) {
    return explicitBrandTokens;
  }

  const productNameTokens = tokenize(product?.['Product Name']);
  return productNameTokens.slice(0, 2);
}

function scoreProductMatch(queryName, product) {
  const productName = product?.['Product Name'] || '';
  const normalizedQuery = normalizeText(queryName);
  const normalizedProduct = normalizeText(productName);

  if (!normalizedQuery || !normalizedProduct) {
    return 0;
  }

  if (normalizedQuery === normalizedProduct) {
    return 1;
  }

  if (
    normalizedProduct.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedProduct)
  ) {
    const queryTokens = tokenize(normalizedQuery);
    const productTokens = tokenize(normalizedProduct);
    const overlap = tokenOverlapScore(queryTokens, productTokens);
    if (overlap >= 0.6) {
      return 0.95;
    }
  }

  const queryTokens = tokenize(normalizedQuery);
  const productTokens = tokenize(normalizedProduct);
  const overlap = tokenOverlapScore(queryTokens, productTokens);

  return overlap * 0.9;
}

/**
 * Fetch and cache the CANADA List data
 */
// In-memory cache. Avoids hitting chrome.storage.local on every match request and keeps a
// stable data reference so the AC trie / brand-data caches stay valid across calls.
let _inMemoryData = null;
let _inMemoryExpiry = 0;

async function fetchAndCacheData() {
  const fetchTimer = performance.now();
  
  try {
    console.log('[CANADA-LIST-BG] Starting data fetch from API...');
    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error(`API responded with status ${response.status}`);
    }

    const data = await response.json();
    const timestamp = Date.now();
    const expiry = timestamp + CACHE_DURATION;

    _inMemoryData = data;
    _inMemoryExpiry = expiry;

    chrome.storage.local.set({
      [CACHE_KEY]: data,
      [CACHE_EXPIRY_KEY]: expiry
    });

    const duration = performance.now() - fetchTimer;
    console.log(`[CANADA-LIST-BG] Data cached successfully in ${duration.toFixed(2)}ms (${data.length} products)`);
    return data;
  } catch (error) {
    const duration = performance.now() - fetchTimer;
    console.error(`[CANADA-LIST-BG] Failed to fetch data in ${duration.toFixed(2)}ms:`, error);
    return null;
  }
}

/**
 * Get cached data if valid, otherwise fetch fresh data
 */
async function getCachedOrFreshData() {
  const cacheTimer = performance.now();
  const now = Date.now();

  // Hot path: in-memory cache. Stable reference => AC trie / brand-profile caches stay warm.
  if (_inMemoryData && _inMemoryExpiry > now) {
    const duration = performance.now() - cacheTimer;
    console.log(`[CANADA-LIST-BG] Using in-memory cache (${duration.toFixed(2)}ms, ${_inMemoryData.length} products)`);
    return _inMemoryData;
  }

  return new Promise((resolve) => {
    chrome.storage.local.get([CACHE_KEY, CACHE_EXPIRY_KEY], async (result) => {
      const cachedData = result[CACHE_KEY];
      const expiry = result[CACHE_EXPIRY_KEY];

      if (cachedData && expiry && expiry > Date.now()) {
        _inMemoryData = cachedData;
        _inMemoryExpiry = expiry;
        const duration = performance.now() - cacheTimer;
        console.log(`[CANADA-LIST-BG] Loaded from storage cache in ${duration.toFixed(2)}ms (${cachedData.length} products)`);
        resolve(cachedData);
        return;
      }

      console.log('[CANADA-LIST-BG] Cache expired or missing, fetching fresh data...');
      const freshData = await fetchAndCacheData();
      const duration = performance.now() - cacheTimer;
      console.log(`[CANADA-LIST-BG] Fresh data fetch completed in ${duration.toFixed(2)}ms`);
      resolve(freshData || cachedData || []);
    });
  });
}

/**
 * Get product info by matching product name
 */
async function getProductInfo(productName, containerText) {
  const searchTimer = performance.now();
  
  const data = await getCachedOrFreshData();
  if (!data || data.length === 0) {
    const duration = performance.now() - searchTimer;
    console.log(`[CANADA-LIST-BG] Product search failed (no data) in ${duration.toFixed(2)}ms for: ${productName}`);
    return null;
  }

  const brandData = getBrandDataCached(data);
  const acIndex = getSearchIndex(data, brandData);

  // 1. Aho-Corasick scan on the product name (catches multi-word product names AND brand aliases)
  if (productName) {
    const m = findBestAhoMatch(productName, acIndex);
    if (m) {
      const result = resolveAhoMatch(m, productName, brandData);
      const duration = performance.now() - searchTimer;
      console.log(`[CANADA-LIST-BG] AC match found in ${duration.toFixed(2)}ms for: ${productName} (score: ${result['CANADIAN Score (out of 10)']})`);
      return result;
    }
  }

  const cleanedProductName = normalizeText(productName);

  // 2. Single-word brand-alias fallback (uses strict coverage / brand-position safety)
  if (cleanedProductName) {
    const brandFallback = getStrictBrandFallback(productName, brandData);
    if (brandFallback) {
      const duration = performance.now() - searchTimer;
      console.log(`[CANADA-LIST-BG] Brand fallback match found in ${duration.toFixed(2)}ms for: ${productName} (score: ${brandFallback['CANADIAN Score (out of 10)']})`);
      return brandFallback;
    }
  }

  // 3. Fuzzy score match (catches partial overlaps the AC + alias paths missed)
  if (cleanedProductName) {
    let bestMatch = null;
    let bestScore = 0;
    for (const product of data) {
      const score = scoreProductMatch(cleanedProductName, product);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = product;
      }
    }
    if (bestMatch && bestScore >= 0.55) {
      const umbrellaScore = getBrandUmbrellaScore(bestMatch, brandData);
      const directScore = Number(bestMatch['CANADIAN Score (out of 10)']);
      if (umbrellaScore !== null && umbrellaScore > directScore) {
        const result = {
          ...bestMatch,
          'CANADIAN Score (out of 10)': umbrellaScore,
          '__matchType': 'brand',
          '__matchedBrand': getCanonicalBrand(bestMatch) || bestMatch['Product Name']
        };
        const duration = performance.now() - searchTimer;
        console.log(`[CANADA-LIST-BG] Fuzzy brand match found in ${duration.toFixed(2)}ms for: ${productName} (score: ${result['CANADIAN Score (out of 10)']})`);
        return result;
      }
      const duration = performance.now() - searchTimer;
      console.log(`[CANADA-LIST-BG] Fuzzy match found in ${duration.toFixed(2)}ms for: ${productName} (score: ${bestMatch['CANADIAN Score (out of 10)']})`);
      return bestMatch;
    }
  }

  // 4. Last resort: scan the full container text. Catches products whose title-extraction
  //    missed but the product name appears elsewhere in the tile (description, alt text, etc.).
  if (containerText) {
    const m = findBestAhoMatch(containerText, acIndex);
    if (m) {
      const result = resolveAhoMatch(m, productName || containerText.slice(0, 100), brandData);
      const duration = performance.now() - searchTimer;
      console.log(`[CANADA-LIST-BG] Container text match found in ${duration.toFixed(2)}ms for: ${productName} (score: ${result['CANADIAN Score (out of 10)']})`);
      return result;
    }
  }

  const duration = performance.now() - searchTimer;
  console.log(`[CANADA-LIST-BG] No match found in ${duration.toFixed(2)}ms for: ${productName}`);
  return null;
}

// Fetch data on extension install/update
chrome.runtime.onInstalled.addListener(() => {
  console.log('[CANADA-LIST-BG] Extension installed/updated. Fetching initial data...');
  fetchAndCacheData();
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const messageTimer = performance.now();
  
  if (request.action === 'getProductInfo') {
    getProductInfo(request.productName, request.containerText).then((result) => {
      const duration = performance.now() - messageTimer;
      console.log(`[CANADA-LIST-BG] Message processed in ${duration.toFixed(2)}ms for: ${request.productName}`);
      sendResponse(result);
    });
    return true; // Keep channel open for async response
  }

  if (request.action === 'getAllProducts') {
    getCachedOrFreshData().then((result) => {
      const duration = performance.now() - messageTimer;
      console.log(`[CANADA-LIST-BG] All products request processed in ${duration.toFixed(2)}ms`);
      sendResponse(result);
    });
    return true;
  }

  if (request.action === 'refreshData') {
    fetchAndCacheData().then((result) => {
      const duration = performance.now() - messageTimer;
      console.log(`[CANADA-LIST-BG] Data refresh request processed in ${duration.toFixed(2)}ms`);
      sendResponse(result);
    });
    return true;
  }
});

// Periodic cache update (every 12 hours)
chrome.alarms.create('refreshData', { periodInMinutes: 12 * 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshData') {
    console.log('[CANADA-LIST-BG] Periodic refresh triggered');
    fetchAndCacheData();
  }
});
