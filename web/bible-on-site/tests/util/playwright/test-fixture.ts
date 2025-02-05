import { expect, test as testBase } from "@playwright/test";
import { addCoverageReport } from "monocart-reporter";
import { filterOutCoverageRedundantFiles } from "../coverage/filter-out-coverage-redundant-files";
// TODO: add typings for coverage
declare global {
  interface Window {
    collectIstanbulCoverage: (coverage: never) => void;
    __coverage__: never;
  }
}

const test = testBase.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() =>
      window.addEventListener("beforeunload", () => window.collectIstanbulCoverage(window.__coverage__))
    );
    await context.exposeFunction("collectIstanbulCoverage", (coverage: never) => {
      if (coverage) {
        filterOutCoverageRedundantFiles(coverage);
        if (Object.keys(coverage).length > 0) {
          addCoverageReport(coverage, test.info());
        }
      }
    });

    await use(context);

    for (const page of context.pages()) {
      await page.evaluate(() => window.collectIstanbulCoverage(window.__coverage__));
    }
  },
});

export { test, expect };
