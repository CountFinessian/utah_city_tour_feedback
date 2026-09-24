import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";

export default function LeadershipLayout({ children }: { children: React.ReactNode }) {
export default async function LeadershipLayout({ children }: { children: React.ReactNode }) {
  const reqHeaders = await headers();
  const userAgent = reqHeaders.get("user-agent") || "";
  const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent);
  if (isMobile) {
    redirect("/");
  }

  return <AppShell>{children}</AppShell>;
}
