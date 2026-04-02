import type { ReviewableChunk } from '../types/diff.types.js';
import type { LLMReviewResponse, ReviewIssue } from '../types/review.types.js';
import type { PRContext, RepoReviewConfig } from './prompts.js';

// ═══════════════════════════════════════════════════════════════════════
// LLM Provider Interface
// ═══════════════════════════════════════════════════════════════════════
//
// Every LLM provider (Groq, Claude, OpenAI, etc.) implements this
// interface. Switching providers is just swapping the implementation
// in `createProvider()`.

/**
 * Result from a single LLM call (one chunk reviewed).
 */
export interface LLMCallResult {
    response: LLMReviewResponse;
    promptTokens: number;
    completionTokens: number;
    model: string;
    attempts: number;
    totalLatencyMs: number;
}

/**
 * Aggregated result from reviewing all chunks.
 */
export interface ReviewOutput {
    /** All issues found across all chunks */
    issues: ReviewIssue[];
    /** Combined summary */
    summary: string;
    /** Overall verdict (worst across chunks wins) */
    overallVerdict: LLMReviewResponse['overallVerdict'];
    /** Positive observations */
    positives: string[];
    /** Questions for the author */
    questions: string[];
    /** Token usage */
    totalPromptTokens: number;
    totalCompletionTokens: number;
    /** Number of LLM calls made (including retries) */
    totalAttempts: number;
}

/**
 * The LLM Provider interface.
 *
 * Every provider must implement `review()`, which takes raw diff chunks
 * and returns a structured review result.
 *
 * Switching from Groq to Claude is just:
 *   export const llmProvider = new ClaudeProvider();
 */
export interface LLMProvider {
    /** Human-readable name (for logging) */
    readonly name: string;

    /** The model being used */
    readonly model: string;

    /**
     * Review one or more diff chunks.
     *
     * Internally handles:
     *  - Building system + user prompts
     *  - Calling the LLM API
     *  - Retry with exponential backoff on rate limits
     *  - JSON parsing and Zod validation
     *  - Repair prompts on parse failure
     *  - Merging results across chunks
     *  - Severity threshold filtering
     */
    review(
        chunks: ReviewableChunk[],
        prContext: PRContext,
        repoConfig: RepoReviewConfig,
        fileContexts?: Map<string, string>,
    ): Promise<ReviewOutput>;

    /**
     * Low-level: call the LLM with raw prompts.
     * Used by review() internally, but exposed for testing.
     */
    call(
        systemPrompt: string,
        userPrompt: string,
        repairPromptBuilder?: (malformed: string, error: string) => string,
    ): Promise<LLMCallResult>;
}

// ─── Error classes ──────────────────────────────────────────────────────

export class LLMParseError extends Error {
    constructor(
        message: string,
        public readonly rawContent: string,
    ) {
        super(message);
        this.name = 'LLMParseError';
    }
}

export class LLMCallError extends Error {
    public readonly statusCode?: number;
    public readonly isRetryable: boolean;

    constructor(message: string, statusCode?: number, isRetryable = false) {
        super(message);
        this.name = 'LLMCallError';
        this.statusCode = statusCode;
        this.isRetryable = isRetryable;
    }
}
