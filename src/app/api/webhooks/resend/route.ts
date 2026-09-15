import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getResendApiKey } from "@/server/email/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_FORWARD_TARGET = "jawoba004@gmail.com";
const DEFAULT_SENDER = "Utah City Support <support@utahcity.app>";

export async function GET() {
  const forwardTo = process.env.SUPPORT_FORWARD_EMAIL || DEFAULT_FORWARD_TARGET;
  const fromEmail = process.env.SUPPORT_FROM_EMAIL || DEFAULT_SENDER;

  return NextResponse.json({
    status: "active",
    service: "Resend Inbound Email Webhook",
    description: "Receives inbound emails sent to support@utahcity.app and forwards them to the primary inbox.",
    forwardTo,
    fromEmail,
    resendConfigured: Boolean(getResendApiKey()),
    signatureVerification: Boolean(process.env.RESEND_WEBHOOK_SECRET),
  });
}

export async function POST(req: NextRequest) {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.error("[resend webhook] RESEND_API_KEY is not configured.");
    return NextResponse.json({ error: "RESEND_API_KEY is not configured in environment variables." }, { status: 500 });
  }

  const resend = new Resend(apiKey);
  const rawBody = await req.text();

  let event: any;
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  if (webhookSecret) {
    try {
      event = resend.webhooks.verify({
        payload: rawBody,
        headers: {
          id: req.headers.get("svix-id") || "",
          timestamp: req.headers.get("svix-timestamp") || "",
          signature: req.headers.get("svix-signature") || "",
        },
        webhookSecret,
      });
    } catch (err: any) {
      console.error("[resend webhook] Signature verification failed:", err?.message);
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
    }
  } else {
    try {
      event = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
  }

  if (event?.type === "email.received") {
    const emailId = event.data?.email_id;
    if (!emailId) {
      console.warn("[resend webhook] Missing email_id in event data:", event.data);
      return NextResponse.json({ error: "Missing email_id in event data." }, { status: 400 });
    }

    const forwardTo = process.env.SUPPORT_FORWARD_EMAIL || DEFAULT_FORWARD_TARGET;
    const rawSender = event.data?.from || "";
    
    // Extract name or email from sender header (e.g. "John Doe <john@example.com>" or "john@example.com")
    let senderName = "User";
    let senderEmail = rawSender;
    const match = rawSender.match(/^(?:"?([^"<]+)"?\s*)?<?([^>]+)>?$/);
    if (match) {
      if (match[1]?.trim()) {
        senderName = match[1].trim();
      } else if (match[2]?.trim()) {
        senderName = match[2].trim().split("@")[0];
      }
      if (match[2]?.trim()) {
        senderEmail = match[2].trim();
      }
    }

    // Sender display format: "Name (via Utah City Support) <support@utahcity.app>"
    const dynamicFrom = `${senderName} (via Utah City Support) <support@utahcity.app>`;

    try {
      console.log(`[resend webhook] Inbound email received: ${emailId} from ${rawSender}. Attempting forwarding to ${forwardTo}...`);

      const { data, error } = await resend.emails.receiving.forward({
        emailId,
        to: forwardTo,
        from: dynamicFrom,
        replyTo: senderEmail || undefined,
      } as any);

      if (!error) {
        console.log(`[resend webhook] Successfully forwarded inbound email ${emailId} to ${forwardTo}.`);
        return NextResponse.json({
          success: true,
          forwardedTo: forwardTo,
          emailId,
          forwardData: data,
        });
      }

      console.warn(`[resend webhook] Forward API failed (${error.message}). Falling back to direct email notification...`);
      // Fallback: send notification email directly using standard sending with replyTo set
      const fallbackResult = await resend.emails.send({
        from: dynamicFrom,
        to: forwardTo,
        replyTo: senderEmail || undefined,
        subject: `[Utah City Support] ${event.data?.subject || "New Inquiry"}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px;">
            <div style="background: #f8fafc; border-left: 4px solid #0b7a75; padding: 16px; border-radius: 4px; margin-bottom: 20px;">
              <h3 style="margin: 0 0 8px 0; color: #0b7a75;">New Inbound Support Inquiry</h3>
              <p style="margin: 4px 0; font-size: 14px;"><strong>From:</strong> ${rawSender || "Unknown"}</p>
              <p style="margin: 4px 0; font-size: 14px;"><strong>Reply-To:</strong> ${senderEmail || "N/A"}</p>
              <p style="margin: 4px 0; font-size: 14px;"><strong>Subject:</strong> ${event.data?.subject || "No Subject"}</p>
            </div>
            <p style="font-size: 14px; color: #475569;">
              💡 <em>You can click <strong>Reply</strong> in your email client to respond directly to ${senderEmail}.</em>
            </p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;" />
            <p style="font-size: 13px; color: #94a3b8;">
              Email ID: ${emailId}<br/>
              <a href="https://resend.com/emails" style="color: #0b7a75; font-weight: bold; text-decoration: underline;">View Full Email in Resend Dashboard &rarr;</a>
            </p>
          </div>
        `,
      });

      return NextResponse.json({
        success: true,
        fallbackNotification: true,
        forwardedTo: forwardTo,
        emailId,
        data: fallbackResult.data,
      });
    } catch (err: any) {
      console.error("[resend webhook] Exception during email forwarding fallback:", err);
      // Try emergency notification
      try {
        await resend.emails.send({
          from: dynamicFrom,
          to: forwardTo,
          replyTo: senderEmail || undefined,
          subject: `[Utah City Support] New message received from ${senderName}`,
          text: `A new email was received from ${rawSender}. Reply directly to this email or check your Resend dashboard at https://resend.com/emails (Email ID: ${emailId})`,
        });
      } catch (e) {
        console.error("[resend webhook] Emergency fallback failed:", e);
      }
      return NextResponse.json({ error: err?.message || "Failed to forward received email" }, { status: 500 });
    }
  }

  // Acknowledge other webhook event types (e.g. email.sent, email.delivered)
  return NextResponse.json({ received: true, type: event?.type || "unknown" });
}

