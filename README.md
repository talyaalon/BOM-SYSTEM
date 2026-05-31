# BOM-SYSTEM

# The Kosher Place — Recipe Book & BOM Management System

A full-stack web application for managing food recipes, calculating costs, and pricing products in a food business. The system integrates with **Odoo ERP** to pull real-time product data, lets admins build nested recipes with automatic cost calculation, and provides customers with an interactive recipe book that scales ingredient quantities to any production batch size.

---

## What It Does

- **Syncs raw materials from Odoo ERP** — names, prices, weights, categories, and images flow in automatically via XML-RPC.
- **Builds recipes** — admins create base recipes (sauces, batters) and final products. Base recipes can be nested as ingredients in other recipes, with recursive cost calculation through any depth.
- **Calculates pricing automatically** — every recipe gets a cost-per-kg, wholesale price, and retail price based on configurable formulas. One formula is set as the default; individual recipes can override it.
- **Lets customers plan production** — pick a recipe, enter "I want to produce 50 kg", and get a fully scaled ingredient list with totals and a printable prep sheet.
- **Traces ingredient usage** — search any product to see every recipe that uses it.
- **Enforces role-based access** — admins manage everything; customers see the recipe book and calculator only, with prices hidden by default.

---

## Tech Stack

**Frontend:** React 18 · TypeScript · Vite · React Router v6 · TanStack Query · Zustand
**Backend:** Node.js · Express · PostgreSQL
**Integrations:** Odoo ERP (XML-RPC) · JWT auth · node-cron

---

## Key Features

- 📦 **Odoo product sync** with bilingual names (EN/HE), image storage, and a regex fallback that extracts weight from product names when Odoo's weight field is empty
- 🧮 **Recursive cost engine** with cycle protection — nested recipes are folded in correctly
- 💰 **Default + override pricing model** — simple, predictable, with a graceful fallback when a manually selected formula is deleted
- 📖 **Customer recipe book** with search, filters, and a built-in production calculator that scales every ingredient (including nested sub-recipes)
- 🖨️ **Printable prep sheets** with an aggregated shopping list on a separate page
- 🔐 **Three-state price visibility** — per-user override on top of role default; price stripping enforced server-side, not just hidden in the UI
- 📝 **Audit log** — every login, user change, formula change, sync, and calculation is recorded with IP and timestamp
- 💾 **Draft persistence** — in-progress recipes survive screen navigation and browser refreshes
- 🌐 **Bilingual UI** (English / Hebrew with full RTL support)

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Odoo ERP credentials (for full functionality)

### Install

```bash
git clone <repo-url>
cd <repo>
npm install
cd client && npm install && cd ..
```

### Configure

```bash
cp .env.example .env
# Fill in DB_*, ODOO_*, and JWT_SECRET values
```

### Run

```bash
npm run db:migrate   # Apply database schema (idempotent — safe to re-run)
npm run dev          # Start backend (port 3000) and Vite dev server (port 5173)
```

Open `http://localhost:5173` and log in with your Odoo credentials.

For local development without an Odoo connection, set `ALLOW_DEV_LOGIN=true` in `.env` and use `DEV_ADMIN_USER` / `DEV_ADMIN_PASSWORD` to log in as an admin.

---

## Architecture Highlights

- **Unified item model** — recipes and raw materials live in a single `items` table differentiated by `item_type`, which is what makes nested recipes and recursive costing possible.
- **Two weight fields by design** — `yield_kg` is the costing denominator (and what the calculator scales by), while `total_weight` is the consumer-facing net weight. Keeping them separate handles cooking loss / shrinkage correctly.
- **Snapshot + live pricing** — recipe cards show stable snapshot prices saved at the time of edit, but every read endpoint queries the live pricing resolver, so formula changes take effect immediately without re-saving every recipe.
- **Server-side enforcement** — all role checks and price-field stripping happen in middleware on the backend. The UI is a thin layer over a properly guarded API.

---

## Project Structure

```
src/                    Backend (Node.js + Express)
├── routes/             API endpoints
├── services/           Business logic (Odoo sync, costing, pricing, calculation)
├── middleware/         Auth, role enforcement, price stripping
├── db/                 Schema + migration runner
└── utils/              Helpers (weight extraction, price visibility)

client/src/             Frontend (React + TypeScript)
├── components/         UI components per feature
├── stores/             Zustand stores (with persist for drafts)
├── hooks/              Reusable hooks (numeric-safe cost summary, etc.)
├── api/                Typed API client
└── context/            i18n (EN/HE)
```

---

## License

Private project. All rights reserved.
