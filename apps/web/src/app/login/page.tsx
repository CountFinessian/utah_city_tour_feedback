"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Check, CheckCircle2, Copy, ExternalLink, Lock, Mail, X } from "lucide-react";

function openExternalUrl(path: string) {
  if (typeof window !== "undefined") {
    const targetUrl = path.startsWith("http") ? path : `${window.location.origin}${path}`;
    window.open(targetUrl, "_system");
  }
}

function LoginForm() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const accountDeleted = searchParams.get("deleted") === "true";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotNotice, setForgotNotice] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);

  function copySupportEmail() {
    navigator.clipboard.writeText("support@utahcity.app");
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function openForgotPassword() {
    setForgotEmail(email.trim());
    setForgotNotice(null);
    setForgotError(null);
    setShowForgotModal(true);
  }

  async function handleSendReset(e: React.FormEvent) {
    e.preventDefault();
    if (!forgotEmail.trim()) return;

    setForgotLoading(true);
    setForgotError(null);
    setForgotNotice(null);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setForgotError(data.error || "Failed to process reset request.");
        setForgotLoading(false);
        return;
      }

      setForgotNotice(
        data.message ||
          `If an account exists for ${forgotEmail.trim()}, a password reset link has been dispatched to your email.`,
      );
    } catch {
      setForgotError("Network error. Please try again.");
    } finally {
      setForgotLoading(false);
    }
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

      const destination = from && !(data.user.role === "host" && from !== "/") ? from : data.redirectTo;
      window.location.href = destination;
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  const fieldClass =
    "w-full rounded-lg border border-[#26354c] bg-[#0c1320] px-3.5 py-3 text-base text-[#f0f6ff] placeholder:text-[#65758b] focus:border-[#43d9c7] focus:outline-none focus:ring-2 focus:ring-[#43d9c7]/25";

  return (
    <div className="flex min-h-full w-full flex-col items-center justify-center px-5 py-10 sm:px-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold tracking-[0.14em] text-[#43d9c7] uppercase">Utah City</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[#f0f6ff] sm:text-[1.75rem]">
            Sign in
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#8292a8]">
            Use your work email to open Host Intelligence.
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          suppressHydrationWarning
          className="rounded-xl border border-[#26354c] bg-[#101827] p-6 shadow-xl sm:p-7"
        >
          {accountDeleted && !error && (
            <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Your session ended because this account is no longer available.</span>
            </div>
          )}

          {error && (
            <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-medium text-[#b8c5d6]">
                Email
              </label>
              <input
                type="email"
                name="email"
                id="email"
                autoComplete="email"
                inputMode="email"
                suppressHydrationWarning
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@utahcity.com"
                className={fieldClass}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="password" className="block text-sm font-medium text-[#b8c5d6]">
                  Password
                </label>
                <button
                  type="button"
                  onClick={openForgotPassword}
                  className="text-sm font-medium text-[#43d9c7] hover:underline"
                >
                  Forgot password?
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
                className={fieldClass}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#43d9c7] px-4 py-3 text-base font-semibold text-[#070b12] transition-colors hover:bg-[#38c4b3] disabled:opacity-50"
            >
              <Lock className="h-4 w-4" />
              <span>{loading ? "Signing in…" : "Sign in"}</span>
            </button>
          </div>
        </form>

        <div className="mt-6 space-y-4 text-center text-sm text-[#8292a8]">
          <p>
            Need help?{" "}
            <button
              type="button"
              onClick={copySupportEmail}
              className="inline-flex items-center gap-1 font-medium text-[#43d9c7] hover:underline"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "support@utahcity.app"}
            </button>
          </p>
          <p className="text-xs leading-5 text-[#65758b]">
            Authorized hosts and leaders only. Request access via your admin or{" "}
            <button
              type="button"
              onClick={() => openExternalUrl("/support")}
              className="inline-flex items-center gap-0.5 text-[#43d9c7] hover:underline"
            >
              Support
              <ExternalLink className="h-3 w-3" />
            </button>
            .
          </p>
          <div className="flex items-center justify-center gap-3 pt-1 text-xs text-[#65758b]">
            <button
              type="button"
              onClick={() => openExternalUrl("/privacy")}
              className="hover:text-[#b8c5d6]"
            >
              Privacy
            </button>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={() => openExternalUrl("/support")}
              className="hover:text-[#b8c5d6]"
            >
              Support
            </button>
          </div>
        </div>
      </div>

      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-[#26354c] bg-[#101827] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg border border-[#26354c] bg-[#131e30] p-2.5 text-[#43d9c7]">
                  <Mail className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[#f0f6ff]">Reset password</h3>
                  <p className="text-sm text-[#8292a8]">We&apos;ll email a secure reset link</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="rounded-md p-1 text-[#8292a8] hover:bg-white/5 hover:text-[#f0f6ff]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {forgotError && (
              <div className="flex items-start gap-2.5 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{forgotError}</span>
              </div>
            )}

            {forgotNotice ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg border border-emerald-800/50 bg-emerald-950/40 px-3 py-3 text-sm text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                  <div>
                    <p className="font-semibold text-emerald-300">Reset email sent</p>
                    <p className="mt-1 leading-relaxed text-emerald-200/90">{forgotNotice}</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    className="rounded-lg bg-[#43d9c7] px-4 py-2.5 text-sm font-semibold text-[#070b12] hover:bg-[#38c4b3]"
                  >
                    Back to sign in
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSendReset} className="space-y-4">
                <p className="text-sm leading-6 text-[#8292a8]">
                  Enter the email on your account. If we find a match, we&apos;ll send a link to choose a new password.
                </p>
                <div className="space-y-2">
                  <label htmlFor="forgot-email" className="block text-sm font-medium text-[#b8c5d6]">
                    Email
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="name@utahcity.com"
                    className={fieldClass}
                  />
                </div>
                <div className="flex items-center justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    disabled={forgotLoading}
                    className="rounded-lg border border-[#26354c] px-4 py-2.5 text-sm font-medium text-[#8292a8] hover:text-[#f0f6ff]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading || !forgotEmail.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#43d9c7] px-4 py-2.5 text-sm font-semibold text-[#070b12] hover:bg-[#38c4b3] disabled:opacity-50"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {forgotLoading ? "Sending…" : "Send reset link"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-full bg-[#070b12]" />}>
      <LoginForm />
    </Suspense>
  );
}
