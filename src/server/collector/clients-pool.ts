import type { DB } from '@server/db/client.ts';
import { loadControllerConfig, setControllerVariant } from '@server/db/queries/controllers.ts';
import { UnifiClient } from '@server/unifi/client.ts';
import type { Logger } from 'pino';

/**
 * Pool de UnifiClient indexado por controllerId. Cada controller mantém sua
 * própria instância (cookie jar, csrf, agente undici). Quando o controller é
 * deletado, chame `evict()` para liberar conexões.
 */
export class UnifiClientPool {
  private readonly clients = new Map<string, UnifiClient>();

  constructor(
    private readonly db: DB,
    private readonly logger: Logger,
    private readonly masterKey: string,
  ) {}

  async getOrCreate(controllerId: string): Promise<UnifiClient> {
    const existing = this.clients.get(controllerId);
    if (existing) return existing;

    const config = loadControllerConfig(this.db, controllerId, this.masterKey);
    if (!config) throw new Error(`controller ${controllerId} não encontrado`);

    const client = new UnifiClient(config, this.logger);
    this.clients.set(controllerId, client);

    // Se a variant ainda não é conhecida, descobre e persiste.
    if (config.variant === null) {
      try {
        await client.ensureReady();
        const detected = client.currentVariant;
        if (detected) setControllerVariant(this.db, controllerId, detected);
      } catch (err) {
        // ensureReady falhou — deixa o config sem variant; próximas tentativas
        // tentarão de novo. Não é fatal para o pool.
        this.logger.warn({ err, controllerId }, 'ensureReady falhou no pool');
      }
    }
    return client;
  }

  async evict(controllerId: string): Promise<void> {
    const c = this.clients.get(controllerId);
    if (!c) return;
    this.clients.delete(controllerId);
    await c.close();
  }

  async closeAll(): Promise<void> {
    const all = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(all.map((c) => c.close()));
  }
}
