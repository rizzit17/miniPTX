import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

async function compile(page: Page) {
  const response = page.waitForResponse((r) => r.url().endsWith("/api/compile") && r.request().method() === "POST");
  await page.getByRole("button", { name: /^Compile/ }).click();
  const result = await (await response).json();
  return result;
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Compiler online")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "MiniPTX source editor" })).toBeVisible();
});

test("real backend smoke: compile, inspect tokens, AST and IR", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const result = await compile(page);
  expect(result.success).toBe(true);
  expect(result.ptx).toContain("mul.lo.s32");
  await expect(page.getByText("Compilation successful", { exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Identifier");
  await expect(page.getByRole("textbox", { name: "Generated PTX assembly" })).toBeVisible();
  mkdirSync("../docs/screenshots", { recursive: true });
  await page.screenshot({ path: "../docs/screenshots/playground.png", fullPage: true });
  await page.getByRole("tab", { name: "Abstract Syntax Tree" }).click();
  await expect(page.locator(".tree-root")).toContainText("5 declarations");
  await page.getByRole("tab", { name: "Intermediate Representation" }).click();
  await expect(page.locator(".ir-code").first()).toContainText("mul");
  expect(errors).toEqual([]);
});

test("example selection, constant folding toggle, and keyboard shortcut", async ({ page }) => {
  await page.getByLabel("Example program").selectOption("folding");
  const folded = await compile(page);
  expect(folded.optimizations.length).toBe(5);
  await page.getByRole("tab", { name: "Optimization", exact: true }).click();
  await expect(page.locator(".fold-row")).toHaveCount(5);
  await page.getByLabel("Constant folding").uncheck();
  const response = page.waitForResponse((r) => r.url().endsWith("/api/compile"));
  await page.getByRole("textbox", { name: "MiniPTX source editor" }).focus();
  await page.keyboard.press("Control+Enter");
  const unoptimized = await (await response).json();
  expect(unoptimized.optimizations).toEqual([]);
  expect(unoptimized.ir.length).toBeGreaterThan(folded.optimized_ir.length);
});

test("diagnostics navigate to the source", async ({ page }) => {
  await page.getByLabel("Example program").selectOption("error");
  const data = await compile(page);
  expect(data.success).toBe(false);
  await expect(page.getByRole("tab", { name: /Diagnostics/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /Undefined variable 'height'/ }).click();
  await expect(page.getByText("Ln 2, Col 28", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PTX" })).toBeDisabled();
});

test("copy and download contain actual generated PTX", async ({ page }) => {
  const data = await compile(page);
  await page.getByRole("button", { name: "Copy PTX" }).click();
  await expect(page.getByRole("status")).toContainText("PTX copied");
  // The Windows clipboard normalizes LF to CRLF; compare equivalent text.
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(data.ptx);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PTX" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("miniptx.ptx");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString("utf8")).toBe(data.ptx);
});

test("source persists, stale output is marked, and theme changes", async ({ page }) => {
  await compile(page);
  await page.getByLabel("Example program").selectOption("hello");
  await expect(page.getByText("Source changed · recompile to update")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy PTX" })).toBeDisabled();
  await page.reload();
  const result = await compile(page);
  expect(result.ast[0].name).toBe("answer");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/light/);
});

test("token selection, AST collapse, accessible resizing, documentation", async ({ page }) => {
  await compile(page);
  await page.getByRole("button", { name: "width", exact: true }).first().click();
  await expect(page.getByText("Ln 2, Col 10", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Abstract Syntax Tree" }).click();
  const node = page.locator(".tree-panel > details").first();
  await node.locator("summary").first().click();
  await expect(node).not.toHaveAttribute("open");
  const separator = page.getByRole("separator", { name: "Resize source and PTX panels" });
  await separator.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", "48");
  await page.getByRole("link", { name: "Documentation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Language reference" })).toBeVisible();
});

test("mobile layout stacks panels without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await compile(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const source = await page.locator(".source-panel").boundingBox();
  const output = await page.locator(".output-panel").boundingBox();
  expect(output!.y).toBeGreaterThan(source!.y + source!.height);
  await page.screenshot({ path: "../docs/screenshots/mobile.png", fullPage: true });
});

test("service failure does not fabricate successful compiler stages", async ({ page }) => {
  // Fault injection only: production requests still use the real C++ service.
  await page.route("**/api/compile", (route) => route.fulfill({ json: {
    success: false, tokens: [], ast: [], ir: [], optimized_ir: [], optimizations: [], ptx: "", duration_ms: 0,
    diagnostics: [{ severity: "error", stage: "service", code: "COMPILER_UNAVAILABLE",
      message: "Build the C++ compiler or set MINIPTX_COMPILER.", span: { offset: 0, length: 0, line: 1, column: 1 } }],
    assembler: { status: "skipped", message: "No PTX generated.", structural_check: false },
  } }));
  await compile(page);
  await expect(page.locator(".diagnostic")).toContainText("COMPILER_UNAVAILABLE");
  await expect(page.locator(".stage-passed")).toHaveCount(0);
  await expect(page.locator(".stage-failed")).toHaveCount(0);
});

test("assembler rejection is separate from completed compiler stages", async ({ page }) => {
  const actual = await compile(page);
  await page.route("**/api/compile", (route) => route.fulfill({ json: { ...actual, success: false,
    diagnostics: [{ severity: "error", stage: "assembler", code: "PTX_VALIDATION_FAILED",
      message: "Injected assembler rejection", span: { offset: 0, length: 0, line: 1, column: 1 } }],
    assembler: { status: "failed", message: "Injected assembler rejection", structural_check: true },
  } }));
  await compile(page);
  await expect(page.locator(".diagnostic")).toContainText("PTX_VALIDATION_FAILED");
  await expect(page.locator(".stage-passed")).toHaveCount(6);
  await expect(page.locator(".stage-failed")).toHaveCount(0);
});
