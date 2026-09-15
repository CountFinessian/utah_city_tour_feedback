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
    const fromEmail = process.env.SUPPORT_FROM_EMAIL || DEFAULT_SENDER;

    try {
      console.log(`[resend webhook] Inbound email received: ${emailId}. Attempting forwarding to ${forwardTo}...`);

      const { data, error } = await resend.emails.receiving.forward({
        emailId,
        to: forwardTo,
        from: fromEmail,
      });

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
      // Fallback: send notification email directly using standard sending
      const fallbackResult = await resend.emails.send({
        from: fromEmail,
        to: forwardTo,
        subject: `[Utah City Support] Inbound email from ${event.data?.from || "a user"}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
            <h2 style="color: #0b7a75;">New Inbound Support Inquiry</h2>
            <p><strong>From:</strong> ${event.data?.from || "Unknown"}</p>
            <p><strong>Subject:</strong> ${event.data?.subject || "No Subject"}</p>
            <p><strong>Email ID:</strong> ${emailId}</p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;" />
            <p style="font-size: 14px; color: #64748b;">
              You can view and reply to the full email directly in your Resend Dashboard:
              <br/>
              <a href="https://resend.com/emails" style="color: #0b7a75; font-weight: bold;">View in Resend Dashboard</a>
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
          from: fromEmail,
          to: forwardTo,
          subject: `[Utah City Support] New message received: ${event.data?.subject || "Support Request"}`,
          text: `A new email was received from ${event.data?.from || "User"}. Check your Resend dashboard at https://resend.com/emails (Email ID: ${emailId})`,
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

