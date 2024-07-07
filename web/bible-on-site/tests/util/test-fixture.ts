import { test as testBase, expect } from "@playwright/test";
import { addCoverageReport } from "monocart-reporter";
import path from "path";

declare global {
  interface Window {
    collectIstanbulCoverage: (coverage: any) => void;
    __coverage__: any;
  }
}

const test = testBase.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() =>
      window.addEventListener("beforeunload", () =>
        window.collectIstanbulCoverage(window.__coverage__)
      )
    );
    await context.exposeFunction("collectIstanbulCoverage", (coverage: any) => {
      if (coverage) {
        const SRC_DIR = path.resolve(__dirname, "../../", "src");
        for (const file in coverage) {
          if (!coverage[file].path.startsWith(SRC_DIR)) {
            delete coverage[file];
          }
        }
        if (Object.keys(coverage).length > 0) {
          addCoverageReport(coverage, test.info());
        }
      }
    });

    await use(context);

    for (const page of context.pages()) {
      await page.evaluate(() =>
        window.collectIstanbulCoverage(window.__coverage__)
      );
    }
  },
});

export { test, expect };
