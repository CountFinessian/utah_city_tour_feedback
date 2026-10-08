import { Comment, CommentWithContext, Post } from "@/domain/social-listening/types";
import { postCommentsInDashboard } from "@/domain/social-listening/relevance";
import {
  isHighSignalFeedback,
  leadershipActionFor,
  PublicFeedbackKind,
  selectActionableFeedback,
} from "@/server/analytics/social-metrics";
import { getResendApiKey, sendOpsAlertEmail } from "@/server/email/mailer";

const DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface SocialAlertMessage {
  subject: string;
  body: string;
}

export interface SocialAlertDispatchResult {
  immediateSent: boolean;
  digestSent: boolean;
  /** Persist when set. Unchanged when email is disabled or delivery fails. */
  lastDigestAt?: string;
}

type RankedFeedback = CommentWithContext & {
  feedbackKind: PublicFeedbackKind;
  leadershipAction: string;
};

function observedAt(comment: Comment): number {
  const parsed = Date.parse(comment.firstSeenAt || comment.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function withContext(comments: Comment[], posts: Post[]): CommentWithContext[] {
  const postById = new Map(posts.filter((post) => postCommentsInDashboard(post)).map((post) => [post.id, post]));
  return comments.filter((comment) => postById.has(comment.postId)).map((comment) => {
    const post = postById.get(comment.postId);
    return {
      ...comment,
      postUrl: post?.url,
      postCaptionSnippet: post?.caption?.slice(0, 80),
    };
  });
}

function rankHighSignal(comments: CommentWithContext[]): RankedFeedback[] {
  return selectActionableFeedback(comments.filter((comment) => isHighSignalFeedback(comment))).map((item) => ({
    ...item,
    leadershipAction: leadershipActionFor(item.feedbackKind),
  }));
}

export function shouldSendDailyDigest(lastDigestAt: string | undefined, now: Date): boolean {
  if (!lastDigestAt) return true;
  const parsed = Date.parse(lastDigestAt);
  if (Number.isNaN(parsed)) return true;
  return now.getTime() - parsed >= DIGEST_INTERVAL_MS;
}

export function formatSocialAlert(params: {
  kind: "immediate" | "digest";
  items: RankedFeedback[];
  appUrl?: string;
}): SocialAlertMessage {
  const origin = (params.appUrl || process.env.NEXT_PUBLIC_APP_URL || "https://utahcity.app").replace(/\/$/, "");
  const pulseUrl = `${origin}/social-pulse`;
  const count = params.items.length;

  if (params.kind === "digest" && count === 0) {
    return {
      subject: "Utah City Social Pulse daily digest",
      body: [
        "No new wayfinding, environment, or brand/operational comments in the last 24 hours.",
        "",
        `Open Social Pulse: ${pulseUrl}`,
      ].join("\n"),
    };
  }

  const lead = params.items[0];
  const snippet = (lead?.text || "").replace(/\s+/g, " ").slice(0, 80);
  const subject =
    params.kind === "immediate"
      ? count === 1
        ? `Utah City Social Pulse: ${snippet}`
        : `Utah City Social Pulse: ${count} new high-signal comments`
      : `Utah City Social Pulse daily digest (${count} high-signal)`;

  const lines = params.items.map((item, index) => {
    const kindLabel =
      item.feedbackKind === "wayfinding_and_access"
        ? "Wayfinding & access"
        : item.feedbackKind === "environment"
          ? "Environment"
          : "Brand & operations";
    return [
      `${index + 1}. ${kindLabel} · ${item.platform} · @${item.authorUsername} · ${item.likeCount || 0} likes`,
      `"${item.text}"`,
      item.postCaptionSnippet ? `On post: ${item.postCaptionSnippet}` : "",
      item.createdAt ? `Comment time: ${item.createdAt}` : "",
      item.postUrl ? `Post: ${item.postUrl}` : "",
      `Action: ${item.leadershipAction}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const intro =
    params.kind === "immediate"
      ? "New high-signal public comments leadership should see now."
      : "Daily digest of high-signal public comments from the last 24 hours.";

  return {
    subject,
    body: [intro, "", ...lines, "", `Open Social Pulse: ${pulseUrl}`].join("\n\n"),
  };
}

async function defaultSend(message: SocialAlertMessage): Promise<{ success: boolean; error?: string }> {
  const to = process.env.SOCIAL_PULSE_ALERT_EMAIL?.trim();
  return sendOpsAlertEmail({
    subject: message.subject,
    body: message.body,
    to: to || undefined,
  });
}

export async function dispatchSocialPulseAlerts(args: {
  comments: Comment[];
  posts: Post[];
  cycleStartedAt: string;
  now?: Date;
  lastDigestAt?: string;
  alertsEnabled?: boolean;
  send?: (message: SocialAlertMessage) => Promise<{ success: boolean; error?: string }>;
}): Promise<SocialAlertDispatchResult> {
  const enabled = args.alertsEnabled ?? process.env.SOCIAL_LISTENING_ALERTS !== "false";
  if (!enabled) return { immediateSent: false, digestSent: false };

  const send = args.send;
  if (!send && !getResendApiKey()) {
    console.info("[social-alerts] RESEND_API_KEY is not set; skipping Social Pulse email");
    return { immediateSent: false, digestSent: false };
  }
  const deliver = send ?? defaultSend;

  const now = args.now ?? new Date();
  const cycleStarted = Date.parse(args.cycleStartedAt);
  const contextual = withContext(args.comments, args.posts);

  const immediateItems = rankHighSignal(
    contextual.filter((comment) => observedAt(comment) >= (Number.isNaN(cycleStarted) ? 0 : cycleStarted))
  );

  let immediateSent = false;
  if (immediateItems.length > 0) {
    const message = formatSocialAlert({ kind: "immediate", items: immediateItems });
    const result = await deliver(message);
    immediateSent = result.success;
    if (!result.success) {
      console.warn("[social-alerts] Immediate alert was not sent:", result.error || "unknown error");
    }
  }

  if (!shouldSendDailyDigest(args.lastDigestAt, now)) {
    return { immediateSent, digestSent: false };
  }

  const digestCutoff = now.getTime() - DIGEST_INTERVAL_MS;
  const digestItems = rankHighSignal(contextual.filter((comment) => observedAt(comment) >= digestCutoff));
  const digest = formatSocialAlert({ kind: "digest", items: digestItems });
  const digestResult = await deliver(digest);
  if (!digestResult.success) {
    console.warn("[social-alerts] Daily digest was not sent:", digestResult.error || "unknown error");
    return { immediateSent, digestSent: false };
  }

  return {
    immediateSent,
    digestSent: true,
    lastDigestAt: now.toISOString(),
  };
}
