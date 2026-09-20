# 🛒 Product Price Tracker

A full-stack product price tracking application that allows users to search products, track selected products, scrape their latest price and stock information, and maintain historical price records.

The application uses **React, Node.js, Express, Supabase, and Playwright** and is deployed using **Vercel and Render**.

---

## 🌐 Live Application

### Frontend

**https://product-scraper-ieuyfwr0n-sarthak-5945.vercel.app**

### Backend API

**https://product-scraper-117w.onrender.com**

### Target Store

**https://demo.inelabteamdev.com/**

---

## ✨ Features

* 🔎 Search products from the mock e-commerce store
* 📌 Track products for continuous monitoring
* 💰 Extract current product prices
* 🏷️ Extract original/MRP prices
* 📦 Detect stock availability
* 📈 Maintain historical price data
* 🔄 Retry failed scraping attempts
* 📝 Log every scraping attempt
* 🚫 Prevent failed scrapes from creating fake price history
* ⏰ Support scheduled scraping through an external cron service
* 🌐 Responsive React frontend
* ☁️ Cloud deployment using Vercel and Render
* 🗄️ Persistent data storage using Supabase

---

# 🏗️ System Architecture

```text
                         ┌─────────────────────┐
                         │    React Frontend   │
                         │       Vercel        │
                         └──────────┬──────────┘
                                    │
                                    │ REST API
                                    ▼
                         ┌─────────────────────┐
                         │  Node.js + Express  │
                         │       Render        │
                         └───────┬───────┬─────┘
                                 │       │
                    ┌────────────┘       └─────────────┐
                    ▼                                  ▼
          ┌──────────────────┐               ┌──────────────────┐
          │     Supabase     │               │    Playwright    │
          │    PostgreSQL    │               │ Browser Scraper  │
          └────────┬─────────┘               └────────┬─────────┘
                   │                                  │
                   │                                  ▼
                   │                         ┌──────────────────┐
                   │                         │   Mock Store     │
                   │                         │    INE Store     │
                   │                         └──────────────────┘
                   │
                   ▼
          ┌──────────────────┐
          │ Price History &  │
          │   Scrape Logs    │
          └──────────────────┘

                  External Cron
                       │
                       ▼
                 POST /scrape
```

---

# 🛠️ Tech Stack

| Layer               | Technology            |
| ------------------- | --------------------- |
| Frontend            | React + Vite          |
| Backend             | Node.js + Express     |
| Database            | Supabase / PostgreSQL |
| Web Scraping        | Playwright            |
| API                 | REST                  |
| Frontend Deployment | Vercel                |
| Backend Deployment  | Render                |
| Scheduled Jobs      | External Cron Service |
| Version Control     | Git + GitHub          |

---

# 📁 Project Structure

```text
scraper/
│
├── backend/
│   ├── src/
│   │   ├── server.js
│   │   ├── scraper.js
│   │   ├── productSearch.js
│   │   └── supabaseClient.js
│   │
│   ├── package.json
│   └── .env
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── ...
│
├── scrape.js
├── README.md
├── DESIGN.md
└── .gitignore
```

> **Note:** The `.env` file contains sensitive credentials and must never be committed to GitHub.

---

# 🔄 Application Workflow

## 1. Product Search

The user searches for a product from the React frontend.

```text
User
 ↓
React Frontend
 ↓
GET /search?q=...
 ↓
Express Backend
 ↓
Product Search Logic
 ↓
Mock Store
 ↓
Search Results
 ↓
Frontend
```

The user can select a product from the search results and add it to the tracking list.

---

## 2. Track a Product

When a product is selected, the frontend sends a request to the backend:

```text
Frontend
   ↓
POST /track
   ↓
Express Backend
   ↓
Supabase
   ↓
tracked_products
```

The product name and URL are stored in the database.

Duplicate products are rejected to avoid tracking the same product multiple times.

---

## 3. Scrape Product Information

When scraping is triggered, the backend retrieves the tracked products from Supabase.

For each product:

```text
Tracked Product
      ↓
Playwright Browser
      ↓
Open Product Page
      ↓
Handle Dynamic Content
      ↓
Wait for Price
      ↓
Extract Price / MRP / Stock
      ↓
Validate Result
      ↓
Store Result
```

Playwright is used because the target website contains dynamically rendered content and interactive page elements.

---

# 🔁 Retry & Failure Handling

Web scraping can fail temporarily due to:

* Slow page responses
* Dynamic content not being immediately available
* Temporary browser failures
* Network issues
* Unexpected page states

