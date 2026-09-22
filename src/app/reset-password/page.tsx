"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Lock, AlertCircle, CheckCircle2, ArrowRight, ShieldCheck, KeyRound } from "lucide-react";

type UserDetails = {
  email: string;
  name: string;
  role: string;
};

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [user, setUser] = useState<UserDetails | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("No reset token was provided in the link. Please request a new password reset link.");
      setLoading(false);
      return;
    }

    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "This reset link is invalid or has expired.");
        } else {
          setUser(data);
        }
      })
      .catch(() => {
        setError("Network error validating reset link.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to reset password.");
        setSubmitting(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        window.location.href = data.redirectTo || "/";
      }, 1200);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070b12] text-[#e8eef7] flex flex-col justify-center items-center px-4 py-12">
        <div className="p-8 rounded-2xl bg-[#101827] border border-[#26354c] max-w-md w-full text-center space-y-4">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#43d9c7] border-t-transparent" />
          <p className="text-sm text-[#8292a8]">Verifying reset security credentials...</p>
        </div>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="min-h-screen bg-[#070b12] text-[#e8eef7] flex flex-col justify-center items-center px-4 py-12">
        <div className="p-8 rounded-2xl bg-[#101827] border border-[#26354c] max-w-md w-full text-center space-y-5">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-red-950/80 border border-red-800 text-red-400">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold text-[#f0f6ff]">Invalid or Expired Link</h2>
          <p className="text-sm text-[#8292a8] leading-relaxed">{error}</p>
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#43d9c7] text-[#070b12] font-bold text-sm hover:bg-[#38c4b3] transition-colors"
            >
              <span>Back to Sign In</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#070b12] text-[#e8eef7] flex flex-col justify-center items-center px-4 py-12">
        <div className="p-8 rounded-2xl bg-[#101827] border border-[#26354c] max-w-md w-full text-center space-y-4">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold text-[#f0f6ff]">Password Updated!</h2>
          <p className="text-sm text-[#8292a8]">Your credentials have been securely saved. Signing you into your workspace...</p>
          <div className="pt-2">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[#43d9c7] border-t-transparent" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070b12] text-[#e8eef7] flex flex-col justify-center items-center px-4 py-12 selection:bg-[#43d9c7] selection:text-[#070b12]">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-[#131e30] border border-[#26354c] text-[#43d9c7] mb-2 shadow-inner">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#f0f6ff]">Reset Your Password</h1>
          <p className="text-xs text-[#8292a8]">
            Choose a new, secure password for <span className="text-[#f0f6ff] font-medium">{user?.email}</span>
          </p>
        </div>

        {/* Form Card */}
        <form
          onSubmit={handleSubmit}
          className="p-6 rounded-2xl bg-[#101827] border border-[#26354c] shadow-2xl space-y-4"
        >
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2.5 text-xs text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {user && (
            <div className="p-3 rounded-xl bg-[#131e30] border border-[#26354c] flex items-center justify-between text-xs">
              <span className="text-[#8292a8]">Signed in as:</span>
              <span className="font-semibold text-[#f0f6ff]">{user.name || user.email}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#b8c5d6]">New Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#131e30] border border-[#26354c] text-sm text-[#f0f6ff] placeholder-[#65758b] focus:outline-none focus:border-[#43d9c7] focus:ring-1 focus:ring-[#43d9c7] transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#b8c5d6]">Confirm New Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#131e30] border border-[#26354c] text-sm text-[#f0f6ff] placeholder-[#65758b] focus:outline-none focus:border-[#43d9c7] focus:ring-1 focus:ring-[#43d9c7] transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !password || !confirmPassword}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#43d9c7] text-[#070b12] font-bold text-sm hover:bg-[#38c4b3] transition-colors shadow-lg shadow-[#43d9c7]/20 disabled:opacity-50 mt-4"
          >
            <Lock className="h-4 w-4" />
            <span>{submitting ? "Updating Password..." : "Update Password & Sign In"}</span>
          </button>
        </form>

        <div className="text-center">
          <Link href="/login" className="text-xs text-[#8292a8] hover:text-[#43d9c7] transition-colors">
            &larr; Return to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#070b12] text-[#e8eef7] flex flex-col justify-center items-center px-4 py-12">
          <div className="p-8 rounded-2xl bg-[#101827] border border-[#26354c] max-w-md w-full text-center space-y-4">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#43d9c7] border-t-transparent" />
            <p className="text-sm text-[#8292a8]">Loading...</p>
          </div>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

