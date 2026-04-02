import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { LLMReviewResponseSchema, type LLMReviewResponse, type ReviewIssue } from '../types/review.types.js';
import { issuesToComments } from '../types/review.types.js';
import { getSystemPrompt, buildReviewPrompt, buildRepairPrompt, type PRContext, type RepoReviewConfig } from './prompts.js';
import type { ReviewableChunk } from '../types/diff.types.js';
import type { LLMProvider, LLMCallResult, ReviewOutput } from './provider.js';
import { LLMParseError, LLMCallError } from './provider.js';

// ─── Constants ──────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15000;

// ─── Severity filtering ────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
};

// ─── Verdict priority (worst wins when merging chunks) ──────────────────

const VERDICT_PRIORITY: Record<LLMReviewResponse['overallVerdict'], number> = {
    approve: 0,
    comment: 1,
    request_changes: 2,
};

// ═══════════════════════════════════════════════════════════════════════
// Groq Provider
// ═══════════════════════════════════════════════════════════════════════

interface RawLLMResult {
    content: string;
    promptTokens: number;
    completionTokens: number;
    model: string;
    latencyMs: number;
}

export class GroqProvider implements LLMProvider {
    readonly name = 'Groq';
    readonly model: string;
    private client: Groq;

    constructor() {
        this.model = env.GROQ_MODEL;
        this.client = new Groq({
            apiKey: env.GROQ_API_KEY,
            timeout: env.GROQ_TIMEOUT_MS,
            maxRetries: 0, // We handle retries ourselves for JSON repair logic
        });

        logger.info({ provider: this.name, model: this.model }, 'LLM provider initialized');
    }

    // ═══════════════════════════════════════════════════════════════════
    // High-level: review chunks
    // ═══════════════════════════════════════════════════════════════════

    async review(
        chunks: ReviewableChunk[],
        prContext: PRContext,
        repoConfig: RepoReviewConfig,
        fileContexts?: Map<string, string>,
    ): Promise<ReviewOutput> {
        const systemPrompt = getSystemPrompt();
        const allIssues: ReviewIssue[] = [];
        const allPositives: string[] = [];
        const allQuestions: string[] = [];
        const summaries: string[] = [];
        let worstVerdict: LLMReviewResponse['overallVerdict'] = 'approve';
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalAttempts = 0;

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            try {
                logger.info(
                    {
                        chunkId: chunk.id,
                        chunkIndex: i + 1,
                        totalChunks: chunks.length,
                        fileCount: chunk.files.length,
                        priority: chunk.priority,
                        estimatedTokens: chunk.estimatedTokens,
                    },
                    'Reviewing chunk',
                );

                const userPrompt = buildReviewPrompt(chunk, prContext, repoConfig, fileContexts);

                const result = await this.call(
                    systemPrompt,
                    userPrompt,
                    buildRepairPrompt,
                );

                // Aggregate results
                allIssues.push(...result.response.issues);
                allPositives.push(...result.response.positives);
                allQuestions.push(...result.response.questions);
                summaries.push(result.response.summary);
                totalPromptTokens += result.promptTokens;
                totalCompletionTokens += result.completionTokens;
                totalAttempts += result.attempts;

                // Track worst verdict
                if (VERDICT_PRIORITY[result.response.overallVerdict] > VERDICT_PRIORITY[worstVerdict]) {
                    worstVerdict = result.response.overallVerdict;
                }

                logger.info(
                    {
                        chunkId: chunk.id,
                        issuesFound: result.response.issues.length,
                        verdict: result.response.overallVerdict,
                        promptTokens: result.promptTokens,
                        completionTokens: result.completionTokens,
                    },
                    'Chunk review completed',
                );
            } catch (error) {
                logger.error(
                    {
                        err: error,
                        chunkId: chunk.id,
                        files: chunk.files.map((f) => f.filename),
                    },
                    'Failed to review chunk',
                );
                // Continue with other chunks — don't let one failure break everything
            }
        }

        // ── Filter by severity threshold ────────────────────────────────

