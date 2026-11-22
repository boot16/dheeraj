# Dheeraj ERP rebuild

Entry point after Firebase deployment: /erp/

This is a separate, empty test workspace at erp/main. The previous app uses wholesale/main. Both use the same owner authentication and the owner UID in wholesaleAccess/owner. The root page has a link to the rebuild.

## Available workflows

- Item create/edit, individual stock unit, optional packing table and prices per pack.
- Separate opening stock with valuation and traceable stock movements.
- Customer/supplier profiles, customer area/address and agreed item-unit rates.
- Purchase and direct-sale tables with selected units, free purchase quantities, discounts and live totals.
- Orders, partial dispatch, linked invoice and delivery confirmation.
- Party ledgers with payments allocated to a chosen bill or oldest open bills.
- Customer and supplier returns against original lines, credit or immediate refund.
- Expenses, visit tasks, date-specific reports and saved daily cash closing.
- Shop details, logo/signature images, print/PDF view and complete JSON export.

Desktop supports direct table entry. At narrow widths the bill uses compact rows and a dialog editor.

## Deploy

From firebase-app:

```powershell
firebase deploy --project dheeraj-b855a --only "firestore:rules,hosting"
```

Open the Firebase Hosting URL with /erp/ appended. Sign in with the existing owner account. Start with sample items and parties.

## Verification

From the repository root:

```powershell
node --test firebase-app/tests/erp-core.test.mjs
npm --prefix firebase-app/tests install
npm --prefix firebase-app/tests test
```

For rule tests, Java 21+ and Firebase CLI are needed. From firebase-app:

```powershell
firebase emulators:exec --project demo-dheeraj --config firebase.emulators.json --only firestore "node tests/erp-firestore.test.mjs"
```

The domain test includes a 28-day sample month that reconciles stock movements, party balances and closings. DOM interaction tests use a mocked persistence adapter and are not visual browser tests. Emulator tests exercise actual Firestore rules, a connected posting cycle, permission failures and a 50-line purchase.

## Explicit pilot defaults and limits

- Rates are entered before GST. Printed invoice is a test layout with an internal sequential reference. Confirm tax treatment, financial-year invoice series and final print fields before live billing.
- Moving weighted-average item cost and oldest-bill-first payment allocation are implementation defaults. A user can select a specific outstanding bill in the party ledger.
- One to fifty rows per document, multiple rows may use the same product in different units. Five optional packing levels. These are declared pilot limits rather than confirmed business requirements.
- Dispatch can select another packing unit. Its initial rate converts proportionally from the order's agreed rate; the owner reviews and can override that dispatch rate before posting.
- Customer returns can be sellable or unsellable. Supplier returns settle as an immediate credit or refund. Pending supplier credits, advances, cancellations, corrections/reversals, batch/expiry and returnable containers are pending.
- Closing is a saved snapshot and blocks later money/stock postings dated that day. Reopening or revised closing is pending.
- Logo/signature are images up to 60 KB each. Full certified digital signatures are outside this implementation.
- Reports show daily sales/gross margin before returns and expenses. Full area contribution and missed-demand analysis need additional report work. Operational ledgers are implemented; this is not a full general-ledger accounting package.
- Firestore rules enforce owner access, positive balances/structure, operation linkage and immutable documents. Browser code enforces pricing, stock-to-document reconciliation and allocation rules; rules do not independently recompute every line.
- The rebuild loads all its records and conservatively verifies all loaded versions during writes, with a shared generation check. This gives safe stale-screen rejection for the pilot but needs scoped reads and pagination for a growing history.
- Existing data migration and validated import/restore are pending. JSON export is available. No old data has been migrated or removed.
- iPhone Safari visual QA and deployment to the real Firebase project still require verification.
