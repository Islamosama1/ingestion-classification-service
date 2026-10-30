const base = require('./jest.config');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  setupFiles: ['<rootDir>/tests/helpers/integration-setup.ts'],
};
