const invoiceInput = document.getElementById('invoiceInput');
const dropZone = document.getElementById('dropZone');
const processButton = document.getElementById('processButton');
const clearButton = document.getElementById('clearButton');
const exportCsvButton = document.getElementById('exportCsvButton');
const exportJsonButton = document.getElementById('exportJsonButton');
const statusNode = document.getElementById('status');
const resultsNode = document.getElementById('results');
const summaryNode = document.getElementById('summary');
const cardTemplate = document.getElementById('invoiceCardTemplate');

const FIELDS = [
  { key: 'documentType', label: 'Tipo de documento', type: 'select', options: ['Factura', 'Factura simplificada / ticket', 'Factura rectificativa', 'Factura proforma', 'Presupuesto', 'Recibo', 'Desconocido'] },
  { key: 'invoiceNumber', label: 'Nº de factura' },
  { key: 'issueDate', label: 'Fecha de emisión', type: 'date' },
  { key: 'dueDate', label: 'Fecha de vencimiento', type: 'date' },
  { key: 'vendor', label: 'Emisor / proveedor', wide: true },
  { key: 'vendorTaxId', label: 'NIF/CIF emisor' },
  { key: 'vendorPhone', label: 'Teléfono emisor' },
  { key: 'vendorEmail', label: 'Email emisor', wide: true },
  { key: 'customer', label: 'Cliente', wide: true },
  { key: 'customerTaxId', label: 'NIF/CIF cliente' },
  { key: 'currency', label: 'Moneda', type: 'select', options: ['EUR', 'USD', 'GBP', 'CHF'] },
  { key: 'subtotal', label: 'Base imponible', type: 'money' },
  { key: 'taxRate', label: 'Tipo IVA (%)' },
  { key: 'taxAmount', label: 'Cuota IVA', type: 'money' },
  { key: 'withholdingRate', label: 'Retención IRPF (%)' },
  { key: 'withholdingAmount', label: 'Importe IRPF', type: 'money' },
  { key: 'total', label: 'Total', type: 'money', highlight: true },
  { key: 'paymentMethod', label: 'Forma de pago' },
  { key: 'iban', label: 'IBAN', wide: true }
];

const STATUS_LABELS = {
  pending: 'Pendiente',
  processing: 'Leyendo…',
  done: 'Leída',
  error: 'Error'
};

let invoices = [];
let nextId = 1;
let isProcessing = false;
let ocrWorker = null;
let currentInvoice = null;

function setStatus(message, tone = 'neutral') {
  statusNode.textContent = message;
  statusNode.dataset.tone = tone;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  return new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value, currency = 'EUR') {
  if (value === null || value === undefined || value === '') return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(value);
}

function emptyData() {
  const data = { lineItems: [], warnings: [] };
  FIELDS.forEach((field) => { data[field.key] = field.key === 'currency' ? 'EUR' : ''; });
  return data;
}

function updateButtons() {
  const pending = invoices.some((invoice) => invoice.status === 'pending' || invoice.status === 'error');
  const done = invoices.some((invoice) => invoice.status === 'done');
  processButton.disabled = isProcessing || !pending;
  clearButton.disabled = isProcessing || !invoices.length;
  exportCsvButton.disabled = !done;
  exportJsonButton.disabled = !done;

  const read = invoices.filter((invoice) => invoice.status === 'done');
  const sums = {};
  read.forEach((invoice) => {
    const currency = invoice.data.currency || 'EUR';
    sums[currency] = (sums[currency] || 0) + (Number(invoice.data.total) || 0);
  });
  const totalsText = Object.entries(sums).map(([currency, sum]) => formatMoney(sum, currency)).join(' + ');
  summaryNode.textContent = invoices.length
    ? `${read.length}/${invoices.length} leídas${totalsText ? ` · Total ${totalsText}` : ''}`
    : '';

  if (!invoices.length) {
    resultsNode.innerHTML = '<div class="empty-state">Todavía no hay facturas. Sube una o varias fotos para empezar.</div>';
  }
}

// ---------- Adding files ----------

function addFiles(fileList) {
  const images = [...fileList].filter((file) => file.type.startsWith('image/'));
  const skipped = fileList.length - images.length;
  if (!images.length) {
    setStatus('Solo se admiten imágenes (PNG, JPG, WEBP).', 'error');
    return;
  }

  if (!invoices.length) resultsNode.innerHTML = '';

  images.forEach((file) => {
    const invoice = {
      id: nextId++,
      file,
      url: URL.createObjectURL(file),
      status: 'pending',
      progress: 0,
      rawText: '',
      data: emptyData()
    };
    invoices.push(invoice);
    renderCard(invoice);
  });

  const skippedNote = skipped ? ` (${skipped} archivo(s) ignorado(s): no son imágenes)` : '';
  setStatus(`${images.length} imagen(es) añadida(s). Pulsa «Leer facturas».${skippedNote}`);
  updateButtons();
}

