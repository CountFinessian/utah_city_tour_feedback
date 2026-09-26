import { test, expect } from "@playwright/test";

test.describe("Host capture → intelligence pipeline", () => {
  test("types a debrief and sees structured signals extracted", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Guided tour debrief" })).toBeVisible();

    const transcript =
      "Toured a couple with a dog. They loved the dog park and the pool, but were worried about " +
      "parking for two cars. They want to apply this week.";

    const textarea = page.getByLabel(/transcript/i);
    const submit = page.getByRole("button", { name: /structure debrief/i });

    // Retry fill until React has hydrated and registered the input (button enables).
    // This makes the test immune to SSR-hydration timing.
    await expect(async () => {
      await textarea.fill(transcript);
      await expect(submit).toBeEnabled({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    // Click and wait for the extraction round-trip to actually complete.
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/observations") && r.request().method() === "POST"),
      submit.click(),
    ]);
    expect(resp.ok()).toBeTruthy();

    // The structured review renders with extracted signals and evidence treatment.
    await expect(page.getByRole("heading", { name: "Intelligence review" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Objections" })).toBeVisible();
    await expect(page.getByText("Parking", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Coverage", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Amenity reactions" })).toBeVisible();

    // And the host can move on to the next tour.
    await expect(page.getByRole("button", { name: /log another tour/i })).toBeVisible();
  });

  test("the mic control is present and labeled", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /start recording/i })).toBeVisible();
    await expect(page.getByText(/tap and talk/i)).toBeVisible();
  });

  test("command surface renders the executive operating system", async ({ page }) => {
    await page.goto("/command");
    await expect(page.getByRole("heading", { name: /utah city operating intelligence/i })).toBeVisible();
    await expect(page.getByText(/community intelligence score/i)).toBeVisible();
    await expect(page.getByText(/operating brief/i).first()).toBeVisible();
  });

  test("old digest route redirects to command", async ({ page }) => {
    await page.goto("/digest");
    await expect(page).toHaveURL(/\/command$/);
    await expect(page.getByRole("heading", { name: /utah city operating intelligence/i })).toBeVisible();
  });

  test("analyst destination renders its query console", async ({ page }) => {
    await page.goto("/analyst");
    await expect(page.getByRole("heading", { name: /ask utah city what it knows/i })).toBeVisible();
    await expect(page.getByPlaceholder(/ask why sentiment changed/i)).toBeVisible();
  });
});
