# ERPNext fit assessment for Dheeraj Wholesale

Assessment date: 22 November 2026.

## Result and scope

ERPNext is a credible core for this shop's stock, accounting and order-to-payment workflows. The documented business model fits more completely than the current custom Firebase build. A simplified owner interface, area work planning and wholesale daily cash closing still require configuration/custom work.

This is a documentation-based assessment. No ERPNext instance was installed, no supplier invoice was imported and no mobile usability test was performed. Documented capability is not a passed shop acceptance test. Exact behaviour must be verified on one selected stable ERPNext/Frappe release with a compatible India Compliance release.

## Confirmed shop requirements

One owner; laptop and iPhone; online billing acceptable. Customers are retail parties, each with address and area on its profile. Orders come by phone or visits. Partial deliveries leave remaining quantities open for the party/area. Bills travel with goods. Selling rates vary by customer and packaging. Supplier receipt/purchase and sales use item tables. Multiple packaging levels vary by item. Need customer/supplier ledgers, returns in both directions, expenses, saved daily closing, area planning, item/area performance and print layout with logo/signature.

Supplier invoice example: 2 boxes correspond to 180 individual pouches at 13.23 each, producing 2381.40 before tax. This illustrates a per-pouch purchase rate despite outer-pack receiving. Actual box conversion and the supplier's term "bunches" need physical confirmation. The uploaded page says Continued, so it is not evidence for a complete invoice total.

## Fit matrix

| Requirement | Documented ERPNext support | Work needed for Dheeraj |
| --- | --- | --- |
| Item and packing properties | Stock UOM plus item-specific alternative UOM conversion factors | Base pouch/bottle; Strip 10 and Carton 120. Optional owner-friendly nested editor converts relationships to base factors. MRP should be explicitly represented with India-specific configuration/custom field rather than confused with a selling price. |
| Customer-specific unit prices | Item Price can specify UOM, customer/supplier and validity | Configure prices and test precedence against general price list/rules. |
| Supplier bills and receipt | Purchase Receipts and Purchase Invoices with source links | Configure combined entry when delivery and invoice arrive together; separate documents when they differ. Test zero-price/free goods and valuation against supplier schemes. |
| Orders and partial dispatch | Sales Order and multiple Delivery Notes | Send 7 of 10; retain 3 open. Create linked Sales Invoice. Combined Dispatch and bill button is a proposed custom action. |
| Proof of customer delivery | Delivery Note is the stock/shipping document | Do not treat its submission as proof the customer received goods. Add delivery confirmation/status if the selected standard flow lacks the desired acknowledgement. |
| Ledger, payment, advances | General Ledger, Payment Entry and reconciliation | Configure receivable/payable/cash/bank accounts; verify partial/advance payments and allocation. |
| Customer returns | Return Delivery Note and/or Sales Invoice credit note | Configure sellable and unsellable warehouse handling; test no duplicate stock return and later refund/credit. |
| Supplier returns | Return Purchase Receipt and return Purchase Invoice/debit note | Test physical return before supplier settlement; retain a pending claim until credit/refund is accepted. |
| Expenses and inventory cost | Expense postings and Landed Cost Voucher | Define delivery expenses versus costs capitalized into inventory; owner/accountant policy required. |
| Area on customer | Standard Territory on customer and supported sales documents | Hide hierarchy/setup from owner if desired; automatically create/reuse territory from customer area. Standard Territory is internally a master. An independent text area field instead requires custom report propagation. |
| Area performance | Territory/customer/item sales analytics | Configure sales analysis; custom pending-order/collection/visit workspace and area contribution report. No claim that standard sales analytics equals net area profitability. |
| Planning visits | No exact shop-specific consolidated screen established by this assessment | Small Visit Plan document linking date/area/parties and tasks; display live order/collection work. |
| Close day | POS closing and Period Closing are documented for their own workflows | Build a wholesale cash-reconciliation snapshot. POS closing must not be assumed to include all ordinary invoices, payments and expenses. Period closing closes accounting income/expense balances, which is a different operation. |
| Invoice printing | Letter Head, Print Formats, PDF printing | Configure item grid, tax presentation, logo and signature image; verify final requirements with accountant. Certified signing is separate. |
| Corrections and reliable accounting | Submitted postings, immutable ledger reversals, accounting reports | Configure posting policies, opening balances, financial year, backup/restore and accountant-reviewed tests. |
| Simple phone/table experience | Standard documents have item tables and row editing | Actual iPhone test remains necessary. Owner may need custom simplified screens over ERPNext APIs. |
| Free Firebase hosting | ERPNext needs a server runtime and database | It cannot be hosted as the existing static Firebase Spark site. Cloud hosting or a maintained self-hosted server is a separate infrastructure decision. |

