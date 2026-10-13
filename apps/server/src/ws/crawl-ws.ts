import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { SessionManager, CrawlSession } from '../session/session-manager';
import type { CrawlEvent } from '@seo-crawler/shared';

const CRAWL_WS_PATH = /^\/ws\/crawl\/([\w-]+)$/;

/** Отправка в сокет не должна ронять сервер, если сокет уже закрыт. */
function send(ws: WebSocket, event: CrawlEvent): void {
  try {
    ws.send(JSON.stringify(event));
  } catch {
    /* noop */
  }
}

function onConnect(ws: WebSocket, session: CrawlSession): void {
  let unsubscribe: (() => void) | null = null;
  let finished = false;

  const closeSocket = (): void => {
    if (finished) return;
    finished = true;
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
    try {
      ws.close();
    } catch {
      /* noop */
    }
  };

  // Снапшот: новый подписчик сразу получает текущий прогресс и отчёт.
  send(ws, { type: 'progress', ...session.progress() });
  send(ws, { type: 'summary', issues: session.issues() });

  // Сессия уже завершена — клиент получит снапшот + done и закрытие, а не будет ждать вечно.
  if (session.state !== 'running') {
    send(ws, { type: 'done', state: session.state });
    closeSocket();
    return;
  }

  unsubscribe = session.subscribe((e) => {
    send(ws, e);
    if (e.type === 'done') closeSocket();
  });

  ws.on('close', () => {
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
  });
  ws.on('error', () => {
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
  });
}

/**
 * Подключает WS-поток прогресса краула к http-серверу: путь /ws/crawl/:id.
 * Подписчику пересылаются все CrawlEvent сессии JSON-строкой;
 * новое подключение сразу получает снапшот progress + summary.
 */
export function attachCrawlWs(httpServer: Server, sessions: SessionManager): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '', 'http://x');
    } catch {
      socket.destroy();
      return;
    }
    const match = CRAWL_WS_PATH.exec(url.pathname);
    const session = match !== null ? sessions.get(match[1]) : undefined;
    if (session === undefined) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      onConnect(ws, session);
    });
  });
}
