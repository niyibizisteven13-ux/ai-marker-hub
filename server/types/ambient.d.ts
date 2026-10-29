// Types the app relies on that its dependencies do not ship.

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth (server/middleware/auth). */
      user?: any;
      /** Set by the account project middleware for /api/agent routes. */
      accountProjectId?: string;
    }
  }
}

export {};
