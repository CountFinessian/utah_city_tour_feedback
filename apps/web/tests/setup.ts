import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

// Force the file storage backend into an isolated temp dir so tests never touch
// a real database or the project's .data/ directory.
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.POSTGRES_PRISMA_URL;
delete process.env.AI_GATEWAY_API_KEY;
delete process.env.VERCEL_OIDC_TOKEN;
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "utahcity-test-"));
