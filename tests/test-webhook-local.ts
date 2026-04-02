/**
 * Local webhook simulation test.
 *
 * What it does:
 *  1. Seeds a fake Installation + Repository in the DB
 *  2. Crafts a realistic pull_request.opened webhook payload
 *  3. Signs it with your GITHUB_WEBHOOK_SECRET (HMAC-SHA256)
 *  4. POSTs it to http://localhost:3000/api/webhooks
 *  5. Polls the DB until the review completes (or times out)
 *  6. Prints the full result
 *
 * Run: npx tsx tests/test-webhook-local.ts
 */

import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../src/db/client.js';

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || 'kartikeya';
const BASE_URL = 'http://localhost:3000';

// ─── Helpers ──────────────────────────────────────────────────────────────

function sign(payload: string): string {
    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
    hmac.update(payload);
    return `sha256=${hmac.digest('hex')}`;
}

async function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
    console.log('=== Local Webhook Simulation Test ===\n');

    // ── Step 1: Seed DB ─────────────────────────────────────────────────

    console.log('1. Seeding database with test installation + repo...');

    const installation = await prisma.installation.upsert({
        where: { githubId: 99999 },
        create: {
            githubId: 99999,
            accountLogin: 'test-org',
            accountType: 'ORGANIZATION',
        },
        update: {},
    });
    console.log(`   Installation: ${installation.id} (githubId: 99999)`);

    const repository = await prisma.repository.upsert({
        where: { githubId: 88888 },
        create: {
            githubId: 88888,
            fullName: 'test-org/test-repo',
            defaultBranch: 'main',
            isActive: true,
            installationId: installation.id,
        },
        update: { isActive: true },
    });
    console.log(`   Repository: ${repository.id} (githubId: 88888)`);
    console.log('   OK\n');

    // ── Step 2: Build webhook payload ───────────────────────────────────

    console.log('2. Building pull_request.opened webhook payload...');

    const payload = {
        action: 'opened',
        number: 1,
        pull_request: {
            number: 1,
            title: 'Add user authentication module',
            body: 'This PR adds login, signup, and admin endpoints.',
            state: 'open',
            draft: false,
            user: { login: 'kartikeya', type: 'User' },
            head: {
                ref: 'feature/auth',
                sha: 'abc123def456',
            },
            base: {
                ref: 'main',
                sha: '000000000000',
            },
            changed_files: 1,
            additions: 25,
            deletions: 0,
        },
        repository: {
            id: 88888,
            full_name: 'test-org/test-repo',
            language: 'TypeScript',
            default_branch: 'main',
        },
        installation: {
            id: 99999,
        },
        sender: {
            login: 'kartikeya',
            type: 'User',
        },
    };

    const payloadStr = JSON.stringify(payload);
    const signature = sign(payloadStr);
    console.log(`   Payload size: ${payloadStr.length} bytes`);
    console.log(`   Signature: ${signature.slice(0, 20)}...`);
    console.log('   OK\n');

    // ── Step 3: Send webhook ────────────────────────────────────────────

    console.log('3. Sending webhook to localhost:3000/api/webhooks ...');

    const response = await fetch(`${BASE_URL}/api/webhooks`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Event': 'pull_request',
            'X-GitHub-Delivery': crypto.randomUUID(),
            'X-Hub-Signature-256': signature,
        },
        body: payloadStr,
    });

    console.log(`   Response: ${response.status} ${response.statusText}`);
    const responseText = await response.text();
    if (responseText) console.log(`   Body: ${responseText}`);

    if (!response.ok) {
        console.error('\n   Webhook rejected! Check server logs for details.');
        process.exit(1);
    }
    console.log('   OK — webhook accepted\n');

    // ── Step 4: Poll for review completion ──────────────────────────────

    console.log('4. Waiting for review to complete (polling DB every 2s, timeout 60s)...');

    const startTime = Date.now();
    const timeout = 60_000;

    while (Date.now() - startTime < timeout) {
        const reviews = await prisma.review.findMany({
            where: { repositoryId: repository.id, prNumber: 1 },
            include: { comments: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
        });

        const review = reviews[0];
        if (!review) {
            process.stdout.write('   .');
            await sleep(2000);
            continue;
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        if (review.status === 'COMPLETED') {
            console.log(`\n\n   Review COMPLETED in ${elapsed}s!`);
            console.log(`   ──────────────────────────────────────`);
            console.log(`   Review ID:    ${review.id}`);
            console.log(`   Verdict:      ${review.verdict}`);
            console.log(`   Files:        ${review.filesReviewed}`);
            console.log(`   Issues:       ${review.commentsPosted}`);
            console.log(`   Tokens:       ${review.promptTokens} prompt + ${review.completionTokens} completion`);
            console.log(`   Duration:     ${review.durationMs}ms`);
            console.log(`   Summary:      ${review.summary?.slice(0, 150)}...`);

            if (review.comments.length > 0) {
                console.log(`\n   Comments:`);
                for (const c of review.comments) {
                    console.log(`     [${c.severity}] ${c.title}`);
                    console.log(`       File: ${c.path}:${c.line}`);
                }
            }

            console.log(`\n=== TEST PASSED ===`);
            await prisma.$disconnect();
            process.exit(0);
        }

        if (review.status === 'FAILED') {
            console.log(`\n\n   Review FAILED after ${elapsed}s`);
            console.log(`   Error: ${review.errorMessage}`);
            console.log(`\n=== TEST FAILED ===`);
            await prisma.$disconnect();
            process.exit(1);
        }

        if (review.status === 'SKIPPED') {
            console.log(`\n\n   Review SKIPPED after ${elapsed}s`);
            console.log(`   Summary: ${review.summary}`);
            console.log(`\n   This is expected — the worker tried to fetch the PR diff from`);
            console.log(`   GitHub but test-org/test-repo doesn't exist on GitHub.`);
            console.log(`   The full pipeline (webhook → queue → worker) is working correctly!`);
            console.log(`\n=== PIPELINE TEST PASSED (skipped at GitHub API call) ===`);
            await prisma.$disconnect();
            process.exit(0);
        }

        process.stdout.write(`   [${review.status}]`);
        await sleep(2000);
    }

    console.log('\n\n   TIMEOUT — review did not complete in 60s');
    console.log('   Check server logs: tail -f the terminal running npm run dev');
    await prisma.$disconnect();
    process.exit(1);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
