import Link from "next/link";
import { FileText, ArrowLeft, Mail, ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Terms of Service — Utah City Tour Host",
  description: "Terms of Service and Conditions of Use for the Utah City Tour Host mobile application and leadership intelligence platform.",
};

export default function TermsOfServicePage() {
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
              <FileText className="h-4 w-4 text-[#43d9c7]" />
              <span className="text-sm font-bold text-white tracking-tight">Utah City</span>
            </div>
          </div>
          <span className="text-xs text-slate-400">Effective: October 2026</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12 space-y-8">
        <div>
          <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#43d9c7]">Legal & Compliance</p>
          <h1 className="text-3xl font-black text-white tracking-tight mt-1">Terms of Service</h1>
          <p className="text-sm text-slate-400 mt-2">
            These Terms of Service (&quot;Terms&quot;) govern your access to and use of the <strong>Utah City Tour Host</strong> mobile application, leadership intelligence platform, and related web services provided by Utah City (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;).
          </p>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">1. Acceptance of Terms</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            By creating an account, signing in, accessing, or using the Utah City Tour Host platform (the &quot;Service&quot;), you agree to be legally bound by these Terms and our{" "}
            <Link href="/privacy" className="text-[#43d9c7] underline underline-offset-4 hover:text-white">
              Privacy Policy
            </Link>
            . If you do not agree to all of these Terms, you may not access or use the Service.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">2. Eligibility & Authorized Access</h2>
          <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
            <p>
              The Service is an enterprise operational tool designed exclusively for authorized Utah City tour guides, brand ambassadors, operational staff, and leadership personnel.
            </p>
            <p>
              <strong className="text-white">Account Security:</strong> Accounts are provisioned by Utah City administrators. You are responsible for safeguarding your login credentials and are solely accountable for any activity occurring under your account. You must notify us immediately at{" "}
              <a href="mailto:support@utahcity.app" className="text-[#43d9c7] underline underline-offset-4 hover:text-white">
                support@utahcity.app
              </a>{" "}
              if you discover or suspect unauthorized access to your credentials.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">3. Permitted Use & User Obligations</h2>
          <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
            <p>You agree to use the Service strictly in compliance with applicable local, state, and federal laws. In using the Service, you agree that you will not:</p>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-300">
              <li>Submit fraudulent, deceptive, intentionally inaccurate, or defamatory tour debriefs or feedback.</li>
              <li>Reverse engineer, decompile, disassemble, or attempt to derive the source code of any portion of the platform.</li>
              <li>Circumvent or attempt to bypass role-based access controls, security tokens, or administrative boundaries.</li>
              <li>Interfere with or disrupt the integrity or performance of the platform, hosting infrastructure, or connected databases.</li>
              <li>Scrape, harvest, or export confidential community feedback or leadership reports without written authorization.</li>
            </ul>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">4. Voice Dictation & AI Processing</h2>
          <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
            <p>
              The Service offers automated voice transcription and language model intelligence features to help tour hosts quickly record observations and extract structured community feedback.
            </p>
            <p>
              When utilizing microphone recording features, you confirm that spoken recaps are your own professional debriefs or that you have obtained necessary consent from individuals whose statements are captured.
            </p>
            <p>
              <strong className="text-white">Advisory Nature of AI Outputs:</strong> Automated summaries, sentiment scores, and theme classifications are generated by machine intelligence to assist human decision-making. They do not constitute official architecture, zoning, or legal representations of Utah City.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">5. Intellectual Property Rights</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            All rights, title, and interest in and to the Service—including software, UI components, branding, logos, trademarks, and synthesized analytics—are and will remain the exclusive property of Utah City and its licensors. Submitting debriefs or tour observations grants Utah City a perpetual, worldwide, irrevocable right to use, aggregate, analyze, and incorporate such feedback into the Utah City master plan and operations.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">6. Data Privacy & Account Deletion</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Our data practices are detailed in our{" "}
            <Link href="/privacy" className="text-[#43d9c7] underline underline-offset-4 hover:text-white">
              Privacy Policy
            </Link>
            . In accordance with platform standards, authorized users may request deletion of their account and associated personal data at any time via in-app settings or by emailing{" "}
            <a href="mailto:privacy@utahcity.app" className="text-[#43d9c7] underline underline-offset-4 hover:text-white">
              privacy@utahcity.app
            </a>
            .
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">7. Suspension & Termination</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Utah City reserves the right to suspend or terminate your access to the Service at any time, with or without cause or notice, including upon conclusion of your ambassadorship, violation of these Terms, or for administrative security reasons. Upon termination, your authorization to use the application terminates immediately.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">8. Disclaimer of Warranties</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            THE SERVICE IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; BASIS WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF HARMFUL COMPONENTS.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">9. Limitation of Liability</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            TO THE FULLEST EXTENT PERMITTED BY LAW, IN NO EVENT SHALL UTAH CITY, ITS DEVELOPERS, AFFILIATES, OFFICERS, OR DIRECTORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF OR INABILITY TO USE THE SERVICE.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">10. Governing Law & Dispute Resolution</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            These Terms shall be governed by and construed in accordance with the laws of the State of Utah, without giving effect to any principles of conflicts of law. Any legal dispute or proceeding arising under these Terms shall be resolved exclusively in the state or federal courts located in Utah County or Salt Lake County, Utah.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">11. Modifications to Terms</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            We may modify these Terms at any time by posting the revised version on the platform. The &quot;Effective&quot; date at the top indicates when the latest modifications occurred. Your continued use of the Service following such updates signifies your agreement to the modified Terms.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">12. Contact Information</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            If you have questions, comments, or legal notices concerning these Terms of Service, please contact our team:
          </p>
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 text-xs space-y-1">
            <p className="font-bold text-white">Utah City Legal & Operations</p>
            <p className="text-slate-400 flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-[#43d9c7]" />
              <span>Legal: legal@utahcity.app</span>
            </p>
            <p className="text-slate-400">Support: support@utahcity.app</p>
            <p className="text-slate-400">Privacy: privacy@utahcity.app</p>
          </div>
        </section>

        <div className="pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>&copy; {new Date().getFullYear()} Utah City. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="text-slate-400 hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <Link href="/support" className="text-slate-400 hover:text-white transition-colors">
              Support Center
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

