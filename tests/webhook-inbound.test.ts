import { describe, it, expect, vi } from "vitest";
import { GET, POST } from "@/app/api/webhooks/resend/route";
import type { NextRequest } from "next/server";

function jsonReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request("https://utahcity.app/api/webhooks/resend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("Resend Inbound Webhook", () => {
  it("GET returns webhook service status and forward target", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("active");
    expect(json.forwardTo).toBe("jawoba004@gmail.com");
  });

  it("POST ignores non-receiving events gracefully with 200", async () => {
    // Provide a dummy RESEND_API_KEY for tests
    process.env.RESEND_API_KEY = "re_test_key_12345";

    const req = jsonReq({
      type: "email.delivered",
      data: { id: "msg_123" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(json.type).toBe("email.delivered");
  });

  it("POST rejects email.received if email_id is missing", async () => {
    process.env.RESEND_API_KEY = "re_test_key_12345";

    const req = jsonReq({
      type: "email.received",
      data: {},
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Missing email_id");
  });
});

