# Design & Engineering Notes

## Product Price Tracker

This document describes the engineering decisions, reliability strategies, debugging process, trade-offs, and AI-assisted development experience behind the Product Price Tracker.

The scraper was developed iteratively against the actual mock e-commerce website. Instead of assuming that the page behaved like a simple static HTML document, the implementation was tested repeatedly, failures were investigated, and the scraping workflow was adjusted based on the observed browser behavior.

---

## 1. Design Goals

The main goals of the scraper were:

- Reliably extract the current product price.
- Extract the original/MRP price when available.
- Detect stock availability.
- Handle dynamically rendered content.
- Handle hover-dependent page behavior.
- Handle cookie overlays that can block interaction.
- Handle price-reveal interactions.
- Wait for the price to reach a valid state before extraction.
- Retry temporary scraping failures.
- Log failures honestly.
- Prevent failed scrapes from creating fake price history.
- Keep memory usage reasonable in a cloud deployment.
- Provide a headed mode for debugging and demonstration.

---

## 2. Overall Architecture

The scraper is part of a full-stack application consisting of a React frontend, Express backend, Supabase database, Playwright scraper, and external scheduler.

```text
                    React Frontend
                         |
                         | REST API
                         v
                 Node.js / Express
                         |
              +----------+----------+
              |                     |
              v                     v
          Supabase             Playwright
          Database              Scraper
                                    |
                                    v
                              Mock Store

The backend retrieves tracked products from Supabase and processes them through Playwright.

For each product, the flow is:

Tracked Product
      |
      v
Launch Browser
      |
      v
Open Product Page
      |
      v
Handle Cookie Overlay
      |
      v
Perform Required Hover / Interaction
      |
      v
Reveal Price
      |
      v
Wait for Valid Price State
      |
      v
Extract Price / MRP / Stock
      |
      v
Validate Result
      |
      +----------------+
      |                |
      v                v
   Success          Failure
      |                |
      v                v
price_history     scrape_log
```
3. Why Playwright?

The target website contains dynamically rendered and interactive content.

The price could not always be reliably obtained by simply making an HTTP request and parsing the initial HTML.

The scraper needed to behave more like a real browser user by:

Loading JavaScript-driven content.
Moving the mouse over elements.
Clicking controls.
Waiting for dynamic updates.
Handling overlays.
Reading the final DOM state.

Playwright was therefore selected because it provides:

Real browser execution.
JavaScript execution.
DOM interaction.
Mouse movement and hover support.
Button interaction.
Explicit waiting.
Headed mode for debugging.
Headless mode for production deployment.
4. Main Scraping Challenge

One of the biggest challenges was that the price was not always immediately available after navigating to the product page.

A simple approach would be:

Open page
   |
   v
Find price element
   |
   v
Read text

This was not reliable.

The actual scraping flow needed to account for the state of the page:

Open Page
   |
   v
Wait for Page Content
   |
   v
Handle Cookie Overlay
   |
   v
Locate Price Section
   |
   v
Trigger Required Interaction
   |
   v
Wait for Price Update
   |
   v
Extract Price
   |
   v
Validate Result

This was one of the main differences between the initial implementation and the final reliable implementation.

5. Hover-Based Price Behaviour

The price section of the website required interaction before the expected price state could be obtained.

One of the issues discovered during testing was that simply locating the price element was not enough.

The scraper therefore performs a mouse interaction over the relevant price block.

Conceptually:

Locate Price Block
       |
       v
Move Mouse Over Price Block
       |
       v
Website Changes State
       |
       v
Price Becomes Available
       |
       v
Wait
       |
       v
Extract Price

This was important because reading the element too early could return incomplete or transitional content.

The final scraper therefore reproduces the interaction required by the website rather than treating the price as static HTML.

6. Cookie Overlay Handling

Another practical problem was the cookie-consent overlay.

A cookie overlay can cover the underlying page and prevent Playwright from interacting with elements underneath it.

This means that even if Playwright successfully locates the price element, a hover or click can still fail because another element is covering it.

