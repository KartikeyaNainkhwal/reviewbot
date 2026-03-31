// ─── Webhook Payload Types ───────────────────────────────────────────────

export interface WebhookPRPayload {
    action: 'opened' | 'synchronize' | 'closed' | 'reopened';
    number: number;
    pull_request: {
        number: number;
        title: string;
        body: string | null;
        head: {
            sha: string;
            ref: string;
        };
        base: {
            sha: string;
            ref: string;
        };
        user: {
            login: string;
            type: string;
        };
        draft: boolean;
        changed_files: number;
        additions: number;
        deletions: number;
    };
    repository: {
        id: number;
        full_name: string;
        default_branch: string;
        language: string | null;
    };
    installation?: {
        id: number;
    };
    sender: {
        login: string;
        type: string;
    };
}

export interface WebhookCommentPayload {
    action: 'created' | 'edited' | 'deleted';
    comment: {
        id: number;
        body: string;
        user: {
            login: string;
        };
    };
    issue: {
        number: number;
        pull_request?: {
            url: string;
        };
    };
    repository: {
        id: number;
        full_name: string;
    };
    installation?: {
        id: number;
    };
}

// ─── PR Metadata ────────────────────────────────────────────────────────

export interface PRMetadata {
    installationId: number;
    repoFullName: string;
    repoGithubId: number;
    prNumber: number;
    title: string;
    body: string | null;
    headSha: string;
    baseSha: string;
    headRef: string;
    baseRef: string;
    sender: string;
    action: string;
    draft: boolean;
    changedFiles: number;
    additions: number;
    deletions: number;
    language: string | null;
}

// ─── File Diff Types ────────────────────────────────────────────────────

export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    content: string;
    context: string;
}

export interface FileDiff {
    path: string;
    language: string;
    status: 'added' | 'modified' | 'removed' | 'renamed';
    hunks: DiffHunk[];
    additions: number;
    deletions: number;
}

// ─── GitHub API Comment Types ───────────────────────────────────────────

export interface GitHubReviewComment {
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    body: string;
}

export interface GitHubReviewPayload {
    commit_id: string;
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
    body: string;
    comments: GitHubReviewComment[];
}
