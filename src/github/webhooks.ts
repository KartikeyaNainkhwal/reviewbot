import { Webhooks, createNodeMiddleware } from '@octokit/webhooks';
import type { RequestHandler } from 'express';
import { enqueueReviewJob } from '../queue/review.queue.js';
import { installationRepo } from '../db/repositories/installation.repo.js';
import { repositoryRepo } from '../db/repositories/repository.repo.js';
import { getInstallationOctokit, fetchPRMetadata, postIssueComment } from './app.js';
import { getRedisConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { AccountType } from '@prisma/client';

// ─── Constants ──────────────────────────────────────────────────────────

const BOT_MENTION = '@axdbot';
const MAX_MANUAL_REVIEWS_PER_PR_PER_HOUR = 3;
const RATE_LIMIT_TTL_SECONDS = 3600; // 1 hour

// ─── Webhooks instance ──────────────────────────────────────────────────

const webhooks = new Webhooks({
    secret: env.GITHUB_WEBHOOK_SECRET,
});

// ═══════════════════════════════════════════════════════════════════════
// pull_request events
// ═══════════════════════════════════════════════════════════════════════

webhooks.on(
    ['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'],
    async ({ id, name, payload }) => {
        const pr = payload.pull_request;
        const repo = payload.repository;
        const installation = payload.installation;
        const sender = payload.sender;

        const log = logger.child({
            deliveryId: id,
            event: name,
            action: payload.action,
            prNumber: pr.number,
            repo: repo.full_name,
        });

        // ── Guard clauses ────────────────────────────────────────────────

        // Skip draft PRs
        if (pr.draft) {
            log.info('Skipping draft PR');
            return;
        }

        // Skip PRs opened by bots
        if (sender.type === 'Bot') {
            log.info({ sender: sender.login }, 'Skipping bot PR');
            return;
        }

        // Must have installation context
        if (!installation) {
            log.warn('Missing installation context in webhook payload');
            return;
        }

        // Check if repo is tracked and active in our DB
        const repoRecord = await repositoryRepo.findByGithubId(repo.id);
        if (!repoRecord || !repoRecord.isActive) {
            log.debug('Repo not tracked or reviews disabled');
            return;
        }

        // Check if this event/action is in the repo's reviewOn config
        const config = repoRecord.config as { reviewOn?: string[] };
        const reviewOn = config.reviewOn ?? ['opened', 'synchronize', 'reopened'];
        if (!reviewOn.includes(payload.action)) {
            log.debug({ action: payload.action }, 'Action not in reviewOn config, skipping');
            return;
        }

        // ── Enqueue review job ───────────────────────────────────────────

        const jobId = await enqueueReviewJob({
            installationId: installation.id,
            repoFullName: repo.full_name,
            repoGithubId: repo.id,
            prNumber: pr.number,
            title: pr.title,
            body: pr.body ?? null,
            headSha: pr.head.sha,
            baseSha: pr.base.sha,
            sender: sender.login,
            action: payload.action,
            language: repo.language ?? null,
        });

        log.info({ jobId }, 'Review job enqueued');
    },
);

// ═══════════════════════════════════════════════════════════════════════
// issue_comment events — Slash Commands
// ═══════════════════════════════════════════════════════════════════════

webhooks.on('issue_comment.created', async ({ id, payload }) => {
    const comment = payload.comment;
    const issue = payload.issue;
    const repo = payload.repository;
    const installation = payload.installation;
    const sender = payload.sender;

    const log = logger.child({
        deliveryId: id,
        event: 'issue_comment.created',
        repo: repo.full_name,
        issueNumber: issue.number,
        commenter: sender.login,
    });

    // ── Guard 1: Only process comments that mention @axdbot ──────────

    const command = parseSlashCommand(comment.body ?? '');
    if (!command) {
        return; // Comment doesn't mention our bot — silently ignore
    }

    log.info({ command }, 'Slash command detected');

    // ── Guard 2: Only process comments on Pull Requests ──────────────

    if (!issue.pull_request) {
        log.debug('Comment is on an issue, not a PR — ignoring');
        return;
    }

    // ── Guard 3: Must have installation context ──────────────────────

    if (!installation) {
        log.warn('Missing installation context');
        return;
    }

    // ── Guard 4: Repo must be tracked ────────────────────────────────

    const repoRecord = await repositoryRepo.findByGithubId(repo.id);
    if (!repoRecord || !repoRecord.isActive) {
        log.debug('Repo not tracked or reviews disabled');
        return;
    }

    // ── Guard 5: Verify write access ─────────────────────────────────

    const octokit = await getInstallationOctokit(installation.id);

    const hasAccess = await checkWriteAccess(octokit, repo.owner.login, repo.name, sender.login);
    if (!hasAccess) {
        log.warn({ commenter: sender.login }, 'User does not have write access, ignoring command');
        await postIssueComment(
            octokit,
            repo.owner.login,
            repo.name,
            issue.number,
            `⚠️ @${sender.login}, you need **write** access to this repository to use bot commands.`,
        );
        return;
    }

    // ── Route to command handler ─────────────────────────────────────

    const [owner, repoName] = repo.full_name.split('/');

    switch (command) {
        case 'review':
            await handleReviewCommand(
                octokit, owner, repoName, issue.number,
                repo.id, installation.id, repo.full_name,
                repo.language ?? null, sender.login, log,
            );
            break;

        case 'help':
            await handleHelpCommand(octokit, owner, repoName, issue.number);
            break;

        default:
            await postIssueComment(
                octokit, owner, repoName, issue.number,
                `❓ Unknown command \`/${command}\`. Type \`${BOT_MENTION} /help\` for available commands.`,
            );
            break;
    }
});

// ═══════════════════════════════════════════════════════════════════════
// Slash Command Parser
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse a slash command from a PR comment.
 *
 * Matches patterns like:
 *   "@axdbot /review"
 *   "@axdbot  /help"
 *   "@axdbot /review please"
 *
 * Returns the command name (without /) or null if no valid command found.
 */
export function parseSlashCommand(commentBody: string): string | null {
    const body = commentBody.toLowerCase().trim();

    // Must mention our bot
    if (!body.includes(BOT_MENTION)) {
        return null;
    }

    // Extract command: @axdbot /command [optional args]
    const pattern = new RegExp(`${BOT_MENTION}\\s+/(\\w+)`, 'i');
    const match = body.match(pattern);

    if (!match || !match[1]) {
        return null;
    }

    return match[1].toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════
// Command Handlers
// ═══════════════════════════════════════════════════════════════════════

/**
 * /review — Trigger a fresh AI review of the current PR.
 *
 * Checks rate limit, fetches PR metadata, and enqueues a review job.
 */
async function handleReviewCommand(
    octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
    owner: string,
    repo: string,
    prNumber: number,
    repoGithubId: number,
    installationId: number,
    repoFullName: string,
    language: string | null,
    sender: string,
    log: typeof logger,
): Promise<void> {
    // ── Rate limit check ─────────────────────────────────────────────

    const rateLimitKey = `axd:ratelimit:review:${repoFullName}:${prNumber}`;
    const redis = getRedisConnection();

    const currentCount = await redis.get(rateLimitKey);
    const count = currentCount ? parseInt(currentCount, 10) : 0;

    if (count >= MAX_MANUAL_REVIEWS_PER_PR_PER_HOUR) {
        log.warn({ count, limit: MAX_MANUAL_REVIEWS_PER_PR_PER_HOUR }, 'Rate limit exceeded');
        await postIssueComment(
            octokit, owner, repo, prNumber,
            `⚠️ Rate limit reached: maximum **${MAX_MANUAL_REVIEWS_PER_PR_PER_HOUR}** manual reviews per PR per hour. Please try again later.`,
        );
        return;
    }

    // ── Increment rate limit counter ─────────────────────────────────

    const pipeline = redis.pipeline();
    pipeline.incr(rateLimitKey);
    pipeline.expire(rateLimitKey, RATE_LIMIT_TTL_SECONDS);
    await pipeline.exec();

    // ── Fetch PR metadata ────────────────────────────────────────────

    try {
        const metadata = await fetchPRMetadata(octokit, owner, repo, prNumber);

        if (metadata.draft) {
            await postIssueComment(
                octokit, owner, repo, prNumber,
                '🤖 This PR is a draft — I\'ll review it when it\'s ready for review.',
            );
            return;
        }

        // ── Enqueue review job ───────────────────────────────────────

        const jobId = await enqueueReviewJob({
            installationId,
            repoFullName,
            repoGithubId,
            prNumber,
            title: metadata.title,
            body: metadata.body ?? null,
            headSha: metadata.headSha,
            baseSha: metadata.baseSha,
            sender,
            action: 'manual_review',
            language,
        });

        log.info({ jobId }, 'Manual review job enqueued');

        // ── Post acknowledgment ──────────────────────────────────────

        await postIssueComment(
            octokit, owner, repo, prNumber,
            `🤖 Review triggered by @${sender}! Reviewing commit \`${metadata.headSha.slice(0, 7)}\`... I'll post my findings shortly.`,
        );
    } catch (error) {
        log.error({ err: error }, 'Failed to enqueue manual review');
        await postIssueComment(
            octokit, owner, repo, prNumber,
            `❌ Failed to start review. Please try again later.\n\n<details>\n<summary>Error details</summary>\n\n\`\`\`\n${(error as Error).message}\n\`\`\`\n</details>`,
        );
    }
}

/**
 * /help — Post available commands as a markdown table.
 */
async function handleHelpCommand(
    octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
    owner: string,
    repo: string,
    prNumber: number,
): Promise<void> {
    const helpText = `## 🤖 AXD Bot Commands

| Command | Description |
|:--------|:------------|
| \`${BOT_MENTION} /review\` | Trigger a fresh AI review of this PR |
| \`${BOT_MENTION} /help\` | Show this help message |

### ⚙️ Configuration

Drop a \`.axdreview.yml\` file in your repo root to customize review behavior:

\`\`\`yaml
review_focus:
  - security
  - performance
  - logic

severity_threshold: "medium"

custom_rules:
  - "Always check for SQL injection in raw queries"
  - "Ensure all async functions have try/catch"

ignore_paths:
  - "dist/**"
  - "*.generated.ts"
  - "migrations/**"
\`\`\`

> 📖 [Full configuration reference](https://github.com/KartikeyaNainkhwal/reviewbot#configuration)`;

    await postIssueComment(octokit, owner, repo, prNumber, helpText);
}

// ═══════════════════════════════════════════════════════════════════════
// Access Control
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if a user has write access (push, maintain, or admin) to a repo.
 *
 * Only users with write access can trigger bot commands to prevent
 * random users from spamming reviews on public repos.
 */
async function checkWriteAccess(
    octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
    owner: string,
    repo: string,
    username: string,
): Promise<boolean> {
    try {
        const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
            owner,
            repo,
            username,
        });

        const permission = data.permission;
        // 'admin', 'write' (maintain), 'read', 'none'
        return permission === 'admin' || permission === 'write';
    } catch (error) {
        logger.warn(
            { err: error, owner, repo, username },
            'Failed to check collaborator permission',
        );
        // Default deny on error
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// installation events
// ═══════════════════════════════════════════════════════════════════════

webhooks.on('installation.created', async ({ payload }) => {
    const inst = payload.installation;

    const account = inst.account as Record<string, unknown> | null;
    const accountLogin = account && 'login' in account ? String(account.login) : String(inst.id);
    const accountType = account && 'type' in account ? String(account.type).toUpperCase() : 'USER';

    const record = await installationRepo.upsert({
        githubId: inst.id,
        accountLogin,
        accountType: accountType as AccountType,
    });

    // Track all initially selected repositories
    const repos = payload.repositories ?? [];
    for (const r of repos) {
        await repositoryRepo.upsert({
            githubId: r.id,
            fullName: r.full_name,
            defaultBranch: (r as Record<string, unknown>).default_branch as string ?? 'main',
            installationId: record.id,
        });
    }

    logger.info(
        { installationId: inst.id, repoCount: repos.length },
        'Installation created',
    );
});

webhooks.on('installation.deleted', async ({ payload }) => {
    await installationRepo.delete(payload.installation.id);
    logger.info({ installationId: payload.installation.id }, 'Installation deleted');
});

webhooks.on('installation.suspend', async ({ payload }) => {
    await installationRepo.suspend(payload.installation.id);
    logger.info({ installationId: payload.installation.id }, 'Installation suspended');
});

webhooks.on('installation.unsuspend', async ({ payload }) => {
    await installationRepo.unsuspend(payload.installation.id);
    logger.info({ installationId: payload.installation.id }, 'Installation unsuspended');
});

// ─── installation_repositories events ───────────────────────────────────

webhooks.on('installation_repositories', async ({ payload }) => {
    const instId = payload.installation.id;
    if (!instId) {
        logger.warn('Missing installation ID in repos event');
        return;
    }
    const inst = await installationRepo.findByGithubId(instId);
    if (!inst) {
        logger.warn({ installationId: payload.installation.id }, 'Unknown installation');
        return;
    }

    for (const r of payload.repositories_added) {
        await repositoryRepo.upsert({
            githubId: r.id,
            fullName: r.full_name,
            defaultBranch: (r as Record<string, unknown>).default_branch as string ?? 'main',
            installationId: inst.id,
        });
    }

    for (const r of payload.repositories_removed) {
        if (!r.id) continue;
        const existing = await repositoryRepo.findByGithubId(r.id);
        if (existing) {
            await repositoryRepo.setActive(existing.id, false);
        }
    }

    logger.info(
        {
            added: payload.repositories_added.length,
            removed: payload.repositories_removed.length,
        },
        'Installation repos updated',
    );
});

// ─── Error handler ──────────────────────────────────────────────────────

webhooks.onError((error) => {
    logger.error({ err: error }, 'Webhook handler error');
});

// ─── Export the middleware ───────────────────────────────────────────────

/**
 * Express middleware that:
 *  1. Verifies the X-Hub-Signature-256 header (HMAC-SHA256)
 *  2. Parses the JSON body
 *  3. Routes to the correct event handler
 *
 * Mount at: app.use('/api/webhooks', webhookMiddleware)
 */
export const webhookMiddleware: RequestHandler = createNodeMiddleware(webhooks, {
    path: '/',
}) as RequestHandler;
