import { Suspense } from "react";
import { MobileCaptureApp } from "@/components/MobileCaptureApp";
import { hasASR } from "@/server/ai/model-config";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#070b12]" />}>
      <MobileCaptureApp serverAsr={hasASR()} />
    </Suspense>
  );
}
