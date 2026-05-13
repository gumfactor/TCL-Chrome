document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('tcl-search');
  const searchBtn = document.getElementById('tcl-search-btn');
  const resultsContainer = document.getElementById('tcl-results');
  const clearCacheBtn = document.getElementById('tcl-clear-cache');
  const statCached = document.getElementById('tcl-stat-cached');
  const statSource = document.getElementById('tcl-stat-source');

  function scoreTier(score) {
    if (score >= 7) return 'high';
    if (score >= 4) return 'mid';
    return 'low';
  }

  function ownershipLine(p) {
    const n = String(p.ownerNation || '').toLowerCase();
    const kind = n === 'canada' ? 'Canadian-owned' : n === 'usa' ? 'USA-owned' : '';
    const detail = (p.ownership || '').trim();
    const parts = [kind, detail].filter(Boolean);
    return parts.join(' · ');
  }

  function renderResults(products) {
    if (!products || products.length === 0) {
      resultsContainer.innerHTML = `
        <div class="tcl-no-results">
          No products found. Try a different search term.
        </div>
      `;
      return;
    }

    resultsContainer.innerHTML = products.map(p => `
      <div class="tcl-result-card" role="article" aria-label="${p.brand || p.name}, CANADA Score ${p.canadaScore} out of 10">
        <div class="tcl-result-card__info">
          <div class="tcl-result-card__name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
          <div class="tcl-result-card__brand">${escapeHtml(p.brand || '')}</div>
          <div class="tcl-result-card__details">
            ${escapeHtml([ownershipLine(p), p.manufacturing].filter(Boolean).join(' · '))}
          </div>
        </div>
        <div class="tcl-result-card__score tcl-result-card__score--${scoreTier(p.canadaScore)}"
             aria-label="Score: ${p.canadaScore} out of 10">
          ${p.canadaScore}
        </div>
      </div>
    `).join('');
  }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  function doSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    resultsContainer.innerHTML = '<div class="tcl-no-results">Searching…</div>';

    chrome.runtime.sendMessage(
      { type: 'TCL_LOOKUP', query, browse: true },
      (response) => {
        if (chrome.runtime.lastError) {
          resultsContainer.innerHTML = '<div class="tcl-no-results">Error connecting to extension.</div>';
          return;
        }
        renderResults(response?.products || []);
      }
    );
  }

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  clearCacheBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TCL_CLEAR_CACHE' }, () => {
      clearCacheBtn.textContent = 'Cleared!';
      setTimeout(() => { clearCacheBtn.textContent = 'Clear cache'; }, 1500);
      loadStats();
    });
  });

  function loadStats() {
    chrome.runtime.sendMessage({ type: 'TCL_GET_STATS' }, (response) => {
      if (response?.success) {
        statCached.textContent = response.stats.cachedProducts;
        statSource.textContent = response.stats.dataSource || 'Live API';
      }
    });
  }

  loadStats();
});
