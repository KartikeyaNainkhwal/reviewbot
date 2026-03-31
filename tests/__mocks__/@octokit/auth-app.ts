// Mock for @octokit/auth-app (ESM-only, can't be required by Jest)
export function createAppAuth() {
    return () => Promise.resolve({ token: 'mock-token' });
}