The scraper therefore attempts to detect and dismiss the cookie overlay before continuing with the main interaction sequence.
```
Page Loaded
     |
     v
Cookie Overlay?
     |
   +-+-+
   |   |
  Yes  No
   |    |
   v    |
Dismiss |
   |    |
   +----+
      |
      v
Continue Scraping
```
This improved the reliability of subsequent hover and click operations.

7. Price Reveal Button

The page also contained a price-reveal interaction.

An early scraping approach assumed that the final price would already be available once the page loaded.

Testing showed that this assumption was not always correct.

The scraper therefore handles the reveal interaction before attempting to read the final price.

The resulting flow is:
```
Locate Price Section
       |
       v
Find Reveal Control
       |
       v
Trigger Reveal
       |
       v
Wait for Price
       |
       v
Validate Price
       |
       v
Extract
```
This changed the scraping approach from:

Find -> Read

to:

Find -> Interact -> Wait -> Validate -> Read
8. Dynamic "Updating" State

Another issue was that the price could temporarily be in an updating state.

For example:

Updating...

could appear before the actual numeric price.

If the scraper attempted to parse the value immediately, it could incorrectly treat the page as a failed scrape.

The scraper therefore waits until the price reaches the expected successful state before extracting it.
```
Price Element Found
       |
       v
Still Updating?
       |
   +---+---+
   |       |
  Yes      No
   |        |
   v        v
 Wait     Extract
   |
   +-------->

This prevents timing-related failures caused by reading the DOM too early.
```
9. Price Parsing and Unicode Handling

One of the real issues discovered during testing was unexpected Unicode formatting in price values.

A scrape attempt returned price text containing full-width Unicode digits rather than normal ASCII digits.

For example, the page could visually represent a value similar to:

₹３２,０２０

A parser based only on ASCII digits could fail even though the displayed price was valid.

The parser was therefore updated to normalize Unicode text before processing it.

The important step is:

rawText.normalize("NFKC")

The parsing flow became:
```
Raw Price Text
      |
      v
Unicode Normalization
      |
      v
Remove Invisible Characters
      |
      v
Clean Numeric Characters
      |
      v
Handle Separators
      |
      v
Convert to Number
```
This made the price parser more tolerant of unexpected Unicode representations.

10. Invisible Character Handling

The price text could also contain invisible Unicode characters.

These characters are not visible to the user but can interfere with numeric parsing.

The scraper therefore removes common zero-width characters before extracting the numeric value.

This gives:
```
Raw Browser Text
      |
      v
Remove Invisible Characters
      |
      v
Normalize Unicode
      |
      v
Parse Price
```
This was an example of an issue that was difficult to identify from the visual page alone but became obvious when inspecting the actual text returned by Playwright.

11. Retry Strategy

Web scraping is inherently subject to temporary failures.

Possible causes include:

Slow responses.
Dynamic content timing.
Browser errors.
Unexpected page states.
Temporary network problems.
Unexpected text formats.

Instead of treating the first failure as permanent, the scraper retries the operation.

The standalone scraper supports a configurable retry count.

Example:

node scrape.js https://demo.inelabteamdev.com/product/823 --headed --retries=5

The retry flow is:
```
Attempt 1
   |
   +-- Success ------> Return Result
   |
   +-- Failure
          |
          v
        Wait
          |
          v
      Attempt 2
          |
          +-- Success ------> Return Result
          |
          +-- Failure
                 |
                 v
               Retry
                 |
                 v
          Maximum Attempts
                 |
          +------+------+
          |             |
        Success       Failure
          |             |
          v             v
       Return        Log Failure
```
The scraper reports:

success

The product was scraped successfully on the first attempt.

retried

The first attempt failed, but a later attempt succeeded.

failed

All available attempts failed.

12. Real Retry Example

During testing, the scraper produced a real first-attempt failure because the price text contained unexpected Unicode digits.

A later attempt successfully extracted the product information.

The successful result looked like:

{
  "status": "retried",
  "price": 32020,
  "originalPrice": 57179,
  "stockText": "OUT OF STOCK",
  "stockCount": null,
  "inStock": false,
  "attempts": 4
}

This demonstrated the value of retry handling.

