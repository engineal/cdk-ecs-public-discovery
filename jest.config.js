/** @typedef {import('ts-jest')} */
/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
    roots: ['<rootDir>/test'],
    testEnvironment: 'node',
    testMatch: ['**/*.test.ts'],
    transform: {
        '^.+\\.tsx?$': 'ts-jest'
    }
};
