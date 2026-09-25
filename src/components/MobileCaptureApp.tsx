"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ShieldCheck,
  LogOut,
  AlertCircle,
  User,
  Trash2,
  X,
  Sparkles,
  Mic,
  ExternalLink,
  Undo2,
  Redo2,
} from "lucide-react";
import { Recorder, type RecorderRef } from "./Recorder";

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

  const [isNativeApp, setIsNativeApp] = useState(false);
  const [hostName, setHostName] = useState("");
  const [prospectFirstName, setProspectFirstName] = useState("");
  const [prospectLastName, setProspectLastName] = useState("");
  const [prospectEmail, setProspectEmail] = useState("");
  const [transcript, setTranscript] = useState("");
  const [history, setHistory] = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Detect whether running inside the native mobile app (Capacitor iOS)
  useEffect(() => {
    try {
      if (Capacitor.isNativePlatform()) {
        setIsNativeApp(true);
        document.documentElement.classList.add("native-app-locked");
        document.body.classList.add("native-app-locked");
      }
    } catch {}
  }, []);

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
    setNotice("AI consent is required for AI debriefs.");
  }

  function handleRevokeConsent() {
    try {
      localStorage.removeItem(AI_CONSENT_KEY);
    } catch {}
    setHasConsent(false);
    setNotice("AI consent revoked");
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

  const PROCESSING_MESSAGES = [
    "Cleaning transcript",
    "Extracting signals",
    "Checking evidence",
    "Saving debrief",
  ];

  // Processing status ticker
  useEffect(() => {
    if (!submitting) return;
    const timer = window.setInterval(() => {
      setProcessingIndex((idx) => Math.min(PROCESSING_MESSAGES.length - 1, idx + 1));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [submitting, PROCESSING_MESSAGES.length]);

  // Auto-dismiss toast notice after 3 seconds
  useEffect(() => {
    if (!notice && !error) return;
    const timer = window.setTimeout(() => {
      setNotice(null);
      setError(null);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [notice, error]);

  const canSubmit = transcript.trim().length > 0 && !submitting;

  function updateTranscript(next: string) {
    setTranscript(next);
    setHistory((prev) => {
      const current = prev[historyIndex];
      if (current === next) return prev;
      const updated = [...prev.slice(0, historyIndex + 1), next];
      if (updated.length > 50) updated.shift();
      return updated;
    });
    setHistoryIndex((prev) => Math.min(prev + 1, 49));
  }

  function appendText(text: string) {
    updateTranscript(transcript ? `${transcript} ${text}` : text);
  }

  function handleUndo() {
    if (historyIndex > 0) {
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      setTranscript(history[nextIndex] ?? "");
    }
  }

  function handleRedo() {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setTranscript(history[nextIndex] ?? "");
    }
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
          hostName: currentUser?.name || hostName || "Tour Host",
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
      // Single-page flow: Clear inputs and display "Entry submitted" toast popup
      setTranscript("");
      setHistory([""]);
      setHistoryIndex(0);
      setProspectFirstName("");
      setProspectLastName("");
      setProspectEmail("");
      setNotice("Entry submitted");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
      setProcessingIndex(0);
    }
  }

  // Common application UI content used across both native app and web presentation
  const appContent = (
    <div className="h-full flex flex-col justify-between overflow-hidden gap-2 flex-1 min-h-0">
      {/* Leadership warning if non-leader tried to access command */}
      {unauthorizedWarning && (
        <div className="mb-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2 shrink-0">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <p className="text-[11px] text-amber-200/90 leading-tight">
            Leadership intelligence is restricted to leadership accounts. Your host workspace is ready below.
          </p>
        </div>
      )}

      {/* Mobile App Header */}
      <header className="flex items-center justify-between py-1 shrink-0">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-mobile-muted">Utah City</p>
          <h1 className="text-base sm:text-lg font-black text-white tracking-tight leading-tight">Guided tour debrief</h1>
        </div>
        <div className="flex items-center gap-1.5">
          {currentUser?.role === "leader" && (
            <Link
              href="/command"
              className="text-[11px] px-2 py-1 rounded-md bg-white/[0.06] border border-white/10 text-slate-300 font-medium hover:bg-white/10 transition-colors"
            >
              Command
            </Link>
          )}
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
            className="h-7 w-7 rounded-md flex items-center justify-center bg-white/[0.04] hover:bg-red-500/15 text-slate-400 hover:text-red-300 border border-white/10 hover:border-red-500/25 transition-colors shrink-0 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Security / trust indicator */}
      <div className="flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-white/[0.03] border border-white/5 text-[11px] text-slate-400 font-medium shrink-0 mb-1">
        <ShieldCheck className="h-3.5 w-3.5 text-[#36cdbd]" />
        <span>{serverAsr ? "AI transcription active" : "On-device voice ready"}</span>
      </div>

      {/* Single-page capture screen */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <CaptureScreen
          transcript={transcript}
          canUndo={historyIndex > 0}
          canRedo={historyIndex < history.length - 1}
          onUndo={handleUndo}
          onRedo={handleRedo}
          hostName={currentUser?.name || hostName || "Tour Host"}
          prospectFirstName={prospectFirstName}
          prospectLastName={prospectLastName}
          prospectEmail={prospectEmail}
          contextOpen={contextOpen}
          submitting={submitting}
          processingIndex={processingIndex}
          processingMessages={PROCESSING_MESSAGES}
          canSubmit={canSubmit}
          serverAsr={serverAsr}
          onText={appendText}
          onTranscript={updateTranscript}
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
      </main>

      {/* Top floating toast popup for "Entry submitted" and errors */}
      {notice && (
        <div className="mobile-toast" role="status">
          <CheckCircle2 className="h-4 w-4 text-[#36cdbd] shrink-0" />
          <span className="leading-snug">{notice}</span>
        </div>
      )}
      {error && (
        <div className="mobile-toast mobile-toast-error" role="alert">
          <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          <span className="leading-snug">{error}</span>
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
                <div className="p-3.5 rounded-xl bg-red-500/[0.04] border border-red-500/20 space-y-3">
                  <div>
                    <p className="text-xs font-bold text-red-200">Delete Account</p>
                    <p className="text-[11px] text-[#8292a8] mt-0.5 leading-relaxed">
                      Permanently remove your account & access
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 active:scale-[0.99] text-red-300 text-xs font-bold transition-colors cursor-pointer shadow-sm"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
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
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={deletingAccount}
                      className="px-3.5 py-2 rounded-xl border border-white/10 text-xs text-slate-300 hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteAccount}
                      disabled={deletingAccount}
                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-md"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{deletingAccount ? "Deleting..." : "Yes, Delete Account"}</span>
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
  );

  // 1. Mobile App (Capacitor iOS): locked fixed viewport mapped to device
  if (isNativeApp) {
    return (
      <div className="fixed inset-0 w-full h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none bg-[#070b12] text-[#f0f6ff] flex flex-col items-center select-none">
        <div className="w-full max-w-md h-full flex flex-col justify-between overflow-hidden px-3.5 pt-[max(0.6rem,env(safe-area-inset-top))] pb-[max(0.6rem,env(safe-area-inset-bottom))]">
          {appContent}
        </div>
      </div>
    );
  }

  // 2. Web Browser: standard flexible website layout with unlocked scrolling
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
        <div className="phone-hardware p-3 sm:p-4 flex flex-col justify-between">
          {appContent}
        </div>
      </section>
    </div>
  );
}

function CaptureScreen({
  transcript,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hostName,
  prospectFirstName,
  prospectLastName,
  prospectEmail,
  contextOpen,
  submitting,
  processingIndex,
  processingMessages,
  canSubmit,
  serverAsr,
  error,
  onErrorClear,
  onText,
  onTranscript,
  onProspectFirstName,
  onProspectLastName,
  onProspectEmail,
  onContextOpen,
  onSubmit,
  recorderRef,
  onBeforeRecord,
}: {
  transcript: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hostName: string;
  prospectFirstName: string;
  prospectLastName: string;
  prospectEmail: string;
  contextOpen: boolean;
  submitting: boolean;
  processingIndex: number;
  processingMessages: string[];
  canSubmit: boolean;
  serverAsr: boolean;
  error?: string | null;
  onErrorClear?: () => void;
  onText: (value: string) => void;
  onTranscript: (value: string) => void;
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
    <div className="h-full flex flex-col justify-between overflow-hidden gap-3 py-1 flex-1 min-h-0">
      {/* 1. Voice debrief stage - enlarged prominent record button */}
      <section className="shrink-0">
        <Recorder
          ref={recorderRef}
          variant="card"
          serverAsr={serverAsr}
          onText={onText}
          onBeforeRecord={onBeforeRecord}
        />
      </section>

      {/* 2. Apple Notes-Style Debrief Textbox (~half height with Undo / Redo toolbar) */}
      <section className="apple-notes-card h-[160px] sm:h-[185px] shrink-0 flex flex-col shadow-inner">
        <div className="apple-notes-header shrink-0">
          <div className="flex items-center gap-2">
            <span className="mobile-section-label">Debrief notes</span>
            {transcript.trim().length > 0 && (
              <span className="text-[11px] font-mono text-[#8292a8]">
                {transcript.trim().length} chars
              </span>
            )}
          </div>
          {/* Apple Notes Toolbar: Undo, Redo, Clear */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-not-allowed transition cursor-pointer"
              title="Undo"
              aria-label="Undo"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-not-allowed transition cursor-pointer"
              title="Redo"
              aria-label="Redo"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
            {transcript.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onTranscript("");
                  if (error) onErrorClear?.();
                }}
                className="text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded-md hover:bg-white/5 transition cursor-pointer ml-1"
              >
                Clear
              </button>
            )}
          </div>
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

      {/* 3. Client details in CRM logging button (enlarged & more prominent) */}
      <div className="shrink-0">
        <button
          type="button"
          onClick={onContextOpen}
          className="w-full flex items-center justify-between px-3.5 py-3 rounded-2xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] transition-all text-left cursor-pointer shadow-sm"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-[#36cdbd]/15 text-[#36cdbd] shrink-0">
              <User className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">
                {prospectAssigned
                  ? [prospectFirstName, prospectLastName].filter(Boolean).join(" ") || prospectEmail
                  : "Client details in CRM logging"}
              </p>
              <p className="text-[11px] text-[#8292a8] truncate">
                {prospectAssigned
                  ? (prospectEmail ? `${prospectEmail} attached` : "CRM profile attached")
                  : "Attach prospect name & email (optional)"}
              </p>
            </div>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${contextOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Prospect Context Modal / Bottom Sheet with clean read-only Host */}
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
            
            {/* Host field - read-only without redundant badges */}
            <label className="mobile-field">
              <span>Tour Host</span>
              <input
                value={hostName}
                readOnly
                disabled
                className="mobile-input mt-1.5 text-[16px] sm:text-sm opacity-80 cursor-default select-none"
              />
            </label>

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
            {processingMessages[processingIndex]}...
          </span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-[#36cdbd]" />
          </div>
        </div>
      )}

      {/* 5. Anchored bottom submit bar (enlarged & more spaced out) */}
      <div className="shrink-0 pt-3 pb-1 flex items-center justify-between gap-3 border-t border-white/10">
        <div className="min-w-0">
          <p className="text-xs font-bold text-white truncate">
            {canSubmit ? "Ready to submit" : "Add debrief to begin"}
          </p>
          <p className="text-[11px] text-[#8292a8] truncate">Zero follow-up forms.</p>
        </div>
        <button
          type="button"
          disabled={submitting || !canSubmit}
          onClick={onSubmit}
          className="mobile-primary-button px-5 py-3 rounded-xl text-sm font-black disabled:opacity-40 disabled:cursor-not-allowed shrink-0 cursor-pointer flex items-center gap-2 shadow-lg shadow-teal-500/20"
        >
          <span>Submit debrief</span>
          <ArrowRight className="h-4 w-4" />
        </button>
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
    <label className="mobile-field">
      <span>{label}</span>
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
