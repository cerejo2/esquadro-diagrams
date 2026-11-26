/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The site is served from https://cerejo2.github.io/esquadro-diagrams/,
// so every asset URL needs that prefix in production builds and in
// `vite preview`, which must serve the build exactly as Pages will.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/esquadro-diagrams/' : '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      // web-tree-sitter is Emscripten output and uses direct eval for its ASM
      // constants; that is expected and not something we can change.
      onwarn(warning, warn) {
        if (warning.code === 'EVAL' && warning.id?.includes('web-tree-sitter')) return;
        warn(warning);
      },
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        spike: resolve(import.meta.dirname, 'spike.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    setupFiles: ['src/analyzers/shared/tree-sitter-node.ts'],
    testTimeout: 20000,
  },
}));
