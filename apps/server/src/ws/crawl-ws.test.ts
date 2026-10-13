import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../api/routes';
import { SessionManager } from '../session/session-manager';
import { attachCrawlWs } from './crawl-ws';
import { startTestSite } from '../test-helpers/test-site';
import type { CrawlEvent, CrawlOptions } from '@seo-crawler/shared';
import type { FastifyInstance } from 'fastify';

const BASE: Omit<CrawlOptions, 'startUrl'> = {
  mode: 'spider',
  maxUrls: 100,
  maxDepth: 10,
  respectRobots: false,
  renderJs: false,
  concurrency: 5,
  requestTimeoutMs: 5000,
};

const TIMEOUT_MS = 10_000;

const openApps: FastifyInstance[] = [];

/** Реальный слушающий http-сервер (buildApp + WS) на случайном порту. */
async function newListeningApp(): Promise<{ sessions: SessionManager; wsUrl: (id: string) => string }> {
  const sessions = new SessionManager();
  const app = buildApp({ sessions });
  attachCrawlWs(app.server, sessions);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  openApps.push(app);
  return { sessions, wsUrl: (id) => `ws://127.0.0.1:${port}/ws/crawl/${id}` };
}

/** Дожидаемся события close, чтобы close-рукопожатие завершилось и не осталось живых соединений. */
function waitWsClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(resolve, TIMEOUT_MS);
    ws.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('ws /ws/crawl/:id', () => {
  afterEach(async () => {
    await Promise.all(openApps.splice(0).map((a) => a.close()));
  });

  it('активной сессии: первое сообщение — progress, в итоге done', async () => {
    const site = await startTestSite();
    try {
      const { sessions, wsUrl } = await newListeningApp();
      const { id } = sessions.create({ startUrl: site.origin + '/', ...BASE });

      const messages: CrawlEvent[] = [];
      const ws = new WebSocket(wsUrl(id));
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout waiting for ws done')), TIMEOUT_MS);
          ws.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
          ws.on('message', (data) => {
            const msg = JSON.parse(data.toString()) as CrawlEvent;
            messages.push(msg);
            if (msg.type === 'done') {
              clearTimeout(timer);
              resolve();
            }
          });
        });
      } finally {
        await waitWsClose(ws);
      }

      expect(messages.length).toBeGreaterThan(0);
      // первое сообщение — снапшот прогресса
      expect(messages[0]).toMatchObject({ type: 'progress' });
      // до done приходит снапшот summary
      expect(messages.some((m) => m.type === 'summary')).toBe(true);
      // последнее сообщение — done с финальным state
      expect(messages[messages.length - 1]).toMatchObject({ type: 'done', state: 'done' });
    } finally {
      await site.close();
    }
  });

  it('несуществующий id: сервер закрывает сокет без сообщений', async () => {
    const { wsUrl } = await newListeningApp();
    const ws = new WebSocket(wsUrl('no-such-session'));
    const messages: unknown[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout waiting for ws close')), TIMEOUT_MS);
        ws.on('message', (data) => messages.push(data.toString()));
        // destroy до завершения рукопожатия: ws-клиент сначала эмитит error, затем close
        ws.on('error', () => undefined);
        ws.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } finally {
      await waitWsClose(ws);
    }
    expect(messages).toHaveLength(0);
  });
});
