# Ledgerline

A bookkeeping prototype for small businesses, built by Pomeroy Agency. It runs entirely in the browser with no dependencies.

## What it does

- Company setup by principal place of business (US states, Canada, UK, Ireland, Australia, New Zealand). This sets currency, tax labels, import date format, and a chart of accounts suited to the entity type.
- Double-entry general ledger in integer cents. Entries must balance, posted entries are corrected only by reversal, and periods can be closed.
- Invoices with sales tax, VAT or GST, bills, partial payments, and aging.
- Bank CSV import with duplicate detection and suggested matches, plus bank reconciliation.
- Profit and loss, balance sheet, trial balance, general ledger, aging and audit trail reports, with CSV export.

## Layout

| Path | Contents |
| --- | --- |
| `src/engine.js` | Pure accounting logic, no DOM. Start here. |
| `src/sample.js` | Fictional example company shown on first load |
| `src/app.js` | UI, storage and event handling |
| `src/style.css` | Styles, light and dark themes |
| `test/engine.test.js` | Tests for the ledger engine |
| `scripts/build.sh` | Bundles everything into `dist/` |
| `supabase/migrations/` | Database tables and access rules |
| `supabase/tests/` | Access-rule checks run against local Postgres |
| `vendor/supabase-js/` | Supabase browser client, vendored so the app has no CDN dependency |

## Develop

```sh
npm test              # ledger engine tests
npm run test:db       # database access rules, against a throwaway local Postgres
npm run test:browser  # sign-in, saving and conflicts in a real browser against a fake Supabase API (needs playwright)
npm run build         # writes dist/ (see below)
```

`npm run build` writes `dist/index.html` for static hosting and `dist/artifact.html` for publishing as a claude.ai Artifact. Without Supabase settings, `dist/index.html` saves to the visitor's browser only. Open it directly to try the app locally.

## Accounts and database (Supabase)

With Supabase connected, people create an account, sign in, and their companies are stored in a Postgres database. Row-level security means each person only sees companies they belong to. Every company has an owner, and the schema is ready for owners to add an accountant, bookkeeper or view-only member (the invite screen is not built yet).

Each company's books are stored as one JSON document with a version number. A save only succeeds if nobody else saved since the page loaded; otherwise the app reloads the latest version and says so.

### One-time setup

1. Create a free project at [supabase.com](https://supabase.com). Choose a strong database password and a region near your clients.
2. In the project, open **SQL Editor**, paste the contents of `supabase/migrations/20261024000000_accounts.sql`, and run it.
3. Open **Authentication > URL Configuration** and set **Site URL** to your Netlify address (for example `https://ledgerline.netlify.app`). Add the same address under **Redirect URLs**.
4. Open **Project Settings > API** and copy the **Project URL** and the **anon public** key.
5. In Netlify, open **Site configuration > Environment variables** and add `SUPABASE_URL` and `SUPABASE_ANON_KEY` with those values. Redeploy.

The anon key is meant to be public, because the access rules in the database do the protecting. Never put the **service_role** key in Netlify or in this repository.

## Deploy to Netlify

Connect this repository in Netlify. `netlify.toml` already sets the build command, the publish folder and security headers. Add the two Supabase variables above to turn on accounts.

## Before real clients use it

This is a prototype. Before production it still needs relational ledger tables (so the server, not the browser, enforces balanced entries), invites and roles in the app, live bank feeds through an aggregator, a tax rate engine, encryption and a security audit such as SOC 2. A CPA, a tax adviser and counsel should review the account templates, statement presentation, tax handling, data privacy and record retention for each jurisdiction. Nothing here makes the product compliant with GAAP, IFRS or tax law on its own.
