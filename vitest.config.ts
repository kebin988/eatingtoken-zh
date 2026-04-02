import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      // Mock the vscode module for unit tests
      vscode: path.resolve(__dirname, 'src/test/__mocks__/vscode.ts'),
    },
  },
});
