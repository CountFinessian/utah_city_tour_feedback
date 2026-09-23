/**
 * Resend Email Service for Utah City Platform
 */

export function getResendApiKey(): string | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  return key.replace(/^["']|["']$/g, "").trim();
}

export type SendInvitationParams = {
  to: string;
  role: "host" | "leader";
  setupUrl: string;
  invitedByName?: string;
};

export async function sendInvitationEmail({
  to,
  role,
  setupUrl,
  invitedByName = "Utah City Leadership",
}: SendInvitationParams): Promise<{ success: boolean; id?: string; error?: string }> {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.warn("[mailer] RESEND_API_KEY not configured. Setup URL:", setupUrl);
    return { success: false, error: "RESEND_API_KEY is not configured in environment variables." };
  }

  const roleLabel = role === "leader" ? "Leadership (Command & Analyst)" : "Tour Host (Mobile Capture)";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation to Utah City</title>
</head>
<body style="margin:0;padding:40px 20px;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;line-height:1.6;">
  <div style="max-width:540px;margin:0 auto;">
    <p style="font-size:16px;font-weight:700;color:#111827;margin:0 0 28px 0;letter-spacing:-0.01em;">Utah City</p>
    
    <p style="font-size:15px;color:#111827;margin:0 0 16px 0;">Hello,</p>
    
    <p style="font-size:15px;color:#374151;margin:0 0 16px 0;">
      You have been invited by <strong>${invitedByName}</strong> to create an account on the Utah City platform.
    </p>

    <div style="margin:20px 0;padding:16px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
      <p style="margin:0 0 6px 0;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;font-weight:600;">Account Details</p>
      <p style="margin:0 0 4px 0;font-size:14px;color:#111827;"><strong>Email:</strong> ${to}</p>
      <p style="margin:0;font-size:14px;color:#111827;"><strong>Role:</strong> ${roleLabel}</p>
    </div>

    <p style="font-size:15px;color:#374151;margin:0 0 24px 0;">
      Please click the button below to complete your registration, enter your name, and set your password:
    </p>

    <div style="margin:28px 0;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${setupUrl}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="14%" stroke="f" fillcolor="#111827">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:sans-serif;font-size:14px;font-weight:bold;">Set Up Your Account &rarr;</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${setupUrl}" style="background-color:#111827;color:#ffffff;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;display:inline-block;">Set Up Your Account &rarr;</a>
      <!--<![endif]-->
    </div>

    <p style="font-size:13px;color:#6b7280;margin:20px 0 0 0;line-height:1.5;">
      If the button above does not work in your email client, copy and paste this link into your browser:<br />
      <a href="${setupUrl}" style="color:#0284c7;text-decoration:underline;word-break:break-all;">${setupUrl}</a>
    </p>

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 20px 0;" />
    
    <p style="font-size:12px;color:#9ca3af;margin:0;">
      This link is single-use and will expire in 30 days. If you were not expecting this invitation, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
`.trim();

  const text = `Hello,\n\nYou have been invited by ${invitedByName} to create an account on the Utah City platform.\n\nEmail: ${to}\nRole: ${roleLabel}\n\nSet up your account using this link:\n${setupUrl}\n\nThis link is single-use and will expire in 30 days.`.trim();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Utah City <onboarding@utahcity.app>",
        to: [to],
        subject: "Invitation to Utah City Tour Intelligence",
        html,
        text,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("[mailer error]", data);
      return { success: false, error: data.message || "Failed to send email via Resend" };
    }

    return { success: true, id: data.id };
  } catch (err: any) {
    console.error("[mailer exception]", err);
    return { success: false, error: err.message || "Network error sending email" };
  }
}

export type SendPasswordResetParams = {
  to: string;
  resetUrl: string;
  name?: string;
  requestedBy?: string;
};

export async function sendPasswordResetEmail({
  to,
  resetUrl,
  name,
  requestedBy,
}: SendPasswordResetParams): Promise<{ success: boolean; id?: string; error?: string }> {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.warn("[mailer] RESEND_API_KEY not configured. Reset URL:", resetUrl);
    return { success: false, error: "RESEND_API_KEY is not configured in environment variables." };
  }

  const greeting = name ? `Hello ${name},` : "Hello,";
  const contextMsg = requestedBy
    ? `A password reset was initiated for your Utah City account by <strong>${requestedBy}</strong>.`
    : `A request was received to reset the password for your Utah City account.`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Utah City Password</title>
</head>
<body style="margin:0;padding:40px 20px;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;line-height:1.6;">
  <div style="max-width:540px;margin:0 auto;">
    <p style="font-size:16px;font-weight:700;color:#111827;margin:0 0 28px 0;letter-spacing:-0.01em;">Utah City</p>
    
    <p style="font-size:15px;color:#111827;margin:0 0 16px 0;">${greeting}</p>
    
    <p style="font-size:15px;color:#374151;margin:0 0 16px 0;">
      ${contextMsg}
    </p>

    <div style="margin:20px 0;padding:16px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
      <p style="margin:0 0 6px 0;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;font-weight:600;">Account</p>
      <p style="margin:0;font-size:14px;color:#111827;"><strong>Email:</strong> ${to}</p>
    </div>

    <p style="font-size:15px;color:#374151;margin:0 0 24px 0;">
      Click the button below to choose a new password:
    </p>

    <div style="margin:28px 0;">
      <a href="${resetUrl}" style="background-color:#111827;color:#ffffff;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;display:inline-block;">Reset Your Password &rarr;</a>
    </div>

    <p style="font-size:13px;color:#6b7280;margin:20px 0 0 0;word-break:break-all;">
      Or copy and paste this URL into your browser:<br />
      <a href="${resetUrl}" style="color:#0284c7;text-decoration:underline;">${resetUrl}</a>
    </p>

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 20px 0;" />
    
    <p style="font-size:12px;color:#9ca3af;margin:0;">
      This password reset link is valid for 2 hours. If you did not request a password reset, you can safely disregard this email; your existing password will remain unchanged.
    </p>
  </div>
</body>
</html>
`.trim();

  const text = `${greeting}\n\n${requestedBy ? `A password reset was initiated for your Utah City account by ${requestedBy}.` : "A request was received to reset the password for your Utah City account."}\n\nEmail: ${to}\n\nReset your password using this link:\n${resetUrl}\n\nThis link is valid for 2 hours. If you did not request this, you can safely ignore this email.`.trim();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Utah City <onboarding@utahcity.app>",
        to: [to],
        subject: "Reset your Utah City password",
        html,
        text,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("[mailer reset error]", data);
      return { success: false, error: data.message || "Failed to send email via Resend" };
    }

    return { success: true, id: data.id };
  } catch (err: any) {
    console.error("[mailer reset exception]", err);
    return { success: false, error: err.message || "Network error sending email" };
  }
}

