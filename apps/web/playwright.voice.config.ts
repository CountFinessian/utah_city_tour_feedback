import { defineConfig, devices } from "@playwright/test";
import path from "path";

const PORT = 3335;
const FIXTURE = path.resolve("e2e-voice/fixtures/debrief.wav");
// Defaults to tiny.en for fast CI; override to verify the production base.en model:
//   VOICE_TEST_MODEL=Xenova/whisper-base.en npm run test:e2e:voice
const VOICE_TEST_MODEL = process.env.VOICE_TEST_MODEL || "Xenova/whisper-tiny.en";

/**
 * Voice E2E: drives the REAL record → on-device Whisper → text flow. Chromium is
 * launched with a fake microphone that streams a known speech WAV, so the test
 * proves audio actually becomes a transcript. Uses whisper-tiny.en for speed.
 *
 * Kept separate from the fast suite (model download + WASM inference is slow):
 *   npm run test:e2e:voice
 */
export default defineConfig({
  testDir: "./e2e-voice",
  timeout: 200_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${FIXTURE}`,
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      `DATABASE_URL= POSTGRES_URL= POSTGRES_PRISMA_URL= VERCEL_OIDC_TOKEN= AI_GATEWAY_API_KEY= OPENAI_API_KEY= ` +
      `DATA_DIR=/tmp/utahcity-voice-e2e NEXT_PUBLIC_WHISPER_MODEL=${VOICE_TEST_MODEL} PORT=${PORT} npm run dev`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
