import rateLimit from 'express-rate-limit';

/**
 * General API rate limiter: 100 requests per 15 minutes per IP.
 */
export const apiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

/**
 * Webhook rate limiter: higher limit since GitHub controls the rate.
 * 500 requests per 15 minutes per IP.
 */
export const webhookRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many webhook requests.' },
});
