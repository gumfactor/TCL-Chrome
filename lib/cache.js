// chrome.storage.local with TTL; stale rows dropped on read.
// Bump prefix when cached shape / lookup meaning changes.

const TCL_CACHE_PREFIX = 'tcl_cache_v5_';
const TCL_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const TCL_CACHE_MAX_ENTRIES = 2000;

const TCLCache = {
  async get(key) {
    const cacheKey = TCL_CACHE_PREFIX + key;
    try {
      const result = await chrome.storage.local.get(cacheKey);
      const entry = result[cacheKey];
      if (!entry) return null;

      if (Date.now() - entry.timestamp > TCL_CACHE_TTL_MS) {
        await chrome.storage.local.remove(cacheKey);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  },

  async set(key, data) {
    const cacheKey = TCL_CACHE_PREFIX + key;
    try {
      await chrome.storage.local.set({
        [cacheKey]: { data, timestamp: Date.now() }
      });
    } catch {
      await this.evict();
      try {
        await chrome.storage.local.set({
          [cacheKey]: { data, timestamp: Date.now() }
        });
      } catch { /* storage truly full – skip */ }
    }
  },

  async setBulk(entries) {
    const payload = {};
    const now = Date.now();
    for (const [key, data] of Object.entries(entries)) {
      payload[TCL_CACHE_PREFIX + key] = { data, timestamp: now };
    }
    try {
      await chrome.storage.local.set(payload);
    } catch {
      await this.evict();
      try { await chrome.storage.local.set(payload); } catch { /* skip */ }
    }
  },

  async evict() {
    try {
      const all = await chrome.storage.local.get(null);
      const cacheEntries = Object.entries(all)
        .filter(([k]) => k.startsWith(TCL_CACHE_PREFIX))
        .sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));

      const removeCount = Math.max(
        cacheEntries.length - TCL_CACHE_MAX_ENTRIES,
        Math.floor(cacheEntries.length * 0.25)
      );
      if (removeCount > 0) {
        const keysToRemove = cacheEntries.slice(0, removeCount).map(([k]) => k);
        await chrome.storage.local.remove(keysToRemove);
      }
    } catch { /* best effort */ }
  },

  async clear() {
    try {
      const all = await chrome.storage.local.get(null);
      const keys = Object.keys(all).filter(k => k.startsWith(TCL_CACHE_PREFIX));
      if (keys.length > 0) await chrome.storage.local.remove(keys);
    } catch { /* skip */ }
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.TCLCache = TCLCache;
}

export { TCLCache };
