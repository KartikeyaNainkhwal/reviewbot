import { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { timingSafeEqual } from 'crypto';

/**
 * API key auth middleware.
 * Validates the X-API-Key header against the configured API_KEY env var.
 * In development without API_KEY set, allows unauthenticated access.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const apiKey = req.headers['x-api-key'] as string;
    const configuredKey = (env as Record<string, unknown>).API_KEY as string | undefined;

    // In development, if no API_KEY is configured, allow access
    if (!configuredKey && env.NODE_ENV === 'development') {
        next();
        return;
    }

    if (!apiKey) {
        res.status(401).json({ error: 'Missing X-API-Key header' });
        return;
    }

    if (!configuredKey) {
        logger.error('API_KEY environment variable not set — rejecting request');
        res.status(500).json({ error: 'Server misconfigured' });
        return;
    }

    // Constant-time comparison to prevent timing attacks
    const keyBuffer = Buffer.from(apiKey);
    const configuredBuffer = Buffer.from(configuredKey);

    if (keyBuffer.length !== configuredBuffer.length || !timingSafeEqual(keyBuffer, configuredBuffer)) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
    }

    logger.debug('API request authenticated');
    next();
}
