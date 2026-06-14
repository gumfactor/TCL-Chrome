// Product Name Normalization Utilities
// Handles text cleaning and tokenization for product matching

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

function normalizeCandidateText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\|.*$/, ' ')
    .trim();
}

function isReasonableProductText(text) {
  if (!text) return false;
  if (text.length < 3 || text.length > 220) return false;
  if (/^(home|menu|shop|search|cart|account|wishlist)$/i.test(text)) return false;
  if (/^(add to cart|buy now|view details|quick view)$/i.test(text)) return false;
  return true;
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeText,
    tokenize,
    buildWordPhrase,
    normalizeCandidateText,
    isReasonableProductText,
    GENERIC_PRODUCT_TOKENS
  };
}