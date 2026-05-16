# The CANADA List Chrome Extension

Chrome extension that displays CANADA Scores on e-commerce product listings to help Canadian consumers shop Canadian-owned products.

## Quick Start
1. Load extension in Chrome developer mode
2. Visit supported e-commerce sites (Amazon.ca, Walmart.ca, etc.)
3. Look for circular score badges on products

## To Do list for Developers
- [ ] Improve badge loading speed and responsiveness
- [ ] Expand e-commerce site coverage
- [ ] Some products on the list have their own specialized websites (for example clothing brand Bonnetier has a dedicated ecommerce site, we can globally give every product on that website their CANADA score and for all other products with their own ecommerce site) maybe brand match from the list with any websites we visit is the approach. 
- [ ] Fix inconsistent product scoring and inaccurate descriptions
- [ ] Fix badge injection positioning (sometimes injects in wrong places)
- [ ] Improve keyword matching accuracy (currently matches similar products incorrectly)
- [ ] Make badge design more sleek and refined (currently too subtle)
- [ ] Add popup notification when extension is active on website
- [ ] Research Honey extension design patterns and best practices
- [ ] Research privacy guidelines and end-user concerns
- [ ] Create a way to recommend, redirect and guide users to more "Canadian" products (eg. if they search up tvs, refer them to Canadian TVs, (maybe a small banner that pops up that users can click on and see recommended Canadian products)
- [ ] Extension is running on all websites, need to restrict it to only run globally on ecommerce sites 
- [ ] Fix badge overlapping website elements (When I scroll down the product page the badge scores from previous badges stay on the page so it overlaps search bar and clutters screen, overlapping page elements, etc.), also random badge scores are being injected in random places but not the actual product container (seen some cases of random floating badges, some badges being injected on page sorting filters, 2 badges of the same badge above and below a product container creating duplicate badges, bunch of messy badge injections)
- [ ] When opening a page sometimes data doesnt load (it fixes when I refresh the data of the extension and then refresh the page) Maybe when opening a new page data automatically refreshed so data loads properly so the badges can load properly? Maybe another approach needed? 
- [X] Expand e-commerce site coverage 
- [X] Debug logging: Added detailed logging to track time it takes for badge to load and tracks successfuly injected badges without comprimising page load times 

*Work in progress - documentation and features being actively developed.*
