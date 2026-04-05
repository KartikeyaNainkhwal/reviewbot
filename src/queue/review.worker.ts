import { Worker, Job } from 'bullmq';
import { REVIEW_QUEUE_NAME } from './review.queue.js';
import { getRedisConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger, createChildLogger } from '../config/logger.js';
import {
    getInstallationOctokit,
    fetchPRMetadata,
    fetchPRDiff,
    postIssueComment,
} from '../github/app.js';
import { parseDiff } from '../github/diff-parser.js';
import { extractReviewableChunks } from '../github/chunk-extractor.js';
import { reviewChunks } from '../llm/reviewer.js';
import { applyReviewLabel } from '../github/label-manager.js';
import { postFullReview } from '../github/review-poster.js';
import { configService } from '../services/config.service.js';
import { usageService } from '../services/usage.service.js';
import { reviewRepo } from '../db/repositories/review.repo.js';
import { repositoryRepo } from '../db/repositories/repository.repo.js';
import { installationRepo } from '../db/repositories/installation.repo.js';
import type { ReviewJobData } from '../types/review.types.js';
import type { PRContext, RepoReviewConfig } from '../llm/prompts.js';

let worker: Worker<ReviewJobData> | null = null;

// ─── Job processor ──────────────────────────────────────────────────────