        const thresholdRank = SEVERITY_RANK[repoConfig.severityThreshold ?? 'low'] ?? 1;
        const filteredIssues = allIssues.filter(
            (issue) => (SEVERITY_RANK[issue.severity] ?? 0) >= thresholdRank,
        );

        if (filteredIssues.length < allIssues.length) {
            logger.info(
                {
                    total: allIssues.length,
                    afterFilter: filteredIssues.length,
                    threshold: repoConfig.severityThreshold,
                },
                'Issues filtered by severity threshold',
            );
        }

        // ── Merge summaries ─────────────────────────────────────────────

        const summary = chunks.length === 1
            ? (summaries[0] ?? 'No reviewable content found.')
            : `Reviewed ${chunks.length} chunks:\n\n${summaries.map((s, i) => `**Chunk ${i + 1}:** ${s}`).join('\n\n')}`;

        // Deduplicate
        const uniquePositives = [...new Set(allPositives)];
        const uniqueQuestions = [...new Set(allQuestions)];

        logger.info(
            {
                provider: this.name,
                model: this.model,
                totalIssues: filteredIssues.length,
                overallVerdict: worstVerdict,
                totalPromptTokens,
                totalCompletionTokens,
                totalAttempts,
            },
            'All chunks reviewed',
        );

        return {
            issues: filteredIssues,
            summary,
            overallVerdict: worstVerdict,
            positives: uniquePositives,
            questions: uniqueQuestions,
            totalPromptTokens,
            totalCompletionTokens,
            totalAttempts,
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // Low-level: call Groq API with retry + parse + validate
    // ═══════════════════════════════════════════════════════════════════

    async call(
        systemPrompt: string,
        userPrompt: string,
        repairPromptBuilder?: (malformed: string, error: string) => string,
    ): Promise<LLMCallResult> {
        const overallStart = Date.now();
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // ── Step 1: Call Groq API ────────────────────────────────

                const raw = await this.callRaw(systemPrompt, userPrompt);
                totalPromptTokens += raw.promptTokens;
                totalCompletionTokens += raw.completionTokens;

                logger.info(
                    {
                        attempt,
                        model: raw.model,
                        promptTokens: raw.promptTokens,
                        completionTokens: raw.completionTokens,
                        latencyMs: raw.latencyMs,
                    },
                    'Groq API call completed',
                );

                // ── Step 2: Parse JSON ────────────────────────────────────

                const parsed = this.parseResponse(raw.content);

                // ── Step 3: Validate with Zod ─────────────────────────────

                const validated = this.validateResponse(parsed);

                return {
                    response: validated,
                    promptTokens: totalPromptTokens,
                    completionTokens: totalCompletionTokens,
                    model: raw.model,
                    attempts: attempt,
                    totalLatencyMs: Date.now() - overallStart,
                };
            } catch (error) {
                lastError = error as Error;

                // ── JSON/schema failure: try repair prompt ────────────────

                if (error instanceof LLMParseError && repairPromptBuilder && attempt < MAX_RETRIES) {
                    logger.warn(
                        { attempt, error: error.message },
                        'Groq returned invalid JSON, sending repair prompt',
                    );

                    try {
                        const repairPrompt = repairPromptBuilder(error.rawContent, error.message);
                        const repairResult = await this.callRaw(systemPrompt, repairPrompt);
                        totalPromptTokens += repairResult.promptTokens;
                        totalCompletionTokens += repairResult.completionTokens;

                        const reparsed = this.parseResponse(repairResult.content);
                        const revalidated = this.validateResponse(reparsed);

                        logger.info({ attempt }, 'Repair prompt succeeded');
                        return {
                            response: revalidated,
                            promptTokens: totalPromptTokens,
                            completionTokens: totalCompletionTokens,
                            model: repairResult.model,
                            attempts: attempt,
                            totalLatencyMs: Date.now() - overallStart,
                        };
                    } catch (repairError) {
                        logger.warn({ attempt, error: (repairError as Error).message }, 'Repair prompt also failed');
                        // Fall through to retry loop
                    }
                }

                // ── API error: check if retryable ─────────────────────────

                if (error instanceof LLMCallError && !error.isRetryable) {
                    logger.error({ err: error, attempt }, 'Non-retryable Groq API error');
                    throw error;
                }

                // ── Exponential backoff ───────────────────────────────────

                if (attempt < MAX_RETRIES) {
                    const delay = Math.min(
                        BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 500,
                        MAX_DELAY_MS,
                    );
                    logger.warn(
                        { attempt, delayMs: delay, error: (error as Error).message },
                        'Retrying Groq call after delay',
                    );
                    await this.sleep(delay);
                }
            }
        }

