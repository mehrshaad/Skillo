import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { htmlToText, parseJobDocument } from '@/core/jobIntake/parseJobHtml';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, 'fixtures/linkedin', name), 'utf8');

const parse = (html: string) =>
  parseJobDocument(new DOMParser().parseFromString(html, 'text/html'));

describe('parseJobDocument — jobs-guest API fragment', () => {
  it('extracts every field from a real posting', () => {
    const job = parse(fixture('guest-api-4432351584.html'));
    expect(job).not.toBeNull();
    expect(job!.title).toBe('Back-end Software Engineer');
    expect(job!.company).toBe('CtrlChain');
    expect(job!.location).toBe('Eindhoven, North Brabant, Netherlands');
    expect(job!.seniority).toBe('Mid-Senior level');
    expect(job!.employmentType).toBe('Full-time');
    expect(job!.descriptionText.length).toBeGreaterThan(1000);
    expect(job!.descriptionText).toContain('back-end');
  });

  it('extracts a second real posting', () => {
    const job = parse(fixture('guest-api-4439304178.html'));
    expect(job).not.toBeNull();
    expect(job!.company).toBe('Booking.com');
    expect(job!.descriptionText.length).toBeGreaterThan(1000);
  });
});

describe('parseJobDocument — public job page', () => {
  it('parses the credential-less public page with the same selectors', () => {
    const job = parse(fixture('public-page-4432351584.html'));
    expect(job).not.toBeNull();
    expect(job!.title).toBe('Back-end Software Engineer');
    expect(job!.company).toBe('CtrlChain');
    expect(job!.descriptionText.length).toBeGreaterThan(1000);
  });
});

describe('parseJobDocument — JSON-LD', () => {
  const jsonLd = (posting: unknown) => `
    <html><head>
      <script type="application/ld+json">${JSON.stringify(posting)}</script>
    </head><body></body></html>`;

  const posting = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Staff Platform Engineer',
    description:
      '<p>We are hiring a staff platform engineer to lead the evolution of our internal ' +
      'developer platform. You will work across infrastructure, tooling and developer ' +
      'experience, partnering with product teams to make shipping safe and boring.</p>' +
      '<ul><li>Own our Kubernetes estate</li><li>Improve CI/CD</li></ul>',
    employmentType: 'FULL_TIME',
    experienceRequirements: 'Mid-Senior level',
    hiringOrganization: { '@type': 'Organization', name: 'Acme BV' },
    jobLocation: {
      '@type': 'Place',
      address: { addressLocality: 'Amsterdam', addressRegion: 'NH', addressCountry: 'NL' },
    },
  };

  it('is preferred when present', () => {
    const job = parse(jsonLd(posting));
    expect(job).not.toBeNull();
    expect(job!.title).toBe('Staff Platform Engineer');
    expect(job!.company).toBe('Acme BV');
    expect(job!.location).toBe('Amsterdam, NH, NL');
    expect(job!.employmentType).toBe('Full-Time');
    expect(job!.descriptionText).toContain('• Own our Kubernetes estate');
  });

  it('finds the posting inside an @graph wrapper', () => {
    const job = parse(jsonLd({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite' }, posting] }));
    expect(job?.title).toBe('Staff Platform Engineer');
  });

  it('finds the posting inside a top-level array', () => {
    const job = parse(jsonLd([{ '@type': 'BreadcrumbList' }, posting]));
    expect(job?.title).toBe('Staff Platform Engineer');
  });

  const withSalary = (baseSalary: unknown) => parse(jsonLd({ ...posting, baseSalary }));

  it('formats a salary range the way the posting means it', () => {
    const job = withSalary({
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: { '@type': 'QuantitativeValue', minValue: 120000, maxValue: 150000, unitText: 'YEAR' },
    });
    expect(job!.salary).toBe('$120,000–150,000 / year');
  });

  it('handles a single figure, an hourly rate, and an unknown currency', () => {
    expect(
      withSalary({ currency: 'EUR', value: { value: 65000, unitText: 'YEAR' } })!.salary,
    ).toBe('€65,000 / year');
    expect(
      withSalary({ currency: 'GBP', value: { minValue: 45, maxValue: 60, unitText: 'HOUR' } })!
        .salary,
    ).toBe('£45–60 / hour');
    // A currency with no symbol still reads correctly rather than disappearing.
    expect(withSalary({ currency: 'SEK', value: { value: 600000, unitText: 'YEAR' } })!.salary)
      .toBe('SEK 600,000 / year');
  });

  it('collapses a range whose ends are equal', () => {
    const job = withSalary({ currency: 'USD', value: { minValue: 90000, maxValue: 90000 } });
    expect(job!.salary).toBe('$90,000');
  });

  it('leaves salary absent when the posting does not state one', () => {
    // Most postings say nothing. Absent must stay absent, never "unknown".
    expect(parse(jsonLd(posting))!.salary).toBeUndefined();
    expect(withSalary({ currency: 'USD', value: {} })!.salary).toBeUndefined();
  });

  it('falls through to selectors when the JSON-LD is malformed', () => {
    const html = `<html><head><script type="application/ld+json">{ not json </script></head>
      <body><h2 class="topcard__title">Fallback Title</h2>
      <div class="show-more-less-html__markup"><p>${'x'.repeat(200)}</p></div></body></html>`;
    expect(parse(html)?.title).toBe('Fallback Title');
  });
});

describe('parseJobDocument — failure modes', () => {
  it('returns null when there is no description container', () => {
    expect(parse('<html><body><h1>Nothing here</h1></body></html>')).toBeNull();
  });

  it('returns null when the description is too short to be a real posting', () => {
    expect(
      parse('<html><body><div class="show-more-less-html__markup">Apply now</div></body></html>'),
    ).toBeNull();
  });
});

describe('htmlToText', () => {
  const el = (html: string) => {
    const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
    return doc.getElementById('r')!;
  };

  it('turns <br> and block tags into line breaks', () => {
    expect(htmlToText(el('one<br>two<p>three</p>'))).toBe('one\ntwo\nthree');
  });

  it('bullets list items', () => {
    expect(htmlToText(el('<ul><li>alpha</li><li>beta</li></ul>'))).toBe('• alpha\n• beta');
  });

  it('collapses runs of whitespace and blank lines', () => {
    expect(htmlToText(el('<p>a   b</p><p></p><p></p><p>c</p>'))).toBe('a b\n\nc');
  });

  it('keeps inline elements on one line', () => {
    expect(htmlToText(el('<p>Use <strong>Python</strong> and <em>Go</em>.</p>'))).toBe(
      'Use Python and Go.',
    );
  });
});
