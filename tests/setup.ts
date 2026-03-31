// Set minimal env vars to prevent env.ts from calling process.exit
process.env.GITHUB_APP_ID = 'test-123';
process.env.GITHUB_APP_PRIVATE_KEY = 'test-private-key';
process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'test';
