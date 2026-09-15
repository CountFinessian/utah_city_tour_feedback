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
    const recipients: string[] = Array.isArray(event.data?.to) ? event.data.to : [event.data?.to || ""];
    
    // Check if this incoming email is actually Jacob REPLYING to a previous support thread!
    // A reply will be sent to `reply+...` or `support+...`
    const relayRecipient = recipients.find((r) => r.toLowerCase().includes("reply+") || r.toLowerCase().includes("support+"));
    const isReplyFromJacob = rawSender.toLowerCase().includes(forwardTo.toLowerCase()) || Boolean(relayRecipient);

    if (relayRecipient && isReplyFromJacob) {
      console.log(`[resend webhook] Jacob is replying via relay address: ${relayRecipient}`);
      
      // Decode the recipient customer email from the plus-address:
      // e.g. reply+kman16409=gmail.com@utahcity.app -> kman16409@gmail.com
      const matchPlus = relayRecipient.match(/(?:reply|support)\+([^@]+)@/i);
      let customerTargetEmail = "";
      if (matchPlus) {
        customerTargetEmail = matchPlus[1].replace(/=/g, "@");
      }

      if (!customerTargetEmail || !customerTargetEmail.includes("@")) {
        console.error("[resend webhook] Could not parse customer email from relay address:", relayRecipient);
        return NextResponse.json({ error: "Invalid relay address" }, { status: 400 });
      }

      // Fetch the reply body text using Resend Receiving API
      let replyHtml = "";
      let replyText = "";
      try {
        const emailDetails = await resend.emails.receiving.get(emailId);
        if (emailDetails.data) {
          replyHtml = emailDetails.data.html || "";
          replyText = emailDetails.data.text || "";
        }
      } catch (e: any) {
        console.warn("[resend webhook] Could not fetch raw email text from receiving API:", e?.message);
      }

      const subject = event.data?.subject || "Re: Utah City Support";

      // Clean plain text reply to customer
      const sendText = replyText || "Thank you for reaching out to Utah City Support. We received your message and are assisting you.";

      try {
        console.log(`[resend webhook] Relaying reply to customer ${customerTargetEmail} from support@utahcity.app...`);
        const sendResult = await resend.emails.send({
          from: "Utah City Support <support@utahcity.app>",
          to: customerTargetEmail,
          subject,
          text: sendText,
        });

        if (sendResult.error) {
          console.error("[resend webhook] Error relaying message to customer:", sendResult.error);
          return NextResponse.json({ error: sendResult.error.message }, { status: 500 });
        }

        console.log(`[resend webhook] Successfully relayed response to customer ${customerTargetEmail}`);
        return NextResponse.json({ success: true, relayedTo: customerTargetEmail, data: sendResult.data });
      } catch (err: any) {
        console.error("[resend webhook] Exception relaying response to customer:", err);
        return NextResponse.json({ error: err?.message || "Relay error" }, { status: 500 });
      }
    }

    // Otherwise, this is a CUSTOMER sending an email to support@utahcity.app
    // Extract customer's name and email cleanly:
    // e.g. "Kaiden <kman16409@gmail.com>" or "kman16409@gmail.com"
    let senderName = "Customer";
    let senderEmail = rawSender.trim();

    const angleMatch = rawSender.match(/<([^>]+)>/);
    if (angleMatch) {
      senderEmail = angleMatch[1].trim();
      const namePart = rawSender.split("<")[0].replace(/["']/g, "").trim();
      if (namePart) {
        senderName = namePart;
      } else {
        senderName = senderEmail.split("@")[0];
      }
    } else {
      senderEmail = rawSender.replace(/["']/g, "").trim();
      senderName = senderEmail.split("@")[0] || "Customer";
    }

    // Construct the relay reply-to address: e.g. reply+kman16409=gmail.com@utahcity.app
    const encodedSender = senderEmail.replace(/@/g, "=");
    const relayReplyTo = `reply+${encodedSender}@utahcity.app`;
    const dynamicFrom = `${senderName} (via Utah City Support) <support@utahcity.app>`;

    // Fetch the customer's actual message body from Resend
    let customerText = "";
    try {
      const emailDetails = await resend.emails.receiving.get(emailId);
      if (emailDetails.data) {
        customerText = emailDetails.data.text || "";
      }
    } catch (e: any) {
      console.warn("[resend webhook] Could not fetch customer email text from receiving API:", e?.message);
    }

    try {
      console.log(`[resend webhook] Delivering customer email ${emailId} to ${forwardTo} with Reply-To: ${relayReplyTo}...`);

      const messageBody = customerText
        ? customerText.trim()
        : "(New support message received. Click Reply to respond directly.)";

      const sendResult = await resend.emails.send({
        from: dynamicFrom,
        to: forwardTo,
        replyTo: relayReplyTo,
        subject: event.data?.subject ? `Re: ${event.data.subject.replace(/^Re:\s*/i, "")}` : "[Utah City Support] New Inquiry",
        text: messageBody,
      });

      if (sendResult.error) {
        console.error("[resend webhook] Failed to deliver forwarded customer inquiry:", sendResult.error);
        return NextResponse.json({ error: sendResult.error.message }, { status: 500 });
      }

      console.log(`[resend webhook] Successfully delivered inbound email ${emailId} to ${forwardTo}.`);
      return NextResponse.json({
        success: true,
        forwardedTo: forwardTo,
        relayReplyTo,
        emailId,
        sendData: sendResult.data,
      });
    } catch (err: any) {
      console.error("[resend webhook] Exception during customer email delivery:", err);
      // Try emergency notification
      try {
        await resend.emails.send({
          from: dynamicFrom,
          to: forwardTo,
          replyTo: relayReplyTo,
          subject: `[Utah City Support] New message received from ${senderName}`,
          text: `A new email was received from ${rawSender}. Reply directly to this email to respond from support@utahcity.app (Email ID: ${emailId})`,
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

