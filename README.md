# Invoice Photo Extractor

A simple browser-based prototype that lets you upload an invoice image, run OCR, and extract basic invoice data such as:

- Vendor name
- Invoice number
- Date
- Subtotal
- Tax
- Total amount

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
- export to Excel/CSV
- user authentication and approval flow

## Future version ideas

- Upload multiple invoices at once
- Auto-detect invoice type and company
- Parse line items and taxes
- Save extracted results in JSON or CSV
- Connect to a real accounting or ERP system