invoiceInput.addEventListener('change', (event) => {
  addFiles(event.target.files);
  invoiceInput.value = '';
});

['dragenter', 'dragover'].forEach((type) => dropZone.addEventListener(type, (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((type) => dropZone.addEventListener(type, (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
}));
dropZone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));

// ---------- Rendering ----------

function renderCard(invoice) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.id = invoice.id;
  invoice.card = card;

  const thumb = card.querySelector('.thumb');
  thumb.src = invoice.url;
  thumb.addEventListener('click', () => window.open(invoice.url, '_blank'));
  card.querySelector('.file-name').textContent = invoice.file.name;
  card.querySelector('.remove-btn').addEventListener('click', () => removeInvoice(invoice));
  card.querySelector('.add-line-btn').addEventListener('click', () => {
    invoice.data.lineItems.push({ quantity: null, description: '', amount: null });
    renderLineItems(invoice);
  });

  renderForm(invoice);
  renderLineItems(invoice);
  updateCardStatus(invoice);
  resultsNode.appendChild(card);
}

function renderForm(invoice) {
  const form = invoice.card.querySelector('.invoice-form');
  form.innerHTML = '';

  FIELDS.forEach((field) => {
    const wrapper = document.createElement('label');
    wrapper.className = `field${field.wide ? ' wide' : ''}${field.highlight ? ' highlight' : ''}`;

    const caption = document.createElement('span');
    caption.className = 'label';
    caption.textContent = field.label;
    wrapper.appendChild(caption);

    let input;
    const value = invoice.data[field.key];
    if (field.type === 'select') {
      input = document.createElement('select');
      const options = field.options.includes(value) || !value ? field.options : [value, ...field.options];
      options.forEach((option) => {
        const node = document.createElement('option');
        node.value = option;
        node.textContent = option;
        input.appendChild(node);
      });
      input.value = value || field.options[0];
    } else {
      input = document.createElement('input');
      input.type = field.type === 'date' ? 'date' : 'text';
      if (field.type === 'money') {
        input.inputMode = 'decimal';
        input.value = formatNumber(value);
      } else {
        input.value = value ?? '';
      }
    }

    input.name = field.key;
    input.addEventListener('change', () => {
      invoice.data[field.key] = field.type === 'money'
        ? InvoiceParser.parseAmount(input.value)
        : input.value.trim();
      if (field.type === 'money') input.value = formatNumber(invoice.data[field.key]);
      wrapper.classList.toggle('missing', isMissing(invoice, field));
      updateButtons();
    });

    wrapper.classList.toggle('missing', isMissing(invoice, field));
    wrapper.appendChild(input);
    form.appendChild(wrapper);
  });
}

function isMissing(invoice, field) {
  if (invoice.status !== 'done') return false;
  const value = invoice.data[field.key];
  return value === '' || value === null || value === undefined;
}

function renderLineItems(invoice) {
  const tbody = invoice.card.querySelector('.line-items tbody');
  tbody.innerHTML = '';

  invoice.data.lineItems.forEach((item, index) => {
    const row = document.createElement('tr');
    const cells = [
      { key: 'quantity', value: item.quantity ?? '', className: 'qty' },
      { key: 'description', value: item.description, className: 'desc' },
      { key: 'amount', value: formatNumber(item.amount), className: 'num' }
    ];
    cells.forEach(({ key, value, className }) => {
      const cell = document.createElement('td');
      cell.className = className;
      const input = document.createElement('input');
      input.value = value;
      input.addEventListener('change', () => {
        if (key === 'description') item.description = input.value.trim();
        else if (key === 'quantity') item.quantity = input.value.trim() === '' ? null : Number(input.value.replace(',', '.'));
        else {
          item.amount = InvoiceParser.parseAmount(input.value);
          input.value = formatNumber(item.amount);
        }
      });
      cell.appendChild(input);
      row.appendChild(cell);
    });

    const removeCell = document.createElement('td');
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'icon-btn small';
    removeButton.textContent = '✕';
    removeButton.title = 'Quitar concepto';
    removeButton.addEventListener('click', () => {
      invoice.data.lineItems.splice(index, 1);
      renderLineItems(invoice);
    });
    removeCell.appendChild(removeButton);
    row.appendChild(removeCell);
    tbody.appendChild(row);
  });
}

