/**
 * Cliente HTTP da Web UI → API. Wrapper fino sobre fetch que:
 *  - Inclui cookies (`credentials: 'include'`)
 *  - Lança erro tipado em respostas !ok
 *  - Padroniza envelope `{ ok, data }` da API
 */

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  error: string;
  details?: unknown;
  message?: string;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    ...init,
  });

  const contentType = res.headers.get('content-type') ?? '';
  if (res.status === 204) {
    return undefined as T;
  }
  if (!contentType.includes('application/json')) {
    if (!res.ok) {
      throw new ApiError(res.status, 'non_json_error', await res.text().catch(() => ''));
    }
    return undefined as T;
  }

  const body = (await res.json()) as ApiOk<T> | ApiErr;
  if (!res.ok || !('ok' in body) || body.ok === false) {
    const err = body as ApiErr;
    throw new ApiError(res.status, err.error ?? 'unknown', err.message, err.details);
  }
  return (body as ApiOk<T>).data;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
