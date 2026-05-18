#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Smoke E2E: sobe um mock UniFi local, cadastra ele como controller via API,
 * espera worker rodar a coleta e valida que metrics_5m tem amostras.
 *
 * Pressupõe que o servidor mm-metricas-unifi já está rodando em $BASE_URL.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3010';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin-e2e-passw0rd!';

const fixturesDir = new URL('../tests/fixtures/', import.meta.url);
function fx(name) {
  return readFileSync(fileURLToPath(new URL(name, fixturesDir)), 'utf8');
}

async function startMockUnifi() {
  const sites = fx('unifi-self-sites.json');
  const devices = fx('unifi-stat-device.json');
  const clients = fx('unifi-stat-sta.json');
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const url = req.url || '';
    if (req.method === 'POST' && url === '/api/login') {
      res.setHeader('set-cookie', 'unifises=fake; HttpOnly');
      res.setHeader('x-csrf-token', 'csrf-e2e');
      res.statusCode = 200;
      res.end('{"meta":{"rc":"ok"},"data":[]}');
      req.on('data', () => {});
      req.on('end', () => {});
      return;
    }
    if (url === '/proxy/network/api/self') {
      res.statusCode = 404;
      res.end('{}');
      return;
    }
    if (url === '/api/self/sites') return res.end(sites);
    if (/^\/api\/s\/[^/]+\/stat\/device$/.test(url)) return res.end(devices);
    if (/^\/api\/s\/[^/]+\/stat\/sta$/.test(url)) return res.end(clients);
    if (/^\/api\/s\/[^/]+\/stat\/health$/.test(url)) {
      return res.end('{"meta":{"rc":"ok"},"data":[]}');
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  return { server, port: addr.port, url: `http://127.0.0.1:${addr.port}` };
}

let cookieJar = '';

async function api(path, init = {}) {
  const headers = { accept: 'application/json', ...init.headers };
  if (init.body) headers['content-type'] = 'application/json';
  if (cookieJar) headers.cookie = cookieJar;
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const first = setCookie.split(',')[0].split(';')[0];
    if (first) cookieJar = first;
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) {
    console.error('❌', msg);
    process.exit(1);
  }
  console.log('✓', msg);
}

async function waitForCondition(check, { timeoutMs = 30_000, intervalMs = 1000, name } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.error(`❌ timeout esperando: ${name}`);
  process.exit(1);
}

async function main() {
  console.log(`▶ apontando para ${BASE_URL}`);

  // 1) Healthz
  const health = await api('/healthz');
  assert(health.status === 200, 'healthz responde');

  // 2) Setup
  const setupStatus = await api('/api/v1/auth/setup-status');
  if (!setupStatus.json.data.complete) {
    const setup = await api('/api/v1/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    assert(setup.status === 201, 'setup admin concluído');
  } else {
    console.log('• setup já completo, pulando');
  }

  // 3) Login
  const login = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  assert(login.status === 200, 'login OK');

  // 4) Sobe mock UniFi
  const mock = await startMockUnifi();
  console.log(`• mock UniFi rodando em ${mock.url}`);

  // 5) Cadastra o mock como controller
  const create = await api('/api/v1/controllers', {
    method: 'POST',
    body: JSON.stringify({
      name: `e2e-${Date.now()}`,
      baseUrl: mock.url,
      variant: 'classic',
      authMode: 'local',
      username: 'admin',
      password: 'mock-pwd',
      insecureTls: true,
      pollSeconds: 60,
      enabled: true,
    }),
  });
  assert(create.status === 201, `controller criado (id=${create.json.data.id})`);

  // 6) Aguarda primeira coleta (worker pega o job imediato via idempotency key).
  await waitForCondition(
    async () => {
      const status = await api('/api/v1/metrics/status');
      return status.json?.data?.rows?.['5m'] > 0;
    },
    { timeoutMs: 30_000, intervalMs: 1000, name: 'primeira amostra em metrics_5m' },
  );
  const status = await api('/api/v1/metrics/status');
  assert(
    status.json.data.rows['5m'] > 0,
    `metrics_5m tem ${status.json.data.rows['5m']} amostras`,
  );

  // 7) Lê amostras recentes
  const recent = await api('/api/v1/metrics/recent?seconds=600&groupBy=device');
  assert(recent.status === 200, 'GET /metrics/recent OK');
  assert(recent.json.data.count > 0, `recent retornou ${recent.json.data.count} linhas`);

  // 8) Sites foram sincronizados
  const sites = await api('/api/v1/sites');
  assert(
    Array.isArray(sites.json.data) && sites.json.data.length >= 2,
    `sites sincronizados (${sites.json.data.length})`,
  );

  // 9) Cleanup
  const del = await api(`/api/v1/controllers/${create.json.data.id}`, { method: 'DELETE' });
  assert(del.status === 204, 'controller removido');

  mock.server.close();
  console.log('\n✅ Smoke E2E passou.');
}

main().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
