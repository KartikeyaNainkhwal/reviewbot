import { getLLMProvider } from './client.js';
import type { ReviewOutput } from './provider.js';
import { getSystemPrompt, buildReviewPrompt, buildRepairPrompt, type PRContext, type RepoReviewConfig } from './prompts.js';
import type { ReviewableChunk } from '../types/diff.types.js';
import type { LLMReviewResponse, ReviewIssue } from '../types/review.types.js';
import { issuesToComments } from '../types/review.types.js';
import type { LLMComment } from '../types/review.types.js';
import { logger } from '../config/logger.js';

// ─── Public types ───────────────────────────────────────────────────────

export type { ReviewOutput } from './provider.js';

// Extended output with legacy compat fields
export interface ReviewOutputWithComments extends ReviewOutput {
    /** Legacy comment format for posting to GitHub */
    comments: LLMComment[];
}

// ─── Main entry point ───────────────────────────────────────────────────

/**
 * Review one or more diff chunks using the active LLM provider.
 *
 * Delegates to the provider's `review()` method, which handles:
 *   - Building prompts
 *   - Calling the LLM with retry/repair logic
 *   - Severity filtering
 *   - Merging results across chunks
 *
 * Also converts issues to legacy comment format for GitHub posting.
 */
export async function reviewChunks(
    chunks: ReviewableChunk[],
    prContext: PRContext,
    repoConfig: RepoReviewConfig,
    fileContexts?: Map<string, string>,
): Promise<ReviewOutputWithComments> {
    const provider = getLLMProvider();

    logger.info(
        {
            provider: provider.name,
            model: provider.model,
            chunkCount: chunks.length,
        },
        'Starting review with LLM provider',
    );

    const result = await provider.review(chunks, prContext, repoConfig, fileContexts);

    // Convert issues → legacy comment format for GitHub posting
    const comments = issuesToComments(result.issues);

    return {
        ...result,
        comments,
    };
}

// ─── Legacy compat ──────────────────────────────────────────────────────

/**
 * Legacy entry point used by review.service.ts.
 * Wraps reviewChunks for backward compatibility.
 */
export async function reviewFiles(
    files: { path: string; language: string; status: string; additions: number; deletions: number; hunks: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; content: string; context: string }> }[],
    prTitle: string,
    prBody: string | null,
    language: string | null,
    customInstructions?: string,
): Promise<ReviewOutputWithComments> {
    // Convert legacy FileDiff[] to ReviewableChunk[]
    const chunkFiles = files.map((f) => ({
        filename: f.path,
        oldFilename: null,
        status: f.status as 'added' | 'modified' | 'deleted' | 'renamed',
        additions: f.additions,
        deletions: f.deletions,
        isBinary: false,
        hunks: f.hunks.map((h) => ({
            header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
            startLine: h.newStart,
            endLine: h.newStart + h.newLines - 1,
            oldStartLine: h.oldStart,
            oldEndLine: h.oldStart + h.oldLines - 1,
            lines: h.content.split('\n').map((line, idx) => ({
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                type: (line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : 'context') as 'add' | 'remove' | 'context',
                lineNumber: h.newStart + idx,
                oldLineNumber: line.startsWith('+') ? null : h.oldStart + idx,
                newLineNumber: line.startsWith('-') ? null : h.newStart + idx,
                content: line.slice(1),
            })),
            context: h.context,
        })),
        language: f.language,
    }));

    const chunk: ReviewableChunk = {
        id: 'legacy-chunk-1',
        files: chunkFiles,
        priority: 'core',
        estimatedTokens: 0,
        reason: 'legacy reviewFiles() call',
    };

    const prContext: PRContext = {
        title: prTitle,
        description: prBody,
        author: 'unknown',
        baseBranch: 'main',
        headBranch: 'feature',
        language,
    };

    const repoConfig: RepoReviewConfig = {
        customInstructions,
    };

    return reviewChunks([chunk], prContext, repoConfig);
}
