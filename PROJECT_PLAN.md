# Dheeraj Wholesale ERP — implementation plan and decision record

Updated 18 November 2026. This document records the owner's requirements and the proposed implementation. Confirmed decisions, proposals and verified implementation are labelled separately. Source code and deployed behaviour must be checked before marking a feature complete.

## Start here

The product is a lightweight Marg-style wholesale ERP for one beverage/snack shop, used by one owner on a laptop and iPhone. Its records describe what happened in the business. Stock, balances and reports must trace back to those records.

Current app is firebase-app/. Earlier product/ and dist/ builds are historical. Firebase project is dheeraj-b855a. Use Firebase Authentication, Firestore and Hosting on Spark. Cloud Functions are excluded from deployment. Architecture is a modular monolith with one application and one release.

## Confirmed decisions

| ID | Decision |
| --- | --- |
| D01 | Customers are retail parties to whom the wholesaler distributes goods. Suppliers supply the wholesaler. Each needs a stable identity. |
| D02 | Address and area belong to customer profiles. Suggest existing area names. No separate Area Master screen. |
| D03 | Orders arrive by phone or during visits. The owner works area by area and needs visit planning, pending deliveries and collection information together. |
| D04 | Partial fulfillment is allowed. Retain the unfulfilled quantity against the original order, customer and area. |
| D05 | Send the invoice with the dispatched goods. Dispatch and invoice may be created by one action, with distinct linked records. |
| D06 | Selling rates can differ by customer. The actual rate belongs on each saved transaction line. |
| D07 | Items have a smallest stock unit and optional packing levels. Different items can have different levels. Example: carton = 12 strips; strip = 10 pouches. |
| D08 | Item setup includes name, MRP, selling rate, packing, GST and HSN. Optional barcode. Quantities arise from opening stock and transactions. |
| D09 | Purchase means stock received from supplier. Customer returns and supplier returns are distinct workflows. |
| D10 | Purchase and sale entry use traditional tables, adapted for mobile. |
| D11 | Dashboard provides business information and a Close day action that saves a daily report. Extra expenses must be recorded. |
| D12 | Invoice formatting, logo and signature are required. Signature image versus certificate-based digital signature remains to be confirmed. |
| D13 | Area reports should explain item demand, fulfillment, sales and profitability. |
| D14 | Internet outages can pause billing. One shop and owner, with shared laptop/iPhone records. No recurring-cost architecture is the current preference. |
| D15 | Current item UI has been rejected as confusing and unreliable. Existing implementation is a prototype baseline, not design approval. |

## Current baseline and known gaps

As of packing commit 44c7e7d7f37709dc059a9219c5ec83885973c516:

- Customer profiles have IDs, address and area. New orders snapshot profile details. Older entries can still be grouped by names.
- Orders can be partially dispatched and billed; delivery can be marked. Dispatches currently live inside order documents.
- Item packing creation and opening conversion exist. Purchases/sales/orders still largely use outer packs and loose units; intermediate-level transaction entry remains incomplete.
- Receipts, sales, payments and basic returns exist in a generic entries collection. Formal stock movement records, dedicated supplier identities, allocations and corrections need work.
- Whole-workspace reads, shared revision contention and an arbitrary twelve-line bill limit need redesign.
- Basic owner authorization and structural Firestore rules exist. Full business invariants and emulator validation are pending.
- Daily saved closing, visit plans, final invoice design and full financial reports are incomplete.
- Local calculation checks have been run. No claim is made that emulator, full browser or live deployment tests passed for every feature.

## Record model — proposed implementation

All identifiers are stable. Store money in integer paise. Store stock quantities as integer smallest units for the currently supported packaged products. Save selected quantity, unit and conversion on document lines. Preserve historical prices, descriptions, tax and delivery details.

