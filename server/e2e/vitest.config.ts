import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/payment.surfpool.test.ts', 'e2e/paymentState.surfpool.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});
