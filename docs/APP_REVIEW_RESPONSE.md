# App Store Review — Guideline 2.1 Response Package

Use this for:
1. Your **Resolution Center reply** in App Store Connect (attach the screen recording)
2. **App Store Connect → App → App Review Information → Notes** (paste the same text for future submissions)
3. **Sign-In Information**: Host demo account below

---

## App Review Notes (paste this)

```
App name: Utah City Intelligence
Bundle ID: com.utahcity.host
Production web app (loaded by Capacitor): https://www.utahcity.app
Privacy Policy: https://www.utahcity.app/privacy
Support: https://www.utahcity.app/support

=== 1) SCREEN RECORDING ===
A screen recording captured on a physical iPhone running the latest iOS is attached to this reply. It begins with a cold launch of the app and demonstrates the typical Tour Host flow:
• Login with the Host demo account
• Full-screen AI Voice & Analysis Consent (Accept)
• Typed (and/or voice) tour debrief capture → Submit debrief
• Account & AI Privacy screen (shows Delete Account control)
• Sign out → Login as the Account Deletion demo account → complete in-app account deletion → return to login
Optional: Leadership demo account briefly shows that leadership surfaces exist on desktop; the iOS app is intentionally capture-focused for hosts.

=== 2) PURPOSE AND TARGET AUDIENCE ===
Utah City Intelligence is an internal operational tool for Utah City community tour hosts (field ambassadors) and leadership.

Problem: After each prospect tour, verbal feedback (objections, amenity reactions, intent, questions) is lost. Leadership cannot see patterns across hosts.

Value: Hosts capture a short post-tour debrief by voice or text. The system structures that feedback into actionable leadership intelligence (objections, amenities, intent, sentiment) without forcing hosts to complete long follow-up forms.

Target audience: Authorized Utah City / partner tour hosts and leadership staff only. Accounts are invite-provisioned by administrators. There is no public self-registration and no consumer marketplace.

=== 3) SETUP / ACCESS INSTRUCTIONS ===
1. Install the submitted build (TestFlight / App Review binary).
2. Launch the app. Network access is required (Capacitor loads https://www.utahcity.app).
3. Sign in with a demo account below. Microphone permission is optional — typing a debrief works without mic.
4. If the AI consent screen appears, tap “I Consent & Continue” (required before recording or submitting). “Not now” returns to capture with recording/submit locked until consent.
5. Main host flow:
   a. Optional: Client details in CRM logging → attach prospect name/email
   b. Tap “Tap to speak debrief” OR type into Debrief notes
   c. Tap “Submit debrief”
6. Account deletion (required demo):
   a. Sign out of the primary Host account
   b. Sign in as delete.test@utahcity.com
   c. Tap the profile name (Account & AI Privacy) → Delete Account → confirm
   d. App returns to login after deletion
7. Leadership (optional): Sign in as appreview.leader@utahcity.com. On iPhone the app keeps hosts on the capture surface; leadership Command/Evidence dashboards are desktop web surfaces at https://www.utahcity.app/command (same credentials).

DEMO ACCOUNTS (same password for all three):

HOST — use this in App Review Information → Sign-In Information:
• Email: appreview@utahcity.com
• Password: UtahCityReview2026!

LEADERSHIP — second role type:
• Email: appreview.leader@utahcity.com
• Password: UtahCityReview2026!

ACCOUNT DELETION DEMO — use only to demonstrate deletion (do not use as primary Sign-In):
• Email: delete.test@utahcity.com
• Password: UtahCityReview2026!

No sample files are required.

=== 4) EXTERNAL SERVICES / PLATFORMS ===
• Hosting / web runtime: Vercel (Next.js), loaded inside a Capacitor iOS shell
• Database: Neon PostgreSQL
• Authentication: first-party email/password (PBKDF2 hashes, HMAC session cookies) — not Sign in with Apple / third-party OAuth
• Email (invites, password reset, support relay): Resend
• AI structuring of debriefs / analyst answers: Google Gemini and/or Anthropic Claude via Vercel AI SDK (deterministic heuristic fallback if AI is unavailable)
• Speech-to-text: on-device Whisper (transformers.js / WASM) by default; optional cloud ASR when configured
• Native shell: Capacitor iOS (com.utahcity.host)

No payment processors. No In-App Purchases. No advertising SDKs.

=== 5) REGIONAL DIFFERENCES ===
The app functions consistently across all regions. There are no region-locked features, geo-priced catalogs, or localized paid content. UI and content are English and intended for Utah City operations staff.

=== 6) REGULATED INDUSTRY / PROTECTED MATERIAL ===
This is not a medical, banking, gambling, or similarly regulated consumer app. It does not redistribute protected third-party media catalogs. It is a private B2B operations tool for authorized staff. Prospect contact fields entered by hosts are internal CRM-style notes for follow-up, governed by our Privacy Policy at https://www.utahcity.app/privacy.

=== ADDITIONAL CLARIFICATIONS ===
• Account creation: invite-only by administrators (email invite → setup-account link). No open public registration.
• Account deletion: available in-app under Account & AI Privacy (Guideline 5.1.1(v)).
• User-generated content: debriefs are internal workplace records for authorized leadership — not a public social network. There is no public feed, comments, DMs, or stranger-to-stranger UGC requiring social report/block UX.
• Paid content / IAP: none.
• Business model: B2B operational tool for a specific organization (Utah City). App Store distribution with invite-only access for authorized employees/contractors.
• AI disclosure: Explicit full-screen AI Voice & Analysis Consent before voice recording or AI analysis of submitted debriefs (Guideline 5.1.2(i)).

Contact for review questions: support@utahcity.app / privacy@utahcity.app
```