| Record | Properties and relationships |
| --- | --- |
| Item | id, name including variant/size, baseUnit, packing versions, MRP and its unit, default prices by unit, HSN, tax defaults, optional barcode, active status |
| Packing unit | stable unit ID, label, unitsPerBase conversion, effective version; keep old conversions on posted lines |
| Customer | id, name, delivery address, area, optional contact/GST details; payment terms after confirmation |
| Supplier | id, name, address, contact/GST details; payment terms after confirmation |
| Customer price | customerId, itemId, unitId, price, effective date; override stored explicitly on order/invoice |
| Opening stock | itemId, quantity, conversion, opening cost, date, source/audit details |
| Order | id, customerId, customer/address/area snapshot, date, lines with stable line IDs, requested quantities and agreed rates |
| Dispatch | id, orderId when applicable, line references and actual quantities, dispatch date, delivery state and confirmation |
| Invoice | id/number, customerId, dispatch/order references, party snapshot, actual item lines, tax/discount/rounding totals |
| Purchase receipt | id, supplierId, received quantities including free goods, cost and packing snapshots; optional batch/expiry |
| Supplier bill | id, supplierId, supplier number/date, receipt references, charge lines and totals |
| Payment | id, partyId/type, date, direction, amount, method, reference, allocations to bills, unallocated amount |
| Return | id, direction customer-to-us or us-to-supplier, source lines, quantities, condition, value and settlement state |
| Expense | id, date, amount, payment method, category, description, optional area attribution |
| Stock movement | id, itemId, source document/line, signed base quantity, valuation effect, posting time |
| Party ledger entry | id, partyId/type, source, debit/credit effect, posting date; balances derived with cached summaries |
| Visit plan | id, date, area selection, customers/tasks, completion; pending work derives from source orders/dues |
| Closing | id, business date, source cutoff, opening/expected/counted cash, differences, receipts/payments/expense totals and revision history |

Collections and fields are a design proposal. Do not bulk migrate existing records until conversion has been tested against exported source data. Keep older text-based party entries unresolved until a user-confirmed match is available.

## Posting rules — proposed implementation

Drafts remain editable. Posting validates and atomically writes related records/effects. Use one operation ID per attempted action to prevent duplicate effects. Reversals refer to the original posting.

| Action | Stock effect | Financial effect |
| --- | --- | --- |
| Create item | None | None |
| Post opening stock | Add recorded quantity | Record opening valuation; accounting treatment to confirm |
| Take order | No physical movement | None; optional reservations remain undecided |
| Receive and record supplier bill | Add received quantity including free units once | Supplier payable from chargeable bill; paid amount recorded separately and linked |
| Dispatch and invoice | Deduct dispatched quantity once | Create receivable for invoiced amount; any immediate payment linked |
| Confirm delivery | No second deduction | None unless an explicit exception is recorded |
| Collect or pay | None | Payment and bill allocation; allow advances only after defining policy |
| Sellable customer return | Add accepted goods | Credit/refund according to agreed settlement |
| Unsellable customer return | Record separately from sellable stock | Credit/refund according to agreed settlement |
| Supplier return | Deduct goods leaving once | Track credit pending/received; prevent duplicate adjustment |
| Damage/expiry | Deduct or move to unsellable stock | Record cost impact |
| Close day | None | Save reconciliation snapshot; no invented sale/payment |

Order pending quantity = requested - dispatched - cancelled. Delivered quantities are tracked separately. Returns never automatically recreate the original order demand. Cancellation and failed delivery policies need confirmation.

Use an internal balanced financial posting model if full financial statements are included. Operational party ledgers alone cannot support a claim of complete accounting. Owner-facing screens should generate appropriate entries automatically.

## Item creation — first implementation target

Proposed experience for owner review:

1. Inventory list offers Search and Add item. Search existing names/barcodes before creating.
2. Add item opens a dedicated form with identity, packing, prices and tax sections.
3. Identity: item name including size/flavour, smallest stock unit, optional barcode.
4. Packing: show concrete relationships, such as Box contains 90 pouches. Optional additional relationship, such as Carton contains 12 boxes. Compute conversion immediately. Do not require an outer pack for piece-only items.
5. Prices: choose the unit beside each rate. MRP per retail unit; default selling rates per supported pack. A customer price is stored against customer + item + unit.
6. Tax: HSN and tax default, with historical snapshots on posted lines. Invoice tax settings need accountant verification.
7. Review a plain summary before save. Save creates one reusable item with zero physical stock.
8. Offer Enter opening stock after the item is saved. Enter quantity by named units and its cost. Save creates a traceable movement.
9. Failed saves keep the draft. Duplicate taps/retries create one record. Existing matches show before confirmation.
10. Reopen the saved item and verify every property persisted.

