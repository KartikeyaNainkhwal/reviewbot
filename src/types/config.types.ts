import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════
// .axdreview.yml — The YAML file teams drop in their repo root
// ═══════════════════════════════════════════════════════════════════════
//
// Example .axdreview.yml:
//
// ```yaml
// # What areas should the bot focus on?
// review_focus:
//   - security
//   - performance
//   - logic
//   - bugs
//
// # Which paths should be skipped? (glob patterns, matched by micromatch)
// ignore_paths:
//   - "*.lock"
//   - "package-lock.json"
//   - "dist/**"
//   - "*.generated.ts"
//   - "migrations/**"
//
// # Minimum severity to post as a comment (critical > high > medium > low)
// severity_threshold: "low"
//
// # If the bot finds zero issues, should it auto-approve?
// auto_approve_if_clean: false
//
// # Plain English rules injected into the LLM prompt
// custom_rules:
//   - "Always check for SQL injection in raw queries"
//   - "Ensure all async functions have try/catch"
//
// # Stack hints for better context
// language_hints:
//   - "typescript"
//   - "nodejs"
//
// # Custom bot display name
// bot_name: "AXD Bot"
//
// # Triggers: which PR events should trigger a review?
// review_on:
//   - opened
//   - synchronize
//   - reopened
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
    'logic',
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

    // Glob patterns to skip (matched via micromatch)
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
        'migrations/**',
    ]),

    // Plain English rules injected into LLM prompt
    custom_rules: z.array(z.string().max(500)).max(20).default([]),

    // Minimum severity to post
    severity_threshold: SeverityThresholdEnum.default('low'),

    // Auto-approve if no issues found
    auto_approve_if_clean: z.boolean().default(false),

    // Legacy compat alias
    auto_approve_if_no_issues: z.boolean().default(false),

    // Which PR events trigger review
    review_on: z.array(TriggerActionEnum).default(['opened', 'synchronize']),

    // Stack hints for better LLM context
    language_hints: z.union([
        // New simplified format: just an array of strings
        z.array(z.string()),
        // Legacy object format
        LanguageHintsSchema,
    ]).default(['typescript', 'nodejs']),

    // Custom bot display name
    bot_name: z.string().max(50).default('AXD Bot'),

    // Limits
    max_files_per_review: z.number().int().positive().max(100).default(25),
    max_diff_lines: z.number().int().positive().max(10000).default(3000),

    // Legacy compat fields (mapped internally)
    includeGlobs: z.array(z.string()).default(['**/*']),
    excludeGlobs: z.array(z.string()).optional(),
    autoReviewEnabled: z.boolean().default(true),
    customInstructions: z.string().optional(),
    maxFilesPerReview: z.number().int().positive().optional(),
    severityThreshold: SeverityThresholdEnum.optional(),
});

export type RepoConfig = z.infer<typeof RepoConfigSchema>;

// ─── Defaults ───────────────────────────────────────────────────────────

export const DEFAULT_REPO_CONFIG: RepoConfig = RepoConfigSchema.parse({});

// ─── Config → prompt snippet ────────────────────────────────────────────

/**
 * Convert a RepoConfig into a prompt-ready string for injection
 * into the LLM system/user prompt.
 *
 * This is how custom_rules, review_focus, severity_threshold,
 * and language_hints naturally flow into the AI's instructions.
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

    // Custom rules  — the most powerful feature!
    // These are plain-English rules the team wrote specifically for their codebase.
    if (config.custom_rules.length > 0) {
        sections.push(
            '**Team-Specific Rules** (enforce these strictly — the team explicitly asked for these checks):\n' +
            config.custom_rules.map((r, i) => `${i + 1}. ${r}`).join('\n'),
        );
    }

    // Severity threshold
    sections.push(
        `**Severity Threshold:** Only report issues at \`${config.severity_threshold}\` or above.`,
    );

    // Language hints
    const hints = config.language_hints;
    if (Array.isArray(hints) && hints.length > 0) {
        // New simplified format: string[]
        if (typeof hints[0] === 'string') {
            sections.push(
                '**Stack Context:**\n' +
                (hints as string[]).map((h) => `- ${h}`).join('\n'),
            );
        }
    } else if (hints && typeof hints === 'object' && !Array.isArray(hints)) {
        // Legacy object format
        const objHints = hints as LanguageHints;
        const parts: string[] = ['**Stack Context:**'];
        if (objHints.primary) {
            parts.push(`- Primary language: ${objHints.primary}`);
        }
        if (objHints.runtime) {
            parts.push(`- Runtime: ${objHints.runtime}`);
        }
        if (objHints.frameworks.length > 0) {
            parts.push(`- Frameworks: ${objHints.frameworks.join(', ')}`);
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
    'logic': 'Logic errors, wrong control flow, incorrect business rules',
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
