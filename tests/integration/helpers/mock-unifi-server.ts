import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

const fixturesDir = new URL('../../fixtures/', import.meta.url);

function readFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, fixturesDir)), 'utf8');
}

export interface MockUnifiOptions {
  /** Variante a simular. Default: `classic` (porta 8443 self-hosted). */
  variant?: 'unifi-os' | 'classic';
  /** Para simular reboot: muda `tx_bytes` para um valor menor. */
  rebootSimulation?: boolean;
}

export interface MockUnifiServer {
  baseUrl: string;
  port: number;
  close: () => Promise<void>;
  /** Quantas requisições autenticadas chegaram (para asserts). */
  callCount(): number;
}

/**
 * Sobe um http.Server local que se comporta como um UniFi controller "classic"
 * ou "unifi-os" servindo as fixtures de `tests/fixtures/`. Usa porta efêmera.
 *
 * Suporta o mínimo necessário para o collect job:
 *  - POST /api/login (classic) ou /api/auth/login (OS) → 200 + cookie
 *  - GET /api/self/sites → lista de sites
 *  - GET /api/s/{site}/stat/device → devices
 *  - GET /api/s/{site}/stat/sta → clientes
 *  - GET /api/s/{site}/stat/health → ok
 */
export async function startMockUnifiServer(opts: MockUnifiOptions = {}): Promise<MockUnifiServer> {
  const variant = opts.variant ?? 'classic';
  const prefix = variant === 'unifi-os' ? '/proxy/network/api' : '/api';
  const loginPath = variant === 'unifi-os' ? '/api/auth/login' : '/api/login';

  const sites = readFixture('unifi-self-sites.json');
  const devicesPayload = JSON.parse(readFixture('unifi-stat-device.json')) as {
    data: Array<{ tx_bytes?: number }>;
  };
  if (opts.rebootSimulation && devicesPayload.data[0]) {
    devicesPayload.data[0].tx_bytes = 100; // bem menor que o original — simula reset
  }
  const devices = JSON.stringify(devicesPayload);
  const clients = readFixture('unifi-stat-sta.json');

  let callCount = 0;

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const url = req.url ?? '';
    res.setHeader('content-type', 'application/json');

    // Login
    if (req.method === 'POST' && url === loginPath) {
      res.setHeader('set-cookie', 'TOKEN=fake-session; HttpOnly');
      res.setHeader('x-csrf-token', 'csrf-abc-123');
      res.statusCode = 200;
      res.end('{"meta":{"rc":"ok"},"data":[]}');
      drainBody(req);
      return;
    }

    callCount += 1;

    // Probe de detecção de UniFi OS (endpoint sempre presente).
    if (url === '/proxy/network/api/self') {
      if (variant === 'unifi-os') {
        res.statusCode = 401;
        res.end('{"meta":{"rc":"error"}}');
      } else {
        res.statusCode = 404;
        res.end('{"meta":{"rc":"error","msg":"api.err.NotFound"}}');
      }
      return;
    }

    if (req.method === 'GET' && url === `${prefix}/self/sites`) {
      res.statusCode = 200;
      res.end(sites);
      return;
    }

    const deviceMatch = url.match(new RegExp(`^${escapeRegex(prefix)}/s/([^/]+)/stat/device$`));
    if (req.method === 'GET' && deviceMatch) {
      res.statusCode = 200;
      res.end(devices);
      return;
    }

    const staMatch = url.match(new RegExp(`^${escapeRegex(prefix)}/s/([^/]+)/stat/sta$`));
    if (req.method === 'GET' && staMatch) {
      res.statusCode = 200;
      res.end(clients);
      return;
    }

    const healthMatch = url.match(new RegExp(`^${escapeRegex(prefix)}/s/([^/]+)/stat/health$`));
    if (req.method === 'GET' && healthMatch) {
      res.statusCode = 200;
      res.end('{"meta":{"rc":"ok"},"data":[{"subsystem":"wlan","status":"ok"}]}');
      return;
    }

    res.statusCode = 404;
    res.end('{"meta":{"rc":"error","msg":"api.err.NotFound"}}');
  };

  const server: Server = createServer(handler);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('servidor não retornou endereço');
  }
  const port = address.port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    callCount: () => callCount,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function drainBody(req: IncomingMessage): void {
  req.on('data', () => {});
  req.on('end', () => {});
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
