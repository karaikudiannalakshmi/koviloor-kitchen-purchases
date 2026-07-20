# Annalakshmi Kitchen — Purchase Ledger

The purchase manager's bible for **Karaikudi Annalakshmi Kitchen**: enter every grocery &
vegetable bill, keep vendor + ingredient masters, and see month-wise totals, per-ingredient
price trends, and a top-5 dashboard.

Stack: **React + Vite → GitHub → Vercel**, **Firebase Firestore** backend.
Same conventions as your other apps (password gate → `signInAnonymously` → rules `auth != null`,
`vercel.json` build-command fix, plain `VITE_` env vars).

## Features
- **Categories master** — define your own purchase groups (Vegetable, Leaf, Grocery, Dairy, Masala, Oil…),
  each with a colour and a "usually on credit" flag that drives the bill payment default.
- **Vendor master** — name, supplies, phone, address.
- **Ingredient master** — Tamil name + phonetic/English search alias, category, default unit.
- **Bill entry** — multi-line item editor, qty + rate **or** qty + amount (the other auto-fills), a single bill-level **GST** (% or ₹, split across items by value) that feeds the true cost/kg, live total.
  A **Paid / Unpaid** toggle (with a *Paid on* date) tracks settlement; bills default to **Paid**,
  but an all-vegetable/leaf bill auto-suggests **Unpaid** (since those are usually on credit).
- **Bills Ledger** — two views:
  - *By month*: consolidated **by vendor** (collapsible); click a vendor → its bills, click a bill →
    its items. Each bill shows a Paid/Unpaid chip, vendor bars show any unpaid amount, and a
    one-tap **Mark paid** settles a bill. Edit / delete inline.
  - *Unpaid (settlement)*: every outstanding bill across all time, grouped by vendor with totals,
    bill age in days, **Mark paid** per bill and **Settle all** per vendor.
- **Ingredient Ledger**
  - *Month roll-up*: every ingredient bought this month with total qty, avg rate, total spent.
  - *Single ingredient*: pick an item + date range → every purchase line + **price-trend chart**
    + min/avg/max rate.
- **Dashboard** — total / per-category spend, Top items (filterable by category), 6-month spend trend.
- **Reports everywhere** — every report (Dashboard, Bills Ledger, Ingredient Ledger, Settlement) has
  **Print**, **Export to Excel** (.xlsx), and **Export to PDF** buttons. Excel/PDF libs are lazy-loaded.

## Setup
1. Create a Firebase project (e.g. `kal-purchases`). Enable **Firestore** and **Anonymous Auth**
   (Authentication → Sign-in method → Anonymous → Enable).
2. Paste the rules from `firestore.rules` into Firestore → Rules → Publish.
3. `npm install`
4. Copy `.env.example` to `.env` and fill in the Firebase web config + a `VITE_APP_PASSWORD`.
5. `npm run dev`

## Deploy (Vercel)
- Push to GitHub (`karaikudiannalakshmi/...`), import into Vercel.
- Add every `VITE_*` var from `.env.example` as **Environment Variables** — set them as
  **plain (non-sensitive)** so Vite can inline them at build time.
- `vercel.json` already pins the build command and SPA rewrites.

## Firestore shape
```
categories   { key, name, color, creditDefault, order, createdAt }
vendors      { name, phone, address, type, active, createdAt }
ingredients  { name, search, category, unit, active, createdAt }
bills        { vendorId, vendorName, billNo, billDate:'YYYY-MM-DD', monthKey:'YYYY-MM',
               items:[{ ingredientId, name, category, unit, qty, rate, amount }],
               totalQty, totalAmount, notes, paid, paidDate:'YYYY-MM-DD'|'', createdAt }
```
`billDate` is a sortable string so date-range queries need no composite index. Month roll-ups
query by `monthKey ==`. Price trends read N months (one query each).

## Note
If you want to reuse an existing Firebase project instead of a new one, prefix the three
collection names in `src/lib/db.js` (e.g. `kal_vendors`, `kal_ingredients`, `kal_bills`).
