// Invoice text parser: turns raw OCR text into structured invoice fields.
// Works in the browser (window.InvoiceParser) and in Node (module.exports) for testing.
(function (root) {
  const AMOUNT_SOURCE = String.raw`-?\d{1,3}(?:[.,\s]\d{3})*[.,]\d{2}(?!\d)|-?\d+[.,]\d{2}(?!\d)`;

  const DOCUMENT_TYPES = [
    { type: 'Factura rectificativa', patterns: [/rectificativa/i, /\babono\b/i, /credit\s*note/i, /nota\s+de\s+cr[eé]dito/i] },
    { type: 'Factura proforma', patterns: [/pro\s*-?\s*forma/i] },
    { type: 'Factura simplificada / ticket', patterns: [/factura\s+simplificada/i, /\bticket\b/i, /\btiquet\b/i, /\breceipt\b/i, /\bcambio\b/i, /\bentregado\b/i] },
    { type: 'Presupuesto', patterns: [/presupuesto/i, /\bquot(?:e|ation)\b/i] },
    { type: 'Recibo', patterns: [/\brecibo\b/i] },
    { type: 'Factura', patterns: [/factura/i, /invoice/i, /\bfra\b\.?/i] }
  ];

  const MONTHS = {
    ene: 1, enero: 1, jan: 1, january: 1,
    feb: 2, febrero: 2, february: 2,
    mar: 3, marzo: 3, march: 3,
    abr: 4, abril: 4, apr: 4, april: 4,
    may: 5, mayo: 5,
    jun: 6, junio: 6, june: 6,
    jul: 7, julio: 7, july: 7,
    ago: 8, agosto: 8, aug: 8, august: 8,
    sep: 9, sept: 9, septiembre: 9, setiembre: 9, september: 9,
    oct: 10, octubre: 10, october: 10,
    nov: 11, noviembre: 11, november: 11,
    dic: 12, diciembre: 12, dec: 12, december: 12
  };

  const TAX_ID_PATTERNS = [
    /\b(?:ES)?[ABCDEFGHJNPQRSUVW][\s.-]?\d{7}[0-9A-J]\b/gi, // CIF
    /\b(?:ES)?\d{8}[\s.-]?[A-Z]\b/gi, // NIF / DNI
    /\b(?:ES)?[XYZ][\s.-]?\d{7}[\s.-]?[A-Z]\b/gi, // NIE
    /\b(?:AT|BE|DE|FR|IT|NL|PT|GB|IE|LU)[A-Z0-9]{8,12}\b/g // other EU VAT ids
  ];

  const LABELS = {
    invoiceNumber: [
      String.raw`n[º°o]\.?\s*(?:de\s+)?factura`, String.raw`factura\s*(?:n[º°o]\.?|n[uú]m(?:ero)?\.?|#)`,
      String.raw`n[uú]mero\s+(?:de\s+)?factura`, String.raw`invoice\s*(?:no\.?|number|num\.?|#)`,
      String.raw`fra\.?\s*n[º°o]\.?`, String.raw`ticket\s*(?:n[º°o]\.?|#)?`, String.raw`n[º°o]\s*(?:de\s+)?ticket`,
      String.raw`n[uú]m(?:ero)?\.?\s*(?:doc(?:umento)?)?`, String.raw`n[º°o]\.?\s*doc(?:umento)?`,
      String.raw`receipt\s*(?:no\.?|#)`, String.raw`factura\s+simplificada`, String.raw`factura`, String.raw`invoice`,
      String.raw`ref(?:erencia|erence)?\.?`, String.raw`n[º°o]\.?`
    ],
    issueDate: [
      String.raw`fecha\s+(?:de\s+)?(?:factura|emisi[oó]n|expedici[oó]n)`, String.raw`invoice\s+date`,
      String.raw`date\s+of\s+issue`, String.raw`issue\s+date`, String.raw`fecha`, String.raw`date`
    ],
    dueDate: [
      String.raw`fecha\s+(?:de\s+)?vencimiento`, String.raw`vencimiento`, String.raw`vto\.?`,
      String.raw`due\s+date`, String.raw`payment\s+due`, String.raw`pagar\s+antes\s+de`
    ],
    subtotal: [
      String.raw`base\s+imponible`, String.raw`total\s+base`, String.raw`base`, String.raw`importe\s+neto`,
      String.raw`subtotal`, String.raw`sub-total`, String.raw`net\s+(?:amount|total)`, String.raw`total\s+neto`, String.raw`neto`
    ],
    tax: [String.raw`cuota\s+i\.?v\.?a\.?`, String.raw`i\.?v\.?a\.?`, String.raw`vat`, String.raw`igic`, String.raw`impuestos?`, String.raw`tax`],
    withholding: [String.raw`i\.?r\.?p\.?f\.?`, String.raw`retenci[oó]n`, String.raw`withholding`],
    total: [
      String.raw`total\s+(?:factura|a\s+pagar|importe|eur|€)`, String.raw`importe\s+total`, String.raw`total\s+(?:due|amount|payable)`,
      String.raw`amount\s+due`, String.raw`grand\s+total`, String.raw`a\s+pagar`, String.raw`total`
    ],
    customer: [
      String.raw`facturar\s+a`, String.raw`datos\s+(?:del\s+)?cliente`, String.raw`cliente`, String.raw`destinatario`,
      String.raw`bill\s+to`, String.raw`billed\s+to`, String.raw`customer`, String.raw`sold\s+to`
    ],
    paymentMethod: [String.raw`forma\s+de\s+pago`, String.raw`m[eé]todo\s+de\s+pago`, String.raw`medio\s+de\s+pago`, String.raw`payment\s+method`, String.raw`pago`]
  };

  const PAYMENT_KEYWORDS = [
    ['Tarjeta', /tarjeta|card|visa|mastercard|amex|contactless|tpv|dat[aá]fono/i],
    ['Efectivo', /efectivo|cash|metálico|metalico/i],
    ['Transferencia', /transferencia|bank\s+transfer|wire/i],
    ['Domiciliación', /domiciliaci[oó]n|recibo\s+domiciliado|direct\s+debit|sepa/i],
    ['Bizum', /bizum/i],
    ['PayPal', /paypal/i]
  ];

  const SUMMARY_LINE = /total|subtotal|base|i\.?v\.?a|vat|tax|impuesto|irpf|retenci|cambio|entregado|efectivo|tarjeta|pago|vencimiento|iban|n\.?i\.?f|c\.?i\.?f|fecha|date|tel[eé]fono|tlf|email|factura|invoice/i;

  function labelRegex(label, flags = 'i') {
    return new RegExp(`(?:^|[^a-záéíóúñ])(?:${label})(?![a-záéíóúñ])`, flags);
  }

  function cleanLines(text) {
    return text
      .replace(/ /g, ' ')
      .split(/\r?\n/)
      .map((line) => line.replace(/[|*_~]+/g, ' ').replace(/\s{2,}/g, ' ').trim())
      .filter(Boolean);
  }

  function parseAmount(raw) {
    if (raw == null) return null;
    let value = String(raw).replace(/[^\d.,\s-]/g, '').trim();
    const negative = value.startsWith('-');
    value = value.replace(/[-\s]/g, '');
    if (!value) return null;

    const lastDot = value.lastIndexOf('.');
    const lastComma = value.lastIndexOf(',');
    const decimalIndex = Math.max(lastDot, lastComma);
    let normalized;

    if (decimalIndex === -1) {
      normalized = value;
    } else {
      const decimals = value.length - decimalIndex - 1;
      const onlyOneSeparatorKind = lastDot === -1 || lastComma === -1;
      if (onlyOneSeparatorKind && decimals === 3) {
        normalized = value.replace(/[.,]/g, ''); // "1.234" -> thousands
      } else {
        normalized = value.slice(0, decimalIndex).replace(/[.,]/g, '') + '.' + value.slice(decimalIndex + 1);
      }
    }

    const number = Number(normalized);
    if (Number.isNaN(number)) return null;
    return Math.round((negative ? -number : number) * 100) / 100;
  }

  function amountsInLine(line) {
    const withoutPercents = line.replace(/\d{1,2}(?:[.,]\d{1,2})?\s*%/g, ' ');
    const withoutDates = withoutPercents.replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, ' ');
    const matches = withoutDates.match(new RegExp(AMOUNT_SOURCE, 'g')) || [];
    return matches.map(parseAmount).filter((value) => value !== null);
  }

  function findLabeledLine(lines, labels, { exclude } = {}) {
    for (const label of labels) {
      const regex = labelRegex(label);
      for (let i = 0; i < lines.length; i += 1) {
        if (regex.test(lines[i]) && !(exclude && exclude.test(lines[i]))) {
          return { index: i, line: lines[i], regex };
        }
      }
    }
    return null;
  }

  function findLabeledAmount(lines, labels, options = {}) {
    for (const label of labels) {
      const regex = labelRegex(label);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!regex.test(line) || (options.exclude && options.exclude.test(line))) continue;
        const afterLabel = line.slice(line.search(regex));
        const amounts = amountsInLine(afterLabel);
        if (amounts.length) return { value: amounts[amounts.length - 1], line, index: i };
        const next = lines[i + 1];
        if (next && !SUMMARY_LINE.test(next)) {
          const nextAmounts = amountsInLine(next);
          if (nextAmounts.length) return { value: nextAmounts[0], line, index: i };
        }
      }
    }
    return null;
  }

  function toIsoDate(day, month, year) {
    let y = Number(year);
    if (y < 100) y += 2000;
    const d = Number(day);
    const m = Number(month);
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function datesInText(text) {
    const found = [];
    const numeric = /\b(\d{1,4})[/.-](\d{1,2})[/.-](\d{2,4})\b/g;
    let match;
    while ((match = numeric.exec(text))) {
      const [, a, b, c] = match;
      let iso = null;
      if (a.length === 4) iso = toIsoDate(c, b, a);
      else if (Number(b) > 12 && Number(a) <= 12) iso = toIsoDate(b, a, c); // US style mm/dd/yyyy
      else iso = toIsoDate(a, b, c); // European dd/mm/yyyy
      if (iso) found.push({ iso, index: match.index });
    }

    const monthNames = Object.keys(MONTHS).sort((x, y) => y.length - x.length).join('|');
    const textual = new RegExp(`\\b(\\d{1,2})(?:\\s+de)?[\\s-]+(${monthNames})\\.?(?:\\s+de)?[\\s,-]+(\\d{2,4})\\b`, 'gi');
    while ((match = textual.exec(text))) {
      const iso = toIsoDate(match[1], MONTHS[match[2].toLowerCase()], match[3]);
      if (iso) found.push({ iso, index: match.index });
    }
    const english = new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi');
    while ((match = english.exec(text))) {
      const iso = toIsoDate(match[2], MONTHS[match[1].toLowerCase()], match[3]);
      if (iso) found.push({ iso, index: match.index });
    }

    return found.sort((x, y) => x.index - y.index);
  }

  function findLabeledDate(lines, labels, exclude) {
    for (const label of labels) {
      const regex = labelRegex(label);
      for (let i = 0; i < lines.length; i += 1) {
        if (!regex.test(lines[i]) || (exclude && exclude.test(lines[i]))) continue;
        const after = lines[i].slice(lines[i].search(regex));
        const dates = datesInText(after);
        if (dates.length) return dates[0].iso;
        if (lines[i + 1]) {
          const nextDates = datesInText(lines[i + 1]);
          if (nextDates.length) return nextDates[0].iso;
        }
      }
    }
    return '';
  }

  function detectDocumentType(text) {
    for (const { type, patterns } of DOCUMENT_TYPES) {
      if (patterns.some((pattern) => pattern.test(text))) return type;
    }
    return 'Desconocido';
  }

  function detectCurrency(text) {
    if (/€|\bEUR\b|euros?/i.test(text)) return 'EUR';
    if (/£|\bGBP\b/i.test(text)) return 'GBP';
    if (/\$|\bUSD\b/i.test(text)) return 'USD';
    if (/\bCHF\b/i.test(text)) return 'CHF';
    return 'EUR';
  }

  function normalizeTaxId(raw) {
    return raw.replace(/[\s.-]/g, '').toUpperCase();
  }

  function findTaxIds(lines) {
    const ids = [];
    lines.forEach((line, index) => {
      // Ignore phone numbers and IBANs that can look like tax ids.
      if (/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,}/.test(line)) return;
      TAX_ID_PATTERNS.forEach((pattern) => {
        for (const match of line.matchAll(pattern)) {
          const id = normalizeTaxId(match[0]);
          if (!ids.some((existing) => existing.id === id)) ids.push({ id, index, position: match.index });
        }
      });
    });
    return ids.sort((a, b) => a.index - b.index || a.position - b.position);
  }

  function isCompanyLike(line) {
    return /[a-záéíóúñ]{3}/i.test(line) &&
      !/^\d/.test(line) &&
      !SUMMARY_LINE.test(line) &&
      !/@|www\.|https?:|\b(?:calle|c\/|avda|avenida|plaza|pza|cp|c\.p\.)\b/i.test(line) &&
      amountsInLine(line).length === 0;
  }

  function extractVendor(lines, customerIndex) {
    const searchUntil = customerIndex >= 0 ? customerIndex : Math.min(lines.length, 8);
    const companySuffix = /\b(?:S\.?L\.?U?|S\.?A\.?U?|S\.?C\.?P?|S\.?COOP|LTD|LLC|INC|GMBH|SAS|SARL|BV)\b\.?/i;
    const head = lines.slice(0, Math.max(searchUntil, 1));
    const withSuffix = head.find((line) => companySuffix.test(line) && !/cliente|customer|bill\s+to/i.test(line));
    if (withSuffix) return withSuffix.replace(/^(?:emisor|proveedor|vendor|from)\s*:?\s*/i, '');
    const firstName = head.find(isCompanyLike);
    return firstName || '';
  }

  function extractCustomer(lines) {
    const hit = findLabeledLine(lines, LABELS.customer);
    if (!hit) return { name: '', index: -1 };
    const sameLine = hit.line.slice(hit.line.search(hit.regex)).replace(hit.regex, '').replace(/^[\s:.-]+/, '').trim();
    if (sameLine && /[a-záéíóúñ]{3}/i.test(sameLine) && !/^n[º°o]/i.test(sameLine)) {
      return { name: sameLine, index: hit.index };
    }
    for (let i = hit.index + 1; i < Math.min(lines.length, hit.index + 4); i += 1) {
      if (isCompanyLike(lines[i])) return { name: lines[i], index: hit.index };
    }
    return { name: '', index: hit.index };
  }

  function extractInvoiceNumber(lines) {
    for (const label of LABELS.invoiceNumber) {
      const regex = new RegExp(`(?:^|[^a-záéíóúñ])(?:${label})\\s*[:.#-]?\\s*([A-Z0-9][A-Z0-9/._-]{1,24})`, 'i');
      for (const line of lines) {
        if (/n\.?i\.?f|c\.?i\.?f|tel[eé]fono|tlf|iban|cuenta|pedido|order|cliente\s+n/i.test(line) && !/factura|invoice|ticket/i.test(line)) continue;
        const match = line.match(regex);
        if (!match) continue;
        const candidate = match[1].replace(/[.:-]+$/, '');
        if (/\d/.test(candidate) && !datesInText(candidate).length && !/^\d{1,2}[.,]\d{2}$/.test(candidate)) {
          return candidate.toUpperCase();
        }
      }
    }
    return '';
  }

  function extractTax(lines) {
    const excluded = /base|total\s+(?:con|incl)|incluido|incl\.|\bnif\b|\bcif\b/i;
    const rates = [];
    let amount = null;
    for (const label of LABELS.tax) {
      const regex = labelRegex(label);
      lines.forEach((line, index) => {
        if (!regex.test(line) || excluded.test(line)) return;
        const rateMatch = line.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
        if (rateMatch) {
          const rate = parseAmount(rateMatch[1].includes(',') || rateMatch[1].includes('.') ? rateMatch[1] : `${rateMatch[1]},00`);
          if (rate !== null && !rates.includes(rate)) rates.push(rate);
        }
        const values = amountsInLine(line.slice(line.search(regex)));
        let value = values.length ? values[values.length - 1] : null;
        if (value === null && lines[index + 1] && !SUMMARY_LINE.test(lines[index + 1])) {
          const next = amountsInLine(lines[index + 1]);
          if (next.length) value = next[next.length - 1];
        }
        if (value !== null) amount = (amount || 0) + value;
      });
      if (amount !== null || rates.length) break;
    }
    return { amount: amount === null ? null : Math.round(amount * 100) / 100, rates };
  }

  // Tickets often print a VAT breakdown table: "10% 2,05 0,21" (rate, base, cuota) per row.
  function extractTaxBreakdown(lines) {
    const rows = [];
    const rowRegex = new RegExp(`^(?:i\\.?v\\.?a\\.?\\s*)?(\\d{1,2}(?:[.,]\\d{1,2})?)\\s*%\\s+(${AMOUNT_SOURCE})\\s*€?\\s+(${AMOUNT_SOURCE})\\s*€?(?:\\s+(${AMOUNT_SOURCE})\\s*€?)?$`, 'i');
    lines.forEach((line) => {
      const match = line.match(rowRegex);
      if (!match) return;
      const base = parseAmount(match[2]);
      const quota = parseAmount(match[3]);
      if (base === null || quota === null || quota > base) return;
      rows.push({ rate: parseAmount(match[1].replace(/^(\d+)$/, '$1,00')), base, quota });
    });
    return rows;
  }

  function extractWithholding(lines) {
    const hit = findLabeledAmount(lines, LABELS.withholding);
    if (!hit) return { amount: null, rate: null };
    const rateMatch = hit.line.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
    return { amount: Math.abs(hit.value), rate: rateMatch ? parseAmount(`${rateMatch[1]}`.replace(/^(\d+)$/, '$1,00')) : null };
  }

  function extractTotal(lines) {
    const excludeSubtotals = /sub\s*-?\s*total|total\s+base|total\s+neto|total\s+i\.?v\.?a|total\s+impuestos?|total\s+(?:art[ií]culos|unidades|items|uds)|total\s+dto/i;
    const hit = findLabeledAmount(lines, LABELS.total, { exclude: excludeSubtotals });
    if (hit) return hit.value;
    const all = lines.flatMap(amountsInLine);
    return all.length ? Math.max(...all) : null;
  }

  function extractIban(text) {
    const match = text.replace(/ /g, ' ').match(/\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]{4}){3,7}(?:[\s-]?[A-Z0-9]{1,3})?\b/);
    return match ? match[0].replace(/[\s-]/g, '').replace(/(.{4})/g, '$1 ').trim() : '';
  }

  function extractPaymentMethod(lines, text) {
    const hit = findLabeledLine(lines, LABELS.paymentMethod);
    if (hit) {
      const after = hit.line.slice(hit.line.search(hit.regex)).replace(hit.regex, '').replace(/^[\s:.-]+/, '').trim();
      for (const [name, pattern] of PAYMENT_KEYWORDS) if (pattern.test(after)) return name;
      if (after && /[a-z]{3}/i.test(after)) return after;
    }
    for (const [name, pattern] of PAYMENT_KEYWORDS) if (pattern.test(text)) return name;
    return '';
  }

  function extractLineItems(lines) {
    const items = [];
    lines.forEach((line) => {
      if (SUMMARY_LINE.test(line) || /^\s*(?:descripci[oó]n|concepto|art[ií]culo|cant|uds|qty|description|item)\b/i.test(line)) return;
      const amounts = amountsInLine(line);
      if (!amounts.length) return;
      const description = line
        .replace(new RegExp(AMOUNT_SOURCE, 'g'), ' ')
        .replace(/[€$£]|\bEUR\b/gi, ' ')
        .replace(/\d{1,2}(?:[.,]\d{1,2})?\s*%/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (!/[a-záéíóúñ]{3}/i.test(description)) return;
      const quantityMatch = description.match(/^(\d{1,4})\s*(?:x|ud|uds|u\.?)?\s+(.+)$/i);
      items.push({
        quantity: quantityMatch ? Number(quantityMatch[1]) : null,
        description: (quantityMatch ? quantityMatch[2] : description).replace(/\s+\d{1,4}$/, '').trim(),
        amount: amounts[amounts.length - 1]
      });
    });
    return items;
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  function parseInvoiceText(text) {
    const lines = cleanLines(text || '');
    const fullText = lines.join('\n');

    const customer = extractCustomer(lines);
    const taxIds = findTaxIds(lines);
    const vendorTaxId = taxIds.find((entry) => customer.index < 0 || entry.index < customer.index) || taxIds[0];
    const customerTaxId = taxIds.find((entry) => entry !== vendorTaxId && (customer.index < 0 || entry.index >= customer.index));

    const tax = extractTax(lines);
    const breakdown = extractTaxBreakdown(lines);
    if (breakdown.length) {
      tax.amount = round2(breakdown.reduce((sum, row) => sum + row.quota, 0));
      tax.rates = [...new Set(breakdown.map((row) => row.rate))];
    }
    const withholding = extractWithholding(lines);
    let subtotal = null;
    if (breakdown.length) subtotal = round2(breakdown.reduce((sum, row) => sum + row.base, 0));
    else {
      const hit = findLabeledAmount(lines, LABELS.subtotal, { exclude: /i\.?v\.?a\s+incl|imponible\s+exenta/i });
      subtotal = hit ? hit.value : null;
    }
    let total = extractTotal(lines);
    let taxAmount = tax.amount;
    let taxRate = tax.rates.length === 1 ? tax.rates[0] : null;

    // Fill gaps from the arithmetic relationship base + IVA - IRPF = total.
    const irpf = withholding.amount || 0;
    if (subtotal === null && total !== null && taxAmount !== null) subtotal = round2(total - taxAmount + irpf);
    if (taxAmount === null && subtotal !== null && total !== null && total >= subtotal) taxAmount = round2(total - subtotal + irpf);
    if (taxAmount === null && subtotal !== null && taxRate !== null) taxAmount = round2(subtotal * taxRate / 100);
    if (total === null && subtotal !== null && taxAmount !== null) total = round2(subtotal + taxAmount - irpf);
    if (tax.rates.length > 1) taxRate = tax.rates.join(' / ');
    if (taxRate === null && subtotal && taxAmount !== null) {
      const computed = round2((taxAmount / subtotal) * 100);
      const standard = [0, 4, 5, 7, 10, 20, 21, 23].find((rate) => Math.abs(rate - computed) < 0.15);
      if (standard !== undefined) taxRate = standard;
      else if (computed <= 30) taxRate = computed;
    }

    const warnings = [];
    if (subtotal !== null && taxAmount !== null && total !== null) {
      const expected = round2(subtotal + taxAmount - irpf);
      if (Math.abs(expected - total) > 0.05) {
        warnings.push(`Base + IVA − IRPF (${expected.toFixed(2)}) no coincide con el total (${total.toFixed(2)}).`);
      }
    }

    const issueDate = findLabeledDate(lines, LABELS.issueDate, /vencimiento|due|vto/i) || (datesInText(fullText)[0] || {}).iso || '';
    const emailMatch = fullText.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
    const phoneMatch = fullText.match(/(?:tel[eé]fono|tel\.?|tlf\.?|m[oó]vil|phone)\s*[:.]?\s*(\+?[\d\s]{9,15}\d)/i);

    return {
      documentType: detectDocumentType(fullText),
      vendor: extractVendor(lines, customer.index),
      vendorTaxId: vendorTaxId ? vendorTaxId.id : '',
      vendorEmail: emailMatch ? emailMatch[0] : '',
      vendorPhone: phoneMatch ? phoneMatch[1].replace(/\s+/g, ' ').trim() : '',
      customer: customer.name,
      customerTaxId: customerTaxId ? customerTaxId.id : '',
      invoiceNumber: extractInvoiceNumber(lines),
      issueDate,
      dueDate: findLabeledDate(lines, LABELS.dueDate),
      currency: detectCurrency(fullText),
      subtotal,
      taxRate,
      taxAmount,
      withholdingRate: withholding.rate,
      withholdingAmount: withholding.amount,
      total,
      paymentMethod: extractPaymentMethod(lines, fullText),
      iban: extractIban(fullText),
      lineItems: extractLineItems(lines),
      warnings
    };
  }

  const api = { parseInvoiceText, parseAmount, datesInText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvoiceParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