Instead of immediately reporting the product as failed, the scraper was able to recover and obtain a valid result.

13. Honest Failure Logging

A major design decision was separating scrape attempts from valid price history.

Every scraping operation creates a record in:

scrape_log

However, only successful results are inserted into:

price_history

The flow is:

                  Scrape
                    |
           +--------+--------+
           |                 |
        Success            Failure
           |                 |
           v                 v
    price_history         scrape_log
           |
           v
       Valid Data

This prevents failed scraping attempts from creating misleading historical records.

For example, the system does not insert:

price = 0

or an empty price simply because the scraper failed.

The historical dataset therefore represents actual successful observations.

14. Sequential Scraping

The backend currently processes products sequentially.

Conceptually:

for (const product of productsToScrape) {
    const result = await scrapeProduct(product.product_url);
}

This was a deliberate engineering trade-off.

Alternative: Parallel Scraping

Multiple products could be scraped simultaneously:

Product 1 ---> Chromium
Product 2 ---> Chromium
Product 3 ---> Chromium
Product 4 ---> Chromium

This could reduce the total scraping time.

However, each Playwright scrape launches a Chromium browser and consumes memory.

Running many browser instances simultaneously could cause significant memory pressure on a limited cloud deployment.

The current design therefore prioritizes:

Reliability + Memory Safety

over:

Maximum Parallelism

For the current number of tracked products, sequential scraping is a reasonable trade-off.

15. Headed vs Headless Mode

Two different modes are used.

Production Mode

The Render backend runs Playwright in headless mode:

const browser = await chromium.launch({
    headless: true
});

This is appropriate for server-side execution because no graphical desktop is required.

Development and Demonstration Mode

The standalone scraper supports headed mode:

node scrape.js https://demo.inelabteamdev.com/product/823 --headed --retries=5

The browser becomes visible.

This was particularly useful while debugging because it allowed direct observation of:

Cookie overlays.
Hover behavior.
Price reveal controls.
Loading states.
Dynamic page changes.
Unexpected browser behavior.

Headed mode was therefore used as a debugging tool, while headless mode is used for deployment.

16. What AI Tools Got Wrong Initially

AI-assisted development was used throughout the project.

However, generated code was treated as a starting point rather than as a guaranteed solution.

Several initial approaches failed when tested against the actual website.

The main lesson was:

Generated code can provide a strong starting point, but browser automation must be validated against the real page behavior.

The main issues discovered and corrected were:

Treating the price as static HTML.
Missing the required hover interaction.
Not handling the cookie overlay.
Not handling the price-reveal interaction.
Reading the price while it was still updating.
Incorrect headed/headless configuration.
Unexpected Unicode price formatting.
Unnecessary anti-detection logic.
Excessive debugging output.
17. Initial Mistake: Treating Price as Static HTML

The initial approach assumed that the price could be extracted immediately after navigation.
```
Navigate
   |
   v
Locate Price
   |
   v
Read Text
Problem
```
The actual page used dynamic and interactive behavior.

Correction

The scraper was modified to:
```
Navigate
   |
   v
Handle Overlay
   |
   v
Hover / Interact
   |
   v
Reveal Price
   |
   v
Wait
   |
   v
Validate
   |
   v
Extract
```
18. Initial Mistake: Missing Hover Behaviour

A simple locator-based implementation could locate the price block but still fail to retrieve the correct final value.

Problem

The website expected interaction with the price section.

Correction

The scraper explicitly performs the required hover operation before extraction.

This was discovered through headed browser testing.

19. Initial Mistake: Ignoring the Cookie Overlay

The initial implementation did not sufficiently account for the cookie overlay blocking interaction.

Problem

Playwright could locate the intended element but interaction could still fail because the overlay was covering it.

Correction

Cookie handling was added before performing the main hover and click interactions.

20. Initial Mistake: Missing the Price Reveal Interaction

The initial implementation assumed that finding the price container was enough.

Problem

The actual page required a reveal action before the final price became available.

Correction

The scraper was changed to trigger the reveal control and then wait for the price to become valid.

