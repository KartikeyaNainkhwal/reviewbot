import { getInstallationOctokit, fetchPRDiff, postIssueComment } from '../github/app.js';
import { parseDiff } from '../github/diff-parser.js';
import { extractReviewableChunks } from '../github/chunk-extractor.js';
import { reviewChunks } from '../llm/reviewer.js';
import { postFullReview } from '../github/review-poster.js';
import { reviewRepo } from '../db/repositories/review.repo.js';
import { repositoryRepo } from '../db/repositories/repository.repo.js';
import { installationRepo } from '../db/repositories/installation.repo.js';
import { configService } from './config.service.js';
import { usageService } from './usage.service.js';
import { env } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';
import type { ReviewJobData, ReviewResult } from '../types/review.types.js';
import type { PRContext, RepoReviewConfig } from '../llm/prompts.js';

class ReviewService {
    /**
     * Process a full PR review: fetch diff → filter files → call LLM → post comments → save results.
     */
    async processReview(jobData: ReviewJobData): Promise<ReviewResult> {
        const log = createChildLogger({
            repoFullName: jobData.repoFullName,
            prNumber: jobData.prNumber,
        });

        const startTime = Date.now();
        const [owner, repo] = jobData.repoFullName.split('/');

        // 1. Find repository record
        const repoRecord = await repositoryRepo.findByGithubId(jobData.repoGithubId);
        if (!repoRecord) {
            log.warn('Repository not found in DB');
            return this.skipResult('Repository not found');
        }

        // 2. Create review record
        const review = await reviewRepo.create({
            repositoryId: repoRecord.id,
            prNumber: jobData.prNumber,
            headSha: jobData.headSha,
            baseSha: jobData.baseSha,
            triggerAction: jobData.action,
            triggeredBy: jobData.sender,
        });

        try {
            // 3. Update status to IN_PROGRESS
            await reviewRepo.updateStatus(review.id, 'IN_PROGRESS');

            // 4. Get authenticated Octokit for this installation
            const octokit = await getInstallationOctokit(jobData.installationId);

            // 5. Fetch and parse diff
            const rawDiff = await fetchPRDiff(octokit, owner, repo, jobData.prNumber);

            if (!rawDiff || rawDiff.length === 0) {
                return this.completeReview(review.id, startTime, {
                    status: 'skipped',
                    summary: 'No diff content found.',
                });
            }

            // Check diff size limit
            if (rawDiff.length > env.MAX_DIFF_SIZE_BYTES) {
                await postIssueComment(
                    octokit,
                    owner,
                    repo,
                    jobData.prNumber,
                    '🤖 **ReviewCode**: Skipping review — diff is too large for analysis.',
                );
                return this.completeReview(review.id, startTime, {
                    status: 'skipped',
                    summary: 'Diff exceeds size limit.',
                });
            }

            // 6. Parse diff and extract reviewable chunks
            const parsedDiff = parseDiff(rawDiff);
            const repoConfig = configService.getConfig(repoRecord.config);

            // Check file count limit
            if (parsedDiff.totalFiles > (repoConfig.maxFilesPerReview ?? repoConfig.max_files_per_review)) {
                await postIssueComment(
                    octokit,
                    owner,
                    repo,
                    jobData.prNumber,
                    `🤖 **ReviewCode**: Skipping review — PR touches ${parsedDiff.totalFiles} files (limit: ${repoConfig.max_files_per_review}).`,
                );
                return this.completeReview(review.id, startTime, {
                    status: 'skipped',
                    summary: `Too many files: ${parsedDiff.totalFiles} > ${repoConfig.max_files_per_review}`,
                });
            }

            const { chunks, skipped } = extractReviewableChunks(parsedDiff, undefined, repoConfig.ignore_paths);

            if (chunks.length === 0) {
                return this.completeReview(review.id, startTime, {
                    status: 'skipped',
                    summary: 'No reviewable files after filtering.',
                });
            }

            const filesReviewed = parsedDiff.totalFiles - skipped.length;
            log.info({ fileCount: filesReviewed, chunkCount: chunks.length }, 'Starting LLM review');

            // 7. Build context and call LLM
            const prContext: PRContext = {
                title: jobData.title,
                description: jobData.body,
                author: jobData.sender,
                baseBranch: 'main',
                headBranch: 'feature',
                language: jobData.language,
            };

            const configPromptContext = configService.getPromptContext(repoConfig);

            const reviewConfig: RepoReviewConfig = {
                customInstructions: configPromptContext || repoConfig.customInstructions,
                focusAreas: repoConfig.review_focus,
                severityThreshold: repoConfig.severity_threshold,
            };

            const reviewOutput = await reviewChunks(chunks, prContext, reviewConfig);

            // 8. Post review to GitHub
            const durationMs = Date.now() - startTime;

            const llmResponse = {
                summary: reviewOutput.summary,
                overallVerdict: reviewOutput.overallVerdict,
                issues: reviewOutput.issues,
                positives: reviewOutput.positives,
                questions: reviewOutput.questions,
            };

            const { reviewId: githubReviewId, summaryCommentId } = await postFullReview(
                octokit,
                owner,
                repo,
                jobData.prNumber,
                jobData.headSha,
                llmResponse,
                {
                    filesReviewed,
                    durationMs,
                    promptTokens: reviewOutput.totalPromptTokens,
                    completionTokens: reviewOutput.totalCompletionTokens,
                },
            );

            // 9. Save issues to DB
            if (reviewOutput.issues.length > 0) {
                await reviewRepo.addIssues(review.id, reviewOutput.issues);
            }

            // 10. Track usage
            const installationRecord = await installationRepo.findByGithubId(jobData.installationId);

            if (installationRecord) {
                await usageService.trackUsage(
                    installationRecord.id,
                    reviewOutput.totalPromptTokens,
                    reviewOutput.totalCompletionTokens,
                );
            }

            // 11. Complete review (persist GitHub IDs for future updates)
            await reviewRepo.updateStatus(review.id, 'COMPLETED', {
                verdict: reviewOutput.overallVerdict,
                filesReviewed,
                commentsPosted: reviewOutput.issues.length,
                promptTokens: reviewOutput.totalPromptTokens,
                completionTokens: reviewOutput.totalCompletionTokens,
                durationMs,
                summary: reviewOutput.summary,
                completedAt: new Date(),
                githubReviewId: githubReviewId ?? undefined,
                githubCommentId: summaryCommentId,
            });

            return {
                reviewId: review.id,
                status: 'completed',
                filesReviewed,
                commentsPosted: reviewOutput.issues.length,
                promptTokens: reviewOutput.totalPromptTokens,
                completionTokens: reviewOutput.totalCompletionTokens,
                durationMs,
                summary: reviewOutput.summary,
                errorMessage: null,
            };
        } catch (error) {
            const err = error as Error;
            const durationMs = Date.now() - startTime;

            await reviewRepo.updateStatus(review.id, 'FAILED', {
                durationMs,
                errorMessage: err.message,
                completedAt: new Date(),
            });

            return {
                reviewId: review.id,
                status: 'failed',
                filesReviewed: 0,
                commentsPosted: 0,
                promptTokens: 0,
                completionTokens: 0,
                durationMs,
                summary: null,
                errorMessage: err.message,
            };
        }
    }

    private skipResult(reason: string): ReviewResult {
        return {
            reviewId: '',
            status: 'skipped',
            filesReviewed: 0,
            commentsPosted: 0,
            promptTokens: 0,
            completionTokens: 0,
            durationMs: 0,
            summary: reason,
            errorMessage: null,
        };
    }

    private async completeReview(
        reviewId: string,
        startTime: number,
        opts: { status: 'skipped' | 'completed'; summary: string },
    ): Promise<ReviewResult> {
        const durationMs = Date.now() - startTime;
        const dbStatus = opts.status === 'skipped' ? 'SKIPPED' as const : 'COMPLETED' as const;

        await reviewRepo.updateStatus(reviewId, dbStatus, {
            durationMs,
            summary: opts.summary,
            completedAt: new Date(),
        });

        return {
            reviewId,
            status: opts.status,
            filesReviewed: 0,
            commentsPosted: 0,
            promptTokens: 0,
            completionTokens: 0,
            durationMs,
            summary: opts.summary,
            errorMessage: null,
        };
    }
}

export const reviewService = new ReviewService();
