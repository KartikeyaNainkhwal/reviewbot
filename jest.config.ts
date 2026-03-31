import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    setupFiles: ['<rootDir>/tests/setup.ts'],
    testMatch: ['**/*.test.ts'],
    collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '!src/types/**'],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov'],
    clearMocks: true,
    restoreMocks: true,
    moduleNameMapper: {
        '^@octokit/app$': '<rootDir>/tests/__mocks__/@octokit/app.ts',
        '^@octokit/auth-app$': '<rootDir>/tests/__mocks__/@octokit/auth-app.ts',
        '^@octokit/rest$': '<rootDir>/tests/__mocks__/@octokit/rest.ts',
    },
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                tsconfig: 'tsconfig.test.json',
            },
        ],
    },
};

export default config;