---

## Screen recording script (physical iPhone, latest iOS)

Record with **iOS Screen Recording** (Control Center). Start **before** launching the app. Target **90–150 seconds**, continuous, no cuts.

1. Home Screen → tap **Utah City Intelligence** (cold launch).
2. Login → `appreview@utahcity.com` / `UtahCityReview2026!`
3. If **AI Voice & Analysis Consent** appears → scroll briefly to show content → tap **I Consent & Continue**.
4. Capture screen: type a short sample debrief, e.g.  
   `Tour with the Millers. Loved the clubhouse and trails. Concerned about HOA fees and commute. Warm intent.`
5. Optional: open **Client details in CRM logging** → add a first name → Done.
6. Tap **Submit debrief** → wait for success confirmation.
7. Tap profile name (**Account & AI Privacy**) → show AI consent status + **Delete Account** control (**do not delete** the primary Host account).
8. Close modal → Sign out.
9. Sign in as `delete.test@utahcity.com` / `UtahCityReview2026!`
10. Account & AI Privacy → **Delete Account** → confirm → land on login.
11. Stop recording. Attach to Resolution Center reply; keep a local copy.

Tips:
- Use the **exact build number** submitted for review (confirm in TestFlight).
- Typing alone is enough if you skip mic; if you demo voice, grant Microphone when prompted.
- Do not use personal staff accounts.
- Keep the phone unlocked; avoid Reduce Motion glitches if animations look broken.

---

## App Store Connect checklist before / during reply

### App Review Information
- [ ] Sign-in required: **Yes**
- [ ] User name: `appreview@utahcity.com`
- [ ] Password: `UtahCityReview2026!`
- [ ] Notes: paste the full **App Review Notes** block above
- [ ] Contact email/phone reachable during review

### Metadata (Guideline 2.3.3)
- [ ] Screenshots show real in-app capture / debrief UI — not only splash or login
- [ ] Screenshots match the current UI (full-screen consent, capture chrome)

### Physical-device QA (Guideline 2.1)
- [ ] Cold launch on current iOS
- [ ] Host + Leader demo logins work
- [ ] Typed debrief submits on Wi-Fi and cellular
- [ ] Microphone prompt uses correct `NSMicrophoneUsageDescription` (if voice demo)
- [ ] Full-screen AI consent → Accept unlocks record/submit; Not now returns to capture
- [ ] Account deletion works on `delete.test@utahcity.com`
- [ ] Privacy + Support links open (Safari / system browser)
- [ ] Background / foreground does not crash
- [ ] Submitted binary build number matches TestFlight install

### Guideline 3.2 (if Apple asks about employee-only apps)
Reply that access is **invite-only** for authorized Utah City hosts and that you can move to **Unlisted App Distribution** if they require it. Emphasize operational purpose + demo credentials already provided.

### What you must do manually
1. Capture the physical-device screen recording (script above).
2. Reply in Resolution Center with the Notes text + attach the recording.
3. Paste the same Notes into App Review Information → Notes.
4. Confirm Sign-In Information uses the Host demo account.
5. Resubmit only after Notes + recording are attached (if Apple asked you to resubmit).

---

## Credential security
These passwords are for App Review only. Rotate after approval if desired. Do not put personal Greystar / staff passwords in App Review fields.