        // All retries exhausted
        const totalMs = Date.now() - overallStart;
        logger.error(
            {
                totalMs,
                totalPromptTokens,
                totalCompletionTokens,
                lastError: lastError?.message,
            },
            'All Groq retry attempts exhausted',
        );

        throw lastError ?? new LLMCallError('Unknown error after all retries');
    }

    // ═══════════════════════════════════════════════════════════════════
    // Private: raw API call
    // ═══════════════════════════════════════════════════════════════════

    private async callRaw(
        systemPrompt: string,
        userPrompt: string,
    ): Promise<RawLLMResult> {
        const start = Date.now();

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                max_tokens: env.GROQ_MAX_TOKENS,
                temperature: 0.1, // Low temperature for consistent, deterministic reviews
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            });

            const content = response.choices[0]?.message?.content || '';

            return {
                content,
                promptTokens: response.usage?.prompt_tokens ?? 0,
                completionTokens: response.usage?.completion_tokens ?? 0,
                model: response.model,
                latencyMs: Date.now() - start,
            };
        } catch (error) {
            const latencyMs = Date.now() - start;
            const err = error as { status?: number; message?: string; error?: { type?: string } };

            // Classify error for retry logic
            const statusCode = err.status;
            const isRetryable = statusCode === 429     // Rate limited
                || statusCode === 500                    // Server error
                || statusCode === 502                    // Bad gateway
                || statusCode === 503                    // Service unavailable
                || statusCode === 529;                   // Overloaded

            logger.error(
                { statusCode, latencyMs, errorType: err.error?.type },
                'Groq API request failed',
            );

            throw new LLMCallError(
                err.message ?? 'Groq API call failed',
                statusCode,
                isRetryable,
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Private: JSON parsing + Zod validation
    // ═══════════════════════════════════════════════════════════════════

    private parseResponse(raw: string): unknown {
        let cleaned = raw.trim();

        // Strip markdown code fences (LLMs sometimes add them despite instructions)
        if (cleaned.startsWith('```json')) {
            cleaned = cleaned.slice(7);
        } else if (cleaned.startsWith('```')) {
            cleaned = cleaned.slice(3);
        }
        if (cleaned.endsWith('```')) {
            cleaned = cleaned.slice(0, -3);
        }
        cleaned = cleaned.trim();

        // Strip any leading text before the first {
        const jsonStart = cleaned.indexOf('{');
        if (jsonStart > 0) {
            logger.debug(
                { prefixLength: jsonStart },
                'Stripping non-JSON prefix from LLM response',
            );
            cleaned = cleaned.slice(jsonStart);
        }

        // Strip any trailing text after the last }
        const jsonEnd = cleaned.lastIndexOf('}');
        if (jsonEnd >= 0 && jsonEnd < cleaned.length - 1) {
            cleaned = cleaned.slice(0, jsonEnd + 1);
        }

        try {
            return JSON.parse(cleaned);
        } catch (error) {
            throw new LLMParseError(
                `Invalid JSON: ${(error as Error).message}`,
                raw,
            );
        }
    }

    private validateResponse(parsed: unknown): LLMReviewResponse {
        const result = LLMReviewResponseSchema.safeParse(parsed);

        if (!result.success) {
            const issues = result.error.issues
                .map((i) => `${i.path.join('.')}: ${i.message}`)
                .join('; ');

            logger.warn({ issues, parsed }, 'LLM response schema validation failed');

            throw new LLMParseError(
                `Schema validation failed: ${issues}`,
                JSON.stringify(parsed).slice(0, 3000),
            );
        }

        return result.data;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
