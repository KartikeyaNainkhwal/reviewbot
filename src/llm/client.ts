import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { LLMProvider } from './provider.js';
import { GroqProvider } from './groq.provider.js';

// Re-export types and errors for convenience
export { LLMParseError, LLMCallError } from './provider.js';
export type { LLMProvider, LLMCallResult, ReviewOutput } from './provider.js';

// ═══════════════════════════════════════════════════════════════════════
// Provider Factory
// ═══════════════════════════════════════════════════════════════════════

let provider: LLMProvider | null = null;

/**
 * Get or create the active LLM provider based on LLM_PROVIDER env var.
 *
 * Currently supports:
 *  - "groq"  → GroqProvider (llama-3.3-70b-versatile via Groq)
 *  - "claude" → placeholder (will be implemented for production)
 *
 * The provider is a singleton — created once and reused across all reviews.
 */
export function getLLMProvider(): LLMProvider {
    if (provider) return provider;

    switch (env.LLM_PROVIDER) {
        case 'groq':
            provider = new GroqProvider();
            break;
        case 'claude':
            // TODO: Implement ClaudeProvider for production
            throw new Error(
                'Claude provider not yet implemented. Set LLM_PROVIDER=groq for now.',
            );
        default:
            throw new Error(`Unknown LLM provider: ${env.LLM_PROVIDER}`);
    }

    logger.info(
        { provider: provider.name, model: provider.model },
        'LLM provider created',
    );

    return provider;
}

/**
 * Convenience: call the LLM directly with raw prompts.
 *
 * This is the single function the reviewer and worker should call
 * instead of the old `callGrok()`.
 */
export async function callLLM(
    systemPrompt: string,
    userPrompt: string,
    repairPromptBuilder?: (malformed: string, error: string) => string,
) {
    return getLLMProvider().call(systemPrompt, userPrompt, repairPromptBuilder);
}
