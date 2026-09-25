"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ShieldCheck,
  LogOut,
  AlertCircle,
  Plus,
  User,
  Trash2,
  X,
  Shield,
  Sparkles,
  Mic,
  ExternalLink,
} from "lucide-react";
import { Recorder, type RecorderRef } from "./Recorder";
import { amenityLabel, objectionLabel, type Observation } from "@/domain/observation";

type AppState = "capture" | "structuring" | "done" | "failed";

const PROCESSING_MESSAGES = [
  "Cleaning transcript",
  "Extracting signals",
  "Checking evidence",
  "Preparing review",
  "Saving intelligence",
];

function sentimentLabel(s: number): string {
  return ["Very negative", "Negative", "Neutral", "Positive", "Very positive"][s + 2] ?? "Neutral";
}

function openExternalUrl(path: string) {
  if (typeof window !== "undefined") {
    const targetUrl = path.startsWith("http") ? path : `${window.location.origin}${path}`;
    // In Capacitor iOS WKWebView, window.open(url, '_system') opens Mobile Safari.
    window.open(targetUrl, "_system");
  }
}

export function MobileCaptureApp({ serverAsr = false }: { serverAsr?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentUser, setCurrentUser] = useState<{ name: string; role: string; email: string } | null>(null);

  const [hostName, setHostName] = useState("");
  const [prospectFirstName, setProspectFirstName] = useState("");
  const [prospectLastName, setProspectLastName] = useState("");
  const [prospectEmail, setProspectEmail] = useState("");
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<Observation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // One-time AI Consent Management (Apple App Store Guideline 5.1.2(i))
  const AI_CONSENT_KEY = "uc_ai_consent_accepted";
  const [hasConsent, setHasConsent] = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<"record" | "submit" | null>(null);
  const recorderRef = useRef<RecorderRef>(null);

  useEffect(() => {
    try {
      const accepted = localStorage.getItem(AI_CONSENT_KEY) === "true";
      setHasConsent(accepted);
    } catch {}
  }, []);

  function requestConsent(action: "record" | "submit"): boolean {
    if (hasConsent) return true;
    setPendingAction(action);
    setShowConsentModal(true);
    return false;
  }

  function handleAcceptConsent() {
    try {
      localStorage.setItem(AI_CONSENT_KEY, "true");
    } catch {}
    setHasConsent(true);
    setShowConsentModal(false);
    const action = pendingAction;
    setPendingAction(null);

    if (action === "record") {
      setTimeout(() => {
        void recorderRef.current?.start();
      }, 150);
    } else if (action === "submit") {
      void submit(transcript.trim());
    }
  }

  function handleDeclineConsent() {
    setShowConsentModal(false);
    setPendingAction(null);
    setNotice("AI consent is required before recording or analyzing debriefs with AI.");
  }

  function handleRevokeConsent() {
    try {
      localStorage.removeItem(AI_CONSENT_KEY);
    } catch {}
    setHasConsent(false);
    setNotice("AI consent has been revoked. You will be prompted before future AI debrief actions.");
  }

  async function handleDeleteAccount() {
    setDeletingAccount(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/auth/delete-account", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error || "Failed to delete account.");
        setDeletingAccount(false);
        return;
      }
      router.push("/login?deleted=true");
      router.refresh();
    } catch {
      setDeleteError("Network error while deleting account.");
      setDeletingAccount(false);
    }
  }

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) {
          setCurrentUser(data.user);
          setHostName(data.user.name);
        }
      })
      .catch(() => {});
  }, []);

  const unauthorizedWarning = searchParams.get("unauthorized") === "leadership";

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  // Processing status ticker
  useEffect(() => {
    if (!submitting) return;
    const timer = window.setInterval(() => {
      setProcessingIndex((idx) => Math.min(PROCESSING_MESSAGES.length - 1, idx + 1));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [submitting]);

  // Auto-dismiss toast notice after 3.2 seconds so it never blocks UI
  useEffect(() => {
    if (!notice && !error) return;
    const timer = window.setTimeout(() => {
      setNotice(null);
      setError(null);
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [notice, error]);

  const appState: AppState = useMemo(() => {
    if (error && !submitting) return "failed";
    if (submitting) return "structuring";
    if (result) return "done";
    return "capture";
  }, [error, result, submitting]);

  const canSubmit = transcript.trim().length > 0 && !submitting;

  function appendText(text: string) {
    setTranscript((prev) => (prev ? `${prev} ${text}` : text));
  }

  async function submit(nextTranscript: string) {
    if (!nextTranscript.trim()) {
      setError("Please add debrief notes or voice to continue.");
      return;
    }
    setSubmitting(true);
    setProcessingIndex(0);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: nextTranscript,
          hostName,
          prospectFirstName,
          prospectLastName,
          prospectEmail,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Could not structure debrief.");
        return;
      }
      setResult(json.observation as Observation);
      setTranscript(nextTranscript);
      // Auto-reset back to capture screen after a short confirmation pause
      setTimeout(() => {
        reset();
      }, 2200);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
      setProcessingIndex(0);
    }
  }

  function reset() {
    setTranscript("");
    setProspectFirstName("");
    setProspectLastName("");
    setProspectEmail("");
    setResult(null);
    setError(null);
    setNotice(null);
  }

  return (
    <div className="mobile-demo-stage">
      <div className="mobile-product-note">
        <p className="command-label">Field product</p>
        <h1>Native-style mobile capture</h1>
        <p>
          Hosts should experience this as a focused phone app: talk, review, close gaps, done.
          Command remains the desktop leadership surface.
        </p>

        {currentUser && (
          <div className="mt-4 p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Authenticated user</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#43d9c7]/10 text-[#43d9c7] border border-[#43d9c7]/20">
                {currentUser.role}
              </span>
            </div>
            <p className="text-sm font-semibold text-slate-200">{currentUser.name.trim().split(" ")[0]}</p>
            <p className="text-xs text-slate-400">{currentUser.email}</p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {currentUser?.role === "leader" ? (
            <Link href="/command" className="command-action-button inline-flex">
              Open Command
            </Link>
          ) : (
            <span className="text-xs text-slate-400 italic">
              Tour Host Mode · Capture debriefs below
            </span>
          )}
          <button
            onClick={handleLogout}
            title="Sign out"
            className="h-7 w-7 rounded-md flex items-center justify-center text-slate-400 hover:text-red-400 border border-white/10 hover:bg-white/5 transition-colors shrink-0"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <section className="phone-frame" aria-label="Utah City mobile capture app">
        <div className="phone-hardware">
          {unauthorizedWarning && (
            <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <p className="font-bold text-amber-300">Leadership Access Required</p>
                <p className="text-[11px] text-amber-200/90 mt-0.5">
                  Your account ({currentUser?.name?.trim().split(" ")[0] || "Host"}) has Host permissions for tour debriefs. Command intelligence is restricted to Leadership accounts.
                </p>
              </div>
            </div>
          )}

          <div className="mobile-app-header">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-mobile-muted">Utah City</p>
              <h1>Guided tour debrief</h1>
            </div>
            <div className="flex items-center gap-2">
              {currentUser && (
                <button
                  type="button"
                  onClick={() => setShowAccountModal(true)}
                  className="text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold flex items-center gap-1.5 h-7 hover:bg-emerald-500/25 transition-colors cursor-pointer"
                  title="Account settings & AI privacy"
                >
                  <User className="h-3 w-3" />
                  <span>{currentUser.name.trim().split(" ")[0]}</span>
                </button>
              )}
              <button
                onClick={handleLogout}
                title="Sign out of workspace"
                className="h-7 w-7 rounded-md flex items-center justify-center bg-white/[0.04] hover:bg-red-500/15 text-slate-400 hover:text-red-300 border border-white/10 hover:border-red-500/25 transition-colors shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="mobile-trust-line">
            <ShieldCheck className="h-4 w-4 text-[#36cdbd]" />
            {serverAsr ? "AI transcription active" : "On-device voice ready"}
          </div>

          <MobileProgress state={appState} />

          <main className="mobile-app-screen">
            {!result ? (
              <CaptureScreen
                transcript={transcript}
                hostName={hostName}
                prospectFirstName={prospectFirstName}
                prospectLastName={prospectLastName}
                prospectEmail={prospectEmail}
                contextOpen={contextOpen}
                submitting={submitting}
                processingIndex={processingIndex}
                canSubmit={canSubmit}
                serverAsr={serverAsr}
                onText={appendText}
                onTranscript={setTranscript}
                onHostName={setHostName}
                onProspectFirstName={setProspectFirstName}
                onProspectLastName={setProspectLastName}
                onProspectEmail={setProspectEmail}
                onContextOpen={() => setContextOpen((value) => !value)}
                recorderRef={recorderRef}
                onBeforeRecord={() => requestConsent("record")}
                onSubmit={() => {
                  if (requestConsent("submit")) {
                    void submit(transcript.trim());
                  }
                }}
                error={error}
                onErrorClear={() => setError(null)}
              />
            ) : (
              <ReviewScreen
                observation={result}
                onReset={reset}
                isLeader={currentUser?.role === "leader"}
              />
            )}
          </main>

          {(notice || error) && (
            <div className={`mobile-toast ${error ? "mobile-toast-error" : ""}`}>
              {error || notice}
            </div>
          )}

          {/* Account Settings & AI Privacy Modal */}
          {showAccountModal && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-150">
              <div className="w-full max-w-md rounded-2xl border border-[#26354c] bg-[#101827] p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-white/[0.04] border border-white/10 text-[#43d9c7]">
                      <User className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Account & AI Privacy</h3>
                      <p className="text-[11px] text-[#8292a8]">{currentUser?.email || "Host Account"}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAccountModal(false);
                      setShowDeleteConfirm(false);
                      setDeleteError(null);
                    }}
                    className="text-[#8292a8] hover:text-white p-1 rounded-md hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {deleteError && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{deleteError}</span>
                  </div>
                )}

                {/* AI Consent Card */}
                <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/10 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#43d9c7] font-semibold">
                      <Sparkles className="h-4 w-4" />
                      <span>AI Voice & Analysis Consent</span>
                    </div>
                    {hasConsent ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                        Consent Active
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300">
                        Pending
                      </span>
                    )}
                  </div>
                  <p className="text-[#8292a8] text-[11px] leading-relaxed">
                    Spoken tour audio is transcribed via automated AI speech recognition and synthesized into operational tour insights. Audio recordings are securely encrypted and are never sold or shared with external advertisers.
                  </p>
                  <div className="pt-1 flex items-center justify-between text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAccountModal(false);
                        setShowConsentModal(true);
                      }}
                      className="text-[#43d9c7] hover:underline font-semibold"
                    >
                      Review AI terms
                    </button>
                    {hasConsent && (
                      <button
                        type="button"
                        onClick={handleRevokeConsent}
                        className="text-amber-400/80 hover:text-amber-300 hover:underline"
                      >
                        Revoke consent
                      </button>
                    )}
                  </div>
                </div>

                {/* Legal Links (opens in external browser per Apple guidelines) */}
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 flex items-center justify-between text-xs">
                  <span className="text-[#8292a8]">Policies & Help</span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => openExternalUrl("/privacy")}
                      className="text-[#43d9c7] hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span>Privacy Policy</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                    <span className="text-[#26354c]">·</span>
                    <button
                      type="button"
                      onClick={() => openExternalUrl("/support")}
                      className="text-[#43d9c7] hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span>Support</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* In-App Account Deletion (Apple Guideline 5.1.1(v)) */}
                <div className="pt-2 border-t border-white/10 space-y-3">
                  {!showDeleteConfirm ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-white">Delete Account</p>
                        <p className="text-[11px] text-[#8292a8]">Permanently remove your account & access</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Delete Account</span>
                      </button>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 space-y-3">
                      <div className="flex items-start gap-2 text-xs text-red-200">
                        <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                        <p className="leading-relaxed">
                          Are you sure you want to permanently delete your host account? This action is immediate and cannot be undone.
                        </p>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowDeleteConfirm(false)}
                          disabled={deletingAccount}
                          className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-slate-300 hover:bg-white/5 transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleDeleteAccount}
                          disabled={deletingAccount}
                          className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {deletingAccount ? "Deleting..." : "Yes, Delete Account"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Explicit AI Consent Modal (Apple Guideline 5.1.2(i)) */}
          <AiConsentModal
            isOpen={showConsentModal}
            onAccept={handleAcceptConsent}
            onDecline={handleDeclineConsent}
          />
        </div>
      </section>
    </div>
  );
}

