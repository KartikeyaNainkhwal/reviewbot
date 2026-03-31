// Mock for @octokit/app — this package is ESM-only and cannot be required by Jest.
// Only used in tests that transitively import it through src/github/app.ts.

export class App {
    constructor() { }
    getInstallationOctokit() {
        return Promise.resolve({});
    }
    webhooks = {
        verify: () => Promise.resolve(),
    };
}
