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
      console.log(`[resend webhook] Inbound email received: ${emailId}. Forwarding to ${forwardTo}...`);

      const { data, error } = await resend.emails.receiving.forward({
        emailId,
        to: forwardTo,
        from: fromEmail,
      });

      if (error) {
        console.error("[resend webhook] Resend forward error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      console.log(`[resend webhook] Successfully forwarded inbound email ${emailId} to ${forwardTo}.`);
      return NextResponse.json({
        success: true,
        forwardedTo: forwardTo,
        emailId,
        forwardData: data,
      });
    } catch (err: any) {
      console.error("[resend webhook] Exception during email forwarding:", err);
      return NextResponse.json({ error: err?.message || "Failed to forward received email" }, { status: 500 });
    }
  }

  // Acknowledge other webhook event types (e.g. email.sent, email.delivered)
  return NextResponse.json({ received: true, type: event?.type || "unknown" });
}

