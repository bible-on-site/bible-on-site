import { expect, test as testBase } from "@playwright/test";

declare global {
  interface Window {
    collectIstanbulCoverage: (coverage?: CoverageData) => void;
  }
}
import { addCoverageReport } from "monocart-reporter";

import { filterOutCoverageRedundantFiles } from "../coverage/filter-out-coverage-redundant-files";
const test = testBase.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() =>
      window.addEventListener("beforeunload", () => {
        window.collectIstanbulCoverage(window.__coverage__);
      })
    );
    await context.exposeFunction("collectIstanbulCoverage", (coverage?: CoverageData) => {
      if (coverage) {
        filterOutCoverageRedundantFiles(coverage);
        if (Object.keys(coverage).length > 0) {
          addCoverageReport(coverage, test.info());
        }
      }
    });

    await use(context);

    for (const page of context.pages()) {
      await page.evaluate(async () => {
        if (window.__coverage__) {
          window.collectIstanbulCoverage(window.__coverage__);
        } else {
          // If __coverage__ is not available (possibly due to server-side route), fetch it via API.
          const res = await fetch("/api/dev/coverage");
          const coverage = await res.json();
          window.collectIstanbulCoverage(coverage);
        }
      });
    }
  },
});

export { test, expect };
