import { test, expect } from "@playwright/test";

test("records fake-mic audio and transcribes it on-device with Whisper", async ({ page }) => {
  test.setTimeout(200_000);
  await page.goto("/");

  const start = page.getByRole("button", { name: /start recording/i });
  const textarea = page.getByPlaceholder(/just type/i);

  // Start recording (retry to survive hydration). The fake mic streams the WAV fixture.
  await expect(async () => {
    await start.click();
    await expect(page.getByRole("button", { name: /stop recording/i })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });

  // Capture the ~8s clip, then stop.
  await page.waitForTimeout(8_500);
  await page.getByRole("button", { name: /stop recording/i }).click();

  // Model download + on-device inference; wait for the transcript to land in the textarea.
  // Fail fast if the recorder surfaces an on-device error instead of a transcript.
  const errorNote = page.getByText(/Couldn't run on-device transcription/i);
  await Promise.race([
    expect
      .poll(async () => (await textarea.inputValue()).trim().length, { timeout: 90_000, intervals: [2_000] })
      .toBeGreaterThan(0),
    errorNote.waitFor({ timeout: 90_000 }).then(() => {
      throw new Error("On-device transcription errored (see browser console in trace).");
    }),
  ]);

  const transcript = (await textarea.inputValue()).toLowerCase();
  // eslint-disable-next-line no-console
  console.log("ON-DEVICE TRANSCRIPT:", transcript);

  // Lenient content check (tiny.en on synthetic speech) — proves real audio → real text.
  expect(transcript).toMatch(/park|dog|tour|coupl|love|worried|appl|car/);
});