The scraper therefore uses multiple attempts before declaring a product scrape as failed.

Example:

```text
Attempt 1
   ↓
Failure
   ↓
Retry
   ↓
Attempt 2
   ↓
Failure
   ↓
Retry
   ↓
Attempt 3
   ↓
Success
```

The scraper reports three possible outcomes:

### `success`

The product was scraped successfully on the initial attempt.

### `retried`

The initial attempt failed, but a later retry successfully extracted the product data.

### `failed`

All available attempts failed.

---

# 🧾 Honest Failure Logging

A major design principle of the application is that **failed scraping attempts must not create fake price history**.

Every scraping operation is logged in:

```text
scrape_log
```

The log records information such as:

* Product ID
* Scrape status
* Number of attempts
* Error message
* Timestamp

Only successful scraping results are written to:

```text
price_history
```

This keeps the historical price data trustworthy.

```text
                  Scrape Result
                       │
              ┌────────┴────────┐
              │                 │
           Success            Failure
              │                 │
              ▼                 ▼
       price_history        scrape_log
              │
              ▼
        Valid Data Only
```

---

# 🗄️ Database Design

The application uses **Supabase PostgreSQL** for persistent storage.

## `tracked_products`

Stores products selected for tracking.

Typical fields:

```text
id
name
product_url
added_at
```

---

## `price_history`

Stores successfully scraped historical price information.

Typical fields:

```text
id
product_id
price
original_price
stock_text
stock_count
in_stock
scraped_at
```

A new price-history record is created only when the scraper successfully extracts valid product information.

---

## `scrape_log`

Stores the result of every scraping operation.

Typical fields:

```text
id
product_id
status
attempts
error_message
attempted_at
```

This allows failed scraping attempts to remain visible without contaminating the price history.

---

# 🔌 API Endpoints

## `GET /health`

Checks whether the backend is running.

### Response

```json
{
  "ok": true
}
```

---

## `GET /search?q=<query>`

Searches for products.

### Example

```text
GET /search?q=usb
```

### Response

```json
{
  "results": [...]
}
```

---

## `POST /track`

Adds a product to the tracking list.

### Request

```json
{
  "name": "Product Name",
  "url": "https://demo.inelabteamdev.com/product/..."
}
```

### Response

```json
{
  "product": {
    ...
  }
}
```

---

## `GET /products`

Returns all tracked products.

### Response

```json
{
  "products": [...]
}
```

---

## `POST /scrape`

Runs the scraper.

If no `productId` is provided, all tracked products are scraped sequentially.

### Request

```json
{}
```

To scrape a specific product:

```json
{
  "productId": 1
}
```

### Response

```json
{
  "scraped": 1,
  "results": [
    {
      "productId": 1,
      "name": "Product Name",
      "status": "success"
    }
  ]
}
```

---

## `GET /products/:id/history`

Returns the historical price information for a tracked product.

### Example

```text
GET /products/1/history
```

---

## `GET /products/:id/logs`

Returns the scraping logs for a tracked product.

### Example

```text
GET /products/1/logs
```

---

# ⏰ Scheduled Scraping

The backend exposes:

```text
POST /scrape
```

which can be called by an external cron service.

The endpoint accepts an empty JSON object:

```json
{}
```

When called without a product ID, the backend retrieves all tracked products and scrapes them sequentially.

```text
External Cron
      │
      │ Every 2 Hours
      ▼
POST /scrape
      │
      ▼
Render Backend
      │
      ▼
Supabase
      │
      ▼
Tracked Products
      │
      ▼
Playwright Scraper
      │
      ├──────────────► scrape_log
      │
      └──────────────► price_history
```

Sequential execution helps control memory usage because each scrape launches a Chromium browser instance.

---

# 🚀 Local Development

## Prerequisites

Install:

* Node.js
* npm
* Git

---

## 1. Clone the Repository

```bash
git clone https://github.com/sarthak-yeti/Product_scraper
cd scraper
```

---

# Backend Setup

Navigate to the backend:

```bash
cd backend
```

Install dependencies:

```bash
npm install
```

Install Playwright Chromium:

```bash
npx playwright install chromium
```

