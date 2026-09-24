import Link from "next/link";
import { ShieldCheck, ArrowLeft, Mail } from "lucide-react";

export const metadata = {
  title: "Privacy Policy — Utah City Tour Host",
  description: "Privacy Policy for the Utah City Tour Host mobile application and web platform.",
};

export default function PrivacyPolicyPage() {
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
              <span>Back</span>
            </Link>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#43d9c7]" />
              <span className="text-sm font-bold text-white tracking-tight">Utah City</span>
            </div>
          </div>
          <span className="text-xs text-slate-400">Effective: September 2026</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12 space-y-8">
        <div>
          <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#43d9c7]">Legal & Compliance</p>
          <h1 className="text-3xl font-black text-white tracking-tight mt-1">Privacy Policy</h1>
          <p className="text-sm text-slate-400 mt-2">
            This Privacy Policy describes how Utah City (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) collects, uses, and protects information when you use the <strong>Utah City Tour Host</strong> mobile application and related web services.
          </p>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">1. Information We Collect</h2>
          <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
            <p>
              <strong className="text-white">a. Account Information:</strong> When an account is provisioned for you as an authorized tour host or ambassador, we collect your name, email address, role, and professional title.
            </p>
            <p>
              <strong className="text-white">b. Voice & Audio Data:</strong> When you choose to dictate a tour debrief by tapping the microphone icon, the application accesses your device microphone to record spoken notes. The audio data is processed via automated speech-to-text models solely to generate an editable transcript of your recap.
            </p>
            <p>
              <strong className="text-white">c. Debrief Notes & Prospect Information:</strong> You may optionally input tour feedback, prospect first and last names, and email addresses to log interactions into the community intelligence corpus.
            </p>
            <p>
              <strong className="text-white">d. Device & Technical Data:</strong> We may collect standard operational logs such as device type, operating system version, and error diagnostics to maintain system reliability.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">2. How We Use Your Information</h2>
          <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
            <p>We use the collected information exclusively for legitimate business and operational purposes:</p>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-300">
              <li>To transcribe spoken voice debriefs into editable text notes.</li>
              <li>To extract structured tour insights (e.g. amenity feedback, sentiment, objections) for Utah City development planning.</li>
              <li>To authenticate authorized hosts and secure the application against unauthorized access.</li>
              <li>To maintain, troubleshoot, and enhance application performance.</li>
            </ul>
            <p className="pt-2 font-medium text-[#43d9c7]">
              We do NOT sell, rent, or trade your personal information or audio recordings to third-party data brokers, marketers, or advertisers.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">3. Third-Party Service Providers</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            We work with trusted infrastructure providers to deliver our services, including cloud hosting, secure database management (Neon PostgreSQL), and enterprise speech recognition / language modeling APIs. All service providers are bound by strict confidentiality and data protection obligations.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">4. Data Security & Retention</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            We implement administrative, technical, and physical safeguards designed to protect personal information from unauthorized access, loss, or misuse. All network communication between the app and our servers is encrypted in transit using industry-standard TLS/HTTPS protocols.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">5. Your Rights & Account Deletion</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            In compliance with Apple App Store Review Guidelines and applicable privacy laws, users have the right to request access to, correction of, or complete deletion of their account and associated data.
          </p>
          <p className="text-sm text-slate-300 leading-relaxed">
            To request deletion of your host account or any debrief records associated with your email, contact our administrator team at{" "}
            <a href="mailto:privacy@utahcity.app" className="text-[#43d9c7] underline underline-offset-4 hover:text-white">
              privacy@utahcity.app
            </a>. Requests are processed within 30 days.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">6. Contact Us</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            If you have questions or concerns regarding this Privacy Policy or data practices, please reach out to:
          </p>
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 text-xs space-y-1">
            <p className="font-bold text-white">Utah City Development Team</p>
            <p className="text-slate-400 flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-[#43d9c7]" />
              <span>Email: privacy@utahcity.app</span>
            </p>
            <p className="text-slate-400">Support: support@utahcity.app</p>
          </div>
        </section>

        <div className="pt-6 border-t border-white/10 flex items-center justify-between text-xs text-slate-500">
          <p>&copy; {new Date().getFullYear()} Utah City. All rights reserved.</p>
          <Link href="/support" className="text-slate-400 hover:text-white transition-colors">
            Support Center &rarr;
          </Link>
        </div>
      </main>
    </div>
  );
}
