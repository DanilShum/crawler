import { describe, it, expect } from 'vitest';
import { startTestSite } from './test-site';

describe('test-site', () => {
  it('отдаёт страницы и статусы', async () => {
    const site = await startTestSite();
    try {
      const ok = await fetch(`${site.origin}/`);
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain('/about');
      expect((await fetch(`${site.origin}/missing`)).status).toBe(404);
      expect((await fetch(`${site.origin}/redirect`, { redirect: 'manual' })).status).toBe(301);
      const bin = await fetch(`${site.origin}/binary.pdf`);
      expect(bin.headers.get('content-type')).toBe('application/pdf');
    } finally {
      await site.close();
    }
  });
});
