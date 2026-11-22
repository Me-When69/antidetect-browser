import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DETECTOR_HTML = fs.readFileSync(path.join(__dirname, 'detector.html'), 'utf8');

export interface LocalTestServer {
  url: string;
  port: number;
  requests: { url: string; headers: http.IncomingHttpHeaders }[];
  close: () => Promise<void>;
}

export async function startLocalDetectorServer(): Promise<LocalTestServer> {
  const requests: { url: string; headers: http.IncomingHttpHeaders }[] = [];

  const server = http.createServer((req, res) => {
    const reqUrl = req.url ?? '/';
    requests.push({ url: reqUrl, headers: req.headers });

    if (reqUrl.startsWith('/detector.html') || reqUrl === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DETECTOR_HTML);
      return;
    }

    if (reqUrl.startsWith('/headers')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ headers: req.headers }));
      return;
    }

    if (reqUrl.startsWith('/ip')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ip: '203.0.113.77', country: 'Vietnam', countryCode: 'VN' }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
