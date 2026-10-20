// Operators must be able to edit labeled fields, see invalid/failed saves, and retain the saved
// values after reloading. The API is synthetic; the browser never reaches a paid service.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import type { AdminWorkerConcurrency, WorkerConcurrency } from "@aihot/contracts/admin";
import { fakeApi, startWebServer, visit } from "./web-server.ts";

for (const engine of [chromium, webkit]) test(`${engine.name()}: admin concurrency settings validate, report save failures and persist on phone and desktop`, async () => {
  let settings: AdminWorkerConcurrency = { values: { analyze: 6, fetch: 8, extract: 4, digest: 3 }, configured: false, updatedAt: null };
  let reject = true;
  const writes: Array<{ values: WorkerConcurrency; reason: string }> = [];
  const api = fakeApi(async (url, res, req) => {
    if (url.pathname === "/api/admin/me") return { name: "Test operator", csrf: "test-concurrency-csrf", dev: true };
    if (url.pathname === "/api/admin/nav-counts") return {};
    if (url.pathname === "/api/admin/settings") return { contact: { wechatQr: null, feishuQr: null }, targets: [], budgets: [], concurrency: settings };
    if (url.pathname === "/api/admin/settings/concurrency") {
      assert.equal(req.method, "PUT");
      assert.equal(req.headers["x-csrf-token"], "test-concurrency-csrf");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as typeof writes[number];
      if (reject) { res.statusCode = 503; return { detail: "暂时无法保存，请重试" }; }
      writes.push(body);
      settings = { values: body.values, configured: true, updatedAt: new Date().toISOString() as AdminWorkerConcurrency["updatedAt"] };
      return settings;
    }
  });
  const web = await startWebServer(api);
  const browser = await engine.launch(engine === chromium ? { channel: "chromium" } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await visit(page, web.origin + "/admin/settings");
    const analyze = page.getByLabel("内容分析", { exact: true });
    const save = page.getByRole("button", { name: "保存并发设置", exact: true });
    await expect(analyze).toHaveValue("6");
    await expect(save).toBeDisabled();
    await analyze.fill("0"); await analyze.blur();
    await expect(page.getByRole("alert")).toContainText("1–32");
    await expect(save).toBeDisabled();
    await analyze.fill("1");
    await page.getByLabel("信源采集", { exact: true }).fill("2");
    await page.getByLabel("正文提取", { exact: true }).fill("1");
    await page.getByLabel("事件综述", { exact: true }).fill("1");
    await save.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("降低服务压力");
    await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("暂时无法保存");
    await expect(dialog).toBeVisible();
    await expect(analyze).toHaveValue("1");
    reject = false;
    await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(save).toBeDisabled();
    await page.reload();
    await expect(analyze).toHaveValue("1");
    await expect(page.getByLabel("信源采集", { exact: true })).toHaveValue("2");
    assert.deepEqual(writes, [{ values: { analyze: 1, fetch: 2, extract: 1, digest: 1 }, reason: "降低服务压力" }]);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px settings fit the screen`);
      await expect(page.getByRole("heading", { name: "任务并发", exact: true })).toBeVisible();
    }
  } finally {
    await browser.close();
    await web.stop();
  }
});
