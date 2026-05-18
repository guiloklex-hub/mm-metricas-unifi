import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, req, reply) => {
    if (error instanceof ZodError) {
      req.log.warn({ issues: error.issues }, 'validação falhou');
      reply.status(400).send({
        ok: false,
        error: 'validation_error',
        details: error.issues,
      });
      return;
    }

    const fe = error as FastifyError;
    const statusCode = fe.statusCode ?? 500;
    if (statusCode >= 500) {
      req.log.error({ err: error }, 'unhandled error');
    } else {
      req.log.warn({ err: error.message }, 'handled error');
    }

    reply.status(statusCode).send({
      ok: false,
      error: statusCode >= 500 ? 'internal_error' : error.message,
    });
  });
}
