import { pathToFileURL } from 'node:url';
import { buildApp } from './api/routes';
import { SessionManager } from './session/session-manager';
import { attachCrawlWs } from './ws/crawl-ws';

export { buildApp };

// Запускаем сервер только когда файл исполнен напрямую (tsx src/index.ts), а не импортирован тестами.
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntry) {
  const sessions = new SessionManager();
  const app = buildApp({ sessions });
  attachCrawlWs(app.server, sessions);
  await app.listen({ port: 3001, host: '127.0.0.1' });
}
