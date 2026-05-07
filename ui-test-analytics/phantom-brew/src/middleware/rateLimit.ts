import { Request, Response, NextFunction } from 'express';
import { TRAPS } from '../traps/config';

const requestCounts = new Map<string, { count: number; resetAt: number }>();

// FP-4: Rate limiting middleware
export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const key = req.sessionID || req.ip || 'unknown';
  const now = Date.now();
  const record = requestCounts.get(key);

  if (!record || now > record.resetAt) {
    requestCounts.set(key, {
      count: 1,
      resetAt: now + TRAPS.FP4_RATE_LIMIT_WINDOW_MS,
    });
    next();
    return;
  }

  record.count++;

  if (record.count > TRAPS.FP4_RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({ error: 'Too Many Requests. Please slow down.' });
    return;
  }

  next();
}
