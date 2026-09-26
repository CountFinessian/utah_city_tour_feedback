import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

async function main() {
  const outDir = path.resolve("screenshots");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log("Launching headless Chrome for screenshot harvesting...");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  const page = await browser.newPage();

  // Exact Apple 6.7" Super Retina XDR: 430x932 @ 3x DPR = 1290x2796 pixels
  await page.setViewport({
    width: 430,
    height: 932,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  });

  console.log("Navigating to login page...");
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle2", timeout: 30000 });

  console.log("Entering test credentials...");
  await page.type('input[name="email"]', "aiden@utahcity.com");
  await page.type('input[name="password"]', "Host#UtahCity2026");

  console.log("Submitting login form...");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
    page.click('button[type="submit"]')
  ]);

  console.log("Logged in! Current URL:", page.url());
  await new Promise((r) => setTimeout(r, 2000));

  // --- SCREENSHOT 1: Voice Debrief & Recording Screen ---
  console.log("Capturing Screenshot 1: Voice Debrief & Recording Screen...");
  const shot1Path = path.join(outDir, "screenshot_1_voice_debrief.png");
  await page.screenshot({ path: shot1Path, fullPage: false });
  console.log("Saved Screenshot 1:", shot1Path);

  // --- PREPARING SUBMISSION FOR SCREENSHOT 2 ---
  console.log("Entering transcript notes for observation analysis...");
  const textarea = await page.$("textarea");
  if (textarea) {
    await textarea.type(
      "Completed walkthrough with Sarah Jenkins, senior commercial broker for tech relocations. She was strongly impressed by the waterfront promenade, lakeside dining options, and planned fiber broadband infrastructure. Her primary concern was delivery timelines for Q3 2026 retail spaces. Requested preliminary architectural floor plans and parking ratio breakdowns."
    );
  }

  // Click Submit Debrief to trigger AI analysis & ReviewScreen
  console.log("Submitting debrief to generate AI observation insights...");
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const btn = buttons.find((b) => b.textContent && b.textContent.includes("Submit debrief"));
    if (btn) btn.click();
  });

  // Wait for structuring to complete (or up to 10s)
  console.log("Waiting for AI debrief structuring...");
  try {
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes("Observation details") || text.includes("Signals") || text.includes("Sentiment") || text.includes("Debrief saved");
      },
      { timeout: 15000 }
    );
  } catch (e) {
    console.log("Proceeding after wait...");
  }
  await new Promise((r) => setTimeout(r, 2000));

  // --- SCREENSHOT 2: AI Observation Review & Prospect Insights ---
  console.log("Capturing Screenshot 2: AI Observation Review & Prospect Insights...");
  const shot2Path = path.join(outDir, "screenshot_2_prospect_observations.png");
  await page.screenshot({ path: shot2Path, fullPage: false });
  console.log("Saved Screenshot 2:", shot2Path);

  // --- SCREENSHOT 3: Host Profile, AI Transparency & Account Settings ---
  console.log("Opening Host Profile & Account Compliance Modal...");
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const userBtn = buttons.find((b) => b.textContent && b.textContent.includes("Aiden"));
    if (userBtn) {
      userBtn.click();
    }
  });

  await new Promise((r) => setTimeout(r, 1000));
  const shot3Path = path.join(outDir, "screenshot_3_account_compliance.png");
  await page.screenshot({ path: shot3Path, fullPage: false });
  console.log("Saved Screenshot 3:", shot3Path);

  await browser.close();
  console.log("🎉 All 3 compliant App Store screenshots harvested successfully!");
}

main().catch((err) => {
  console.error("Error harvesting screenshots:", err);
  process.exit(1);
});