function updateCardStatus(invoice) {
  const { card } = invoice;
  const badge = card.querySelector('.badge');
  badge.textContent = invoice.status === 'processing'
    ? `${STATUS_LABELS.processing} ${Math.round(invoice.progress * 100)}%`
    : STATUS_LABELS[invoice.status];
  badge.dataset.status = invoice.status;
  card.dataset.status = invoice.status;
  card.querySelector('.progress-bar').style.width = `${Math.round(invoice.progress * 100)}%`;
  card.querySelector('.raw-text textarea').value = invoice.rawText;

  const warnings = card.querySelector('.warnings');
  const messages = [...(invoice.data.warnings || [])];
  if (invoice.error) messages.unshift(invoice.error);
  warnings.innerHTML = '';
  messages.forEach((message) => {
    const node = document.createElement('p');
    node.textContent = `⚠ ${message}`;
    warnings.appendChild(node);
  });
}

function removeInvoice(invoice) {
  if (invoice.status === 'processing') return;
  invoices = invoices.filter((item) => item !== invoice);
  URL.revokeObjectURL(invoice.url);
  invoice.card.remove();
  updateButtons();
}

clearButton.addEventListener('click', () => {
  invoices.forEach((invoice) => URL.revokeObjectURL(invoice.url));
  invoices = [];
  setStatus('Esperando imágenes…');
  updateButtons();
});

// ---------- OCR ----------

// Photos come in all sizes and orientations: normalise them before OCR.
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest < 1600 ? 1600 / longest : longest > 3000 ? 3000 / longest : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  context.filter = 'grayscale(1) contrast(1.25)';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

async function getWorker() {
  if (ocrWorker) return ocrWorker;
  setStatus('Cargando el motor de lectura (solo la primera vez)…');
  ocrWorker = await Tesseract.createWorker(['spa', 'eng'], 1, {
    logger: (message) => {
      if (message.status === 'recognizing text' && currentInvoice) {
        currentInvoice.progress = message.progress;
        updateCardStatus(currentInvoice);
      }
    }
  });
  return ocrWorker;
}

async function processInvoice(invoice) {
  invoice.status = 'processing';
  invoice.progress = 0;
  invoice.error = '';
  currentInvoice = invoice;
  updateCardStatus(invoice);

  try {
    const worker = await getWorker();
    const image = await prepareImage(invoice.file);
    const { data } = await worker.recognize(image);
    invoice.rawText = data.text || '';
    invoice.data = { ...emptyData(), ...InvoiceParser.parseInvoiceText(invoice.rawText) };
    if (!invoice.rawText.trim()) invoice.data.warnings.push('No se ha detectado texto. Prueba con una foto más nítida y recta.');
    invoice.status = 'done';
    invoice.progress = 1;
  } catch (error) {
    console.error(error);
    invoice.status = 'error';
    invoice.error = 'No se ha podido leer esta imagen.';
  } finally {
    currentInvoice = null;
  }

  renderForm(invoice);
  renderLineItems(invoice);
  updateCardStatus(invoice);
}

processButton.addEventListener('click', async () => {
  const queue = invoices.filter((invoice) => invoice.status === 'pending' || invoice.status === 'error');
  if (!queue.length) return;

  isProcessing = true;
  updateButtons();

  for (let i = 0; i < queue.length; i += 1) {
    if (!invoices.includes(queue[i])) continue;
    setStatus(`Leyendo factura ${i + 1} de ${queue.length}…`);
    await processInvoice(queue[i]);
    updateButtons();
  }

  isProcessing = false;
  const failed = queue.filter((invoice) => invoice.status === 'error').length;
  setStatus(
    failed ? `Terminado con ${failed} error(es). Puedes reintentarlo.` : 'Todas las facturas leídas. Revisa los campos marcados en amarillo.',
    failed ? 'error' : 'success'
  );
  updateButtons();
});

// ---------- Export ----------

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportRows() {
  return invoices
    .filter((invoice) => invoice.status === 'done')
    .map((invoice) => ({ file: invoice.file.name, ...invoice.data }));
}

exportJsonButton.addEventListener('click', () => {
  const rows = exportRows().map(({ warnings, ...row }) => row);
  download('facturas.json', JSON.stringify(rows, null, 2), 'application/json');
});

// Semicolon separator + decimal comma + BOM so Excel in Spanish opens it correctly.
exportCsvButton.addEventListener('click', () => {
  const columns = [{ key: 'file', label: 'Archivo' }, ...FIELDS, { key: 'lineItems', label: 'Conceptos' }];
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const cell = (row, column) => {
    const value = row[column.key];
    if (column.key === 'lineItems') {
      return value.map((item) => `${item.quantity ? `${item.quantity} x ` : ''}${item.description} (${formatNumber(item.amount)})`).join(' | ');
    }
    if (column.type === 'money') return formatNumber(value);
    return value;
  };

  const lines = [
    columns.map((column) => escape(column.label)).join(';'),
    ...exportRows().map((row) => columns.map((column) => escape(cell(row, column))).join(';'))
  ];
  download('facturas.csv', `﻿${lines.join('\r\n')}`, 'text/csv;charset=utf-8');
});

updateButtons();
