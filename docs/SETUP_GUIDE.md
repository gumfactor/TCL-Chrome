# Setup and Installation Guide

## Installing the Extension

**Step 1: Download and Extract**
- Download the extension ZIP file
- Right-click the ZIP file and select "Extract All"
- Open the extracted folder - you'll see another folder inside
- This inner folder is the actual extension folder

**Step 2: Open Chrome Extensions**
- Open Chrome browser
- Type `chrome://extensions/` in the address bar and press Enter
- Or click the three dots menu > Extensions > Manage Extensions

**Step 3: Enable Developer Mode**
- Look for "Developer mode" toggle in the top right
- Turn it ON

**Step 4: Load the Extension**
- Click "Load unpacked" button
- Navigate to the extracted folder
- Select the **inner folder** (the one that contains manifest.json file)
- Click "Select Folder"

**Troubleshooting "Manifest Missing" Error:**
If you see "Manifest file is missing or unreadable":
- You selected the outer folder instead of the extension folder
- Go back and select the folder inside the extracted folder
- The correct folder contains files like manifest.json, package.json, and a src folder

**Step 5: Verify Installation**
- You should see "The CANADA List" extension in your extensions list
- The extension icon appears in Chrome toolbar
- Pin the extension for easy access (click puzzle piece icon and pin)

## Using the Extension

**Automatic Detection:**
The extension works automatically on supported shopping sites. No setup needed.

**Manual Refresh:**
If product data seems outdated:
1. Click the extension icon
2. Click "Refresh Data" button
3. Data updates in the background

**Checking Status:**
Click the extension icon to see:
- Current data status
- Number of products in database
- Quick access to The CANADA List website

## Supported Websites

The extension automatically activates on e-commerce sites including:
- Amazon (amazon.ca, amazon.com)
- Walmart (walmart.ca)
- Best Buy (bestbuy.ca)
- Canadian Tire (canadiantire.ca)
- Loblaws family stores (nofrills, superstore, etc.)
- Shopify stores
- Any site with shopping cart or product pages

## Troubleshooting

**Badges not showing:**
- Refresh the page
- Check that you're on an e-commerce site
- Click extension icon to verify data is loaded

**Outdated information:**
- Click extension icon and refresh data
- Data updates automatically every 24 hours

**Extension not working:**
- Go to `chrome://extensions/`
- Check that the extension is enabled
- Try removing and reinstalling the extension

## Data Updates

The extension automatically checks for new data every 24 hours. You can manually refresh anytime from the popup menu.

## Uninstalling

1. Go to `chrome://extensions/`
2. Find "The CANADA List" extension
3. Click "Remove"
4. Confirm removal