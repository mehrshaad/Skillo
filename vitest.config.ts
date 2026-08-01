import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    // The saved LinkedIn fixtures reference real scripts, styles and images;
    // without this happy-dom tries to fetch them from the network.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableJavaScriptEvaluation: true,
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
          disableComputedStyleRendering: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
  },
});
