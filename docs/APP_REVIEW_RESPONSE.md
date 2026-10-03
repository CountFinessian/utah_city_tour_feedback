# App Store Review — Guideline 2.1

Paste **App Review Notes** into Resolution Center + App Review Information → Notes. Attach the screen recording. Sign-In Information = Host demo account.

**Credentials are not stored in this repo.** Copy emails/passwords from your private local file `docs/APP_REVIEW_RESPONSE.local.md` (gitignored) or from App Store Connect → App Review Information.

---

## App Review Notes (paste this — fill DEMO lines from your private local file)

```
Utah City Intelligence — internal tool for Utah City tour hosts.
Hosts capture a short post-tour debrief (voice or text). Leadership sees structured feedback. Invite-only; no public signup. No IAP/ads.

Production: https://www.utahcity.app
Privacy: https://www.utahcity.app/privacy

DEMO (same password for all three — paste from App Review Information / private notes)
• Host (use for Sign-In): <HOST_DEMO_EMAIL>
• Leadership: <LEADER_DEMO_EMAIL>
• Account deletion demo: <DELETE_DEMO_EMAIL>

HOW TO REVIEW
1. Sign in as Host. Accept AI consent if shown.
2. Type a short debrief → Submit debrief. Mic optional.
3. Profile (Account & AI Privacy) shows Delete Account.
4. Sign out → sign in as deletion demo → Delete Account → confirm → back to login.

iOS app is host capture. Leadership dashboards are desktop web (same credentials).
Screen recording on physical iPhone is attached.

Contact: support@utahcity.app
```

---

## Screen recording (~90–120s, physical iPhone)

Cold launch → Host login → consent if shown → type sample debrief → Submit → open Account & AI Privacy (show Delete, don’t delete Host) → Sign out → deletion demo account → Delete Account → login. Stop. Confirm TestFlight build matches the submitted binary.

Sample text: `Tour with the Millers. Loved the clubhouse. Concerned about HOA fees. Warm intent.`

---

## Checklist

- [ ] Sign-in credentials filled in App Store Connect (not committed to git)
- [ ] Notes pasted; recording attached
- [ ] Screenshots show real capture UI
- [ ] Host login, submit, deletion demo work on device
