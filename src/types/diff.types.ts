// ─── Parsed Diff Types ──────────────────────────────────────────────────

export type LineType = 'add' | 'remove' | 'context';
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface DiffLine {
    type: LineType;
    lineNumber: number;         // Line number in the new file (or old file for removals)
    oldLineNumber: number | null; // Line number in old file (null for additions)
    newLineNumber: number | null; // Line number in new file (null for deletions)
    content: string;             // Raw content without +/- prefix
}

export interface DiffHunk {
    header: string;              // The @@ line header (e.g., "@@ -10,7 +10,9 @@ function foo()")
    startLine: number;           // Starting line in new file
    endLine: number;             // Ending line in new file
    oldStartLine: number;
    oldEndLine: number;
    lines: DiffLine[];
    context: string;             // Function/class context from the @@ header
}

export interface DiffFile {
    filename: string;
    oldFilename: string | null;   // Non-null for renames
    status: FileStatus;
    additions: number;
    deletions: number;
    isBinary: boolean;
    hunks: DiffHunk[];
    language: string;
}

export interface ParsedDiff {
    files: DiffFile[];
    totalAdditions: number;
    totalDeletions: number;
    totalFiles: number;
}

// ─── Chunk Extraction Types ─────────────────────────────────────────────

export type FilePriority = 'security' | 'core' | 'test' | 'config' | 'docs' | 'generated';

export interface ReviewableChunk {
    id: string;                   // Unique chunk identifier
    files: DiffFile[];
    priority: FilePriority;
    estimatedTokens: number;
    reason: string;               // Why this chunk was grouped
}

export interface ChunkExtractionResult {
    chunks: ReviewableChunk[];
    skipped: Array<{
        filename: string;
        reason: string;
    }>;
    stats: ChunkStats;
}

export interface ChunkStats {
    totalFiles: number;
    reviewableFiles: number;
    skippedFiles: number;
    totalChunks: number;
    estimatedTotalTokens: number;
}

// ─── File Context Types ─────────────────────────────────────────────────

export interface FileContext {
    filename: string;
    ref: string;
    fullContent: string | null;    // null if file is binary/too large
    relevantSections: ContextSection[];
    isTruncated: boolean;
}

export interface ContextSection {
    startLine: number;
    endLine: number;
    content: string;
    reason: string;                // "surrounding hunk at line 42"
}

// ─── Stats Summary Types ────────────────────────────────────────────────

export interface PRReviewStats {
    filesAnalyzed: number;
    filesSkipped: number;
    totalAdditions: number;
    totalDeletions: number;
    languageBreakdown: Record<string, number>;
    complexityEstimate: 'trivial' | 'small' | 'medium' | 'large' | 'very_large';
    riskAreas: string[];
    chunkCount: number;
    estimatedReviewTokens: number;
}
