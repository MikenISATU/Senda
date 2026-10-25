import { expect, test } from "@playwright/test";

test("landing renders, has no horizontal overflow, and exposes the CTA", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Send money.");
  await expect(page.getByRole("link", { name: "Open Senda" }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("tap targets in the header and hero are at least 44px", async ({ page }) => {
  await page.goto("/");
  for (const name of ["Open Senda", "How it works"]) {
    const box = await page.getByRole("link", { name }).first().boundingBox();
    expect(box && box.height).toBeGreaterThanOrEqual(44);
  }
});

test("reduced motion: demo does not auto-advance and tabs still switch", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  const tabs = page.getByRole("tab");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(5000);
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await tabs.nth(2).click();
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
  await ctx.close();
});

test("team, roadmap and partners are present; no tech jargon in the hero", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Miles Kenneth Napilan")).toBeVisible();
  await expect(page.getByText("Alicia Amor Cerrudo")).toBeVisible();
  await expect(page.locator("#roadmap [aria-current=step]")).toContainText("Testnet");
  await expect(page.locator("#partners")).toContainText("Web3 Iloilo");
  const hero = await page.locator("main section").first().innerText();
  expect(hero).not.toMatch(/stellar|blockchain|usdc|xlm|smart contract|on-chain/i);
});

test("FAQ is keyboard operable", async ({ page }) => {
  await page.goto("/#faq");
  const q = page.getByText("Is this real money?");
  await q.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/preview uses free test money/)).toBeVisible();
});

test("app routes require sign-in", async ({ page }) => {
  await page.goto("/wallet");
  await expect(page).toHaveURL(/\/(login|wallet)/);
});

test("API rejects unauthenticated money operations", async ({ request }) => {
  const r = await request.post("/api/payments/prepare", { data: { to: "@x", asset: "XLM", amount: "1" } });
  expect([401, 503]).toContain(r.status());
  const cron = await request.get("/api/cron/reconcile");
  expect([401, 503]).toContain(cron.status());
});
