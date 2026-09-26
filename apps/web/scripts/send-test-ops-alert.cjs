const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  const full = path.isAbsolute(file) ? file : path.resolve(__dirname, file);
  if (!fs.existsSync(full)) {
    console.log("skip missing", full);
    return;
  }
  console.log("loading", full);
  for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Z0-9_]+$/.test(key) || process.env[key]) continue;
    let v = trimmed.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[key] = v;
  }
}

loadEnv(path.join(__dirname, "..", ".env.local"));
loadEnv(path.join(__dirname, "..", ".env"));

async function main() {
  const apiKey = process.env.RESEND_API_KEY?.trim()?.replace(/^["']|["']$/g, "");
  console.log("env loaded: RESEND=", Boolean(apiKey), "OPS=", process.env.OPS_ALERT_EMAIL || "(default jacob@utahcity.app)");
  const to =
    process.env.OPS_ALERT_EMAIL?.trim() ||
    process.env.ALERT_EMAIL?.trim() ||
    "jacob@utahcity.app";
  const from = process.env.EMAIL_FROM || "Utah City <onboarding@utahcity.app>";

  if (!apiKey) {
    console.error("RESEND_API_KEY missing");
    process.exit(1);
  }

  const body = [
    "This is a TEST ops alert from Utah City.",
    "If you received this, OPS_ALERT_EMAIL / Resend delivery is working.",
    "",
    `To: ${to}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "[TEST] Utah City: OPS_ALERT_EMAIL check",
      text: body,
      html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${body}</pre>`,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("Failed:", data);
    process.exit(1);
  }
  console.log("Sent OK:", JSON.stringify({ to, id: data.id }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
