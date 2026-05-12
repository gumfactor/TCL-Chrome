// API Client for The CANADA List Extension
// Handles fetching and caching of product data

const API_URL = 'https://thecanadalist.ca/TheCanadaList.json';
const CACHE_KEY = 'canadaListData';
const CACHE_EXPIRY_KEY = 'canadaListDataExpiry';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// In-memory cache. Avoids hitting chrome.storage.local on every match request and keeps a
// stable data reference so the AC trie / brand-data caches stay valid across calls.
let _inMemoryData = null;
let _inMemoryExpiry = 0;

/**
 * Fetch and cache the CANADA List data
 */
async function fetchAndCacheData() {
  try {
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

    console.log('✓ CANADA List data cached successfully', data.length);
    return data;
  } catch (error) {
    console.error('✗ Failed to fetch CANADA List data:', error);
    return null;
  }
}

/**
 * Get cached data if valid, otherwise fetch fresh data
 */
async function getCachedOrFreshData() {
  const now = Date.now();

  // Hot path: in-memory cache. Stable reference => AC trie / brand-profile caches stay warm.
  if (_inMemoryData && _inMemoryExpiry > now) {
    return _inMemoryData;
  }

  return new Promise((resolve) => {
    chrome.storage.local.get([CACHE_KEY, CACHE_EXPIRY_KEY], async (result) => {
      const cachedData = result[CACHE_KEY];
      const expiry = result[CACHE_EXPIRY_KEY];

      if (cachedData && expiry && expiry > Date.now()) {
        _inMemoryData = cachedData;
        _inMemoryExpiry = expiry;
        resolve(cachedData);
        return;
      }

      console.log('⟳ Cache expired or missing, fetching fresh data...');
      const freshData = await fetchAndCacheData();
      resolve(freshData || cachedData || []);
    });
  });
}

// Export functions for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fetchAndCacheData, getCachedOrFreshData };
}