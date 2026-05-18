import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    requireAdmin(): (
      req: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => Promise<void>;
  }
  interface FastifyRequest {
    sessionUser?: { role: 'admin' };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { role: 'admin' };
    user: { role: 'admin' };
  }
}

export interface AuthPluginOptions {
  jwtSecret: string;
  cookieName?: string;
  cookieSecure?: boolean;
}

const SESSION_COOKIE = 'mm_session';

async function authPlugin(app: FastifyInstance, opts: AuthPluginOptions): Promise<void> {
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: opts.jwtSecret,
    cookie: {
      cookieName: opts.cookieName ?? SESSION_COOKIE,
      signed: false,
    },
    sign: { expiresIn: '24h' },
  });

  app.decorate('requireAdmin', () => async (req, reply) => {
    try {
      const payload = await req.jwtVerify();
      if (!payload || (payload as { role?: string }).role !== 'admin') {
        reply.code(401).send({ ok: false, error: 'unauthorized' });
        return;
      }
      req.sessionUser = { role: 'admin' };
    } catch {
      reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  });
}

export default fp(authPlugin, { name: 'auth' });
export { SESSION_COOKIE };
