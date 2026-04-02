/**
 * Quick E2E smoke test: simulates what happens when the worker processes a review.
 *
 * Tests:
 *  1. Diff parser works on a real diff
 *  2. Chunk extractor filters and prioritizes correctly
 *  3. LLM call actually returns a valid response
 *  4. Issue-to-comment mapping works
 *
 * Run: npx tsx tests/test-e2e.ts
 */

import { parseDiff } from '../src/github/diff-parser.js';
import { extractReviewableChunks } from '../src/github/chunk-extractor.js';
import { reviewChunks } from '../src/llm/reviewer.js';
import { issuesToComments } from '../src/types/review.types.js';
import type { PRContext, RepoReviewConfig } from '../src/llm/prompts.js';

const SAMPLE_DIFF = `diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,25 @@
+import express from 'express';
+
+const router = express.Router();
+
+router.post('/login', async (req, res) => {
+    const { username, password } = req.body;
+
+    // BUG: SQL injection vulnerability
+    const query = \`SELECT * FROM users WHERE username = '\${username}' AND password = '\${password}'\`;
+    const user = await db.raw(query);
+
+    if (user) {
+        const token = password; // BUG: using password as token
+        res.json({ token });
+    } else {
+        res.status(401).json({ error: 'Invalid' });
+    }
+});
+
+router.get('/admin', (req, res) => {
+    // BUG: no auth check
+    res.json({ users: getAllUsers() });
+});
+
+export default router;
`;

async function main() {
    console.log('=== AXD E2E Smoke Test ===\n');

    // Step 1: Parse diff
    console.log('1. Parsing diff...');
    const parsed = parseDiff(SAMPLE_DIFF);
    console.log(`   Files: ${parsed.totalFiles}, Additions: ${parsed.totalAdditions}, Deletions: ${parsed.totalDeletions}`);
    if (parsed.totalFiles !== 1) throw new Error('Expected 1 file');
    console.log('   OK\n');

    // Step 2: Extract chunks
    console.log('2. Extracting reviewable chunks...');
    const { chunks, skipped } = extractReviewableChunks(parsed);
    console.log(`   Chunks: ${chunks.length}, Skipped: ${skipped.length}`);
    if (chunks.length !== 1) throw new Error('Expected 1 chunk');
    console.log(`   Priority: ${chunks[0].priority}`);
    console.log('   OK\n');

    // Step 3: Call LLM
    console.log('3. Calling LLM for review (this may take 10-30s)...');
    const prContext: PRContext = {
        title: 'Add authentication endpoints',
        description: 'Basic login and admin routes',
        author: 'test-user',
        baseBranch: 'main',
        headBranch: 'feature/auth',
        language: 'typescript',
    };

    const repoConfig: RepoReviewConfig = {
        focusAreas: ['security', 'bugs'],
    };

    try {
        const result = await reviewChunks(chunks, prContext, repoConfig);

        console.log(`   Summary: ${result.summary.slice(0, 100)}...`);
        console.log(`   Verdict: ${result.overallVerdict}`);
        console.log(`   Issues found: ${result.issues.length}`);
        console.log(`   Positives: ${result.positives.length}`);
        console.log(`   Tokens: ${result.totalPromptTokens} prompt + ${result.totalCompletionTokens} completion`);

        if (result.issues.length > 0) {
            console.log('\n   Issues:');
            for (const issue of result.issues) {
                console.log(`     - [${issue.severity}] ${issue.title} (${issue.filename}:${issue.lineNumber})`);
            }
        }

        // Step 4: Convert to comments
        console.log('\n4. Converting issues to GitHub comments...');
        const comments = issuesToComments(result.issues);
        console.log(`   Comments: ${comments.length}`);
        if (comments.length > 0) {
            console.log(`   First comment path: ${comments[0].path}, line: ${comments[0].line}`);
        }
        console.log('   OK\n');

        console.log('=== ALL TESTS PASSED ===');
    } catch (error) {
        console.error('\n   LLM call failed:', (error as Error).message);
        console.error('   This likely means the API key or base URL is wrong.');
        console.error('   Check XAI_API_KEY and XAI_BASE_URL in .env');
        process.exit(1);
    }
}

main().catch(console.error);
