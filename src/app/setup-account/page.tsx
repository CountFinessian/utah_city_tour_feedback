"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Lock, AlertCircle, ArrowRight, ShieldCheck } from "lucide-react";

type InviteDetails = {
  email: string;
  name: string;
  role: "host" | "leader";
  title?: string;
};

function SetupAccountForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("No invitation token provided. Please use the link sent to your device.");
      setLoading(false);
      return;
    }

    fetch(`/api/auth/setup-account?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Invalid invitation link.");
        } else {
          setInvite(data);
          if (data.name) {
            const parts = data.name.trim().split(" ");
            setFirstName(parts[0] || "");
            setLastName(parts.slice(1).join(" ") || "");
          }
        }
      })
      .catch(() => {
        setError("Network error verifying your invitation link.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter both your first and last name.");
      return;
    }

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

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

    try {
      const res = await fetch("/api/auth/setup-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: fullName,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create account credentials.");
        setSubmitting(false);
        return;
      }

      router.push(data.redirectTo || "/");
      router.refresh();
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
          <p className="text-sm text-[#8292a8]">Verifying invitation on your device...</p>
        </div>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen bg-[#070b12] text-[#e8eef7] flex flex-col justify-center items-center px-4 py-12">
        <div className="p-8 rounded-2xl bg-[#101827] border border-[#26354c] max-w-md w-full text-center space-y-5">
          <div className={`inline-flex items-center justify-center h-12 w-12 rounded-full ${
            error.toLowerCase().includes("already") ? "bg-sky-950/80 border border-sky-800 text-sky-400" : "bg-red-950/80 border border-red-800 text-red-400"
          }`}>
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold text-[#f0f6ff]">
            {error.toLowerCase().includes("already") ? "Invitation Already Activated" : "Invitation Expired or Invalid"}
          </h2>
          <p className="text-sm text-[#8292a8] leading-relaxed">{error}</p>
          <div className="pt-2">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#131e30] border border-[#26354c] text-sm text-[#f0f6ff] hover:border-[#43d9c7] transition-colors"
            >
              <span>Go to Sign In</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070b12] text-[#e8eef7] flex flex-col justify-center items-center px-4 py-12 selection:bg-[#43d9c7] selection:text-[#070b12]">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-[#0b7a75] to-[#43d9c7] shadow-lg shadow-[#0b7a75]/20 font-black text-2xl text-[#070b12] tracking-wider mb-2">
            UC
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#f0f6ff]">
            Activate Your Account
          </h1>
          <p className="text-sm text-[#8292a8]">
            Set your name and password to complete your device registration
          </p>
        </div>

        {/* Invited Identity Card */}
        {invite && (
          <div className="p-4 rounded-xl bg-[#101827] border border-[#26354c] flex items-center justify-between">
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8292a8] block">
                Authorized Invite
              </span>
              <p className="text-sm font-bold text-[#f0f6ff] truncate">{invite.email}</p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[#43d9c7]/10 border border-[#43d9c7]/20 text-[#43d9c7]">
              {invite.role === "host" ? "Tour Host" : "Leadership"}
            </span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 p-3.5 rounded-xl bg-red-950/50 border border-red-800/60 text-red-200 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Password Setup Form */}
        <form onSubmit={handleSubmit} suppressHydrationWarning className="p-6 rounded-2xl bg-[#101827] border border-[#26354c] space-y-4 shadow-xl">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#b8c5d6]">First Name</label>
              <input
                type="text"
                name="firstName"
                id="firstName"
                autoComplete="given-name"
                suppressHydrationWarning
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Sarah"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#131e30] border border-[#26354c] text-sm text-[#f0f6ff] placeholder-[#65758b] focus:outline-none focus:border-[#43d9c7] focus:ring-1 focus:ring-[#43d9c7] transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#b8c5d6]">Last Name</label>
              <input
                type="text"
                name="lastName"
                id="lastName"
                autoComplete="family-name"
                suppressHydrationWarning
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Miller"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#131e30] border border-[#26354c] text-sm text-[#f0f6ff] placeholder-[#65758b] focus:outline-none focus:border-[#43d9c7] focus:ring-1 focus:ring-[#43d9c7] transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#b8c5d6]">Create Password</label>
            <input
              type="password"
              name="password"
              id="password"
              autoComplete="new-password"
              suppressHydrationWarning
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#131e30] border border-[#26354c] text-sm text-[#f0f6ff] placeholder-[#65758b] focus:outline-none focus:border-[#43d9c7] focus:ring-1 focus:ring-[#43d9c7] transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#b8c5d6]">Confirm Password</label>
            <input
              type="password"
              name="confirmPassword"
              id="confirmPassword"
              autoComplete="new-password"
              suppressHydrationWarning
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#131e30] border border-[#26354c] text-sm text-[#f0f6ff] placeholder-[#65758b] focus:outline-none focus:border-[#43d9c7] focus:ring-1 focus:ring-[#43d9c7] transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#43d9c7] text-[#070b12] font-bold text-sm hover:bg-[#38c4b3] transition-colors shadow-lg shadow-[#43d9c7]/20 disabled:opacity-50 mt-4"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>{submitting ? "Saving Credentials..." : "Complete Setup & Sign In"}</span>
          </button>
        </form>

        <p className="text-center text-xs text-[#65758b]">
          Already activated?{" "}
          <Link href="/login" className="text-[#43d9c7] hover:underline font-semibold">
            Sign in here
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SetupAccountPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#070b12]" />}>
      <SetupAccountForm />
    </Suspense>
  );
}
