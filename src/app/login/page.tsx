"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, AlertCircle, Shield, LifeBuoy, Copy, Check } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function copySupportEmail() {
    navigator.clipboard.writeText("support@utahcity.app");
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

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
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-[#131e30] border border-[#26354c] text-[#43d9c7] mb-2 shadow-inner">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#f0f6ff]">Sign in to Utah City</h1>
          <p className="text-xs text-[#8292a8]">Enter your credentials to access the intelligence platform</p>
        </div>

        {/* Form Card */}
        <form
          onSubmit={handleLogin}
          suppressHydrationWarning
          className="p-6 rounded-2xl bg-[#101827] border border-[#26354c] shadow-2xl space-y-4"
        >
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2.5 text-xs text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

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
              <button
                type="button"
                onClick={copySupportEmail}
                className="text-[11px] text-[#43d9c7] hover:underline"
              >
                {copied ? "support@utahcity.app copied!" : "Forgot password?"}
              </button>
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
                Can&apos;t remember your email or password? Copy the support email below.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={copySupportEmail}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-[#26354c] text-[#43d9c7] font-semibold transition-colors shrink-0 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-[#43d9c7]" />
                <span className="text-[#43d9c7]">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>support@utahcity.app</span>
              </>
            )}
          </button>
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
