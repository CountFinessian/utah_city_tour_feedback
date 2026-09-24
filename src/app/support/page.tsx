import Link from "next/link";
import { HelpCircle, ArrowLeft, Mail, Mic, KeyRound, Smartphone, ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Support — Utah City Tour Host",
  description: "Official support and help center for the Utah City Tour Host mobile application.",
};

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-[#070b12] text-slate-200 antialiased selection:bg-[#43d9c7]/20 selection:text-[#43d9c7]">
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to App</span>
            </Link>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-[#43d9c7]" />
              <span className="text-sm font-bold text-white tracking-tight">Utah City</span>
            </div>
          </div>
          <span className="text-xs text-slate-400">Host Help Center</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12 space-y-10">
        <div>
          <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#43d9c7]">Help & Assistance</p>
          <h1 className="text-3xl font-black text-white tracking-tight mt-1">Utah City Tour Host Support</h1>
          <p className="text-sm text-slate-400 mt-2 max-w-2xl leading-relaxed">
            Welcome to the official support hub for authorized ambassadors and tour guides using the Utah City Tour Host mobile application.
          </p>
        </div>

        {/* Contact Banner */}
        <div className="p-6 rounded-2xl bg-gradient-to-r from-emerald-950/40 to-teal-950/20 border border-[#43d9c7]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white">Need immediate assistance?</h2>
            <p className="text-xs text-slate-300 mt-1">Our technical and community team is ready to assist you.</p>
          </div>
          <a
            href="mailto:support@utahcity.app"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#43d9c7] hover:bg-[#36cdbd] text-slate-900 font-bold text-xs transition-colors shrink-0"
          >
            <Mail className="h-4 w-4" />
            <span>Email support@utahcity.app</span>
          </a>
        </div>

        {/* Common Help Topics */}
        <div className="space-y-6">
          <h2 className="text-lg font-bold text-white tracking-tight">Frequently Asked Questions</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl border border-white/10 bg-white/[0.02] space-y-2">
              <div className="flex items-center gap-2 text-[#43d9c7]">
                <KeyRound className="h-4 w-4" />
                <h3 className="text-sm font-bold text-white">How do I get an account?</h3>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Tour Host accounts are provisioned by Utah City leadership. If you are an active community ambassador, contact your team administrator or email{" "}
                <a href="mailto:support@utahcity.app" className="text-[#43d9c7] hover:underline">support@utahcity.app</a> to have an account setup invitation link sent to your email.
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-white/10 bg-white/[0.02] space-y-2">
              <div className="flex items-center gap-2 text-[#43d9c7]">
                <KeyRound className="h-4 w-4" />
                <h3 className="text-sm font-bold text-white">Forgot your password?</h3>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                You can easily reset your password by going to the{" "}
                <Link href="/login" className="text-[#43d9c7] hover:underline font-semibold">Sign In page</Link> and tapping <em>&quot;Forgot password?&quot;</em>. Enter your email and a secure reset link will be sent to you.
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-white/10 bg-white/[0.02] space-y-2">
              <div className="flex items-center gap-2 text-[#43d9c7]">
                <Mic className="h-4 w-4" />
                <h3 className="text-sm font-bold text-white">Microphone permission denied?</h3>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                If the app cannot access your microphone, open your iPhone <strong>Settings</strong> &rarr; scroll down to <strong>Utah City</strong> &rarr; toggle <strong>Microphone</strong> to ON. You can also type your recap manually into the debrief field at any time.
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-white/10 bg-white/[0.02] space-y-2">
              <div className="flex items-center gap-2 text-[#43d9c7]">
                <Smartphone className="h-4 w-4" />
                <h3 className="text-sm font-bold text-white">Offline or poor network?</h3>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                If cellular connectivity drops during a walking tour, your typed notes and debrief text remain preserved in the editor. Once you reconnect to Wi-Fi or LTE, tap <strong>Submit debrief</strong> to upload.
              </p>
            </div>
          </div>
        </div>

        {/* Security & Data Section */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#43d9c7]" />
            <h2 className="text-base font-bold text-white">Data Privacy & Account Rights</h2>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Your privacy is our priority. Audio recordings are solely used to transcribe tour recaps and are not shared with advertisers. To request account deletion or data review, see our{" "}
            <Link href="/privacy" className="text-[#43d9c7] hover:underline font-semibold">
              Privacy Policy
            </Link>{" "}
            or contact <a href="mailto:privacy@utahcity.app" className="text-[#43d9c7] hover:underline">privacy@utahcity.app</a>.
          </p>
        </section>

        <div className="pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>&copy; {new Date().getFullYear()} Utah City. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="text-slate-400 hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <Link href="/login" className="text-slate-400 hover:text-white transition-colors">
              Sign In
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