async function processReviewJob(job: Job<ReviewJobData>) {
    const { data } = job;
    const [owner, repo] = data.repoFullName.split('/');

    const log = createChildLogger({
        jobId: job.id,
        repo: data.repoFullName,
        pr: data.prNumber,
        attempt: job.attemptsMade + 1,
    });

    const startTime = Date.now();

    // ── Step 1: Look up repo in DB ─────────────────────────────────────

    const repoRecord = await repositoryRepo.findByGithubId(data.repoGithubId);
    if (!repoRecord) {
        log.warn('Repository not found in database, skipping');
        return { status: 'skipped', reason: 'repo_not_found' };
    }

    // ── Step 2: Create review record ───────────────────────────────────

    const review = await reviewRepo.create({
        repositoryId: repoRecord.id,
        prNumber: data.prNumber,
        headSha: data.headSha,
        baseSha: data.baseSha,
        triggerAction: data.action,
        triggeredBy: data.sender,
    });

    await reviewRepo.updateStatus(review.id, 'IN_PROGRESS');

    try {
        // ── Step 3: Authenticate as GitHub App installation ─────────────

        log.info('Authenticating as installation');
        const octokit = await getInstallationOctokit(data.installationId);

        // ── Step 4: Fetch PR metadata ──────────────────────────────────

        log.info('Fetching PR metadata');
        const metadata = await fetchPRMetadata(octokit, owner, repo, data.prNumber);

        // Skip draft PRs (might have been converted after webhook fired)
        if (metadata.draft) {
            log.info('PR is now a draft, skipping');
            await reviewRepo.updateStatus(review.id, 'SKIPPED', {
                summary: 'PR is a draft',
                completedAt: new Date(),
                durationMs: Date.now() - startTime,
            });
            return { status: 'skipped', reason: 'draft' };
        }

        // ── Step 5: Fetch the PR diff ──────────────────────────────────

        log.info('Fetching PR diff');
        const rawDiff = await fetchPRDiff(octokit, owner, repo, data.prNumber);

        if (!rawDiff || rawDiff.trim().length === 0) {
            log.info('Empty diff, skipping');
            await reviewRepo.updateStatus(review.id, 'SKIPPED', {
                summary: 'Empty diff',
                completedAt: new Date(),
                durationMs: Date.now() - startTime,
            });
            return { status: 'skipped', reason: 'empty_diff' };
        }

        // Guard: diff size limit
        if (rawDiff.length > env.MAX_DIFF_SIZE_BYTES) {
            log.warn({ diffSize: rawDiff.length, limit: env.MAX_DIFF_SIZE_BYTES }, 'Diff too large');
            await postIssueComment(
                octokit, owner, repo, data.prNumber,
                `🤖 **ReviewCode** — Skipping review: diff is ${(rawDiff.length / 1024).toFixed(0)}KB (limit: ${(env.MAX_DIFF_SIZE_BYTES / 1024).toFixed(0)}KB).`,
            );
            await reviewRepo.updateStatus(review.id, 'SKIPPED', {
                summary: `Diff too large: ${rawDiff.length} bytes`,
                completedAt: new Date(),
                durationMs: Date.now() - startTime,
            });
            return { status: 'skipped', reason: 'diff_too_large' };
        }

        // ── Step 6: Load repo config (before parsing, needed for ignore_paths) ──

        const repoConfig = configService.getConfig(repoRecord.config);

        // ── Step 7: Parse diff and extract reviewable chunks ───────────

        const parsedDiff = parseDiff(rawDiff);

        // Guard: file count limit
        if (parsedDiff.totalFiles > env.MAX_FILES_PER_REVIEW) {
            log.warn({ fileCount: parsedDiff.totalFiles, limit: env.MAX_FILES_PER_REVIEW }, 'Too many files');
            await postIssueComment(
                octokit, owner, repo, data.prNumber,
                `🤖 **ReviewCode** — Skipping review: PR touches ${parsedDiff.totalFiles} files (limit: ${env.MAX_FILES_PER_REVIEW}).`,
            );
            await reviewRepo.updateStatus(review.id, 'SKIPPED', {
                summary: `Too many files: ${parsedDiff.totalFiles}`,
                completedAt: new Date(),
                durationMs: Date.now() - startTime,
            });
            return { status: 'skipped', reason: 'too_many_files' };
        }

        const { chunks, skipped } = extractReviewableChunks(parsedDiff, undefined, repoConfig.ignore_paths);

        if (chunks.length === 0) {
            log.info({ skippedFiles: skipped.length }, 'No reviewable files after filtering');
            await postIssueComment(
                octokit, owner, repo, data.prNumber,
                '🤖 **ReviewCode** — No reviewable files in this PR (all files were filtered out).',
            );
            await reviewRepo.updateStatus(review.id, 'SKIPPED', {
                summary: 'No reviewable files after filtering',
                completedAt: new Date(),
                durationMs: Date.now() - startTime,
            });
            return { status: 'skipped', reason: 'no_reviewable_files' };
        }

        // ── Step 8: Build PR context ──────────────────────────────────

        const prContext: PRContext = {
            title: metadata.title,
            description: metadata.body,
            author: metadata.author,
            baseBranch: metadata.baseRef,
            headBranch: metadata.headRef,
            language: data.language,
        };

        // Inject the full config context (custom_rules, review_focus, etc.) into the prompt
        const configPromptContext = configService.getPromptContext(repoConfig);

        const reviewConfig: RepoReviewConfig = {
            customInstructions: configPromptContext || repoConfig.customInstructions,
            focusAreas: repoConfig.review_focus,
            severityThreshold: repoConfig.severity_threshold,
        };

        // ── Step 8: Run the LLM review engine ──────────────────────────

        log.info({ chunkCount: chunks.length }, 'Running LLM review engine');
        const result = await reviewChunks(chunks, prContext, reviewConfig);

        // ── Step 9: Post review to GitHub ──────────────────────────────

        const durationMs = Date.now() - startTime;

        const llmResponse = {
            summary: result.summary,
            overallVerdict: result.overallVerdict,
            issues: result.issues,
            positives: result.positives,
            questions: result.questions,
        };

        const { reviewId: githubReviewId, summaryCommentId: githubCommentId } = await postFullReview(
            octokit, owner, repo, data.prNumber,
            metadata.headSha,
            llmResponse,
            {
                filesReviewed: parsedDiff.totalFiles - skipped.length,
                durationMs,
                promptTokens: result.totalPromptTokens,
                completionTokens: result.totalCompletionTokens,
            },
            rawDiff,
            repoConfig.ignore_paths,
        );

        // ── Step 10: Save results to DB ────────────────────────────────

        if (result.issues.length > 0) {
            await reviewRepo.addIssues(review.id, result.issues);
        }

        await reviewRepo.updateStatus(review.id, 'COMPLETED', {
            verdict: result.overallVerdict,
            filesReviewed: parsedDiff.totalFiles - skipped.length,
            commentsPosted: result.issues.length,
            promptTokens: result.totalPromptTokens,
            completionTokens: result.totalCompletionTokens,
            durationMs,
            summary: result.summary,
            completedAt: new Date(),
            githubReviewId: githubReviewId ?? undefined,
            githubCommentId,
        });

        // ── Step 11: Apply review label to PR ────────────────────────────

        await applyReviewLabel(
            octokit, owner, repo, data.prNumber,
            result.issues, result.overallVerdict,
        );

        // ── Step 12: Track usage ───────────────────────────────────────

        const installationRecord = await installationRepo.findByGithubId(data.installationId);
        if (installationRecord) {
            await usageService.trackUsage(
                installationRecord.id,
                result.totalPromptTokens,
                result.totalCompletionTokens,
            );
        }

        log.info(
            {
                status: 'completed',
                filesReviewed: parsedDiff.totalFiles - skipped.length,
                issuesFound: result.issues.length,
                verdict: result.overallVerdict,
                durationMs,
            },
            'Review completed',
        );

        return {
            status: 'completed',
            reviewId: review.id,
            filesReviewed: parsedDiff.totalFiles - skipped.length,
            issuesFound: result.issues.length,
            durationMs,
        };
    } catch (error) {
        const err = error as Error;
        const durationMs = Date.now() - startTime;

        log.error({ err, durationMs }, 'Review job failed');

        await reviewRepo.updateStatus(review.id, 'FAILED', {
            errorMessage: err.message,
            durationMs,
            completedAt: new Date(),
        });

        // Re-throw so Bull retries the job
        throw error;
    }
}

// ─── Worker lifecycle ───────────────────────────────────────────────────

/**
 * Start the BullMQ worker that processes review jobs.
 */
export function startReviewWorker(): Worker<ReviewJobData> {
    if (worker) return worker;

    worker = new Worker<ReviewJobData>(
        REVIEW_QUEUE_NAME,
        processReviewJob,
        {
            connection: getRedisConnection(),
            concurrency: env.QUEUE_CONCURRENCY,
        },
    );

    worker.on('completed', (job) => {
        logger.debug({ jobId: job?.id }, 'Job completed');
    });

    worker.on('failed', (job, err) => {
        logger.error(
            { jobId: job?.id, err, attempt: job?.attemptsMade },
            'Job failed',
        );
    });

    worker.on('error', (err) => {
        logger.error({ err }, 'Worker error');
    });

    logger.info({ concurrency: env.QUEUE_CONCURRENCY }, 'Review worker started');
    return worker;
}

export async function stopReviewWorker(): Promise<void> {
    if (worker) {
        await worker.close();
        worker = null;
        logger.info('Review worker stopped');
    }
}
