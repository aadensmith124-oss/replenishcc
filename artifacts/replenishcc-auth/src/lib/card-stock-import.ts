export type ImportedGiftCard = {
  cardNumber: string;
  expiration: string;
  securityCode: string;
  email: string | null;
  phone: string | null;
  address: string;
  state: string;
  city: string;
  regionZip: string | null;
  sourceRow: number;
  issues: string[];
};

export type CardStockImport = {
  format: string;
  cards: ImportedGiftCard[];
  message: string;
};

type CardField =
  | 'cardNumber'
  | 'expiration'
  | 'expirationMonth'
  | 'expirationYear'
  | 'securityCode'
  | 'address'
  | 'state'
  | 'city'
  | 'regionZip'
  | 'email'
  | 'phone'
  | 'contact';

type RawCard = {
  values: Partial<Record<CardField, string>>;
  numericSensitiveFields: Set<CardField>;
  sourceRow: number;
};

const aliases: [CardField, string[]][] = [
  ['cardNumber', ['card number', 'card no', 'card #', 'cardnum', 'card', 'cc number', 'ccnum', 'pan', 'primary account number', 'account number', 'gift card number', 'giftcardno', 'number']],
  ['expiration', ['expiration', 'expiration date', 'expiry', 'expiry date', 'exp', 'exp date', 'valid thru', 'valid until', 'month year', 'card expiry', 'card expiration', 'mm/yy', 'mm/yyyy', 'exp date mm yy', 'expiry date mm yy', 'expiration date mm yy']],
  ['expirationMonth', ['expiration month', 'expiry month', 'exp month', 'expmonth', 'month']],
  ['expirationYear', ['expiration year', 'expiry year', 'exp year', 'expyear', 'year']],
  ['securityCode', ['security code', 'security number', 'cvv', 'cvc', 'cvn', 'cv2', 'csc', 'verification code']],
  ['address', ['address', 'billing address', 'street address', 'street', 'redemption address', 'card address']],
  ['state', ['state', 'province', 'region', 'province code']],
  ['city', ['city', 'town', 'municipality']],
  ['regionZip', ['zip', 'zip code', 'zipcode', 'postal', 'postal code', 'postcode', 'region zip', 'redemption zip']],
  ['email', ['email', 'email address']],
  ['phone', ['phone', 'phone number', 'mobile', 'telephone', 'tel']],
  ['contact', ['contact', 'email phone', 'email/phone']],
];

