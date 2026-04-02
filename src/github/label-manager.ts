import { Octokit } from '@octokit/rest';
import { logger } from '../config/logger.js';
import type { ReviewIssue, IssueSeverity } from '../types/review.types.js';

// ═══════════════════════════════════════════════════════════════════════
// Label Definitions
// ═══════════════════════════════════════════════════════════════════════

const AXD_LABEL_PREFIX = 'axd:';

interface LabelDefinition {
    name: string;
    color: string;
    description: string;
}

const AXD_LABELS: LabelDefinition[] = [
    {
        name: 'axd: critical',
        color: 'FF0000',
        description: '🔴 AXD found critical issues that must be fixed',
    },
    {
        name: 'axd: needs-work',
        color: 'FF6B00',
        description: '🟠 AXD found high-severity issues requiring changes',
    },
    {
        name: 'axd: reviewed',
        color: '0075CA',
        description: '🔵 AXD reviewed this PR',
    },
    {
        name: 'axd: approved',
        color: '00B300',
        description: '✅ AXD approved — no significant issues found',
    },
    {
        name: 'axd: low-risk',
        color: 'E4E669',
        description: '🟡 AXD found only minor issues (medium/low)',
    },
];

// ═══════════════════════════════════════════════════════════════════════
// ensureLabelsExist
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ensure all AXD labels exist in the repository.
 *
 * Creates them if missing, updates color/description if they already exist
 * but have different settings. Runs once per review — GitHub API is
 * idempotent so this is safe to call frequently.
 *
 * Never throws — label creation is nice-to-have, not critical.
 */
export async function ensureLabelsExist(
    octokit: Octokit,
    owner: string,
    repo: string,
): Promise<void> {
    for (const label of AXD_LABELS) {
        try {
            await octokit.rest.issues.createLabel({
                owner,
                repo,
                name: label.name,
                color: label.color,
                description: label.description,
            });

            logger.debug({ label: label.name }, 'Created label');
        } catch (error) {
            const err = error as { status?: number };

            if (err.status === 422) {
                // Label already exists — update it to ensure correct color/description
                try {
                    await octokit.rest.issues.updateLabel({
                        owner,
                        repo,
                        name: label.name,
                        color: label.color,
                        description: label.description,
                    });
                } catch {
                    // Update failed — label exists with correct settings, that's fine
                }
            } else {
                logger.warn(
                    { err: error, label: label.name },
                    'Failed to create label',
                );
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// determineLabelFromVerdict
// ═══════════════════════════════════════════════════════════════════════

/**
 * Determine which AXD label to apply based on review results.
 *
 * Priority order:
 *  1. Has critical issues     → "axd: critical"
 *  2. Has high issues         → "axd: needs-work"
 *  3. Verdict is approve      → "axd: approved"
 *  4. Only medium/low issues  → "axd: low-risk"
 *  5. Fallback                → "axd: reviewed"
 */
export function determineLabelFromVerdict(
    issues: ReviewIssue[],
    verdict: string,
): string {
    // Count issues by severity
    const severityCounts: Record<string, number> = {};
    for (const issue of issues) {
        severityCounts[issue.severity] = (severityCounts[issue.severity] ?? 0) + 1;
    }

    // 1. Critical issues present
    if ((severityCounts['critical'] ?? 0) > 0) {
        return 'axd: critical';
    }

    // 2. High issues present
    if ((severityCounts['high'] ?? 0) > 0) {
        return 'axd: needs-work';
    }

    // 3. Clean approval
    if (verdict === 'approve' && issues.length === 0) {
        return 'axd: approved';
    }

    // 4. Only medium/low issues
    const hasMediumOrLow = (severityCounts['medium'] ?? 0) > 0 || (severityCounts['low'] ?? 0) > 0;
    if (hasMediumOrLow && (severityCounts['critical'] ?? 0) === 0 && (severityCounts['high'] ?? 0) === 0) {
        return 'axd: low-risk';
    }

    // 5. Approved with minor issues
    if (verdict === 'approve') {
        return 'axd: approved';
    }

    // 6. Fallback
    return 'axd: reviewed';
}

// ═══════════════════════════════════════════════════════════════════════
// applyReviewLabel
// ═══════════════════════════════════════════════════════════════════════

/**
 * Apply the correct AXD review label to a PR.
 *
 * Steps:
 *  1. Ensure all AXD labels exist in the repo
 *  2. Remove any existing "axd:*" labels from the PR
 *  3. Add the correct new label based on review results
 *
 * Never throws — labels are nice-to-have. If GitHub API fails,
 * we log the error and continue. The review itself is unaffected.
 */
export async function applyReviewLabel(
    octokit: Octokit,
    owner: string,
    repo: string,
    pullNumber: number,
    issues: ReviewIssue[],
    verdict: string,
): Promise<void> {
    try {
        // Step 1: Ensure labels exist
        await ensureLabelsExist(octokit, owner, repo);

        // Step 2: Remove existing AXD labels
        await removeAxdLabels(octokit, owner, repo, pullNumber);

        // Step 3: Determine and apply the correct label
        const labelName = determineLabelFromVerdict(issues, verdict);

        await octokit.rest.issues.addLabels({
            owner,
            repo,
            issue_number: pullNumber,
            labels: [labelName],
        });

        logger.info(
            { label: labelName, pullNumber, issueCount: issues.length, verdict },
            'Applied review label',
        );
    } catch (error) {
        // Labels are nice-to-have — never crash the review
        logger.warn(
            { err: error, pullNumber, owner, repo },
            'Failed to apply review label (non-fatal)',
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Remove all existing "axd:*" labels from a PR.
 */
async function removeAxdLabels(
    octokit: Octokit,
    owner: string,
    repo: string,
    pullNumber: number,
): Promise<void> {
    try {
        const { data: currentLabels } = await octokit.rest.issues.listLabelsOnIssue({
            owner,
            repo,
            issue_number: pullNumber,
        });

        const axdLabels = currentLabels.filter((l) =>
            l.name.toLowerCase().startsWith(AXD_LABEL_PREFIX),
        );

        for (const label of axdLabels) {
            try {
                await octokit.rest.issues.removeLabel({
                    owner,
                    repo,
                    issue_number: pullNumber,
                    name: label.name,
                });

                logger.debug({ label: label.name, pullNumber }, 'Removed old AXD label');
            } catch (error) {
                const err = error as { status?: number };
                if (err.status !== 404) {
                    // 404 means the label was already removed — that's fine
                    logger.warn({ err: error, label: label.name }, 'Failed to remove label');
                }
            }
        }
    } catch (error) {
        logger.warn({ err: error, pullNumber }, 'Failed to list PR labels');
    }
}
