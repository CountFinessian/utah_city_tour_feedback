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

      try {
        console.log(`[resend webhook] Relaying reply to customer ${customerTargetEmail} from support@utahcity.app...`);
        const sendResult = await resend.emails.send({
          from: "Utah City Support <support@utahcity.app>",
          to: customerTargetEmail,
          subject,
          text: replyText || "Thank you for contacting Utah City Support. We received your message and are assisting you.",
          html: replyHtml || undefined,
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
    // Extract customer's name and email
    let senderName = "Customer";
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

    // Construct the relay reply-to address: e.g. reply+kman16409=gmail.com@utahcity.app
    const encodedSender = senderEmail.replace(/@/g, "=");
    const relayReplyTo = `reply+${encodedSender}@utahcity.app`;
    const dynamicFrom = `${senderName} (via Utah City Support) <support@utahcity.app>`;

    // Fetch the customer's actual message body from Resend
    let customerText = "";
    let customerHtml = "";
    try {
      const emailDetails = await resend.emails.receiving.get(emailId);
      if (emailDetails.data) {
        customerText = emailDetails.data.text || "";
        customerHtml = emailDetails.data.html || "";
      }
    } catch (e: any) {
      console.warn("[resend webhook] Could not fetch customer email text from receiving API:", e?.message);
    }

    try {
      console.log(`[resend webhook] Delivering customer email ${emailId} to ${forwardTo} with Reply-To: ${relayReplyTo}...`);

      const sendResult = await resend.emails.send({
        from: dynamicFrom,
        to: forwardTo,
        replyTo: relayReplyTo,
        subject: `[Utah City Support] ${event.data?.subject || "New Inquiry"}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; color: #1e293b; max-width: 600px; line-height: 1.5;">
            <div style="background: #f1f5f9; border-left: 4px solid #0b7a75; padding: 14px 16px; border-radius: 6px; margin-bottom: 20px;">
              <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>From:</strong> ${rawSender || "Unknown"}</p>
              <p style="margin: 0; font-size: 14px;"><strong>Subject:</strong> ${event.data?.subject || "No Subject"}</p>
            </div>
            
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px; font-size: 15px; color: #0f172a;">
              ${customerHtml || (customerText ? `<p style="white-space: pre-wrap; margin: 0;">${customerText}</p>` : `<p style="color: #64748b; margin: 0;"><em>(View full email content in Resend Dashboard)</em></p>`)}
            </div>

            <p style="font-size: 13px; color: #475569; background: #e0f2fe; border: 1px solid #bae6fd; padding: 10px 14px; border-radius: 6px; margin: 0 0 20px 0;">
              💡 <strong>How to reply:</strong> Just click <strong>Reply</strong> in your email app. Your response will be relayed to <strong>${senderEmail}</strong> from <strong>support@utahcity.app</strong>.
            </p>

            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;" />
            <p style="font-size: 12px; color: #94a3b8; margin: 0;">
              Email ID: ${emailId} &bull; <a href="https://resend.com/emails" style="color: #0b7a75; font-weight: 600; text-decoration: none;">Open Resend Dashboard &rarr;</a>
            </p>
          </div>
        `,
        text: `${customerText}\n\n---\nFrom: ${rawSender}\nTo reply, simply reply to this email. It will be sent to ${senderEmail} from support@utahcity.app.`,
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