## Proposed shop configuration

One company, INR, one operational warehouse initially. Add an unsellable/returns warehouse only if physical handling requires it. Use Customer, Supplier, Item, Item Price, Sales Order, Delivery Note, Sales Invoice, Purchase Receipt/Purchase Invoice and Payment Entry.

Expose a short menu: Today, Items, Parties, Purchases, Orders/Dispatch, Sales, Money, Returns, Areas, Reports. Retain the established ledger and posting engine behind the simplified menu. Hide unused modules through configuration. Do not fork ERPNext core to achieve this.

Use a small custom Frappe app for the specific area workflow, wholesale closing and any combined actions. Standard transactions remain the source records. Combined actions must be atomic/idempotent and preserve source-document links.

## Hands-on acceptance pack — not yet run

1. Create three products: bottle-only; box of 90 pouches; carton of 12 strips of 10 pouches. Confirm inventory unit and alternate prices.
2. Reproduce the supplier row with 180 pouches at 13.23, testing how entry in two boxes fetches/converts the price.
3. Receive paid and free goods. Verify total stock, supplier payable and inventory value; do not assume free-row selling scheme documentation proves purchase-cost treatment.
4. Create two same-name customers with different addresses/areas. Configure different carton and pouch rates and verify the correct rate is fetched.
5. Order ten cartons, dispatch/bill seven, record partial payment, and inspect the order balance, stock ledger, party ledger and accounting entries.
6. Restock and dispatch the last three. Confirm each dispatch/invoice and the original order remain traceable without double stock posting.
7. Record a customer advance, allocate it later, then receive one payment covering multiple bills.
8. Receive a damaged customer return and return stock to supplier before credit is settled. Verify physical and monetary dates independently.
9. Record fuel as an area expense and inward freight as inventory cost where appropriate. Check report definitions with accountant.
10. Confirm customer address/area edits do not unexpectedly rewrite the intended historical reports; add explicit snapshots where needed.
11. Cancel/amend an erroneous transaction and check reversals, allocations and downstream stock valuation.
12. Reconcile daily cash and old-bill receipts; verify daily snapshot versus period closing.
13. On an iPhone, create an order, edit a unit/rate, record a collection and confirm delivery without desktop-only controls.
14. Print the final invoice and restore a backup into a separate instance.

## Architecture and cost conclusion

If the priority is complete ERP foundations, evaluate configured ERPNext plus a small custom Frappe app first. It comes with documented accounting, allocations, corrections and valuation systems.

If zero recurring expense and no maintained server are hard requirements, the existing Firebase Spark custom approach remains a separate option with substantially more engineering and validation. Do not silently promise both a full ERP engine and zero hosting/maintenance burden.

A self-hosted trial on available hardware can establish workflow fit before choosing deployment. It still requires setup/maintenance, and phone access outside the shop needs a properly operated remote-access arrangement. No paid service or installation has been authorized by this assessment alone.

## Sources

- [Alternative units and pricing](https://docs.frappe.io/erpnext/Selling-in-different-UOM)
- [Item Price and customer/UOM specificity](https://docs.frappe.io/erpnext/item-price)
- [Purchase Invoice and receipt links](https://docs.frappe.io/erpnext/purchase-invoice)
- [Delivery Note and partial deliveries](https://docs.frappe.io/erpnext/delivery-note)
- [Payment Entry](https://docs.frappe.io/erpnext/payment-entry)
- [Payment reconciliation](https://docs.frappe.io/erpnext/payment-reconciliation)
- [Accounting entries](https://docs.frappe.io/erpnext/accounting-entries)
- [Immutable ledger](https://docs.frappe.io/erpnext/immutable-ledger-in-erpnext)
- [Sales return](https://docs.frappe.io/erpnext/sales-return)
- [Purchase return](https://docs.frappe.io/erpnext/purchase-return)
- [Territory](https://docs.frappe.io/erpnext/territory)
- [Sales analytics](https://docs.frappe.io/erpnext/sales-analytics)
- [Landed cost](https://docs.frappe.io/erpnext/stock-transactions-landed-cost-voucher)
- [POS workflows](https://docs.frappe.io/erpnext/pos-workflows)
- [Period closing](https://docs.frappe.io/erpnext/period-closing-voucher)
- [Print format](https://docs.frappe.io/erpnext/print-format)
- [GST configuration in India Compliance](https://docs.indiacompliance.app/docs/configuration/gst_setup)
- [Hosting/open-source responsibilities](https://docs.frappe.io/erpnext/open-source)

## Decision status

ERPNext is the recommended candidate for a hands-on fit trial. Migration, deployment, hosting expenditure and replacement of the current Firebase app are not approved or completed. Keep this assessment separate from the implementation decision log until the owner chooses a direction.