The final logic became:
```
Find
 |
 v
Interact
 |
 v
Wait
 |
 v
Validate
 |
 v
Read
```
21. Initial Mistake: Incorrect Headed/Headless Configuration

During development, there was an issue where headed mode was requested but the browser launch configuration still forced headless execution.

The corrected approach is:

const headed = process.argv.includes("--headed");

const browser = await chromium.launch({
    headless: !headed
});

This means:
```
--headed
   |
   v
headless = false
   |
   v
Visible Browser

Without --headed:

headless = true
```
This was important for the required headed-mode demonstration.

22. Initial Mistake: Unnecessary Anti-Detection Logic

An earlier AI-generated implementation included unnecessary browser fingerprint and automation-detection modifications.

These included attempts to modify:

WebGL information.
Navigator properties.
Automation-related browser flags.
Request headers.

These changes were not required for the assignment and added unnecessary complexity.

Correction

The anti-detection/fingerprint spoofing logic was removed.

The final scraper focuses on:
```
Normal Browser
+
Correct Page Interaction
+
Correct Waiting
+
Robust Parsing
+
Retries
```
This resulted in a simpler and more maintainable implementation.

23. Initial Mistake: Excessive Debug Output

During debugging, request and browser information was printed to the terminal.

Although useful during development, this created noisy output and could potentially expose sensitive information such as authorization headers.

Correction

The final operational logging focuses on:

Attempt
Failure
Retry
Success
Price
Stock
Final Status

Sensitive request information is not necessary for normal scraper operation or demonstration.

24. Development Process

The scraper was developed through repeated testing rather than a single implementation attempt.

The process was:
```
AI-generated implementation
          |
          v
Run against actual website
          |
          v
Observe failure
          |
          v
Inspect browser / terminal output
          |
          v
Identify actual cause
          |
          v
Modify implementation
          |
          v
Run again
          |
          v
Discover another edge case
          |
          v
Fix
          |
          v
Repeat
          |
          v
Reliable scraper
```
This process was particularly important because several issues were related to browser state and interaction rather than simple syntax or API errors.

25. Reliability Layers

The final implementation uses multiple reliability layers.
```
+---------------------------------------+
|        Browser Interaction            |
| Cookie / Hover / Reveal / Click       |
+-------------------+-------------------+
                    |
                    v
+---------------------------------------+
|        Dynamic State Handling         |
|     Wait for valid price state        |
+-------------------+-------------------+
                    |
                    v
+---------------------------------------+
|        Text Normalization             |
|      Unicode + invisible chars        |
+-------------------+-------------------+
                    |
                    v
+---------------------------------------+
|             Validation                |
|      Verify extracted information     |
+-------------------+-------------------+
                    |
                    v
+---------------------------------------+
|              Retries                  |
|       Recover from failures           |
+-------------------+-------------------+
                    |
                    v
+---------------------------------------+
|        Honest Persistence             |
| Success -> history / Failure -> log   |
+---------------------------------------+
```
The reliability of the scraper does not depend on a single technique.

It comes from combining browser interaction, explicit waiting, normalization, validation, retries, and correct persistence behavior.

26. Deployment Trade-offs

The application uses:

Frontend  -> Vercel
Backend   -> Render
Database  -> Supabase
Scheduler -> cron-job.org

This architecture separates the main responsibilities of the system.

The major deployment constraint is resource usage.

Playwright requires a real browser, and Chromium can consume significant memory.

Therefore, the backend uses:

Headless Chromium in production.
Sequential scraping.
Retry logic instead of uncontrolled parallel execution.
External scheduling.
Database-backed persistence.

This keeps the system simple enough to deploy while still providing the required functionality.

27. Why External Cron Instead of setInterval()?

A possible implementation would be:

setInterval(
    scrapeAllProducts,
    2 * 60 * 60 * 1000
);

However, this would depend on the backend process remaining alive continuously.

A cloud service may restart or sleep, which would interrupt an in-process timer.

Instead, the backend exposes:

POST /scrape

and an external cron service triggers it every two hours.

