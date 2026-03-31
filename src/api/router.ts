import { Router } from 'express';
import { healthCheck } from './controllers/health.controller';
import { listRepos, updateRepoConfig, toggleRepo } from './controllers/repos.controller';
import { listReviews, getReview } from './controllers/reviews.controller';
import { submitFeedback, getFeedbackStats } from './controllers/feedback.controller';
import { authMiddleware } from './middleware/auth';
import { apiRateLimiter } from './middleware/rateLimit';

const router = Router();

// ─── Health ─────────────────────────────────────────────────────────────
router.get('/health', healthCheck);

// ─── Protected API routes ───────────────────────────────────────────────
router.use('/api', apiRateLimiter, authMiddleware);

// Repos
router.get('/api/repos', listRepos);
router.patch('/api/repos/:id/config', updateRepoConfig);
router.patch('/api/repos/:id/toggle', toggleRepo);

// Reviews
router.get('/api/reviews', listReviews);
router.get('/api/reviews/:id', getReview);

// Feedback
router.post('/api/feedback', submitFeedback);
router.get('/api/feedback/:commentId', getFeedbackStats);

export { router };