Create a `.env` file:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
PORT=3001
```

Start the backend:

```bash
npm start
```

The backend will run at:

```text
http://localhost:3001
```

---

# Frontend Setup

Open another terminal:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Configure the frontend environment variable:

```env
VITE_API_URL=http://localhost:3001
```

Start the development server:

```bash
npm run dev
```

Vite will provide the local frontend URL in the terminal.

---

# 🧪 Running the Scraper Directly

The standalone scraper can be executed locally for testing and demonstration.

Example:

```bash
node scrape.js https://demo.inelabteamdev.com/product/823 --headed --retries=5
```

The `--headed` option launches a visible Chromium browser.

This makes it possible to observe:

* Page loading
* Dynamic content
* Scraping attempts
* Retry behavior
* Price extraction
* Stock detection

Example workflow:

```text
Browser Opens
      ↓
Product Page Loads
      ↓
Scraping Attempt
      ↓
Temporary Failure
      ↓
Retry
      ↓
Successful Extraction
      ↓
Price + Stock Result
```

---

# ☁️ Deployment

## Frontend — Vercel

The React frontend is deployed on Vercel.

Production URL:

**https://product-scraper-ieuyfwr0n-sarthak-5945.vercel.app**

The frontend uses the following environment variable:

```env
VITE_API_URL=https://product-scraper-117w.onrender.com
```

---

## Backend — Render

The Express backend is deployed on Render.

Production URL:

**https://product-scraper-117w.onrender.com**

The backend uses Supabase environment variables configured through Render's environment settings.

Playwright Chromium is installed during deployment so the backend can perform browser-based scraping.

---

## Database — Supabase

Supabase provides the PostgreSQL database used by the application for:

* Tracked products
* Price history
* Scrape logs

---

# 🔐 Environment Variables

Environment variables are used to keep credentials and deployment configuration outside the source code.

### Backend

```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
PORT=3001
```

### Frontend

```env
VITE_API_URL=https://product-scraper-117w.onrender.com
```

### Security

Real `.env` files must **never** be committed to GitHub.

Recommended `.gitignore` entries:

```gitignore
node_modules/
.env
.env.*
!.env.example
dist/
*.log
```

---

# 📊 Reliability & Engineering Decisions

Several design decisions were made to improve reliability and deployment stability.

## Sequential Scraping

Products are scraped sequentially rather than launching multiple Chromium instances simultaneously.

This reduces memory consumption and makes the system more suitable for resource-constrained cloud environments.

## Retry Mechanism

Temporary failures are retried instead of immediately marking the product as unavailable.

This is useful for slow-loading or dynamically rendered pages.

## Explicit Waiting

The scraper waits for the required price content and page state instead of assuming that the price is available immediately after navigation.

## Failure Observability

Every scraping operation produces a corresponding entry in `scrape_log`.

This makes failures visible and easier to debug.

## No Fake Price History

A failed scrape does not generate an empty, zero, or fabricated price record.

Only valid successful results are stored in `price_history`.

---

# 🧠 AI-Assisted Development

AI tools were used during development as a programming and debugging assistant.

Generated code and approaches were tested against the actual target website rather than being accepted without verification.

Several issues were identified and corrected during development, including:

* Unnecessary browser fingerprint/anti-detection modifications
* Incorrect headed/headless browser configuration
* Price parsing failures caused by Unicode/full-width numeric characters
* Excessive debugging output containing sensitive request information
* Scraper behavior that needed to be adjusted based on the actual dynamic behavior of the target website

The final implementation was tested against the mock store and modified based on observed results.

Detailed engineering decisions, trade-offs, and corrections are documented separately in `DESIGN.md`.

---

# 📹 Demonstration

The project demonstration covers:

* Product search
* Product tracking
* Live application
* Headed Playwright execution
* Dynamic page interaction
* Handling a slow/failing scrape
* Retry mechanism
* Successful price extraction
* Stock detection
* Historical data storage
* Deployed frontend and backend

---

# 🔮 Future Improvements

Potential improvements include:

* Controlled concurrent scraping
* Authentication for scheduled scraping endpoints
* Price-drop notifications
* Email/Telegram/WhatsApp alerts
* Advanced price-history visualizations
* Automatic detection of significant price changes
* Scraper health monitoring
* Queue-based scraping
* Distributed scraping workers for larger workloads

---

# 👨‍💻 Project Summary

**Product Price Tracker** is a full-stack web application demonstrating:

* Frontend development with React
* REST API development with Node.js and Express
* Browser automation with Playwright
* PostgreSQL database integration through Supabase
* Retry and failure-handling strategies
* Cloud deployment
* Scheduled background scraping
* Historical data management

### Built With

**React • Vite • Node.js • Express • Playwright • Supabase • PostgreSQL • Vercel • Render**

---

## 📄 License

This project was developed as a technical assignment to demonstrate full-stack development, browser automation, database integration, reliability engineering, and cloud deployment.
