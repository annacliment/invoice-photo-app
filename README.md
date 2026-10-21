# Invoice Photo Extractor

A browser-based prototype that lets you upload one or more invoice photos at once, run OCR (Spanish + English), and fill in an editable form per invoice.

Supported document types: invoices, simplified invoices / receipts (tickets), credit notes (rectificativas), pro forma invoices, quotes and receipts.

Extracted fields:

- Document type, invoice number, issue date, due date
- Vendor name, tax ID (NIF/CIF/NIE or EU VAT), phone, email
- Customer name and tax ID
- Currency, tax base, VAT rate(s) and amount (including multi-rate ticket breakdowns), IRPF withholding, total
- Payment method and IBAN
- Line items (quantity, description, amount)

Every field can be corrected by hand; empty fields are highlighted, and a warning is shown when base + VAT − IRPF does not match the total. Results can be exported to CSV (Excel-friendly, `;` separator and decimal comma) or JSON.

The parsing logic lives in `parser.js`, which also runs in Node for testing.

## How to run

Option 1: open the file directly in a browser
- Open `index.html` in your browser.

Option 2: run a local web server

```bash
cd invoice-photo-app
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Notes

This is a prototype designed for experimenting and design validation. It uses Tesseract.js in the browser, which keeps setup simple and helps you test the core concept quickly.

For a production company workflow, the next step would be adding:

- safer invoice parsing rules
- backend OCR with validation
- database storage
- user authentication and approval flow

## Future version ideas

- PDF and HEIC (iPhone) support
- Auto-detect invoice type and company
- Parse line items and taxes
- Save extracted results in JSON or CSV
- Connect to a real accounting or ERP system
