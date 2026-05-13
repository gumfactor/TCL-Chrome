/**
 * Badge + tooltip injection via Shadow DOM.
 * Provides full CSS isolation and accessibility (WCAG AA contrast, ARIA, sr-text).
 */

const TCLBadge = {

  BADGE_STYLES: `
    :host {
      all: initial;
      display: inline-block;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      z-index: 10000;
    }

    .tcl-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
      cursor: pointer;
      border: 2px solid transparent;
      transition: box-shadow 0.15s ease, transform 0.1s ease;
      position: relative;
      white-space: nowrap;
    }

    .tcl-badge:hover,
    .tcl-badge:focus-visible {
      transform: scale(1.04);
      box-shadow: 0 2px 8px rgba(0,0,0,0.18);
      outline: none;
    }

    .tcl-badge:focus-visible {
      border-color: #005fcc;
    }

    .tcl-badge__leaf {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    /* Score-based colour tiers – WCAG AA compliant */
    .tcl-badge--high    { background: #1a6b3c; color: #ffffff; }
    .tcl-badge--mid     { background: #b45309; color: #ffffff; }
    .tcl-badge--low     { background: #991b1b; color: #ffffff; }
    .tcl-badge--unknown { background: #4b5563; color: #ffffff; }

    .tcl-sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0,0,0,0);
      white-space: nowrap;
      border: 0;
    }

    /* Tooltip */
    .tcl-tooltip {
      display: none;
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      width: 280px;
      padding: 14px;
      background: #ffffff;
      color: #1f2937;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      font-size: 13px;
      font-weight: 400;
      line-height: 1.5;
      z-index: 10001;
      white-space: normal;
      cursor: default;
    }

    .tcl-tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 6px solid transparent;
      border-top-color: #ffffff;
    }

    .tcl-badge[aria-expanded="true"] + .tcl-tooltip,
    .tcl-badge:hover + .tcl-tooltip,
    .tcl-badge:focus-visible + .tcl-tooltip {
      display: block;
    }

    .tcl-tooltip__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e5e7eb;
    }

    .tcl-tooltip__brand {
      font-weight: 700;
      font-size: 14px;
      color: #111827;
    }

    .tcl-tooltip__score-big {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-weight: 800;
      font-size: 20px;
      padding: 2px 8px;
      border-radius: 6px;
    }

    .tcl-tooltip__score-big--high { background: #d1fae5; color: #065f46; }
    .tcl-tooltip__score-big--mid  { background: #fef3c7; color: #92400e; }
    .tcl-tooltip__score-big--low  { background: #fee2e2; color: #991b1b; }

    .tcl-tooltip__row {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
      font-size: 12.5px;
    }
    .tcl-tooltip__label {
      color: #6b7280;
    }
    .tcl-tooltip__value {
      font-weight: 600;
      color: #111827;
      text-align: right;
      max-width: 60%;
    }

    .tcl-tooltip__footer {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #e5e7eb;
      font-size: 11px;
      color: #9ca3af;
      text-align: center;
    }

    .tcl-tooltip__reassessed {
      display: inline-block;
      background: #dbeafe;
      color: #1e40af;
      font-size: 11px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 4px;
      margin-top: 4px;
    }
  `,

  MAPLE_LEAF_SVG: `<svg class="tcl-badge__leaf" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1l1.5 3.5 3.5.5-2 3 1 3.5-2.5-1L12 13l-1.5-2.5-2.5 1 1-3.5-2-3 3.5-.5z"/><path d="M12 13v10M8 20l4-3 4 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  scoreTier(score) {
    if (score >= 7) return 'high';
    if (score >= 4) return 'mid';
    if (score >= 1) return 'low';
    return 'unknown';
  },

  scoreTierLabel(score) {
    if (score >= 7) return 'High Canadian contribution';
    if (score >= 4) return 'Moderate Canadian contribution';
    if (score >= 1) return 'Low Canadian contribution';
    return 'Score unavailable';
  },

  /** @param {string} [ownerNation] - "canada" | "usa" */
  ownershipKindLabel(ownerNation) {
    const n = String(ownerNation || '').toLowerCase();
    if (n === 'canada') return 'Canadian-owned';
    if (n === 'usa') return 'USA-owned';
    return '';
  },

  ownershipDisplay(product) {
    const kind = this.ownershipKindLabel(product.ownerNation);
    const detail = (product.ownership || '').trim();
    if (!kind && !detail) return this._esc('—');
    const parts = [];
    if (kind) parts.push(kind);
    if (detail) parts.push(detail);
    return this._esc(parts.join(' · '));
  },

  create(product) {
    const host = document.createElement('tcl-score');
    host.setAttribute('data-tcl-id', product.id || '');
    const shadow = host.attachShadow({ mode: 'open' });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(this.BADGE_STYLES);
    shadow.adoptedStyleSheets = [sheet];

    const tier = this.scoreTier(product.canadaScore);
    const scoreTierBig = tier === 'unknown' ? 'mid' : tier;
    const tooltipId = `tcl-tip-${product.id || Math.random().toString(36).slice(2)}`;

    const wrapper = document.createElement('span');
    wrapper.innerHTML = `
      <button
        class="tcl-badge tcl-badge--${tier}"
        aria-label="CANADA Score ${product.canadaScore} out of 10 for ${product.brand || product.name}. ${this.scoreTierLabel(product.canadaScore)}."
        aria-describedby="${tooltipId}"
        aria-expanded="false"
        type="button"
      >
        ${this.MAPLE_LEAF_SVG}
        <span aria-hidden="true">${product.canadaScore}/10</span>
        <span class="tcl-sr-only">CANADA Score: ${product.canadaScore} out of 10</span>
      </button>
      <div class="tcl-tooltip" id="${tooltipId}" role="tooltip">
        <div class="tcl-tooltip__header">
          <span class="tcl-tooltip__brand">${this._esc(product.brand || product.name)}</span>
          <span class="tcl-tooltip__score-big tcl-tooltip__score-big--${scoreTierBig}">
            ${product.canadaScore}/10
          </span>
        </div>
        <div class="tcl-tooltip__row">
          <span class="tcl-tooltip__label">Ownership</span>
          <span class="tcl-tooltip__value">${this.ownershipDisplay(product)}</span>
        </div>
        <div class="tcl-tooltip__row">
          <span class="tcl-tooltip__label">Manufacturing</span>
          <span class="tcl-tooltip__value">${this._esc(product.manufacturing || '—')}</span>
        </div>
        <div class="tcl-tooltip__row">
          <span class="tcl-tooltip__label">Sourcing</span>
          <span class="tcl-tooltip__value">${this._esc(product.sourcing || '—')}</span>
        </div>
        <div class="tcl-tooltip__row">
          <span class="tcl-tooltip__label">Job Support</span>
          <span class="tcl-tooltip__value">${this._esc(product.jobSupport || '—')}</span>
        </div>
        ${product.reassessed ? '<span class="tcl-tooltip__reassessed">✓ Reassessed</span>' : ''}
        <div class="tcl-tooltip__footer">
          Data by The CANADA List · thecanadalist.ca
        </div>
      </div>
    `;

    shadow.appendChild(wrapper);

    const badge = shadow.querySelector('.tcl-badge');
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = badge.getAttribute('aria-expanded') === 'true';
      badge.setAttribute('aria-expanded', String(!expanded));
    });

    document.addEventListener('click', () => {
      badge.setAttribute('aria-expanded', 'false');
    });

    return host;
  },

  createCompact(product) {
    const host = document.createElement('tcl-score-mini');
    host.setAttribute('data-tcl-id', product.id || '');
    const shadow = host.attachShadow({ mode: 'open' });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(this.BADGE_STYLES + `
      .tcl-badge { font-size: 11px; padding: 2px 5px; gap: 2px; }
      .tcl-badge__leaf { width: 11px; height: 11px; }
      .tcl-tooltip { width: 250px; }
    `);
    shadow.adoptedStyleSheets = [sheet];

    const tier = this.scoreTier(product.canadaScore);
    const scoreTierBig = tier === 'unknown' ? 'mid' : tier;
    const tooltipId = `tcl-tip-mini-${product.id || Math.random().toString(36).slice(2)}`;

    const wrapper = document.createElement('span');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
    wrapper.innerHTML = `
      <button
        class="tcl-badge tcl-badge--${tier}"
        aria-label="CANADA Score ${product.canadaScore} out of 10 for ${product.brand || product.name}. ${this.scoreTierLabel(product.canadaScore)}."
        aria-describedby="${tooltipId}"
        aria-expanded="false"
        type="button"
      >
        ${this.MAPLE_LEAF_SVG}
        <span aria-hidden="true">${product.canadaScore}/10</span>
        <span class="tcl-sr-only">CANADA Score: ${product.canadaScore} out of 10</span>
      </button>
      <div class="tcl-tooltip" id="${tooltipId}" role="tooltip">
        <div class="tcl-tooltip__header">
          <span class="tcl-tooltip__brand">${this._esc(product.brand || product.name)}</span>
          <span class="tcl-tooltip__score-big tcl-tooltip__score-big--${scoreTierBig}">
            ${product.canadaScore}/10
          </span>
        </div>
        <div class="tcl-tooltip__row">
          <span class="tcl-tooltip__label">Ownership</span>
          <span class="tcl-tooltip__value">${this.ownershipDisplay(product)}</span>
        </div>
        <div class="tcl-tooltip__row">
          <span class="tcl-tooltip__label">Manufacturing</span>
          <span class="tcl-tooltip__value">${this._esc(product.manufacturing || '—')}</span>
        </div>
        <div class="tcl-tooltip__row">
          <span class="tcl-tooltip__label">Sourcing</span>
          <span class="tcl-tooltip__value">${this._esc(product.sourcing || '—')}</span>
        </div>
        <div class="tcl-tooltip__row">
          <span class="tcl-tooltip__label">Job Support</span>
          <span class="tcl-tooltip__value">${this._esc(product.jobSupport || '—')}</span>
        </div>
        ${product.reassessed ? '<span class="tcl-tooltip__reassessed">✓ Reassessed</span>' : ''}
        <div class="tcl-tooltip__footer">
          Data by The CANADA List · thecanadalist.ca
        </div>
      </div>
    `;

    shadow.appendChild(wrapper);

    const badge = shadow.querySelector('.tcl-badge');
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const expanded = badge.getAttribute('aria-expanded') === 'true';
      badge.setAttribute('aria-expanded', String(!expanded));
    });

    document.addEventListener('click', () => {
      badge.setAttribute('aria-expanded', 'false');
    });

    return host;
  },

  _esc(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.TCLBadge = TCLBadge;
}
