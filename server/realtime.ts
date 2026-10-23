import type { Server as HttpServer } from 'node:http';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { WebSocket, WebSocketServer } from 'ws';
import { getJwtSecret } from './auth/secrets.js';
import { prisma } from './db.js';
import logger from './utils/logger.js';
import { randomUUID } from 'node:crypto';
import { publish, subscribe } from './services/cache/redis.js';

/** Identifies this server, so its own cluster-wide messages are not delivered twice. */
const SERVER_ID = randomUUID();

const ADMIN_FEEDBACK_PATH = '/api/admin/live';
const adminSockets = new Map<string, Set<WebSocket>>();

function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[] | true): boolean {
  if (allowedOrigins === true) return true;
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return true;

  try {
    const hostname = new URL(origin).hostname;
    return /^([a-z0-9-]+)-3000\.app\.github\.dev$/i.test(hostname);
  } catch {
    return false;
  }
}

export function attachRealtime(httpServer: HttpServer, allowedOrigins: string[] | true) {
  // Admins connected to another server hear about changes made here, and the other way round.
  subscribe('admin-live', (from) => { if (from !== SERVER_ID) void notifyLocalAdmins(); });
  const websocketServer = new WebSocketServer({ noServer: true });

  websocketServer.on('error', (error) => {
    logger.error('Live feedback WebSocket server error.', error);
  });

  httpServer.once('close', () => {
    for (const socket of websocketServer.clients) {
      socket.close(1001, 'Server shutting down.');
    }
    websocketServer.close();
  });

  httpServer.on('upgrade', (request, networkSocket, head) => {
    let pathname: string;
    try {
      pathname = new URL(request.url || '/', 'http://localhost').pathname;
    } catch {
      return;
    }
    if (pathname !== ADMIN_FEEDBACK_PATH) return;

    if (!isAllowedOrigin(request.headers.origin, allowedOrigins)) {
      networkSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      networkSocket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, networkSocket, head, (socket) => {
      websocketServer.emit('connection', socket, request);
    });
  });

  websocketServer.on('connection', (socket) => {
    let authenticating = false;
    let adminId: string | null = null;
    const authTimeout = setTimeout(() => socket.close(4401, 'Authentication required.'), 5_000);

    socket.on('error', (error) => {
      logger.error('Live feedback WebSocket connection error.', error);
    });

    socket.on('message', (message, isBinary) => {
      if (authenticating || adminId || isBinary) return;
      authenticating = true;

      void (async () => {
        let token = '';
        try {
          const payload = JSON.parse(message.toString()) as { type?: unknown; token?: unknown };
          if (payload.type !== 'auth' || typeof payload.token !== 'string') {
            socket.close(4401, 'Invalid authentication message.');
            return;
          }
          token = payload.token;
        } catch {
          socket.close(4401, 'Invalid authentication message.');
          return;
        }

        let claims: JwtPayload;
        try {
          const verified = jwt.verify(token, getJwtSecret(), {
            algorithms: ['HS256'],
            issuer: 'bwenge',
            audience: 'bwenge-web',
          });
          if (!verified || typeof verified === 'string' || typeof verified.userId !== 'string') {
            socket.close(4401, 'Invalid authentication token.');
            return;
          }
          claims = verified;
        } catch {
          socket.close(4401, 'Invalid or expired authentication token.');
          return;
        }

        try {
          const user = await prisma.user.findUnique({
            where: { id: claims.userId },
            select: { id: true, role: true, disabledAt: true },
          });
          if (!user || user.disabledAt || user.role !== 'ADMIN') {
            socket.close(4403, 'Administrator access required.');
            return;
          }
          if (socket.readyState !== WebSocket.OPEN) return;

          adminId = user.id;
          const sockets = adminSockets.get(adminId) ?? new Set<WebSocket>();
          sockets.add(socket);
          adminSockets.set(adminId, sockets);
          clearTimeout(authTimeout);
          socket.send(JSON.stringify({ type: 'authenticated' }));

          if (typeof claims.exp === 'number') {
            const expiresIn = Math.max(0, claims.exp * 1000 - Date.now());
            setTimeout(() => socket.close(4401, 'Authentication expired.'), expiresIn).unref();
          }
        } catch (error) {
          logger.error('Could not verify administrator access for live updates.', error);
          socket.close(1011, 'Administrator access could not be verified.');
        }
      })();
    });

    socket.on('close', () => {
      clearTimeout(authTimeout);
      if (!adminId) return;
      const sockets = adminSockets.get(adminId);
      sockets?.delete(socket);
      if (sockets?.size === 0) adminSockets.delete(adminId);
    });
  });
}

export async function notifyAdminsOfFeedbackUpdate() {
  void publish('admin-live', SERVER_ID);
  await notifyLocalAdmins();
}

async function notifyLocalAdmins() {
  if (!adminSockets.size) return;
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', disabledAt: null },
      select: { id: true },
    });
    for (const admin of admins) {
      for (const socket of adminSockets.get(admin.id) ?? []) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'feedback:updated' }));
        }
      }
    }
  } catch (error) {
    logger.error('Could not send live feedback update to administrators.', error);
  }
}
