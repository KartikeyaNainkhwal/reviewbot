import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════
// .prbot.yml — The YAML file teams drop in their repo root
// ═══════════════════════════════════════════════════════════════════════
//
// Example .prbot.yml:
//
// ```yaml
// # What areas should the bot focus on?
// review_focus:
//   - security
//   - performance
//   - error-handling
//
// # Which paths should be skipped?
// ignore_paths:
//   - "**/*.test.ts"
//   - "**/*.spec.ts"
//   - "docs/**"
//   - "scripts/**"
//   - ".github/**"
//
// # Plain English rules injected into the Claude prompt
// custom_rules:
//   - "Always check for SQL injection in any database query"
//   - "Enforce async/await over .then() chains"
//   - "All API endpoints must validate request body with Zod"
//   - "Never commit console.log — use the logger instead"
//   - "Check that all new API routes have rate limiting"
//
// # Minimum severity to post as a comment (critical > high > medium > low)
// severity_threshold: medium
//
// # If the bot finds zero issues, should it auto-approve?
// auto_approve_if_no_issues: true
//
// # Triggers: which PR events should trigger a review?
// review_on:
//   - opened
//   - synchronize
//   - reopened
//
// # Stack hints for better context
// language_hints:
//   primary: typescript
//   frameworks:
//     - express
//     - prisma
//     - react
//   runtime: node
//
// # Limits
// max_files_per_review: 25
// max_diff_lines: 3000
// ```

// ─── Zod schemas ────────────────────────────────────────────────────────

export const ReviewFocusEnum = z.enum([
    'security',
    'performance',
    'bugs',
    'error-handling',
    'testing',
    'accessibility',
    'api-design',
    'database',
    'concurrency',
    'memory',
    'types',
    'documentation',
]);

export type ReviewFocus = z.infer<typeof ReviewFocusEnum>;

export const SeverityThresholdEnum = z.enum(['critical', 'high', 'medium', 'low']);
export type SeverityThreshold = z.infer<typeof SeverityThresholdEnum>;

export const TriggerActionEnum = z.enum(['opened', 'synchronize', 'reopened']);
export type TriggerAction = z.infer<typeof TriggerActionEnum>;

export const LanguageHintsSchema = z.object({
    primary: z.string().optional(),
    frameworks: z.array(z.string()).default([]),
    runtime: z.string().optional(),
}).default({ frameworks: [] });

export type LanguageHints = z.infer<typeof LanguageHintsSchema>;

// ─── Main config schema ─────────────────────────────────────────────────

export const RepoConfigSchema = z.object({
    // Review focus areas
    review_focus: z.array(ReviewFocusEnum).default(['security', 'bugs', 'performance']),

    // Glob patterns to skip
    ignore_paths: z.array(z.string()).default([
        '*.lock',
        '*.generated.*',
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        '*.min.js',
        '*.min.css',
        '*.d.ts',
        '*.snap',
        '*.map',
        'dist/**',
        'build/**',
        'node_modules/**',
        '.next/**',
        'coverage/**',
    ]),

    // Plain English rules injected into Claude prompt
    custom_rules: z.array(z.string().max(500)).max(20).default([]),

    // Minimum severity to post
    severity_threshold: SeverityThresholdEnum.default('medium'),

    // Auto-approve if no issues found
    auto_approve_if_no_issues: z.boolean().default(false),

    // Which PR events trigger review
    review_on: z.array(TriggerActionEnum).default(['opened', 'synchronize']),

    // Stack hints for better LLM context
    language_hints: LanguageHintsSchema,

    // Limits
    max_files_per_review: z.number().int().positive().max(50).default(25),
    max_diff_lines: z.number().int().positive().max(10000).default(3000),

    // Legacy compat fields (mapped internally)
    includeGlobs: z.array(z.string()).default(['**/*']),
    excludeGlobs: z.array(z.string()).optional(),
    autoReviewEnabled: z.boolean().default(true),
    customInstructions: z.string().optional(),
    maxFilesPerReview: z.number().int().positive().optional(),
    severityThreshold: z.enum(['critical', 'warning', 'suggestion', 'nitpick']).optional(),
});

export type RepoConfig = z.infer<typeof RepoConfigSchema>;

// ─── Defaults ───────────────────────────────────────────────────────────

export const DEFAULT_REPO_CONFIG: RepoConfig = RepoConfigSchema.parse({});

// ─── Config → prompt snippet ────────────────────────────────────────────

/**
 * Convert a RepoConfig into a prompt-ready string for injection
 * into the Claude system/user prompt.
 *
 * This is how custom_rules get into the LLM naturally.
 */
export function configToPromptContext(config: RepoConfig): string {
    const sections: string[] = [];

    // Focus areas
    if (config.review_focus.length > 0) {
        sections.push(
            '**Review Focus Areas** (pay extra attention to these):\n' +
            config.review_focus.map((f) => `- ${formatFocusArea(f)}`).join('\n'),
        );
    }

    // Custom rules
    if (config.custom_rules.length > 0) {
        sections.push(
            '**Team-Specific Rules** (enforce these strictly):\n' +
            config.custom_rules.map((r, i) => `${i + 1}. ${r}`).join('\n'),
        );
    }

    // Severity threshold
    sections.push(
        `**Severity Threshold:** Only report issues at \`${config.severity_threshold}\` or above.`,
    );

    // Language hints
    if (config.language_hints.primary || config.language_hints.frameworks.length > 0) {
        const parts: string[] = ['**Stack Context:**'];
        if (config.language_hints.primary) {
            parts.push(`- Primary language: ${config.language_hints.primary}`);
        }
        if (config.language_hints.runtime) {
            parts.push(`- Runtime: ${config.language_hints.runtime}`);
        }
        if (config.language_hints.frameworks.length > 0) {
            parts.push(`- Frameworks: ${config.language_hints.frameworks.join(', ')}`);
        }
        sections.push(parts.join('\n'));
    }

    return sections.join('\n\n');
}

// ─── Helpers ────────────────────────────────────────────────────────────

const FOCUS_DESCRIPTIONS: Record<ReviewFocus, string> = {
    'security': 'Security vulnerabilities (injection, auth bypass, data exposure)',
    'performance': 'Performance issues (N+1 queries, memory leaks, O(n²) algorithms)',
    'bugs': 'Logic bugs, null access, off-by-one errors, race conditions',
    'error-handling': 'Missing error handling, swallowed exceptions, uncaught promises',
    'testing': 'Test coverage gaps, fragile tests, missing edge case tests',
    'accessibility': 'Accessibility issues (ARIA, keyboard nav, color contrast)',
    'api-design': 'API design (REST conventions, error responses, pagination)',
    'database': 'Database issues (missing indexes, N+1, transaction safety)',
    'concurrency': 'Concurrency bugs (race conditions, deadlocks, shared state)',
    'memory': 'Memory management (leaks, unbounded caches, large allocations)',
    'types': 'Type safety issues (any casts, missing generics, loose types)',
    'documentation': 'Missing or misleading documentation, unclear function contracts',
};

function formatFocusArea(focus: ReviewFocus): string {
    return `**${focus}**: ${FOCUS_DESCRIPTIONS[focus]}`;
}
