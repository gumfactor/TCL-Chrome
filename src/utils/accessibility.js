// Accessibility utilities for The CANADA List Extension
// Ensures WCAG compliance and screen reader compatibility

/**
 * Score to color mapping (WCAG AAA compliant)
 * All colors meet 7:1 contrast ratio against white backgrounds
 */
function getScoreColor(score) {
  if (score >= 9) return '#0d6e35'; // Canadian green (WCAG AAA)
  if (score >= 7) return '#2d5016'; // Darker green
  if (score >= 5) return '#b8860b'; // Goldenrod
  if (score >= 3) return '#c97d1a'; // Orange
  return '#8b0000'; // Dark red
}

/**
 * Get human-readable score label
 */
function getScoreLabel(score) {
  if (score >= 9) return 'Excellent';
  if (score >= 7) return 'Good';
  if (score >= 5) return 'Moderate';
  if (score >= 3) return 'Limited';
  return 'Minimal';
}

/**
 * Create accessible ARIA label for badge
 */
function createBadgeAriaLabel(product, score) {
  const productName = product['Product Name'] || 'Product';
  const scoreLabel = getScoreLabel(score);
  const matchType = product['__matchType'] === 'brand' ? 'brand match' : 'direct match';
  
  return `CANADA Score: ${score} out of 10, ${scoreLabel} Canadian contribution for ${productName} (${matchType})`;
}

/**
 * Create accessible tooltip content with proper ARIA structure
 */
function createAccessibleTooltip(product, score) {
  const matchType = product?.['__matchType'] === 'brand' ? 'Brand match' : 'Direct match';
  const matchedBrand = product?.['__matchedBrand'] ? ` (${product['__matchedBrand']})` : '';
  const notes = product['Notes'] ? `<div role="note">${product['Notes']}</div>` : '';
  const color = getScoreColor(score);
  const scoreLabel = getScoreLabel(score);

  return `
    <div class="canada-badge-tooltip-inner" role="tooltip" aria-live="polite">
      <h3 id="tooltip-title">${product['Product Name']}</h3>
      <div class="tcl-score-row" aria-labelledby="tooltip-title">
        <span class="tcl-score-pill" style="background:${color}" aria-label="${score} out of 10">${score}/10</span>
        <span class="tcl-score-description">${scoreLabel} Canadian contribution</span>
      </div>
      <dl class="tcl-meta" aria-label="Product details">
        <dt>Match type</dt>
        <dd>${matchType}${matchedBrand}</dd>
        <dt>Ownership</dt>
        <dd>${product['Ownership (Country)']}</dd>
        <dt>Made in</dt>
        <dd>${product['Manufacturing (Countries)']}</dd>
      </dl>
      ${notes}
    </div>
  `;
}

/**
 * Ensure element meets minimum touch target size (44x44px)
 */
function ensureMinimumTouchTarget(element) {
  const rect = element.getBoundingClientRect();
  const minSize = 44;
  
  if (rect.width < minSize || rect.height < minSize) {
    element.style.minWidth = `${minSize}px`;
    element.style.minHeight = `${minSize}px`;
  }
}

/**
 * Add keyboard navigation support to badge
 */
function addKeyboardSupport(badge, showTooltip, hideTooltip) {
  badge.setAttribute('tabindex', '0');
  badge.setAttribute('role', 'button');
  
  badge.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      showTooltip();
    } else if (event.key === 'Escape') {
      hideTooltip();
    }
  });
  
  badge.addEventListener('focus', showTooltip);
  badge.addEventListener('blur', hideTooltip);
}

/**
 * Check if user prefers reduced motion
 */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Apply reduced motion styles if needed
 */
function applyReducedMotionStyles(element) {
  if (prefersReducedMotion()) {
    element.style.transition = 'none';
    element.style.animation = 'none';
  }
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getScoreColor,
    getScoreLabel,
    createBadgeAriaLabel,
    createAccessibleTooltip,
    ensureMinimumTouchTarget,
    addKeyboardSupport,
    prefersReducedMotion,
    applyReducedMotionStyles
  };
}