function MobileProgress({ state }: { state: AppState }) {
  const steps = [
    ["capture", "Record"],
    ["structuring", "Process"],
    ["done", "Done"],
  ] as const;

  const activeIndex =
    state === "done" ? 2 : state === "structuring" ? 1 : 0;

  return (
    <div className="mobile-progress">
      {steps.map(([key, label], index) => {
        const isCompleted = index < activeIndex;
        const isActive = index === activeIndex;
        return (
          <span
            key={key}
            className={`mobile-progress-step ${isActive || isCompleted ? "mobile-progress-step-active" : ""}`}
          >
            {isCompleted ? <Check className="h-3 w-3 inline" /> : `${index + 1} ·`}
            {label}
          </span>
        );
      })}
    </div>
  );
}

function CaptureScreen({
  transcript,
  hostName,
  prospectFirstName,
  prospectLastName,
  prospectEmail,
  contextOpen,
  submitting,
  processingIndex,
  canSubmit,
  serverAsr,
  error,
  onErrorClear,
  onText,
  onTranscript,
  onHostName,
  onProspectFirstName,
  onProspectLastName,
  onProspectEmail,
  onContextOpen,
  onSubmit,
  recorderRef,
  onBeforeRecord,
}: {
  transcript: string;
  hostName: string;
  prospectFirstName: string;
  prospectLastName: string;
  prospectEmail: string;
  contextOpen: boolean;
  submitting: boolean;
  processingIndex: number;
  canSubmit: boolean;
  serverAsr: boolean;
  error?: string | null;
  onErrorClear?: () => void;
  onText: (value: string) => void;
  onTranscript: (value: string) => void;
  onHostName: (value: string) => void;
  onProspectFirstName: (value: string) => void;
  onProspectLastName: (value: string) => void;
  onProspectEmail: (value: string) => void;
  onContextOpen: () => void;
  onSubmit: () => void;
  recorderRef?: React.RefObject<RecorderRef | null>;
  onBeforeRecord?: () => boolean;
}) {
  const prospectAssigned = Boolean(prospectFirstName.trim() || prospectLastName.trim() || prospectEmail.trim());

  return (
    <div className="h-full flex flex-col justify-between overflow-hidden gap-2.5 pb-1 flex-1 min-h-0">
      {/* 1. Voice debrief stage - compact bar */}
      <section className="shrink-0">
        <Recorder
          ref={recorderRef}
          variant="card"
          serverAsr={serverAsr}
          onText={onText}
          onBeforeRecord={onBeforeRecord}
        />
      </section>

      {/* 2. Apple Notes-Style Debrief Textbox */}
      <section className="apple-notes-card">
        <div className="apple-notes-header">
          <div className="flex items-center gap-2">
            <span className="mobile-section-label">Debrief notes</span>
            {transcript.trim().length > 0 && (
              <span className="text-[11px] font-mono text-[#8292a8]">
                {transcript.trim().length} chars
              </span>
            )}
          </div>
          {transcript.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onTranscript("");
                if (error) onErrorClear?.();
              }}
              className="text-[11px] text-slate-400 hover:text-white px-2 py-0.5 rounded hover:bg-white/5 transition-colors cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
        <textarea
          id="mobile-transcript"
          value={transcript}
          onChange={(event) => {
            onTranscript(event.target.value);
            if (error) onErrorClear?.();
          }}
          placeholder="Voice recording will transcribe directly into this note. Tap anywhere to type, edit, or adjust..."
          className={`apple-notes-textarea ${error ? "ring-1 ring-rose-500/60" : ""}`}
          autoComplete="off"
          autoCorrect="on"
          spellCheck={true}
        />
        {error && (
          <div className="px-3 py-1.5 bg-rose-500/10 border-t border-rose-500/20 text-xs text-rose-300 flex items-center gap-1.5 shrink-0">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </section>

      {/* 3. Compact prospect trigger */}
      <div className="shrink-0">
        <button
          type="button"
          onClick={onContextOpen}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center gap-2 min-w-0">
            <User className="h-3.5 w-3.5 text-[#36cdbd] shrink-0" />
            <span className="text-xs text-slate-300 truncate">
              {prospectAssigned
                ? [prospectFirstName, prospectLastName, prospectEmail].filter(Boolean).join(" · ")
                : "Add prospect details (optional)"}
            </span>
          </div>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform ${contextOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Prospect Context Modal / Bottom Sheet */}
      {contextOpen && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-3">
          <div className="w-full max-w-md rounded-2xl border border-[#26354c] bg-[#101827] p-4 shadow-2xl space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-[#36cdbd]" />
                <span className="text-sm font-bold text-white">Prospect Tracking</span>
              </div>
              <button
                type="button"
                onClick={onContextOpen}
                className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-white/5 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MobileField label="First name" value={prospectFirstName} onChange={onProspectFirstName} placeholder="e.g. Sarah" />
              <MobileField label="Last name" value={prospectLastName} onChange={onProspectLastName} placeholder="e.g. Miller" />
            </div>
            <MobileField label="Email" value={prospectEmail} onChange={onProspectEmail} placeholder="client@example.com" />
            <MobileField label="Host" value={hostName} onChange={onHostName} placeholder="Host name" />
            <button
              type="button"
              onClick={onContextOpen}
              className="w-full mt-2 py-2.5 rounded-xl bg-[#36cdbd] text-[#070b12] font-bold text-xs hover:bg-[#43d9c7] transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* 4. Processing bar */}
      {submitting && (
        <div className="p-2.5 rounded-xl bg-white/[0.04] border border-[#36cdbd]/30 flex items-center justify-between shrink-0">
          <span className="text-xs font-semibold text-[#36cdbd]">
            {PROCESSING_MESSAGES[processingIndex]}...
          </span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-[#36cdbd]" />
          </div>
        </div>
      )}

      {/* 5. Anchored bottom submit bar */}
      <div className="shrink-0 pt-2 pb-1 flex items-center justify-between gap-3 border-t border-white/10">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white truncate">
            {canSubmit ? "Ready to structure" : "Add debrief to begin"}
          </p>
          <p className="text-[11px] text-[#8292a8] truncate">Zero forms after submit.</p>
        </div>
        <button
          type="button"
          disabled={submitting || !canSubmit}
          onClick={onSubmit}
          className="mobile-primary-button disabled:opacity-40 disabled:cursor-not-allowed shrink-0 cursor-pointer"
        >
          Submit debrief
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ReviewScreen({
  observation,
  onReset,
  isLeader,
}: {
  observation: Observation;
  onReset: () => void;
  isLeader: boolean;
}) {
  const e = observation.extraction;
  const [detailsOpen, setDetailsOpen] = useState(false);

  const prospectDisplayName = [observation.prospectFirstName, observation.prospectLastName].filter(Boolean).join(" ");

  return (
    <div className="h-full flex flex-col justify-between overflow-y-auto gap-3 py-1 flex-1 min-h-0">
      <div className="space-y-3">
        {/* Confirmed Success Hero */}
        <section className="mobile-card bg-gradient-to-b from-[#123631] to-[#0d1a1d] border-[#36cdbd]/40 text-center py-4">
          <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-[#36cdbd]/20 border border-[#36cdbd]/40 text-[#36cdbd] mb-2">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-black text-white tracking-tight">Tour debrief captured!</h2>
          <p className="text-xs text-slate-300 mt-0.5">
            {prospectDisplayName ? (
              <>
                Logged for <strong className="text-[#36cdbd]">{prospectDisplayName}</strong>
                {observation.prospectEmail ? ` (${observation.prospectEmail})` : ""}
              </>
            ) : (
              "Observation saved to Utah City intelligence corpus"
            )}
          </p>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="mobile-chip font-bold text-xs">{e.prospectIntent} lead</span>
            <span className="mobile-chip text-xs">{sentimentLabel(e.overallSentiment)}</span>
          </div>
        </section>

        {/* Summary Card */}
        <section className="mobile-card py-3">
          <h3 className="mobile-section-label">Executive summary</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-mobile-soft">{e.summary}</p>
        </section>

        {/* Collapsible Signal Drilldown */}
        <section className="mobile-card py-3">
          <button
            type="button"
            className="mobile-disclosure cursor-pointer"
            onClick={() => setDetailsOpen((prev) => !prev)}
          >
            <span>
              <span className="mobile-section-label block">Captured signals</span>
              <span className="block text-xs text-mobile-muted">
                {e.objections.length} objections · {e.amenities.length} amenities
              </span>
            </span>
            <ChevronDown className={`h-4 w-4 transition ${detailsOpen ? "rotate-180" : ""}`} />
          </button>

          {detailsOpen && (
            <div className="mt-3 space-y-3 pt-2 border-t border-white/10">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Objections</p>
                {e.objections.length === 0 ? (
                  <p className="text-xs text-mobile-muted">No blockers raised.</p>
                ) : (
                  e.objections.map((item, index) => (
                    <div key={`${item.type}-${index}`} className="mobile-signal-row text-xs py-1.5">
                      <span>{objectionLabel(item.type)}</span>
                      <span className="text-[11px] text-slate-400">{item.severity}</span>
                    </div>
                  ))
                )}
              </div>

              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Amenity reactions</p>
                {e.amenities.length === 0 ? (
                  <p className="text-xs text-mobile-muted">No specific amenity reactions noted.</p>
                ) : (
                  e.amenities.map((item, index) => (
                    <div key={`${item.name}-${index}`} className="mobile-signal-row text-xs py-1.5">
                      <span>{amenityLabel(item.name)}</span>
                      <span className="text-[11px] capitalize text-slate-400">{item.reaction}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Bottom bar — auto-reset fires after 2.2s; this is a manual shortcut */}
      <div className="shrink-0 pt-2 pb-1 border-t border-white/10 flex items-center gap-2">
        <button
          type="button"
          onClick={onReset}
          className="mobile-primary-button w-full justify-center text-xs py-2.5 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Log another tour
        </button>

        {isLeader && (
          <Link
            href="/command"
            className="hidden md:inline-flex mobile-secondary-button text-xs shrink-0"
          >
            Open Command
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

function MobileField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mobile-section-label">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mobile-input mt-1.5 text-[16px] sm:text-sm"
      />
    </label>
  );
}

function AiConsentModal({
  isOpen,
  onAccept,
  onDecline,
}: {
  isOpen: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl border border-[#26354c] bg-[#0c121e] p-5 sm:p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-[#43d9c7]/10 border border-[#43d9c7]/20 text-[#43d9c7]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">AI Voice & Analysis Consent</h3>
              <p className="text-xs text-[#8292a8]">Required before submitting or recording debriefs</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDecline}
            className="text-[#8292a8] hover:text-white p-1 rounded-md hover:bg-white/5 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-[#cad5e2] leading-relaxed">
          Utah City uses automated artificial intelligence to help tour hosts capture and summarize visitor feedback quickly. To comply with Apple App Store privacy requirements (Guideline 5.1.2(i)), we ask for your explicit permission before transmitting debrief notes or voice audio to our AI processing services.
        </p>

        <div className="space-y-2.5 text-xs">
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-1">
            <div className="flex items-center gap-2 font-semibold text-white">
              <Mic className="h-3.5 w-3.5 text-[#43d9c7]" />
              <span>Voice Speech Recognition</span>
            </div>
            <p className="text-[#8292a8] text-[11px] leading-relaxed">
              When using microphone voice recording, spoken audio is sent to automated speech-to-text models to generate your written tour debrief transcript.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-1">
            <div className="flex items-center gap-2 font-semibold text-white">
              <Sparkles className="h-3.5 w-3.5 text-[#43d9c7]" />
              <span>AI Language Model Debrief Analysis</span>
            </div>
            <p className="text-[#8292a8] text-[11px] leading-relaxed">
              Both spoken transcripts and manually typed debrief notes are processed by enterprise language models to extract visitor interest signals, sentiment, and follow-up action items.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-1">
            <div className="flex items-center gap-2 font-semibold text-white">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Enterprise Privacy & Encryption</span>
            </div>
            <p className="text-[#8292a8] text-[11px] leading-relaxed">
              Data is encrypted in transit and at rest. Your notes and recordings are strictly confidential to Utah City and are never sold, shared with external advertisers, or used to train public AI models.
            </p>
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between text-[11px]">
          <span className="text-[#8292a8]">Policies & Help</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => openExternalUrl("/privacy")}
              className="text-[#43d9c7] hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Privacy Policy</span>
              <ExternalLink className="h-3 w-3" />
            </button>
            <span className="text-[#26354c]">·</span>
            <button
              type="button"
              onClick={() => openExternalUrl("/support")}
              className="text-[#43d9c7] hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Support</span>
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="pt-2 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onDecline}
            className="px-4 py-2.5 rounded-xl border border-white/10 text-xs font-semibold text-slate-300 hover:bg-white/5 transition-colors cursor-pointer"
          >
            Not Now
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#070b12] font-bold text-xs shadow-lg shadow-emerald-500/20 transition-all cursor-pointer flex items-center gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>I Consent & Continue</span>
          </button>
        </div>
      </div>
    </div>
  );
}
