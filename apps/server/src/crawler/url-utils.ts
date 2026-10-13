export function normalizeUrl(raw: string, baseUrl: string): string | null {
  try {
    const u = new URL(raw, baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // «Мусорные» href (например «::::»): путь без букв и цифр — невалидная ссылка
    const path = u.pathname.replace(/^\//, '');
    if (path !== '' && !/[A-Za-z0-9]/.test(path)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function isInternal(url: string, origin: string): boolean {
  try {
    const strip = (h: string) => h.replace(/^www\./, '');
    return strip(new URL(url).host) === strip(new URL(origin).host);
  } catch {
    return false;
  }
}

export function extractLinks(htmlUrl: string, href: string): string | null {
  return normalizeUrl(href, htmlUrl);
}
