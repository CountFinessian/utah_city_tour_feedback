"use client";

import { useEffect, useState } from "react";
import { UserPlus, Check, AlertCircle, Trash2, X, Mail } from "lucide-react";

type InviteItem = {
  email: string;
  name: string;
  role: "host" | "leader";
  claimed: boolean;
  setupUrl: string;
};

export function InviteManager() {
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"host" | "leader">("host");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [resendingEmail, setResendingEmail] = useState<string | null>(null);
  const [confirmRemoveUser, setConfirmRemoveUser] = useState<InviteItem | null>(null);
  const [removing, setRemoving] = useState(false);

  async function loadInvites() {
    try {
      const res = await fetch("/api/auth/invite");
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Failed to load invitations from database.");
      } else if (data?.invitations) {
        setInvites(data.invitations);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to connect to invitations API.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInvites();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setSubmitting(true);
    setError(null);
    setEmailNotice(null);

    try {
      const res = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create invitation");
        setSubmitting(false);
        return;
      }

      if (data.emailSent) {
        setEmailNotice(`Invitation email successfully dispatched to ${email.trim()}!`);
      } else if (data.emailError) {
        setEmailNotice(`Account setup created. Email notice: ${data.emailError}`);
      } else {
        setEmailNotice(`Invitation created for ${email.trim()}.`);
      }

      if (data.invite) {
        setInvites((prev) => [
          {
            email: data.invite.email,
            name: data.invite.name || data.invite.email.split("@")[0],
            role: data.invite.role,
            claimed: false,
            setupUrl: data.setupUrl,
          },
          ...prev.filter((i) => i.email.toLowerCase() !== data.invite.email.toLowerCase()),
        ]);
      }

      setEmail("");
      loadInvites();
    } catch {
      setError("Network error creating invitation");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResendSetup(targetEmail: string) {
    setResendingEmail(targetEmail);
    setError(null);
    setEmailNotice(null);
    try {
      const res = await fetch("/api/auth/resend-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail, action: "resend-setup" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to resend setup invitation.");
        return;
      }
      setEmailNotice(data.message || `Account setup email resent to ${targetEmail}!`);
      loadInvites();
    } catch {
      setError("Network error resending setup invitation.");
    } finally {
      setResendingEmail(null);
    }
  }

  async function handleRemoveUser(targetEmail: string) {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/invite?email=${encodeURIComponent(targetEmail)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to remove user account.");
        return;
      }
      setInvites((prev) => prev.filter((i) => i.email.toLowerCase() !== targetEmail.toLowerCase()));
      setEmailNotice(`Account for ${targetEmail} was removed successfully.`);
      setConfirmRemoveUser(null);
    } catch {
      setError("Network error removing account.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Invite Creation Form */}
      <form onSubmit={handleCreate} className="rounded-xl border border-command-border bg-white/[0.02] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-command-accent" />
          <h3 className="text-sm font-bold text-command-ink">Onboard New Team Member</h3>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800/60 text-red-200 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {emailNotice && (
          <div className="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-emerald-200 text-xs flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="font-semibold text-emerald-300">{emailNotice}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-command-soft block mb-1">User Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@utahcity.com"
              className={`w-full px-3 py-2 rounded-lg bg-white/[0.04] border text-xs text-command-ink placeholder:text-command-muted focus:outline-none transition-colors ${
                invites.some((inv) => inv.email.toLowerCase() === email.trim().toLowerCase() && inv.claimed)
                  ? "border-amber-500/60 focus:border-amber-400"
                  : "border-command-border focus:border-command-accent"
              }`}
            />
            {invites.some((inv) => inv.email.toLowerCase() === email.trim().toLowerCase() && inv.claimed) && (
              <p className="text-[11px] text-amber-400 mt-1 flex items-center gap-1">
                <span>⚠️</span>
                <span>An active account already exists for this email. They can sign in directly.</span>
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-command-soft block mb-1">Authority Level</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "host" | "leader")}
              className="w-full px-3 py-2 rounded-lg bg-[#101827] border border-command-border text-xs text-command-ink focus:outline-none focus:border-command-accent"
            >
              <option value="host">Tour Host (Capture Only)</option>
              <option value="leader">Leadership (Command & Analyst)</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={
            submitting ||
            !email.trim() ||
            invites.some((inv) => inv.email.toLowerCase() === email.trim().toLowerCase() && inv.claimed)
          }
          className="btn btn-primary px-4 py-2 text-xs font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <UserPlus className="h-3.5 w-3.5" />
          <span>{submitting ? "Sending Invitation..." : "Send Secure Invitation Email"}</span>
        </button>
      </form>

      {/* Existing Accounts List */}
      <div className="rounded-xl border border-command-border bg-white/[0.02] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-command-ink">Accounts</h3>
          <span className="text-xs text-command-muted">{invites.length} registered</span>
        </div>

        {loading ? (
          <p className="text-xs text-command-muted">Loading accounts...</p>
        ) : invites.length === 0 ? (
          <p className="text-xs text-command-muted">No accounts found.</p>
        ) : (
          <div className="divide-y divide-command-border">
            {invites.map((inv) => (
              <div key={inv.email} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-command-ink">{inv.name || inv.email}</span>
                    {inv.name && <span className="text-xs text-command-muted">({inv.email})</span>}
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        inv.role === "host"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                      }`}
                    >
                      {inv.role === "host" ? "Host" : "Leadership"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span
                      className={
                        inv.claimed
                          ? "text-emerald-400 font-medium flex items-center gap-1"
                          : "text-amber-400 font-medium flex items-center gap-1"
                      }
                    >
                      {inv.claimed ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          <span>Claimed & Active</span>
                        </>
                      ) : (
                        <>
                          <span>⏳</span>
                          <span>Pending Setup</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!inv.claimed && (
                    <button
                      type="button"
                      onClick={() => handleResendSetup(inv.email)}
                      disabled={resendingEmail === inv.email}
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-command-border hover:border-command-accent text-command-soft hover:text-command-ink transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
                      title={`Resend account setup email to ${inv.email}`}
                    >
                      <Mail className="h-3.5 w-3.5 text-command-accent" />
                      <span>{resendingEmail === inv.email ? "Sending..." : "Resend Invite"}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setConfirmRemoveUser(inv)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500/40 transition-colors shrink-0 cursor-pointer"
                    title={`Remove ${inv.name || inv.email}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Remove</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Account Removal Confirmation Modal */}
      {confirmRemoveUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-command-border bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-command-ink">Confirm Account Removal</h3>
                  <p className="text-xs text-command-muted">Permanently revoke account credentials</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmRemoveUser(null)}
                disabled={removing}
                className="text-command-muted hover:text-command-ink p-1 rounded-md hover:bg-white/5 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-red-900/40 bg-red-950/25 p-4 text-xs text-red-200/90 leading-relaxed">
              Are you sure you want to remove{" "}
              <strong className="text-white font-semibold">{confirmRemoveUser.name || confirmRemoveUser.email}</strong>{" "}
              (<span className="capitalize">{confirmRemoveUser.role}</span>)?
              <p className="mt-2 text-command-soft">
                This will immediately delete their login access and invitation link from the system.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRemoveUser(null)}
                disabled={removing}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-command-border text-command-soft hover:text-command-ink hover:border-command-border/80 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRemoveUser(confirmRemoveUser.email)}
                disabled={removing}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {removing ? (
                  <span>Removing...</span>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Confirm & Remove Account</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
