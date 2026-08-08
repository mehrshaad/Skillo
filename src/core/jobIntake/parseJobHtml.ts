import type { ParsedJob } from './types';

/**
 * Parses a LinkedIn job page or the jobs-guest API fragment.
 *
 * Verified against real responses (see tests/fixtures/linkedin): both the
 * jobs-guest API fragment and the credential-less public page render the same
 * semantic `topcard__*` / `description__job-criteria-*` classes. Neither
 * currently ships JSON-LD, but we still try it first because it is the most
 * stable shape whenever LinkedIn does emit it.
 */
export function parseJobDocument(doc: Document): ParsedJob | null {
  return parseJsonLd(doc) ?? parseSemantic(doc) ?? null;
}

const MIN_DESCRIPTION_CHARS = 80;

/* ------------------------------------------------------------------ JSON-LD */

function parseJsonLd(doc: Document): ParsedJob | null {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of Array.from(scripts)) {
    const posting = findJobPosting(safeJsonParse(script.textContent ?? ''));
    if (!posting) continue;

    const description = htmlStringToText(doc, str(posting.description));
    if (description.length < MIN_DESCRIPTION_CHARS) continue;

    return {
      title: str(posting.title),
      company: str(asRecord(posting.hiringOrganization)?.name),
      location: jsonLdLocation(posting),
      seniority: str(posting.experienceRequirements) || undefined,
      employmentType: normalizeEmploymentType(posting.employmentType),
      salary: jsonLdSalary(posting),
      descriptionText: description,
    };
  }
  return null;
}

/** JSON-LD may be a bare object, an array, or wrapped in an @graph. */
function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  const obj = asRecord(value);
  if (!obj) return null;
  const type = obj['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) {
    return obj;
  }
  if (obj['@graph']) return findJobPosting(obj['@graph']);
  return null;
}

function jsonLdLocation(posting: Record<string, unknown>): string {
  const loc = Array.isArray(posting.jobLocation) ? posting.jobLocation[0] : posting.jobLocation;
  const address = asRecord(asRecord(loc)?.address);
  if (!address) return '';
  return [address.addressLocality, address.addressRegion, address.addressCountry]
    .map(str)
    .filter(Boolean)
    .join(', ');
}

/** Most postings state no pay. Absent must stay absent — never "unknown". */
function jsonLdSalary(posting: Record<string, unknown>): string | undefined {
  const base = asRecord(posting.baseSalary);
  if (!base) return undefined;

  const value = asRecord(base.value) ?? base;
  const min = num(value.minValue);
  const max = num(value.maxValue);
  const single = num(value.value);

  const amount =
    min !== null && max !== null && min !== max
      ? `${money(min)}–${money(max)}`
      : money(min ?? max ?? single);
  if (!amount) return undefined;

  const currency = symbolFor(str(base.currency) || str(value.currency));
  const period = periodFor(str(value.unitText));

  return `${currency}${amount}${period}`;
}

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$' };

function symbolFor(code: string): string {
  if (!code) return '';
  return SYMBOLS[code.toUpperCase()] ?? `${code.toUpperCase()} `;
}

function periodFor(unitText: string): string {
  const unit = unitText.toUpperCase();
  if (unit === 'YEAR') return ' / year';
  if (unit === 'MONTH') return ' / month';
  if (unit === 'WEEK') return ' / week';
  if (unit === 'DAY') return ' / day';
  if (unit === 'HOUR') return ' / hour';
  return '';
}

