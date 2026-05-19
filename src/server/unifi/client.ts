import type { Logger } from 'pino';
import { Agent, request } from 'undici';
import { type DetectFetcher, detectVariant } from './detect.ts';
import {
  loginPath,
  selfSitesPath,
  statDevicePath,
  statHealthPath,
  statReportPath,
  statStaPath,
} from './endpoints.ts';
import type {
  ControllerVariant,
  UnifiAuth,
  UnifiClientPayload,
  UnifiControllerConfig,
  UnifiDevicePayload,
  UnifiSitePayload,
  UnifiStatReportPoint,
} from './types.ts';

export class UnifiClientError extends Error {
  override readonly name = 'UnifiClientError';
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
  }
}

/**
 * Timeouts globais para qualquer request ao controller. Evita coletas travadas
 * em sockets meio-abertos (cenário comum quando o controller passa por um
 * tunnel/proxy ou está parcialmente saudável).
 */
const HTTP_HEADERS_TIMEOUT_MS = 20_000;
const HTTP_BODY_TIMEOUT_MS = 30_000;

interface Session {
  cookie: string;
  csrf: string | null;
  expiresAt: number;
}

/**
 * Cliente HTTP por controller UniFi. Uma instância por controller (estado de sessão
 * isolado). Suporta:
 *   - Auth via API Key (preferida, stateless) ou login local com cookie + CSRF.
 *   - Detecção automática de variant (UniFi OS vs Classic) com persistência.
 *   - Retry-on-401 com mutex de re-login (evita stampede em sessão expirada).
 *   - TLS auto-assinado opt-in (`insecureTls`).
 *
 * Esqueleto. Implementação completa de fetchDevices/fetchSites/fetchClients será
 * preenchida em M1 — aqui já temos a estrutura, getters e ensureSession.
 */
export class UnifiClient {
  private variant: ControllerVariant | null;
  private session: Session | null = null;
  private readonly dispatcher: Agent;
  private readonly logger: Logger;
  private readonly loginMutex = new Mutex();

  constructor(
    private readonly config: UnifiControllerConfig,
    logger: Logger,
  ) {
    this.variant = config.variant;
    this.dispatcher = new Agent({
      connect: { rejectUnauthorized: !config.insecureTls },
    });
    this.logger = logger.child({ controllerId: config.id, baseUrl: config.baseUrl });
  }

  async close(): Promise<void> {
    await this.dispatcher.close();
  }

  get currentVariant(): ControllerVariant | null {
    return this.variant;
  }

  /**
   * Garante que `variant` está descoberto e que há sessão válida (no caso de auth local).
   * API Key não precisa de sessão.
   */
  async ensureReady(): Promise<void> {
    if (!this.variant) {
      const detected = await detectVariant(this.config.baseUrl, defaultFetcher, this.dispatcher);
      this.variant = detected.variant;
      this.logger.debug(
        { variant: detected.variant, signals: detected.signals },
        'variant detectado',
      );
    }
    if (this.config.auth.mode === 'local' && !this.isSessionValid()) {
      await this.loginMutex.run(() => this.login());
    }
  }

  private isSessionValid(): boolean {
    return !!this.session && this.session.expiresAt > Date.now() + 60_000;
  }

  private async login(): Promise<void> {
    if (this.config.auth.mode !== 'local') return;
    const variant = this.variant ?? 'classic';
    const url = joinUrl(this.config.baseUrl, loginPath(variant));
    const res = await request(url, {
      method: 'POST',
      dispatcher: this.dispatcher,
      headers: { 'content-type': 'application/json' },
      headersTimeout: HTTP_HEADERS_TIMEOUT_MS,
      bodyTimeout: HTTP_BODY_TIMEOUT_MS,
      body: JSON.stringify({
        username: this.config.auth.username,
        password: this.config.auth.password,
        remember: true,
      }),
    });
    if (res.statusCode >= 400) {
      throw new UnifiClientError(`Login falhou (${res.statusCode})`, res.statusCode);
    }
    const setCookie = res.headers['set-cookie'];
    const cookie = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
    const csrfHeader = res.headers['x-csrf-token'];
    const csrf = Array.isArray(csrfHeader) ? (csrfHeader[0] ?? null) : (csrfHeader ?? null);
    this.session = {
      cookie,
      csrf,
      expiresAt: Date.now() + 90 * 60 * 1000, // 90min de margem (cookie real ~2h)
    };
    this.logger.debug('login bem-sucedido');
    // Consome o body para liberar a conexão.
    await res.body.text();
  }

  /* ----------- métodos de coleta (esqueleto) -----------
   *
   * Implementação completa em M1. Aqui já temos a forma e a chamada autenticada.
   */

  async fetchSites(): Promise<UnifiSitePayload[]> {
    await this.ensureReady();
    const url = joinUrl(this.config.baseUrl, selfSitesPath(this.variant));
    const body = await this.authedGet(url);
    return (body.data ?? []) as UnifiSitePayload[];
  }

  async fetchDevices(siteName: string): Promise<UnifiDevicePayload[]> {
    await this.ensureReady();
    const url = joinUrl(this.config.baseUrl, statDevicePath(this.variant, siteName));
    const body = await this.authedGet(url);
    return (body.data ?? []) as UnifiDevicePayload[];
  }

  async fetchClients(siteName: string): Promise<UnifiClientPayload[]> {
    await this.ensureReady();
    const url = joinUrl(this.config.baseUrl, statStaPath(this.variant, siteName));
    const body = await this.authedGet(url);
    return (body.data ?? []) as UnifiClientPayload[];
  }

  async fetchHealth(siteName: string): Promise<unknown> {
    await this.ensureReady();
    const url = joinUrl(this.config.baseUrl, statHealthPath(this.variant, siteName));
    const body = await this.authedGet(url);
    return body.data;
  }

