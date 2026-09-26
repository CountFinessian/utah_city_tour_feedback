"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { triggerSubmitHaptic, triggerErrorHaptic, triggerTapHaptic } from "@/lib/haptics";

function openExternalUrl(path: string) {
  if (typeof window !== "undefined") {
    const targetUrl = path.startsWith("http") ? path : `${window.location.origin}${path}`;
    // In Capacitor iOS WKWebView, window.open(url, '_system') opens Mobile Safari.
    window.open(targetUrl, "_system");
  }
}

export function MobileCaptureApp({ serverAsr = false }: { serverAsr?: boolean }) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<{ name: string; role: string; email: string } | null>(null);

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
  const [unauthorizedWarning, setUnauthorizedWarning] = useState(false);

  // Detect whether running in mobile viewport (native app or mobile screen <= 900px)
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    setUnauthorizedWarning(new URLSearchParams(window.location.search).get("unauthorized") === "leadership");
    const updateViewport = () => {
      const isMobile = Capacitor.isNativePlatform() || window.innerWidth <= 900;
      setIsMobileViewport(isMobile);
      if (isMobile) {
        document.documentElement.classList.add("native-app-locked");
        document.body.classList.add("native-app-locked");
      } else {
        document.documentElement.classList.remove("native-app-locked");
        document.body.classList.remove("native-app-locked");
      }
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  // One-time AI Consent Management (Apple App Store Guideline 5.1.2(i))
  const AI_CONSENT_KEY = "uc_ai_consent_accepted";
  const [hasConsent, setHasConsent] = useState(false);
  const [showConsentScreen, setShowConsentScreen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"record" | "submit" | null>(null);
  const recorderRef = useRef<RecorderRef>(null);

  useEffect(() => {
    try {
      setHasConsent(localStorage.getItem(AI_CONSENT_KEY) === "true");
    } catch {}
    // Read location directly — Next searchParams can lag behind during hydration.
    if (new URLSearchParams(window.location.search).get("consent") === "1") {
      setShowConsentScreen(true);
    }
  }, []);

  function readConsentFlag(): boolean {
    try {
      return localStorage.getItem(AI_CONSENT_KEY) === "true";
    } catch {
      return hasConsent;
    }
  }

  function requestConsent(action: "record" | "submit"): boolean {
    if (readConsentFlag()) {
      setHasConsent(true);
      return true;
    }
    setPendingAction(action);
    setShowAccountModal(false);
    setShowConsentScreen(true);
    return false;
  }

  function openConsentScreen() {
    setShowAccountModal(false);
    setPendingAction(null);
    setShowConsentScreen(true);
  }

  function handleAcceptConsent() {
    try {
      localStorage.setItem(AI_CONSENT_KEY, "true");
    } catch {}
    setHasConsent(true);
    setShowConsentScreen(false);
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
    const blockedAction = pendingAction;
    setShowConsentScreen(false);
    setPendingAction(null);
    if (blockedAction) {
      setNotice("AI consent is required before recording or submitting a debrief.");
    }
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
    void triggerTapHaptic();
    if (!nextTranscript.trim()) {
      setError("Please add debrief notes or voice to continue.");
      void triggerErrorHaptic();
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
        void triggerErrorHaptic();
        return;
      }
      // Haptic first so the native call isn't dropped by immediate re-render
      await triggerSubmitHaptic();
      setTranscript("");
      setHistory([""]);
      setHistoryIndex(0);
      setProspectFirstName("");
      setProspectLastName("");
      setProspectEmail("");
      setNotice(json.notice || "Sent — structuring in background");
    } catch {
      setError("Could not reach the server.");
      void triggerErrorHaptic();
    } finally {
      setSubmitting(false);
      setProcessingIndex(0);
    }
  }

  // Common application UI content used across both native app and web presentation
  const captureContent = (
    <div className="relative h-full flex flex-col justify-between overflow-hidden gap-2 flex-1 min-h-0">
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
      <header className="flex items-start justify-between gap-3 py-1 shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-wider text-teal-400">Utah City</p>
          <h1 className="text-lg font-black text-white tracking-tight leading-tight">Guided tour debrief</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {currentUser && (
            <button
              type="button"
              onClick={() => setShowAccountModal(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 font-bold flex items-center gap-1.5 h-8 hover:bg-emerald-500/25 transition-colors cursor-pointer"
              title="Account settings & AI privacy"
            >
              <User className="h-3.5 w-3.5" />
              <span>{currentUser.name.trim().split(" ")[0]}</span>
            </button>
          )}
          <button
            onClick={handleLogout}
            title="Sign out of workspace"
            className="h-8 w-8 rounded-lg flex items-center justify-center bg-white/[0.04] hover:bg-red-500/15 text-slate-300 hover:text-red-300 border border-white/10 hover:border-red-500/25 transition-colors shrink-0 cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Security / trust indicator */}
      <div className="flex items-center gap-2 py-1.5 px-3 rounded-xl bg-white/[0.03] border border-white/5 text-xs text-slate-200 font-semibold shrink-0 mb-1">
        <ShieldCheck className="h-4 w-4 text-[#36cdbd]" />
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
          notice={notice}
          onNoticeClear={() => setNotice(null)}
          error={error}
          onErrorClear={() => setError(null)}
        />
      </main>

      {/* Account Settings & AI Privacy Modal */}
      {showAccountModal && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm p-3 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-[#26354c] bg-[#101827] p-5 shadow-2xl space-y-4 max-h-[90%] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-[#43d9c7]">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Account & AI Privacy</h3>
                  <p className="text-xs text-slate-300 font-medium">{currentUser?.email || "Host Account"}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAccountModal(false);
                  setShowDeleteConfirm(false);
                  setDeleteError(null);
                }}
                className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-white/5 transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {deleteError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{deleteError}</span>
              </div>
            )}

            {/* AI Consent Card */}
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/10 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0 text-[#43d9c7] font-bold text-sm">
                  <Sparkles className="h-4 w-4 shrink-0" />
                  <span className="truncate">AI Voice & Analysis Consent</span>
                </div>
                {hasConsent ? (
                  <span className="shrink-0 whitespace-nowrap text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                    Consent Active
                  </span>
                ) : (
                  <span className="shrink-0 whitespace-nowrap text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300">
                    Pending
                  </span>
                )}
              </div>
              <p className="text-slate-200 text-xs leading-relaxed font-normal">
                Utah City Intelligence uses automated artificial intelligence to synthesize tour debriefs into operational insights. Spoken audio and debrief notes are encrypted and never sold or shared.
              </p>
              <div className="pt-1.5 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={openConsentScreen}
                  className="text-[#43d9c7] hover:underline font-bold"
                >
                  Review AI terms
                </button>
                {hasConsent && (
                  <button
                    type="button"
                    onClick={handleRevokeConsent}
                    className="text-amber-400/90 hover:text-amber-300 hover:underline font-bold"
                  >
                    Revoke consent
                  </button>
                )}
              </div>
            </div>

            {/* Legal Links (opens in external browser per Apple guidelines) */}
            <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/10 flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium">Policies & Help</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => openExternalUrl("/privacy")}
                  className="text-[#43d9c7] hover:underline inline-flex items-center gap-1 cursor-pointer font-bold"
                >
                  <span>Privacy Policy</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
                <span className="text-slate-600">·</span>
                <button
                  type="button"
                  onClick={() => openExternalUrl("/support")}
                  className="text-[#43d9c7] hover:underline inline-flex items-center gap-1 cursor-pointer font-bold"
                >
                  <span>Support</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* In-App Account Deletion (Apple Guideline 5.1.1(v)) */}
            <div className="pt-2 border-t border-white/10 space-y-3">
              {!showDeleteConfirm ? (
                <div className="p-4 rounded-xl bg-red-500/[0.04] border border-red-500/20 space-y-3">
                  <div>
                    <p className="text-sm font-bold text-red-200">Delete Account</p>
                    <p className="text-xs text-slate-300 mt-0.5 leading-relaxed font-medium">
                      Permanently remove your account & access
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 active:scale-[0.99] text-red-200 text-sm font-bold transition-colors cursor-pointer shadow-sm"
                  >
                    <Trash2 className="h-4 w-4 text-red-400" />
                    <span>Delete Account</span>
                  </button>
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 space-y-3">
                  <div className="flex items-start gap-2.5 text-sm text-red-200">
                    <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      Are you sure you want to permanently delete your host account? This action is immediate and cannot be undone.
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={deletingAccount}
                      className="px-4 py-2.5 rounded-xl border border-white/10 text-sm text-slate-200 font-bold hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteAccount}
                      disabled={deletingAccount}
                      className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2 shadow-md"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>{deletingAccount ? "Deleting..." : "Yes, Delete Account"}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const appContent = showConsentScreen ? (
    <AiConsentScreen onAccept={handleAcceptConsent} onDecline={handleDeclineConsent} />
  ) : (
    captureContent
  );

  // 1. Mobile Screen (iPhone / Native App / screen <= 900px): edge-to-edge dark viewport filling around the notch
  if (isMobileViewport) {
    return (
      <div className="fixed inset-0 w-full overflow-hidden overscroll-none bg-[#070b12] text-[#f0f6ff] flex flex-col items-center select-none">
        <div className="phone-screen-shell w-full max-w-[440px] mx-auto">
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
          Hosts should experience this as a focused phone app: talk, review, submit — done.
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

      <div className="phone-slot" aria-label="iPhone 13 TestFlight preview">
        <section className="phone-frame">
          <div className="phone-hardware">
            {/* Same shell as native TestFlight / Capacitor on iPhone 13 */}
            <div className="phone-screen-shell phone-screen-shell--iphone13">
              {appContent}
            </div>
          </div>
        </section>
      </div>
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
  notice,
  onNoticeClear,
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
  notice?: string | null;
  onNoticeClear?: () => void;
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
    <div className="relative h-full flex flex-col justify-between overflow-hidden gap-3 py-1 flex-1 min-h-0">
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
      <section className="apple-notes-card relative flex-1 min-h-[200px] shrink flex flex-col shadow-inner">
        <div className="apple-notes-header shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="mobile-section-label">Debrief notes</span>
            {transcript.trim().length > 0 && (
              <span className="text-xs font-mono text-slate-300 font-semibold">
                {transcript.trim().length} chars
              </span>
            )}
          </div>
          {/* Apple Notes Toolbar: Undo, Redo, Clear */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-200 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-not-allowed transition cursor-pointer"
              title="Undo"
              aria-label="Undo"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-200 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-not-allowed transition cursor-pointer"
              title="Redo"
              aria-label="Redo"
            >
              <Redo2 className="h-4 w-4" />
            </button>
            {transcript.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onTranscript("");
                  if (error) onErrorClear?.();
                }}
                className="text-xs text-slate-200 font-bold hover:text-white px-2.5 py-1 rounded-md hover:bg-white/10 transition cursor-pointer ml-1"
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
          className="apple-notes-textarea"
          autoComplete="off"
          autoCorrect="on"
          spellCheck={true}
        />

        {/* Big Green Popup: centered directly over debrief notes textbox */}
        {notice && (
          <div className="absolute inset-0 z-30 rounded-2xl bg-[#071916]/95 backdrop-blur-md border-2 border-emerald-400 flex flex-col items-center justify-center p-4 text-center animate-in fade-in zoom-in-95 duration-150 pointer-events-none">
            <div className="p-2.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 mb-2">
              <CheckCircle2 className="h-7 w-7 text-emerald-400" />
            </div>
            <p className="text-xl font-black text-white tracking-tight">
              {notice}
            </p>
          </div>
        )}

        {/* Big Red Popup: centered directly over debrief notes textbox */}
        {error && (
          <div className="absolute inset-0 z-30 rounded-2xl bg-[#1a0a0d]/95 backdrop-blur-md border-2 border-rose-500 flex flex-col items-center justify-center p-4 text-center animate-in fade-in zoom-in-95 duration-150">
            <div className="p-2.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 mb-2">
              <AlertCircle className="h-7 w-7 text-rose-400" />
            </div>
            <p className="text-base font-black text-white tracking-tight">
              {error}
            </p>
            {onErrorClear && (
              <button
                type="button"
                onClick={onErrorClear}
                className="mt-2.5 px-4 py-1.5 rounded-lg bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-bold transition cursor-pointer"
              >
                Dismiss
              </button>
            )}
          </div>
        )}
      </section>

      {/* 3. Client details in CRM logging button (enlarged & more prominent) */}
      <div className="shrink-0">
        <button
          type="button"
          onClick={onContextOpen}
          className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] transition-all text-left cursor-pointer shadow-sm"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-[#36cdbd]/15 text-[#36cdbd] shrink-0">
              <User className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black text-white truncate">
                {prospectAssigned
                  ? [prospectFirstName, prospectLastName].filter(Boolean).join(" ") || prospectEmail
                  : "Client details in CRM logging"}
              </p>
              <p className="text-xs text-slate-300 font-medium truncate">
                {prospectAssigned
                  ? (prospectEmail ? `${prospectEmail} attached` : "CRM profile attached")
                  : "Attach prospect name & email (optional)"}
              </p>
            </div>
          </div>
          <ChevronDown className={`h-4.5 w-4.5 text-slate-300 shrink-0 transition-transform ${contextOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Prospect Context Modal / Bottom Sheet with clean read-only Host */}
      {contextOpen && (
        <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/75 backdrop-blur-sm p-3">
          <div className="w-full max-w-md rounded-2xl border border-[#26354c] bg-[#101827] p-5 shadow-2xl space-y-3.5 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2.5">
                <User className="h-5 w-5 text-[#36cdbd]" />
                <span className="text-base font-bold text-white">Prospect Tracking</span>
              </div>
              <button
                type="button"
                onClick={onContextOpen}
                className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-white/5 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <MobileField label="First name" value={prospectFirstName} onChange={onProspectFirstName} placeholder="e.g. Sarah" />
              <MobileField label="Last name" value={prospectLastName} onChange={onProspectLastName} placeholder="e.g. Miller" />
            </div>
            <MobileField label="Email" value={prospectEmail} onChange={onProspectEmail} placeholder="client@example.com" />
            
            {/* Host field - read-only without redundant badges */}
            <label className="mobile-field">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Tour Host</span>
              <input
                value={hostName}
                readOnly
                disabled
                className="mobile-input mt-1.5 text-base font-semibold opacity-85 cursor-default select-none"
              />
            </label>

            <button
              type="button"
              onClick={onContextOpen}
              className="w-full mt-2 py-3 rounded-xl bg-[#36cdbd] text-[#070b12] font-black text-sm hover:bg-[#43d9c7] transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* 4. Processing bar */}
      {submitting && (
        <div className="p-3 rounded-xl bg-white/[0.04] border border-[#36cdbd]/30 flex items-center justify-between shrink-0">
          <span className="text-sm font-bold text-[#36cdbd]">
            {processingMessages[processingIndex]}...
          </span>
          <div className="h-2 w-24 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-[#36cdbd]" />
          </div>
        </div>
      )}

      {/* 5. Anchored bottom submit bar (enlarged & more spaced out) */}
      <div className="shrink-0 pt-3 pb-1 flex items-center justify-between gap-3 border-t border-white/10">
        <div className="min-w-0">
          <p className="text-sm font-black text-white truncate">
            {canSubmit ? "Ready to submit" : "Add debrief to begin"}
          </p>
          <p className="text-xs text-slate-300 font-medium truncate">Zero follow-up forms.</p>
        </div>
        <button
          type="button"
          disabled={submitting || !canSubmit}
          onClick={onSubmit}
          className="mobile-primary-button px-6 py-3.5 rounded-xl text-base font-black disabled:opacity-40 disabled:cursor-not-allowed shrink-0 cursor-pointer flex items-center gap-2 shadow-lg shadow-teal-500/20"
        >
          <span>Submit debrief</span>
          <ArrowRight className="h-5 w-5" />
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
      <span className="text-xs font-bold uppercase tracking-wider text-slate-200">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mobile-input mt-1.5 text-base font-semibold"
      />
    </label>
  );
}

function AiConsentScreen({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="h-full min-h-0 flex-1 flex flex-col overflow-hidden">
      <header className="shrink-0 pt-1 pb-3">
        <p className="text-xs font-black uppercase tracking-wider text-teal-400">Utah City</p>
        <h1 className="mt-1 text-[1.65rem] font-black text-white tracking-tight leading-[1.1]">
          AI Voice &amp; Analysis Consent
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Please review how Utah City uses AI before recording or submitting a tour debrief.
        </p>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 pr-0.5 pb-3">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2.5">
          <p className="text-sm leading-relaxed text-slate-100">
            Utah City helps tour hosts capture visitor feedback in seconds. With your permission,
            we use automated artificial intelligence to turn spoken or typed debriefs into structured
            signals leadership can act on — without follow-up forms for hosts.
          </p>
          <p className="text-sm leading-relaxed text-slate-300">
            Consent is required before we process a voice recording or run AI analysis on a submitted
            debrief. You can revoke consent anytime from your account settings.
          </p>
        </section>

        <section className="space-y-2.5">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-white text-sm">
              <Mic className="h-4 w-4 text-[#43d9c7] shrink-0" />
              <span>Voice speech recognition</span>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">
              When you tap to speak, your microphone audio is transcribed into editable debrief notes.
              On supported devices this may run on-device; otherwise a secure transcription service is used.
              You can always type or edit the note before submitting.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-white text-sm">
              <Sparkles className="h-4 w-4 text-[#43d9c7] shrink-0" />
              <span>AI debrief analysis</span>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">
              After you submit, language models structure the note into objections, amenities, intent,
              sentiment, and related signals so leadership can prioritize product and experience improvements.
              Hosts are not asked blocking follow-up questionnaires.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-white text-sm">
              <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>Privacy &amp; encryption</span>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">
              Debrief content is handled as confidential operational data. It is encrypted in transit,
              never sold, and not used to train public foundation models. Access is limited to your
              Utah City workspace.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Policies &amp; help</p>
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => openExternalUrl("/privacy")}
              className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm font-bold text-[#43d9c7] hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <span>Privacy Policy</span>
              <ExternalLink className="h-4 w-4 shrink-0" />
            </button>
            <button
              type="button"
              onClick={() => openExternalUrl("/support")}
              className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm font-bold text-[#43d9c7] hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <span>Support</span>
              <ExternalLink className="h-4 w-4 shrink-0" />
            </button>
          </div>
        </section>
      </div>

      <footer className="shrink-0 border-t border-white/10 pt-3 pb-1 space-y-2.5">
        <button
          type="button"
          onClick={onAccept}
          className="mobile-primary-button w-full px-5 py-3.5 rounded-xl text-base font-black cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-teal-500/20"
        >
          <span>I Consent &amp; Continue</span>
          <ArrowRight className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="w-full px-5 py-3 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-bold text-slate-200 hover:bg-white/[0.07] transition-colors cursor-pointer"
        >
          Not now
        </button>
        <p className="text-center text-[11px] leading-relaxed text-slate-500 px-2">
          Choosing Not now returns you to capture. Recording and submit stay locked until you consent.
        </p>
      </footer>
    </div>
  );
}
