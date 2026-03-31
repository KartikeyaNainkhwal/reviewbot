// Mock for @octokit/rest (ESM-only, can't be required by Jest)
export class Octokit {
    constructor() { }
    rest = {
        pulls: {
            get: () => Promise.resolve({ data: {} }),
            listFiles: () => Promise.resolve({ data: [] }),
            createReview: () => Promise.resolve({ data: { id: 1 } }),
        },
        apps: {
            getAuthenticated: () => Promise.resolve({ data: {} }),
        },
        issues: {
            createComment: () => Promise.resolve({ data: {} }),
        },
    };
    paginate = () => Promise.resolve([]);
}