The previous combined item/opening-stock form and five-level limit were assistant implementation choices. They are not confirmed product requirements.

## Page behaviour

| Workspace | Main behaviour |
| --- | --- |
| Today | Date-specific sales, collections, payments, expenses, ready dispatches, shortages and open deliveries; every amount opens its records; Close day |
| Inventory | Search, item details, stock balance and movement history; Add item and Enter opening stock |
| Parties | Customer/supplier profiles; rates, ledger, orders, invoices, payments; record transactions with party preselected |
| Purchases | Supplier bill header and editable row grid; quantity unit and rate unit explicit; receipt/bill review and posting |
| Orders | Customer selection, area/address fill, product search and quantity/rate grid; pending quantities and source documents |
| Dispatch | Select order quantities available now; combined dispatch/invoice review; confirm delivery later |
| Sales | Direct-sale grid or dispatch-linked invoice; show customer rates; full/partial/credit settlement; invoice preview |
| Money | Customer receipts, supplier payments, advances when supported, expenses and refunds |
| Returns | Separate customer and supplier lists/forms with source references, condition and settlement |
| Area planning | Customer profiles supply area options; choose visit date, deliveries, collection tasks and pending shortages |
| Reports | Date/area/item/party filters; demand vs fulfilled, net sales, cost/margin, returns, dues; drill down |
| Settings | Shop/invoice identity, logo/signature, numbering, exports and backup/recovery tools |

Desktop uses keyboard-friendly editable grids. Mobile uses a compact document table plus a focused row editor with unit and rate visible. Screen mockups must use actual transaction examples. Avoid demanding the owner complete unrelated master setup during billing.

## Report definitions

- Requested demand comes from order lines, fulfilled quantities from dispatches, billed sales from posted invoices.
- Cash collected comes from receipts, including receipts against older bills.
- Pending quantity is not automatically lost sales; record cancellation and reason to establish lost demand.
- Gross margin uses net item revenue and recorded item cost. Area contribution subtracts explicitly attributed expenses. Shared expenses stay visible with any allocation method disclosed.
- Area reports use transaction area snapshots; changing a customer profile does not rewrite history.
- Low item sales must be assessed alongside availability, order demand, shortages and returns.
- Start with reconciled operational reports. Add comparative claims only when source data is complete.

## Technical implementation sequence

1. Audit current records and export a backup. Inventory existing data and deployed rules.
2. Separate UI rendering, business commands, persistence and report queries into modules inside the same deployable app.
3. Implement the new item model and all-unit conversion/pricing service, preserving legacy item support.
4. Build the dedicated item screen and review it on laptop and iPhone before rollout.
5. Add supplier identities, price records and reviewed legacy party linking.
6. Implement stock/party postings and purchase workflow.
7. Implement orders, independent dispatch records, invoices and allocations using the same services.
8. Add returns, corrections, expenses and saved daily closing.
9. Add visit plans, area reports and final invoice presentation.
10. Validate a month of sample business, backup recovery and user walkthrough before live bookkeeping.

Firestore Spark remains the chosen constraint. Replace full-history reloads with scoped queries and pagination. Minimize contention by reading only relevant document versions and balances. Prove security-rule access limits and actual bill sizes in the emulator. Never split a financial posting into independent saves that can leave inconsistent stock and money. If the required invariant cannot be enforced within this architecture, document the concrete failure and alternatives before changing infrastructure.

## Verification scenarios

| Scenario | Expected result |
| --- | --- |
| Individual-only item | No compulsory carton; quantities and rates clearly named |
| Multi-level item | 2 cartons + 3 strips + 4 pouches at 12 strips/carton and 10 pouches/strip = 274 pouches |
| Changed packing or price | Old documents preserve original conversion and price |
| Purchase with free goods | Stock includes free units; amount payable reflects charged quantity and discounts |
| Partial order | Request 10 cartons; dispatch/bill 7; retain 3 pending for area; restock; dispatch remaining 3 |
| Customer moved/renamed | Historical order/invoice details preserved; balance stays on customer ID |
| Same-name customers | Independent IDs and ledgers |
| Partial collection | Payment allocated; remaining balance correct; historical invoice value preserved |
| Return/refund/credit | Correct direction and stock condition; settlement traceable |
| Retry/concurrent save | No duplicates, overselling or partially posted money/stock |
| Closing | Receipts from old bills counted today; sales and collections remain distinct |
| Recovery | Restored export reconciles quantities, balances and document references |