/** Thousands separators, and no decimals on a salary. */
function money(value: number | null): string {
  if (value === null) return '';
  return Math.round(value).toLocaleString('en-US');
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[, ]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeEmploymentType(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value.join(', ') : str(value);
  if (!raw) return undefined;
  // Schema.org uses FULL_TIME / PART_TIME; present it the way LinkedIn does.
  return raw
    .split(/,\s*/)
    .map((part) =>
      /^[A-Z_]+$/.test(part)
        ? part
            .toLowerCase()
            .split('_')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join('-')
        : part,
    )
    .join(', ');
}

/* ---------------------------------------------------------------- selectors */

/** Tolerant selector lists — first match wins. LinkedIn renames classes often. */
const SELECTORS = {
  title: ['.topcard__title', '.top-card-layout__title', 'h1.topcard__title', 'h1', 'h2.topcard__title'],
  company: ['.topcard__org-name-link', '.topcard__flavor--black-link', 'a[data-tracking-control-name*="topcard-org-name"]'],
  location: ['.topcard__flavor--bullet', '.topcard__flavor.topcard__flavor--bullet'],
  description: ['.show-more-less-html__markup', '.description__text', '.jobs-description__container', '.jobs-box__html-content'],
  salary: ['.compensation__salary', '.salary.compensation__salary', '.compensation__salary-range'],
} as const;

function parseSemantic(doc: Document): ParsedJob | null {
  const descEl = pick(doc, SELECTORS.description);
  if (!descEl) return null;

  const descriptionText = htmlToText(descEl);
  if (descriptionText.length < MIN_DESCRIPTION_CHARS) return null;

  const criteria = parseCriteria(doc);

  return {
    title: textOf(pick(doc, SELECTORS.title)),
    company: textOf(pick(doc, SELECTORS.company)),
    location: textOf(pick(doc, SELECTORS.location)),
    seniority: criteria['seniority level'],
    employmentType: criteria['employment type'],
    workplaceType: criteria['workplace type'],
    salary: textOf(pick(doc, SELECTORS.salary)) || undefined,
    descriptionText,
  };
}

/** The "Seniority level / Employment type / Job function / Industries" list. */
function parseCriteria(doc: Document): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  const items = doc.querySelectorAll('.description__job-criteria-item, li.description__job-criteria-item');
  for (const item of Array.from(items)) {
    const label = textOf(item.querySelector('.description__job-criteria-subheader')).toLowerCase();
    const value = textOf(item.querySelector('.description__job-criteria-text'));
    if (label && value) out[label] = value;
  }
  return out;
}

function pick(doc: Document, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (el) return el;
  }
  return null;
}

/* -------------------------------------------------------------------- text */

/** Break before and after. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'BR', 'TR', 'SECTION', 'ARTICLE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'FOOTER', 'BLOCKQUOTE',
]);
/** Break before only — a trailing break too would blank-line between bullets. */
const LEADING_BREAK_TAGS = new Set(['LI']);
/** Break after only — separates whatever follows the list from the last bullet. */
const TRAILING_BREAK_TAGS = new Set(['UL', 'OL']);

/**
 * Block-aware text extraction. `innerText` is unavailable on documents produced
 * by DOMParser (no layout), so paragraph breaks are reconstructed from tags.
 */
export function htmlToText(root: Element): string {
  const parts: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === 3 /* text */) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== 1 /* element */) return;

    const el = node as Element;
    if (el.tagName === 'BR') {
      parts.push('\n');
      return;
    }

    const isBlock = BLOCK_TAGS.has(el.tagName);
    const breakBefore = isBlock || LEADING_BREAK_TAGS.has(el.tagName);
    const breakAfter = isBlock || TRAILING_BREAK_TAGS.has(el.tagName);

    if (breakBefore) parts.push('\n');
    if (el.tagName === 'LI') parts.push('• ');
    for (const child of Array.from(el.childNodes)) walk(child);
    if (breakAfter) parts.push('\n');
  };

  walk(root);

  return parts
    .join('')
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Turns an HTML string (e.g. a JSON-LD description) into plain text. */
export function htmlStringToText(doc: Document, html: string): string {
  if (!html) return '';
  const holder = doc.createElement('div');
  holder.innerHTML = html;
  return htmlToText(holder);
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------- utils */

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}
