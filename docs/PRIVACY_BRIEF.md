# Privacy and Data Handling

## What Data the Extension Accesses

**Product Names:**
The extension reads product names from web pages to match them against The CANADA List database.

**Website Content:**
The extension scans product listings on e-commerce sites to detect products and inject score badges.

## What Data the Extension Does NOT Collect

- No browsing history
- No personal information
- No purchase data
- No tracking cookies
- No analytics or usage statistics

## How Data is Stored

**Local Storage Only:**
All product data is stored locally on your device in Chrome's storage. Nothing is sent to external servers except the initial database download.

**Database Updates:**
The extension downloads The CANADA List database from thecanadalist.ca once every 24 hours. This is a public dataset and contains no personal information.

## Chrome Permissions Explained

**Storage Permission:**
Required to cache The CANADA List database locally so the extension works offline and loads quickly.

**Host Permissions (http://*/* and https://*/*):**
Required to detect products and show badges on any shopping website you visit. The extension only activates on e-commerce sites.

**Alarms Permission:**
Used to schedule automatic database updates every 24 hours.

## Data Transmission

**What Gets Sent:**
- One request every 24 hours to download the public product database from thecanadalist.ca
- No other data is transmitted

**What Stays Local:**
- All product matching happens on your device
- Product names you view are never sent anywhere
- Your shopping activity is completely private

## Third Party Access

The extension does not share any data with third parties. It operates entirely locally after downloading the public database.

## Session Data

The extension uses browser session storage to remember which notifications you've already seen during your browsing session. This data is cleared when you close the browser tab.

**Notifications:**
The extension shows a brief notification when it activates on an e-commerce site. This notification appears once per browsing session to let you know the extension is working. If you visit a website that's in The CANADA List database, you'll also see a notification with the site's score. These notifications use session storage to avoid showing repeatedly on the same site during your session.

## Your Control

**Disable Anytime:**
You can disable or remove the extension at any time from `chrome://extensions/`

**Data Deletion:**
Removing the extension automatically deletes all local data it stored.

**No Account Required:**
The extension works without any login or account creation.