Run meaningful domain tests, security-rule emulator tests and full browser workflows. Record actual results and remaining verification gaps. User reports are evidence, not blanket approval of related features.

## Open business decisions

- Batch/expiry tracking and returnable bottle/crate tracking.
- Rate includes/excludes tax, rounding rules, and applicable invoice requirements.
- Customer payment terms, advances, refunds and allocation defaults.
- Stock reservation priority among waiting orders; default is undecided.
- Failed delivery, cancelled remainder and return settlement policy.
- Packing changes to an existing SKU versus a new SKU.
- Closing correction policy and financial-year invoice series.
- Signature image versus certificate-based signature.
- Full accounting statements versus operational ledger scope.

Resolve each when the affected workflow is designed. Continue independent work with labelled proposals.

## Keeping decisions and progress current

Before each change, read this document and inspect the relevant current code. Add a decision ID when the owner confirms a change. Record what changed and which decisions it supersedes. Update implementation status and test evidence in the same change. Preserve pending items rather than treating a screen as completed service functionality.

### Current next action

Model and prototype the dedicated item form using three concrete products: individual bottle, box of 90 pouches, and carton/strip/pouch. Connect the same conversions to opening stock, purchase, order and sale before calling packing support complete.

### Change log

- 18 Nov 2026 — Consolidated owner decisions and proposed end-to-end implementation. Corrected the earlier assumption that the existing item UI and arbitrary bill/packing limits were approved requirements.

## Implementation checkpoint — 18 November 2026

Started dedicated Inventory → Add item → Review → Save → saved details flow. Item creation uses zero opening stock and is separate from the inventory list. Duplicate-name/barcode validation runs during review; edits invalidate the review. Local syntax and three rendering checks passed. Browser, emulator and live persistence verification pending. The packing editor and naming still require owner review. Separate opening-stock action, default prices by each pack, intermediate-unit transaction entry and item editing remain pending. This checkpoint does not complete the item milestone.

### Item presentation checkpoint

Implemented Item details → Packing → Prices → Tax details → Review/Save. Packing rows show Pack name, Contains and the preceding unit. Prices show selling unit, MRP and selling price in aligned columns. Unit labels follow the selected unit/pack. Optional outer-pack price is hidden for individual-only items. Existing data fields remain compatible. Syntax and section/field checks passed. Browser rendering and live save remain unverified. Intermediate pack pricing, separate opening stock and all-unit transaction integration remain pending.

## Rebuild specification — 22 November 2026

This section supersedes earlier proposed wizard-style screen flows. The owner rejected the previous interface. Confirmed presentation requirement: simple tables, chronological field order, familiar language. Implementation below is proposed sequencing, not a claim of completion.

### Shared presentation

Document pages use one page: header details, editable item rows, totals/payment, Save and optional Print. Item creation uses details then optional packing rows then Save. Review is inline. Desktop grids support keyboard entry; mobile shows compact rows with a focused row editor. Lists and creation forms are distinct screens. Saved records open a readable detail view.

### Service contracts

