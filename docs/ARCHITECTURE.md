# Architecture Overview

## Extension Components

The extension is built using Chrome Extension Manifest V3 and consists of three main parts:

### 1. Background Service Worker
**Location:** `src/background/background.js`

**Purpose:** Manages data and handles requests from content scripts.

**Key Functions:**
- Downloads and caches The CANADA List database
- Matches product names against the database
- Updates data automatically every 24 hours
- Responds to requests from content scripts

**Data Storage:**
Uses Chrome's storage API to cache the product database locally.

### 2. Content Scripts
**Location:** `src/content/`

**Purpose:** Runs on e-commerce websites to detect products and show badges.

**Key Files:**
- `content-script.js` - Main logic for badge injection
- `content-styles.css` - Styles for badges, tooltips, and notifications
- `universal-detector.js` - Detects product containers on any website
- `matchers/` - Site-specific product detection rules

**How It Works:**
1. Detects when you're on an e-commerce site
2. Scans the page for product listings
3. Extracts product names
4. Sends names to background worker for matching
5. Injects score badges on matched products
6. Shows tooltips on hover with detailed information

### 3. Popup Interface
**Location:** `src/popup/`

**Purpose:** Provides controls and information when you click the extension icon.

**Features:**
- Shows current data status
- Manual data refresh button
- Link to The CANADA List website
- Score guide reference

## Data Flow

1. **Initial Load:**
   - Extension installs
   - Background worker downloads database from thecanadalist.ca
   - Database cached locally

2. **Page Visit:**
   - Content script activates on e-commerce site
   - Scans page for products
   - Extracts product names

3. **Product Matching:**
   - Content script sends product name to background worker
   - Background worker searches local database
   - Returns match result with score and details

4. **Badge Display:**
   - Content script receives match result
   - Creates and injects score badge
   - Badge shows instantly from cached data

5. **Updates:**
   - Every 24 hours, background worker checks for database updates
   - Downloads new version if available
   - Updates local cache

## Product Detection

**Universal Detector:**
Uses pattern recognition to find product containers on any website without hardcoded rules.

**Site-Specific Matchers:**
Custom detection rules for major retailers (Amazon, Walmart, etc.) for better accuracy.

**Fallback System:**
If universal detector fails, falls back to common CSS selectors used by most e-commerce sites.

## Matching Algorithm

**Normalization:**
Product names are normalized (lowercase, remove special characters, remove common words) before matching.

**Aho-Corasick Search:**
Fast multi-pattern string matching algorithm finds products in database efficiently.

**Brand Matching:**
If exact product name isn't found, tries matching by brand name.

**Scoring:**
Returns the CANADA Score (1-10) based on ownership and manufacturing location.

## Performance Optimizations

**Local Caching:**
All data stored locally means instant badge display without network requests.

**Debounced Scanning:**
Page mutations trigger scans with 150ms delay to avoid excessive processing.

**Incremental Injection:**
Only scans new products added to page (infinite scroll, dynamic loading).

**Memory Management:**
Product name cache limited to 1500 entries to prevent memory growth.

## Website Detection

The extension only activates on e-commerce sites by checking for:
- Domain names with shopping keywords
- Product schema markup
- Shopping cart elements
- Common e-commerce URL patterns

This prevents unnecessary processing on non-shopping sites.

## Notifications

**Active Notification:**
Shows once per browsing session when extension activates on a site.

**Site Notification:**
Shows when visiting a website that's in The CANADA List database.

**Stacking Behavior:**
Multiple notifications stack vertically like iOS notifications.

**Session Tracking:**
Uses sessionStorage to prevent repeated notifications during same browsing session.

## Security

**Content Security:**
All content from external sources treated as untrusted and sanitized before display.

**No Remote Code:**
Extension doesn't load external scripts or execute remote code.

**Limited Permissions:**
Only requests necessary permissions for core functionality.

## Project Structure

```
the-CANADA-LIST-2/
├── manifest.json              # Extension configuration
├── package.json              # Project metadata
├── src/
│   ├── background/
│   │   └── background.js     # Service worker (data management)
│   ├── content/
│   │   ├── content-script.js # Main injection logic
│   │   ├── content-styles.css # Badge and notification styles
│   │   ├── universal-detector.js # Product detection
│   │   └── matchers/
│   │       ├── amazon.js     # Amazon-specific rules
│   │       └── base-matcher.js # Common matching logic
│   ├── popup/
│   │   ├── popup.html        # Extension popup interface
│   │   ├── popup.js          # Popup functionality
│   │   └── popup-styles.css  # Popup styling
│   ├── utils/
│   │   ├── accessibility.js  # Accessibility helpers
│   │   ├── api-client.js     # API communication
│   │   └── product-normalizer.js # Text processing
│   ├── data/
│   │   └── TheCanadaList.json # Bundled database
│   └── assets/
│       └── icons/
│           └── maple_leaf.png # Extension icon
└── docs/
    ├── ARCHITECTURE.md       # This file
    ├── SETUP_GUIDE.md        # Installation instructions
    ├── PRIVACY_BRIEF.md      # Privacy information
    └── MATCHING_SPEC.md      # Product matching details
```