  /**
   * Consulta o endpoint histórico `/stat/report/{interval}.{subject}`. Diferente
   * de `fetchDevices`/`fetchClients`, este é POST com um body indicando a
   * janela (`start`/`end` em epoch ms) e a lista de `attrs` desejados.
   *
   * Retorna a série pré-agregada pelo próprio controller — útil para
   * backfill de histórico já existente no UniFi (até onde a retenção do
   * controller permitir: tipicamente 5min~7d, hourly~30d, daily~12-24m).
   */
  async fetchStatReport(
    siteName: string,
    interval: '5minutes' | 'hourly' | 'daily' | 'monthly',
    subject: 'site' | 'ap' | 'user' | 'gw',
    opts: { start: number; end: number; attrs: string[]; macs?: string[] },
  ): Promise<UnifiStatReportPoint[]> {
    await this.ensureReady();
    const url = joinUrl(
      this.config.baseUrl,
      statReportPath(this.variant, siteName, interval, subject),
    );
    const payload: Record<string, unknown> = {
      attrs: opts.attrs,
      start: opts.start,
      end: opts.end,
    };
    if (opts.macs && opts.macs.length > 0) payload.macs = opts.macs;
    const body = await this.authedPost(url, payload);
    return (body.data ?? []) as UnifiStatReportPoint[];
  }

  private async authedGet(url: string): Promise<{ data?: unknown[] }> {
    const headers = this.buildAuthHeaders();
    let res = await request(url, {
      method: 'GET',
      dispatcher: this.dispatcher,
      headers,
      headersTimeout: HTTP_HEADERS_TIMEOUT_MS,
      bodyTimeout: HTTP_BODY_TIMEOUT_MS,
    });
    if (isAuthExpired(res.statusCode) && this.config.auth.mode === 'local') {
      await res.body.text();
      this.session = null;
      await this.loginMutex.run(() => this.login());
      res = await request(url, {
        method: 'GET',
        dispatcher: this.dispatcher,
        headers: this.buildAuthHeaders(),
        headersTimeout: HTTP_HEADERS_TIMEOUT_MS,
        bodyTimeout: HTTP_BODY_TIMEOUT_MS,
      });
    }
    if (res.statusCode >= 400) {
      await res.body.text();
      throw new UnifiClientError(`GET ${url} retornou ${res.statusCode}`, res.statusCode);
    }
    const text = await res.body.text();
    const parsed = text ? (JSON.parse(text) as { data?: unknown[] }) : {};
    return parsed;
  }

  private async authedPost(url: string, payload: unknown): Promise<{ data?: unknown[] }> {
    const headers = { ...this.buildAuthHeaders(), 'content-type': 'application/json' };
    const body = JSON.stringify(payload);
    let res = await request(url, {
      method: 'POST',
      dispatcher: this.dispatcher,
      headers,
      headersTimeout: HTTP_HEADERS_TIMEOUT_MS,
      bodyTimeout: HTTP_BODY_TIMEOUT_MS,
      body,
    });
    if (isAuthExpired(res.statusCode) && this.config.auth.mode === 'local') {
      await res.body.text();
      this.session = null;
      await this.loginMutex.run(() => this.login());
      res = await request(url, {
        method: 'POST',
        dispatcher: this.dispatcher,
        headers: { ...this.buildAuthHeaders(), 'content-type': 'application/json' },
        headersTimeout: HTTP_HEADERS_TIMEOUT_MS,
        bodyTimeout: HTTP_BODY_TIMEOUT_MS,
        body,
      });
    }
    if (res.statusCode >= 400) {
      await res.body.text();
      throw new UnifiClientError(`POST ${url} retornou ${res.statusCode}`, res.statusCode);
    }
    const text = await res.body.text();
    const parsed = text ? (JSON.parse(text) as { data?: unknown[] }) : {};
    return parsed;
  }

  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (this.config.auth.mode === 'api-key') {
      headers['x-api-key'] = this.config.auth.apiKey;
      return headers;
    }
    if (this.session) {
      headers.cookie = this.session.cookie;
      if (this.session.csrf) headers['x-csrf-token'] = this.session.csrf;
    }
    return headers;
  }
}

export function buildAuth(input: {
  authMode: 'api-key' | 'local';
  apiKey?: string;
  username?: string;
  password?: string;
}): UnifiAuth {
  if (input.authMode === 'api-key') {
    if (!input.apiKey) throw new Error('apiKey é obrigatório para authMode=api-key');
    return { mode: 'api-key', apiKey: input.apiKey };
  }
  if (!input.username || !input.password) {
    throw new Error('username e password são obrigatórios para authMode=local');
  }
  return { mode: 'local', username: input.username, password: input.password };
}

/* ----- helpers ----- */

/**
 * Tanto 401 quanto 403 podem indicar cookie/sessão expirada no UniFi OS.
 * Versões mais novas devolvem 403 com o body `{ meta: { rc: 'error', msg: 'api.err.LoginRequired' } }`
 * em chamadas autenticadas quando o cookie morre durante a request.
 */
function isAuthExpired(statusCode: number): boolean {
  return statusCode === 401 || statusCode === 403;
}

class Mutex {
  private chain: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(() => fn());
    this.chain = next.catch(() => undefined);
    return next;
  }
}

function joinUrl(base: string, suffix: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const s = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `${b}${s}`;
}

const defaultFetcher: DetectFetcher = async (url, init) => {
  const res = await request(url, init);
  await res.body.text();
  return {
    statusCode: res.statusCode,
    headers: res.headers as Record<string, string | string[] | undefined>,
  };
};