The flow is:
```
cron-job.org
      |
      | Every 2 Hours
      v
POST /scrape
      |
      v
Render Backend
      |
      v
Tracked Products
      |
      v
Playwright
```
This makes scheduling independent of the backend process.

28. Data Integrity vs Availability

One of the main design decisions was choosing data integrity over filling every scheduled time slot.

Suppose a product cannot be scraped during one scheduled run.

The system does not insert:

price = 0

or:

price = null

into historical price data.

Instead:
```
Scrape Failure
      |
      v
scrape_log
      |
      v
No price_history entry
```
This can result in gaps in the historical timeline, but every price stored in price_history represents a real successful observation.

For a price-tracking application, this is more useful than a complete but unreliable dataset.

29. Current Limitations

The current implementation intentionally keeps the architecture relatively simple.

Known limitations include:

Products are scraped sequentially.
Each scrape launches a Chromium browser.
The scraper depends on the current DOM and behavior of the target mock store.
Major changes to the website could require selector updates.
The scheduled endpoint is currently simple and relies on the external scheduler.
There is no distributed scraping queue.
There are no price-drop notifications.

These limitations are acceptable for the current project scale.

30. Possible Future Improvements

If the number of tracked products increased significantly, the architecture could evolve toward a queue-based worker system.

                API
                 |
                 v
              Job Queue
                 |
       +---------+---------+
       |         |         |
       v         v         v
    Worker 1  Worker 2  Worker 3
       |         |         |
       v         v         v
    Browser   Browser   Browser

Possible improvements include:

Controlled concurrency.
Browser/context reuse.
Queue-based workers.
Scraper health monitoring.
Automatic selector fallback.
Price-drop notifications.
Email or messaging alerts.
Detailed execution metrics.
Authentication for scheduled endpoints.
Dedicated worker infrastructure.

Controlled concurrency would be preferred over unrestricted parallel scraping to avoid excessive Chromium memory usage.

31. Final Engineering Philosophy

The final scraper follows a simple principle:

Do not assume the website behaves ideally. Observe its actual behavior, handle the interaction required by the page, validate the extracted data, and record failures honestly.

The most important improvements came from the development cycle:
```
Observe
   |
   v
Test
   |
   v
Fail
   |
   v
Understand Why
   |
   v
Fix
   |
   v
Test Again
   |
   v
Keep the Simplest Reliable Solution
```
The final implementation combines:

Browser automation.
Cookie handling.
Hover interaction.
Price reveal interaction.
Dynamic-state waiting.
Unicode normalization.
Invisible-character cleanup.
Price validation.
Retry handling.
Honest failure logging.
Sequential execution.
Headless production execution.
External scheduled execution.

The result is a scraper that is not designed around an idealized webpage, but around the actual behavior observed during testing.

32. Summary of Key Engineering Decisions
Problem	Initial Approach	Final Solution
Dynamic price	Read immediately	Wait for valid state
Hover behavior	Static extraction	Explicit mouse hover
Cookie overlay	Ignore overlay	Detect and dismiss
Price reveal	Assume price visible	Trigger reveal interaction
Updating state	Parse immediately	Wait for final state
Unicode price	ASCII-only parsing	Unicode normalization
Invisible characters	Not handled	Remove before parsing
Temporary failures	Single attempt	Retry mechanism
History on failure	Risk of invalid data	Log failure only
Multiple products	Parallel browsers	Sequential scraping
Production browser	Visible browser	Headless Chromium
Debugging	Terminal only	Headed browser testing
Anti-detection	Complex spoofing	Removed unnecessary logic
Scheduling	In-process timer	External cron
Debug output	Excessive request data	Focused operational logs
Conclusion

The scraper's reliability came primarily from iterative testing against the actual target website.

AI tools were valuable for generating initial implementations, suggesting Playwright patterns, and helping debug problems. However, the generated code was repeatedly tested against real browser behavior, and several assumptions had to be corrected.

The final design favors:

Reliability, data integrity, observability, and simplicity

over unnecessary complexity or maximum scraping speed.

This resulted in a practical scraper that can handle interactive page behavior, temporary failures, dynamic price rendering, and resource constraints while maintaining trustworthy price history.