const fieldByNormalizedAlias = new Map<string, CardField>();
for (const [field, names] of aliases) {
  for (const name of [field, ...names]) {
    fieldByNormalizedAlias.set(normalizeHeader(name), field);
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const zipPattern = /^\d{5}(?:-\d{4})?$/;
const phonePattern = /^\+?[\d\s().-]+$/;

function normalizeHeader(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function fieldForHeader(value: string): CardField | null {
  return fieldByNormalizedAlias.get(normalizeHeader(value)) ?? null;
}

function newRawCard(sourceRow: number): RawCard {
  return { values: {}, numericSensitiveFields: new Set(), sourceRow };
}

function setRawValue(raw: RawCard, field: CardField, value: unknown): void {
  if (value === null || value === undefined || typeof value === 'object') return;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return;
  if (typeof value === 'number' && (field === 'cardNumber' || field === 'securityCode')) {
    raw.numericSensitiveFields.add(field);
  }
  raw.values[field] = String(value).trim();
}

function normalizeExpiration(value: string): string {
  const text = value.trim().replace(/\s+/g, '');
  const fullMonthFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (fullMonthFirst) {
    const first = Number(fullMonthFirst[1]);
    const second = Number(fullMonthFirst[2]);
    if (first >= 1 && first <= 12) {
      return `${String(first).padStart(2, '0')}/${fullMonthFirst[3]}`;
    }
    if (second >= 1 && second <= 12) {
      return `${String(second).padStart(2, '0')}/${fullMonthFirst[3]}`;
    }
  }
  const monthFirst = /^(0?[1-9]|1[0-2])[/.-](\d{2}|\d{4})$/.exec(text);
  if (monthFirst) return `${monthFirst[1]!.padStart(2, '0')}/${monthFirst[2]}`;
  const compactMonthFirst = /^(0[1-9]|1[0-2])(\d{2}|\d{4})$/.exec(text);
  if (compactMonthFirst) return `${compactMonthFirst[1]}/${compactMonthFirst[2]}`;
  const yearFirst = /^(\d{4})[-/.](0?[1-9]|1[0-2])(?:[-/.]\d{1,2})?(?:[T ].*)?$/i.exec(text);
  if (yearFirst) return `${yearFirst[2]}/${yearFirst[1]}`;
  const months = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
  const namedMonthFirst = /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[,\s.-]+(?:(?:\d{1,2})[,\s.-]+)?(\d{2}|\d{4})$/i.exec(value.trim());
  const namedMonthLast = /^\d{1,2}[,\s.-]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[,\s.-]+(\d{2}|\d{4})$/i.exec(value.trim());
  const namedMonth = namedMonthFirst ?? namedMonthLast;
  if (namedMonth) {
    const monthPrefix = namedMonth[1]!.slice(0, 3).toLocaleLowerCase();
    const monthIndex = months.indexOf(monthPrefix);
    if (monthIndex >= 0) return `${String(monthIndex + 1).padStart(2, '0')}/${namedMonth[2]}`;
  }
  return text.replace('-', '/');
}

function looksLikeExpiration(value: string): boolean {
  return /^(?:0[1-9]|1[0-2])\/(?:\d{2}|\d{4})$/.test(normalizeExpiration(value));
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function detectContacts(values: string[]): { email: string | null; phone: string | null } {
  let email: string | null = null;
  let phone: string | null = null;
  for (const value of values) {
    const emailMatch = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(value);
    if (!email && emailMatch) email = emailMatch[0];
    const candidates = value.match(/\+?\d[\d\s().-]{7,}\d/g) ?? [];
    const candidate = candidates.find((item) => {
      const length = digitsOnly(item).length;
      return length >= 10 && length <= 15;
    });
    if (!phone && candidate) phone = candidate.trim();
  }
  return { email, phone };
}

function cardFromRaw(raw: RawCard): ImportedGiftCard {
  const values = raw.values;
  const cardNumber = digitsOnly(values.cardNumber ?? '');
  let expirationValue = values.expiration ?? '';
  if (!expirationValue && values.expirationMonth && values.expirationYear) {
    expirationValue = `${values.expirationMonth}/${values.expirationYear}`;
  }
  const expiration = normalizeExpiration(expirationValue);
  const securityCode = values.securityCode ?? '';
  const contact = detectContacts([
    values.contact ?? '',
    values.phone ?? '',
    values.email ?? '',
  ]);
  const email = values.email || contact.email;
  const phone = values.phone || contact.phone;
  const address = values.address ?? '';
  const state = values.state ?? '';
  const city = values.city ?? '';
  const regionZip = values.regionZip || null;
  const issues: string[] = [];

  if (raw.numericSensitiveFields.has('cardNumber')) {
    issues.push('Store the card number as text to preserve every digit.');
  } else if (!/^\d{13,19}$/.test(cardNumber)) {
    issues.push('Check the card number.');
  }
  if (!/^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/.test(expiration)) {
    issues.push('Check the expiration date.');
  }
  if (raw.numericSensitiveFields.has('securityCode')) {
    issues.push('Store the security code as text to preserve leading zeros.');
  } else if (!/^\d{3,4}$/.test(securityCode)) {
    issues.push('Check the security code.');
  }
  if (email && (email.length > 320 || !emailPattern.test(email))) {
    issues.push('Check the email address.');
  }
  if (phone && (phone.length > 40 || !phonePattern.test(phone) || digitsOnly(phone).length < 10 || digitsOnly(phone).length > 15)) {
    issues.push('Check the phone number.');
  }
  if (regionZip && !zipPattern.test(regionZip)) issues.push('Check the ZIP code.');
  if (address.length > 255 || state.length > 80 || city.length > 120) {
    issues.push('A location field is too long.');
  }

  return {
    cardNumber,
    expiration,
    securityCode,
    email: email || null,
    phone: phone || null,
    address,
    state,
    city,
    regionZip,
    sourceRow: raw.sourceRow,
    issues,
  };
}

function valueForCell(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

function rawFromObject(value: Record<string, unknown>, sourceRow: number): RawCard {
  const raw = newRawCard(sourceRow);
  const visit = (object: Record<string, unknown>, depth: number) => {
    if (depth > 3) return;
    for (const [key, fieldValue] of Object.entries(object)) {
      const field = fieldForHeader(key);
      if (field) {
        setRawValue(raw, field, fieldValue);
      } else if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
        visit(fieldValue as Record<string, unknown>, depth + 1);
      }
    }
  };
  visit(value, 0);
  return raw;
}

function rowsFromDelimitedText(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (!quoted && (character === '\n' || character === '\r')) {
      row.push(cell.trim());
      if (row.some((item) => item !== '')) rows.push(row);
      row = [];
      cell = '';
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some((item) => item !== '')) rows.push(row);
  return rows;
}

function requiredHeaderCount(fields: (CardField | null)[]): number {
  const hasExpiration = fields.includes('expiration')
    || (fields.includes('expirationMonth') && fields.includes('expirationYear'));
  return Number(fields.includes('cardNumber'))
    + Number(hasExpiration)
    + Number(fields.includes('securityCode'));
}

function rawFromColumns(
  row: unknown[],
  sourceRow: number,
  headers?: (CardField | null)[],
): RawCard {
  const raw = newRawCard(sourceRow);
  if (headers) {
    row.forEach((value, index) => {
      const field = headers[index];
      if (field) setRawValue(raw, field, value);
    });
    return raw;
  }

  const values = row.map(valueForCell);
  const numberIndex = values.findIndex((value) => {
    const digits = digitsOnly(value);
    return /^[\d\s().-]+$/.test(value) && digits.length >= 13 && digits.length <= 19;
  });
  const expirationIndex = values.findIndex(looksLikeExpiration);
  let separateExpirationIndexes: [number, number] | null = null;
  if (expirationIndex < 0) {
    const monthPattern = /^(?:0?[1-9]|1[0-2])$/;
    const yearPattern = /^(?:\d{2}|20\d{2})$/;
    for (let index = 0; index < values.length - 1; index += 1) {
      if (index === numberIndex || index + 1 === numberIndex) continue;
      if (monthPattern.test(values[index]!) && yearPattern.test(values[index + 1]!)) {
        separateExpirationIndexes = [index, index + 1];
        break;
      }
      if (yearPattern.test(values[index]!) && monthPattern.test(values[index + 1]!)) {
        separateExpirationIndexes = [index + 1, index];
        break;
      }
    }
  }
  const separateExpirationIndexSet = new Set(separateExpirationIndexes ?? []);
  const securityIndex = values.findIndex((value, index) =>
    index !== numberIndex
    && index !== expirationIndex
    && !separateExpirationIndexSet.has(index)
    && /^\d{3,4}$/.test(value),
  );
  const detectedIndexes = new Set([
    numberIndex,
    expirationIndex,
    securityIndex,
    ...(separateExpirationIndexes ?? []),
  ].filter((index) => index >= 0));

  if (numberIndex >= 0) setRawValue(raw, 'cardNumber', values[numberIndex]);
  if (expirationIndex >= 0) setRawValue(raw, 'expiration', values[expirationIndex]);
  else if (separateExpirationIndexes) {
    const [monthIndex, yearIndex] = separateExpirationIndexes;
    setRawValue(raw, 'expiration', `${values[monthIndex]}/${values[yearIndex]}`);
  }
  if (securityIndex >= 0) setRawValue(raw, 'securityCode', values[securityIndex]);

  // Preserve the original layout for optional fields after detecting the required values.
  const extras = values.filter((_, index) => !detectedIndexes.has(index));
  const zipIndex = extras.findIndex((value) => zipPattern.test(value));
  const emailContact = detectContacts(extras);
  const remaining = extras.filter((value, index) =>
    index !== zipIndex
    && !(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value))
    && !(emailContact.phone && value.includes(emailContact.phone)),
  );
  if (remaining[0]) setRawValue(raw, 'address', remaining[0]);
  if (remaining[1]) setRawValue(raw, 'state', remaining[1]);
  if (remaining[2]) setRawValue(raw, 'city', remaining[2]);
  if (zipIndex >= 0) setRawValue(raw, 'regionZip', extras[zipIndex]);
  if (emailContact.email) setRawValue(raw, 'email', emailContact.email);
  if (emailContact.phone) setRawValue(raw, 'phone', emailContact.phone);
  return raw;
}

function parseTable(rows: unknown[][], format: string): CardStockImport | null {
  const nonemptyRows = rows.filter((row) => row.some((cell) => valueForCell(cell) !== ''));
  if (!nonemptyRows.length) return null;
  const firstRow = nonemptyRows[0]!.map((cell) => valueForCell(cell));
  const headerFields = firstRow.map(fieldForHeader);
  const hasHeader = requiredHeaderCount(headerFields) >= 2;
  const dataRows = hasHeader ? nonemptyRows.slice(1) : nonemptyRows;
  const cards = dataRows.map((row, index) =>
    cardFromRaw(rawFromColumns(row, index + 1, hasHeader ? headerFields : undefined)),
  );
  return {
    format,
    cards,
    message: cards.length
      ? ''
      : 'A header row was detected, but no card records were found.',
  };
}

function parseLabeledText(text: string): CardStockImport | null {
  const records: RawCard[] = [];
  let current = newRawCard(1);
  let lineNumber = 0;
  const flush = () => {
    if (Object.keys(current.values).length) records.push(current);
    current = newRawCard(lineNumber + 1);
  };

  for (const line of text.split(/\r?\n/)) {
    lineNumber += 1;
    if (!line.trim()) {
      flush();
      continue;
    }
    const segments = line.split(/(?:[|;]|\s*,\s*(?=[A-Za-z][A-Za-z0-9 _/#-]{0,32}\s*[:=]))/);
    for (const segment of segments) {
      const match = /^\s*([^:=]+?)\s*[:=]\s*(.*?)\s*$/.exec(segment);
      if (!match) continue;
      const field = fieldForHeader(match[1]!);
      if (!field) continue;
      if (field === 'cardNumber' && current.values.cardNumber) flush();
      current.sourceRow = lineNumber;
      setRawValue(current, field, match[2]!.replace(/^["']|["']$/g, ''));
    }
  }
  flush();
  const cards = records
    .filter((record) => record.values.cardNumber || record.values.expiration || record.values.securityCode)
    .map(cardFromRaw);
  if (!cards.length) return null;
  return { format: 'Labeled text', cards, message: '' };
}

function parseJsonValue(value: unknown): CardStockImport | null {
  if (Array.isArray(value)) {
    if (value.every((entry) => Array.isArray(entry))) {
      const rows = value as unknown[][];
      return parseTable(rows, 'JSON table');
    }
    const cards = value
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
      .map((entry, index) => cardFromRaw(rawFromObject(entry, index + 1)));
    return cards.length ? { format: 'JSON', cards, message: '' } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const object = value as Record<string, unknown>;
  for (const key of ['cards', 'records', 'items', 'data', 'rows']) {
    const nested = object[key];
    if (Array.isArray(nested) || (nested && typeof nested === 'object')) {
      const parsed = parseJsonValue(nested);
      if (parsed) return { ...parsed, format: 'JSON' };
    }
  }
  const raw = rawFromObject(object, 1);
  if (Object.keys(raw.values).length) {
    return { format: 'JSON', cards: [cardFromRaw(raw)], message: '' };
  }
  return null;
}

function parseJsonText(text: string): CardStockImport | null {
  try {
    return parseJsonValue(JSON.parse(text) as unknown);
  } catch {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return null;
    try {
      const entries = lines.map((line) => JSON.parse(line) as unknown);
      const parsed = parseJsonValue(entries);
      return parsed ? { ...parsed, format: 'JSON Lines' } : null;
    } catch {
      return null;
    }
  }
}

function bestDelimitedTable(text: string): CardStockImport | null {
  const candidates = [
    { character: ',', label: 'CSV' },
    { character: '\t', label: 'TSV' },
    { character: '|', label: 'Pipe-delimited text' },
    { character: ';', label: 'Semicolon-delimited text' },
    { character: ':', label: 'Colon-delimited text' },
  ];
  let best: { rows: string[][]; label: string; score: number } | null = null;
  for (const candidate of candidates) {
    const rows = rowsFromDelimitedText(text, candidate.character);
    const sample = rows.slice(0, 20);
    if (!sample.length) continue;
    const widths = new Map<number, number>();
    for (const row of sample) widths.set(row.length, (widths.get(row.length) ?? 0) + 1);
    const [commonWidth, commonCount] = [...widths.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0])[0]!;
    const headerCount = requiredHeaderCount(sample[0]!.map(fieldForHeader));
    const score = headerCount >= 2 ? 1000 + headerCount * 100 + commonWidth : commonWidth >= 3 ? commonCount * 10 + commonWidth : 0;
    if (score > (best?.score ?? 0)) best = { rows, label: candidate.label, score };
  }
  if (!best) return null;
  return parseTable(best.rows, best.label);
}

export function parseCardStockInput(input: string): CardStockImport {
  const text = input.replace(/^\uFEFF/, '').trim();
  if (!text) return { format: 'Waiting for data', cards: [], message: 'Choose a card file or paste card data to preview it.' };

  const json = parseJsonText(text);
  if (json?.cards.length) return json;

  const labeled = parseLabeledText(text);
  if (labeled) return labeled;

  const delimited = bestDelimitedTable(text);
  if (delimited?.cards.length) return delimited;

  return {
    format: 'Not recognized',
    cards: [],
    message: 'Could not detect card records. Try a CSV, TSV, TXT, or JSON file with card numbers, expiration dates, and security codes.',
  };
}