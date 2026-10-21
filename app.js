const invoiceInput = document.getElementById('invoiceInput');
const previewImage = document.getElementById('previewImage');
const emptyState = document.getElementById('emptyState');
const ocrButton = document.getElementById('ocrButton');
const statusNode = document.getElementById('status');
const ocrOutput = document.getElementById('ocrOutput');

const vendorValue = document.getElementById('vendorValue');
const invoiceNumberValue = document.getElementById('invoiceNumberValue');
const dateValue = document.getElementById('dateValue');
const subtotalValue = document.getElementById('subtotalValue');
const taxValue = document.getElementById('taxValue');
const totalValue = document.getElementById('totalValue');

const invoiceKeywords = [
  'invoice',
  'bill',
  'supplier',
  'vendor',
  'date',
  'total',
  'subtotal',
  'tax',
  'amount due',
  'due date',
  'payment',
  'balance',
  'currency'
];

let currentFile = null;

function setStatus(message, tone = 'neutral') {
  statusNode.textContent = message;
  statusNode.style.color = tone === 'error' ? '#c62828' : tone === 'success' ? '#148f5d' : '#667085';
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function formatMoney(value) {
  if (!value || Number.isNaN(Number(value))) return '—';
  const numeric = Number(value.replace(/[^0-9.]/g, ''));
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(numeric);
}

function stripNoise(line) {
  return normalizeWhitespace(line)
    .replace(/[*#|]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractInvoiceNumber(text) {
  const patterns = [
    /(?:invoice(?:\s+(?:no|number|#|num))?|inv(?:\s*#)?)[\s:]*([A-Z0-9\-\/]+[A-Z0-9\-\/\s]*)/i,
    /(?:bill\s*(?:no|number)|reference)[\s:]*([A-Z0-9\-\/]+)/i,
    /(?:order\s*(?:no|number)|po\s*#?)[\s:]*([A-Z0-9\-\/]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return stripNoise(match[1]).replace(/\s+/g, '');
    }
  }

  return '—';
}

function extractDate(text) {
  const patterns = [
    /(?:invoice\s*date|date)[\s:]*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i,
    /(?:issued\s*on|created\s*on)[\s:]*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i,
    /([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return '—';
}

function extractVendor(text) {
  const lines = text
    .split(/\n|\r/)
    .map(stripNoise)
    .filter(Boolean);

  const candidate = lines.find((line) => {
    const lower = line.toLowerCase();
    return !invoiceKeywords.some((keyword) => lower.includes(keyword)) &&
      line.length > 3 &&
      !/^\d/.test(line) &&
      /[a-z]/i.test(line);
  });

  return candidate || '—';
}

function extractAmountByLabel(text, labels) {
  const patternBase = labels.join('|');
  const regex = new RegExp(`(?:${patternBase})\\s*[:#-]?\\s*([$€£¥]?\\s*\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d{2})?)`, 'i');
  const match = text.match(regex);
  if (match && match[1]) {
    return formatMoney(match[1]);
  }
  return '—';
}

function extractTotal(text) {
  const pattern = /(?:total(?:\s+(?:amount|due|payable))?|amount\s*due)\s*[:#-]?\s*([$€£¥]?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i;
  const match = text.match(pattern);

  if (match && match[1]) {
    return formatMoney(match[1]);
  }

  const amounts = [...text.matchAll(/[$€£¥]?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?/g)];
  if (!amounts.length) return '—';

  const lastAmount = amounts[amounts.length - 1][0];
  return formatMoney(lastAmount);
}

function extractSubtotal(text) {
  return extractAmountByLabel(text, ['subtotal', 'sub-total', 'net total']);
}

function extractTax(text) {
  return extractAmountByLabel(text, ['tax', 'vat', 'sales tax', 'gst', 'hst']);
}

function parseInvoiceText(text) {
  const cleanText = text.replace(/\u00a0/g, ' ');

  return {
    vendor: extractVendor(cleanText),
    invoiceNumber: extractInvoiceNumber(cleanText),
    date: extractDate(cleanText),
    subtotal: extractSubtotal(cleanText),
    tax: extractTax(cleanText),
    total: extractTotal(cleanText)
  };
}

function renderExtractedFields(extracted) {
  vendorValue.textContent = extracted.vendor;
  invoiceNumberValue.textContent = extracted.invoiceNumber;
  dateValue.textContent = extracted.date;
  subtotalValue.textContent = extracted.subtotal;
  taxValue.textContent = extracted.tax;
  totalValue.textContent = extracted.total;
}

invoiceInput.addEventListener('change', (event) => {
  const [file] = event.target.files;

  if (!file) return;

  currentFile = file;
  const objectUrl = URL.createObjectURL(file);

  previewImage.src = objectUrl;
  previewImage.hidden = false;
  emptyState.hidden = true;
  ocrButton.disabled = false;
  setStatus('Image ready. Click “Read invoice” to extract the data.');
});

ocrButton.addEventListener('click', async () => {
  if (!currentFile) {
    setStatus('Please upload an invoice image first.', 'error');
    return;
  }

  ocrButton.disabled = true;
  setStatus('Reading invoice… this may take a few seconds.');

  try {
    const result = await Tesseract.recognize(currentFile, 'eng', {
      logger: (message) => {
        if (message.status === 'recognizing text') {
          setStatus(`Processing invoice… ${Math.round(message.progress * 100)}%`);
        }
      }
    });

    const text = result.data.text || '';
    ocrOutput.value = text;

    const extracted = parseInvoiceText(text);
    renderExtractedFields(extracted);

    setStatus('Invoice successfully processed.', 'success');
  } catch (error) {
    console.error(error);
    setStatus('Something went wrong while processing the image.', 'error');
  } finally {
    ocrButton.disabled = false;
  }
});

function initializeDefaults() {
  ocrOutput.value = '';
  renderExtractedFields({
    vendor: '—',
    invoiceNumber: '—',
    date: '—',
    subtotal: '—',
    tax: '—',
    total: '—'
  });
}

initializeDefaults();
