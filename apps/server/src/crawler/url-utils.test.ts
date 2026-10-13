import { describe, it, expect } from 'vitest';
import { normalizeUrl, isInternal, extractLinks } from './url-utils';

describe('normalizeUrl', () => {
  it('делает абсолютным и отбрасывает fragment', () => {
    expect(normalizeUrl('/a?x=1#sec', 'https://example.com')).toBe('https://example.com/a?x=1');
  });
  it('не склеивает разные query', () => {
    expect(normalizeUrl('/a?x=1', 'https://example.com'))
      .not.toBe(normalizeUrl('/a?x=2', 'https://example.com'));
  });
  it('отбрасывает не-http(s) и невалидные', () => {
    expect(normalizeUrl('mailto:a@b.c', 'https://example.com')).toBeNull();
    expect(normalizeUrl('tel:+123', 'https://example.com')).toBeNull();
    expect(normalizeUrl('::::', 'https://example.com')).toBeNull();
  });
  it('убирает trailing slash только у корня-дубликата пути', () => {
    expect(normalizeUrl('https://example.com', 'https://example.com')).toBe('https://example.com/');
  });
  it('принимает кириллические пути', () => {
    expect(normalizeUrl('/о-нас', 'https://example.com')).toBe('https://example.com/%D0%BE-%D0%BD%D0%B0%D1%81');
  });
});

describe('isInternal', () => {
  it('www-эквивалентность', () => {
    expect(isInternal('https://www.example.com/a', 'https://example.com')).toBe(true);
    expect(isInternal('https://other.com', 'https://example.com')).toBe(false);
  });
});
