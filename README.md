# The CANADA List Chrome Extension

A Chrome extension that shows CANADA Scores on online shopping sites to help you identify Canadian products.

## What It Does

The extension automatically detects products while you shop online and displays their CANADA Score (1-10 rating based on Canadian ownership and manufacturing).

**Features:**
- Score badges appear on product listings
- Hover over badges to see ownership and manufacturing details
- Site notifications when visiting Canadian company websites
- Works on major retailers: Amazon, Walmart, Best Buy, Canadian Tire, and more

## Installation

1. Download the extension ZIP file
2. Unzip the downloaded file - this creates a folder
3. Open the unzipped folder - you'll see another folder inside (this is the actual extension folder)
4. Open Chrome and go to `chrome://extensions/`
5. Enable "Developer mode" (top right toggle)
6. Click "Load unpacked"
7. Select the **inner extension folder** (the one containing manifest.json)
8. If you see "Manifest file is missing", you selected the wrong folder - go one level deeper

**Important:** You must select the folder that contains manifest.json, not the outer folder created by unzipping. 

## How to Use

1. Visit any e-commerce website
2. Browse products as normal
3. Look for circular score badges on product images
4. Hover over badges to see detailed information
5. Click the extension icon for stats and controls

## Score Guide

- **9-10:** Excellent Canadian contribution
- **7-8:** Good Canadian contribution
- **5-6:** Moderate Canadian contribution
- **3-4:** Limited Canadian contribution
- **1-2:** Minimal Canadian contribution

## Data Source

Product data is sourced from The CANADA List database at thecanadalist.ca, updated automatically every 24 hours.

## Privacy

The extension does not collect or transmit any personal data. It only reads product names from web pages to match against the local database. See PRIVACY_BRIEF.md for details.

## Support

For questions or issues, visit thecanadalist.ca or check the documentation in the /docs folder.