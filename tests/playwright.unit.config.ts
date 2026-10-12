import baseConfig from './playwright.config';

export default {
  ...baseConfig,
  testMatch: ['**/unit/**/*.test.ts'],
  testIgnore: ['**/unit/**/*.script.unit.test.ts', '**/unit/**/*.integration.test.ts'],
};
