import type { RequestHandler } from "express";

type Bucket = { count: number; resetAt: number };

export function createRateLimit(
  limit: number,
  windowMs: number,
  label: string,
): RequestHandler {
  const buckets = new Map<string, Bucket>();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.min(windowMs, 60_000));
  cleanup.unref();

  return (req, res, next): void => {
    const now = Date.now();
    const key = `${label}:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (bucket.count >= limit) {
      res.setHeader(
        "Retry-After",
        Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      );
      res.status(429).json({ error: "Too many requests. Please try again later." });
      return;
    }

    bucket.count += 1;
    next();
  };
}