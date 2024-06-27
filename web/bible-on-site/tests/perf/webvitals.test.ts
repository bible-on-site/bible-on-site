import { test, expect, TestInfo } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve } from "path";
test.describe.configure({ mode: "serial" });

const BASE_URL = "http://127.0.0.1:3000";

type WebVitalsMetric = { measure: number; max: number };

type WebVitalsMetrics = {
  CLS: number;
  FCP: number;
  INP: number;
  LCP: number;
  TTFB: number;
};

type WebVitalsMetricsResult = {
  [K in keyof WebVitalsMetrics]: WebVitalsMetric;
};

type WebVitalsMetricsClient = {
  [K in keyof WebVitalsMetrics]: number;
} & {
  [K in keyof WebVitalsMetrics as `${K}Threshold`]: number;
} & {
  [K in keyof WebVitalsMetrics as `on${K}`]: CallableFunction;
};
const testWebVitals = async ({ page }, testInfo: TestInfo) => {
  const webVitalsScript = readFileSync(
    resolve(__dirname, "../../node_modules/web-vitals/dist/web-vitals.iife.js"),
    "utf8"
  );

  await page.goto(testInfo.title);

  await page.addScriptTag({ content: webVitalsScript });
  await page.evaluate(() => {
    const webVitals = (
      window as unknown as { webVitals: WebVitalsMetricsClient }
    ).webVitals;
    (window as unknown as { results: WebVitalsMetricsResult }).results = [
      "CLS",
      "FCP",
      "INP",
      "LCP",
      "TTFB",
    ]
      .map((name) => ({
        name,
        measure: NaN,
        max: (webVitals[`${name}Thresholds`] as [number, number])[0],
      }))
      .reduce((acc, { name, measure, max }) => {
        acc[name] = { measure, max };
        return acc;
      }, {} as WebVitalsMetricsResult);
    const handleMetric = (name) => (metric) => {
      console.log(name, metric.value);
      (window as unknown as { results: WebVitalsMetricsResult }).results[
        name
      ].measure = metric.value;
    };
    webVitals.onCLS(handleMetric("CLS"), { reportAllChanges: true });
    webVitals.onFCP(handleMetric("FCP"));
    webVitals.onINP(handleMetric("INP"), { reportAllChanges: true });
    webVitals.onLCP(handleMetric("LCP"));
    webVitals.onTTFB(handleMetric("TTFB"));
  });

  // TODO: refactor into test-utils into something like `simulateRandomUserInteraction(page, tags = ["button, "label", "input"], maxElements = 10)`
  const elements = page.locator("button, label, input"); // Select all labels and buttons in the body

  for (const element of (await elements.all())
    .slice(0, 10)
    .filter((elem) => elem !== undefined)) {
    try {
      await element.click({ timeout: 1000 }); // Try to click the element with a timeout
    } catch (error) {}
  }

  await page.locator("body").dispatchEvent("onbeforeunload");

  const webVitalsMetrics: WebVitalsMetricsResult = await page.evaluate(() => {
    return (window as unknown as { results: WebVitalsMetricsResult }).results;
  });

  console.log("Web Vitals Analysis:", webVitalsMetrics);

  Object.values(webVitalsMetrics).forEach((metric) => {
    expect(metric.measure).toBeLessThan(metric.max);
  });
};
// TODO: generate tests for all routes
test("/", testWebVitals);
// inp (https://web.dev/articles/inp) is raised significantly when toggling the read mode. Also it looks like ttfb is affected as well (not sure why it should)
test("/929/567", testWebVitals);
test("/929/1", testWebVitals);
test("/929/686", testWebVitals);