| Service | Owns | Produces and changes |
| --- | --- | --- |
| Access and shop | Owner authentication, shop identity, invoice settings | Grants access to the single shop; settings supply document snapshots |
| Items and units | Item identity, name, base unit, packing relationships, MRP, HSN, default tax and unit prices | Reusable product; zero stock on creation; historical conversions preserved on documents |
| Parties and prices | Customers and suppliers with stable IDs; customer address/area; agreed item/unit rates | Supplies party selection and price defaults; profile edits preserve historical documents |
| Opening records | Opening physical stock/cost, customer/supplier balances, opening cash | Dated source records and stock/financial postings; tracked corrections |
| Purchasing | Supplier bill/receipt, paid/free quantities, actual cost, invoice reference/date | Records goods received and payable; links immediate payment; checks duplicate supplier bill |
| Orders | Requested items, quantities, agreed rates, customer and area snapshot | Pending quantities and shortages; no stock deduction or receivable |
| Dispatch and delivery | Actual outgoing quantities linked to order lines; delivery status | Posts stock issue once and generates linked invoice in one owner action; partial remainder persists |
| Sales invoices | Customer invoice, actual rates, tax/discount/rounding, direct-sale option | Receivable and invoice snapshot; direct sale posts stock once through shared posting logic |
| Payments and allocation | Collections, supplier payments, payment method, linked bill allocations | Cash/bank and outstanding movements; accommodates policy for unallocated money once defined |
| Customer returns | Goods received back from customer and condition; source sale | Sellable/unsellable movement and linked credit/refund settlement |
| Supplier returns | Goods sent back and pending/received supplier credit | Stock issue and separately tracked settlement without duplicate payable reduction |
| Expenses | Date, category, description, amount, payment method, optional area | Cash/bank expense posting and closing/report input |
| Stock ledger | Append-only movements with item, source, signed base quantity and valuation | Explainable balance; reconciliation; stock adjustment requires reason |
| Financial posting | Party subledgers, cash/bank entries, source links, reversals | Shared atomic posting rules; operational balances reconciled; full accounting scope remains an open decision |
| Area planning | Area names derived from profiles; dated visits/tasks | Ready dispatches, pending shortages and collections; task completion references real events |
| Daily closing | Date/cutoff, opening cash, cash movement, counted cash, difference | Saved daily snapshot and outstanding-work summary; later correction/version policy |
| Reports | Read-only calculations from source documents and ledgers | Demand/fulfillment, sales/returns, stock, dues, area gross margin/direct expenses with drill-down |
| Invoice output | Print/PDF template, logo, signature image once confirmed | Consistent printed copy from saved invoice; legal/tax format verification before live use |
| Data administration | Export, validated import/migration and recovery | Backups, reviewed legacy linking, reconciliation and restore verification |

### Minimal page inventory

- Today: business figures, pending tasks, Close day.
- Items: list; Add/Edit item; item details and movements.
- Customers and Suppliers: lists; profiles; linked transactions and ledger.
- Purchases: list; New purchase table; saved bill.
- Orders: list/filter by area and pending status; New order table; order detail.
- Dispatches: outgoing quantities and linked invoice; delivery confirmation.
- Sales: invoice list; New sale table; saved invoice.
- Money: collections, supplier payments and expenses.
- Returns: Customer returns and Supplier returns.
- Areas: visit plan and area work.
- Reports: filters and source drill-down.
- Settings: shop, invoice, export/restore.

Ledger is a view of transactions for a selected party with date, source, debit, credit and running balance. It must not require re-entering a sale or payment.

### Rebuild sequence and safeguards

1. Preserve current source and export shop records before migration. Develop rebuild separately in the same repository.
2. Implement Items, Units and Parties first with shared validation and legacy readers. Complete item creation, edit/reopen and pricing persistence.
3. Implement posting and opening records; purchases; direct sale; payments. Verify one complete receipt-to-sale-to-collection cycle.
4. Add orders, partial dispatch and delivery with original-line tracking.
5. Add distinct return workflows, expenses and saved closing.
6. Add area planning, reports and final invoice presentation.
7. Reconcile sample scenarios, test rules and browser flows, migrate reviewed records and deploy.

Firebase Spark and monolith remain confirmed constraints. Choose document shapes only after checking atomic write/rule limits. Do not claim a screen or module complete based on syntax checks. Record UI, domain, rules, persistence and migration verification separately.

### First deliverable

A working Items list and simple item form with name/unit/MRP/default selling rates/HSN/GST, optional packing table and Save. Prices retain their explicit unit. Save/reopen/edit must persist correctly. Purchases and sales then reuse this same unit model. Extra review pages and abstract packing-level terminology are superseded.

### Decisions still needed at the affected stage

Tax-inclusive/exclusive pricing and rounding; expiry/batch and containers; credit/advance allocation policy; failed delivery/cancelled remainder; return settlement; closing correction; signature type. Do not silently decide these from a UI example.

## Integrated rebuild checkpoint — 22 November 2026

