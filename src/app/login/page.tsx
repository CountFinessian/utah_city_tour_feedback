"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, AlertCircle, Shield, LifeBuoy, Mail } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid email or password.");
        setLoading(false);
        return;
      }

      // If user had a specific deep-link destination and their role allows it, respect it
      const destination = from && !(data.user.role === "host" && from !== "/") ? from : data.redirectTo;
      window.location.href = destination;
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#070b12] text-[#e8eef7] flex flex-col justify-center items-center px-4 py-12 selection:bg-[#43d9c7] selection:text-[#070b12]">
      <div className="w-full max-w-md space-y-7">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-[#0b7a75] to-[#43d9c7] shadow-lg shadow-[#0b7a75]/20 font-black text-2xl text-[#070b12] tracking-wider mb-2">
            UC
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#f0f6ff]">
            Utah City Host Intelligence
          </h1>
          <p className="text-sm text-[#8292a8]">
            Sign in with your verified credentials
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-red-950/50 border border-red-800/60 text-red-200 text-sm animate-in fade-in">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form
          onSubmit={handleLogin}
          suppressHydrationWarning
          className="p-6 rounded-2xl bg-[#101827] border border-[#26354c] space-y-4 shadow-xl"
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#b8c5d6]">Email address</label>
            <input
              type="email"
              name="email"
              id="email"
              autoComplete="email"
              suppressHydrationWarning
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@utahcity.com"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#131e30] border border-[#26354c] text-sm text-[#f0f6ff] placeholder-[#65758b] focus:outline-none focus:border-[#43d9c7] focus:ring-1 focus:ring-[#43d9c7] transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#b8c5d6]">Password</label>
              <a
                href="mailto:support@utahcity.app?subject=Password%20Reset%20Request%20-%20Utah%20City&body=Hi%20Utah%20City%20Support,%0A%0APlease%20help%20me%20reset%20my%20password.%0A%0AEmail:%20"
                className="text-[11px] text-[#43d9c7] hover:underline"
              >
                Forgot password?
              </a>
            </div>
            <input
              type="password"
              name="password"
              id="password"
              autoComplete="current-password"
              suppressHydrationWarning
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#131e30] border border-[#26354c] text-sm text-[#f0f6ff] placeholder-[#65758b] focus:outline-none focus:border-[#43d9c7] focus:ring-1 focus:ring-[#43d9c7] transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#43d9c7] text-[#070b12] font-bold text-sm hover:bg-[#38c4b3] transition-colors shadow-lg shadow-[#43d9c7]/20 disabled:opacity-50 mt-4"
          >
            <Lock className="h-4 w-4" />
            <span>{loading ? "Authenticating..." : "Sign in to workspace"}</span>
          </button>
        </form>

        {/* Support Card */}
        <div className="p-4 rounded-xl bg-[#101827] border border-[#26354c] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5 text-[#8292a8]">
            <LifeBuoy className="h-4 w-4 shrink-0 text-[#43d9c7] mt-0.5" />
            <div>
              <p className="font-semibold text-[#f0f6ff]">Need help with your account?</p>
              <p className="text-[#8292a8] mt-0.5">
                Can&apos;t remember your email or password? Reach out and leadership will help reset your account.
              </p>
            </div>
          </div>
          <a
            href="mailto:support@utahcity.app?subject=Account%20Access%20Help%20-%20Utah%20City&body=Hi%20Utah%20City%20Support,%0A%0AI%20need%20help%20accessing%20my%20account.%0A%0AMy%20Name:%20%0AMy%20Email:%20%0AProblem:%20"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-[#26354c] text-[#43d9c7] font-semibold transition-colors shrink-0"
          >
            <Mail className="h-3.5 w-3.5" />
            <span>Contact Support</span>
          </a>
        </div>

        {/* Access Notice */}
        <div className="p-4 rounded-xl bg-[#101827]/60 border border-[#26354c]/60 flex items-start gap-3 text-xs text-[#8292a8]">
          <Shield className="h-4 w-4 shrink-0 text-[#43d9c7] mt-0.5" />
          <p className="leading-relaxed">
            Access is restricted to authorized Utah City hosts and leaders. If you received an invitation on your device, please open your setup link to create your credentials.
          </p>
        </div>

        <p className="text-center text-xs text-[#65758b]">
          Utah City Host Intelligence Platform
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#070b12]" />}>
      <LoginForm />
    </Suspense>
  );
}
