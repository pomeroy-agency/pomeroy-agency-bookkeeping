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

## Develop

```sh
npm test          # run the ledger tests
npm run build     # writes dist/index.html (static hosting) and dist/artifact.html (claude.ai Artifact)
```

Open `dist/index.html` in a browser to use it locally.

## Deploy to Netlify

Connect this repository in Netlify. `netlify.toml` already sets the build command and publish folder. On Netlify the app saves to each visitor's browser only. Shared, durable storage needs a backend (see below).

## Before real clients use it

This is a prototype. Production needs a server database with user accounts and roles, live bank feeds through an aggregator, a tax rate engine, encryption and a security audit such as SOC 2. A CPA, a tax adviser and counsel should review the account templates, statement presentation, tax handling, data privacy and record retention for each jurisdiction. Nothing here makes the product compliant with GAAP, IFRS or tax law on its own.