Implementation lives at firebase-app/public/erp/ and opens at /erp/. It uses the same Firebase owner identity but a separate erp/main workspace. The original wholesale/main records and old application remain available. No migration or deletion was performed.

### Implemented for owner testing

- Item create/edit; base unit and optional packing rows; explicit selling rates per packing unit; separate opening-stock command and movement history.
- Customer and supplier identities; customer area/address; agreed item-unit prices; party ledger and outstanding-bill allocation.
- Traditional purchase, direct sale and order entry tables with quantities in any defined unit, purchase free quantity, discounts and live totals.
- Orders, partial dispatch and generated sales invoice; delivery confirmation; dispatch can select another unit and review its converted rate.
- Customer/supplier returns referencing original bill lines; sellable/unsellable handling; credit or immediate refund settlement.
- Expenses; dated area visit tasks; saved cash closing; day totals, source transactions and provisional area/item gross margin.
- Printable test invoice with internal sequential reference, optional small logo/signature image; JSON export.
- Shared domain commands produce affected records and explicit stock movement entries. Firestore writes stock, bills, money, order changes and retry receipt atomically.

### Verification completed

- Seven domain scenarios passed, including a 28-day synthetic month reconciling movement quantities, party balances, payment allocations and closing cash.
- DOM interaction scenario passed item/party creation, purchase entry, ordering, dispatch, delivery, collection and phone row editor. These tests mock persistence and are not visual browser QA.
- Firestore emulator compiled the combined rules and passed real writes for the connected workflow. Unauthorized access, deletions, invoice edits and invalid negative stock were rejected.
- A 50-line purchase passed actual emulator rule evaluation with 50 balance updates, 50 movement records and one bill.
- Real Firebase deployment and actual iPhone Safari rendering remain unverified.

### Temporary implementation defaults requiring owner review

- Rates before GST, moving weighted-average item cost, oldest-bill-first allocation unless a bill is selected.
- Up to 50 rows per document; repeated item rows allow mixed packing units; up to five optional pack levels.
- Closing blocks money/stock postings on that business date. Reopening is pending.
- Supplier return credit currently settles immediately; pending supplier credits are unfinished.
- Dispatch in another unit initially converts the agreed order rate proportionally; the owner can change that dispatch rate before posting.
- Separate empty workspace chosen to avoid unreviewed migration of the existing records.

### Still pending

Full accounting/general ledger, corrections and linked reversals, advances, order cancellation/failed delivery, supplier-credit-pending workflow, batch/expiry and containers, complete return/expense-adjusted area profitability, final GST invoice/numbering requirements, validated restore and legacy migration.

Reads currently load the rebuild workspace, and writes conservatively check loaded record versions plus a shared generation. This is safe against stale screens in tested workflows but needs scoped query/pagination work as records grow. Rules enforce ownership, operation linkage, basic shape, nonnegative stock and immutable financial documents; the owner's browser still executes the detailed posting arithmetic on Spark.

See firebase-app/public/erp/README.md for exact deployment and repeatable checks. This checkpoint records a connected test release, not production accounting approval.

## Minimal owner experience — 22 November 2026

The owner asked for an easy, minimal ERP and does not want to choose implementation details. Continue the existing Firebase application for this iteration. The ERPNext document remains a candidate assessment, not an approved platform migration.

Implemented navigation and guidance:
- Five main destinations: Today, Orders, Stock & items, Customers & suppliers, More.
- First-use setup checklist: one item, supplier, customer and initial stock.
- Today emphasizes New sale, Receive stock, Take order, pending goods and deliveries. Cash-method details are expandable; closing has a dedicated action.
- More groups existing purchase/sale history, money, returns, visits, reports and settings with plain descriptions.
- Money forms hide unrelated expense/party fields and filter parties to the correct role.
- Return forms filter source bills by return direction; supplier returns hide customer goods-condition fields.
- Missing item/party prerequisites lead to the appropriate form with a clear explanation.
- Mobile navigation stays at the bottom. Existing business records, packing conversions and posting logic are reused.

Verification: all seven domain tests and DOM interaction tests passed, including five-tab navigation, first-use setup and conditional money/return fields. Browser visual checks, actual iPhone Safari and live Firebase deployment remain unverified. Previous backend and report limitations remain listed in the integrated rebuild checkpoint.
