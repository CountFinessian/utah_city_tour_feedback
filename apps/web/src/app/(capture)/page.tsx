import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MobileCaptureApp } from "@/components/MobileCaptureApp";
import { hasASR } from "@/server/ai/env-flags";

export const dynamic = "force-dynamic";

export default async function Home(props: {
  searchParams?: Promise<{ surface?: string; capture?: string; mode?: string }>;
}) {
  const searchParams = props.searchParams ? await props.searchParams : {};
  const reqHeaders = await headers();
  const userAgent = reqHeaders.get("user-agent") || "";
  const role = reqHeaders.get("x-user-role");
  const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent);

  const isExplicitCapture =
    searchParams.surface === "capture" ||
    searchParams.capture === "1" ||
    searchParams.mode === "capture";

  if (!isMobile && role === "leader" && !isExplicitCapture) {
    redirect("/command");
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-[#070b12]" />}>
      <MobileCaptureApp serverAsr={hasASR()} />
    </Suspense>
  );
}
