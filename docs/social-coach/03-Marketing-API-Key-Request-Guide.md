# Getting Utah City's social API keys: meeting guide

**For:** Jacob, meeting with the Utah City marketing manager
**Shareable step-by-step guide for Utah City:** https://claude.ai/code/artifact/8380304a-e896-4b69-8166-17918fdcbbc9
**Goal:** Leave the meeting with read-only API access to all six official accounts, tested live in the app.

| Network | Official account | Where the keys go in our app |
|---|---|---|
| TikTok | [@utahcityutah](https://www.tiktok.com/@utahcityutah) | Settings → Official account connections → **TikTok** |
| Instagram | [@utahcityutah](https://www.instagram.com/utahcityutah/) | → **Facebook & Instagram** (one Meta setup covers both) |
| Facebook | [utahcityutah](https://www.facebook.com/utahcityutah/) | → **Facebook & Instagram** |
| YouTube | [@UtahCity](https://www.youtube.com/@UtahCity) | → **YouTube** |
| X | [@utahcityutah](https://x.com/utahcityutah) | → **X** (about $0.001 per post read, roughly $3 for the full history) |
| LinkedIn | [utah-city](https://www.linkedin.com/company/utah-city/) | → **LinkedIn** |

---

## 1. The 60-second pitch (say this first)

> "We want to look back at your past campaigns and see exactly what worked and where posts fell short, then score new posts across every platform as soon as they go live. Over time, that lets us predict how a video will do before you post it.
>
> To do that we need **read-only** analytics access to the official accounts. We can't post, edit, delete, or send messages. You stay the owner, and you can revoke access any time from each platform's settings. The keys are stored encrypted and only leadership can see the connection page."

**Points that tend to make a manager comfortable:**
- **Read-only.** Every permission we ask for is a read or analytics scope. None of them allows posting.
- **Revocable.** They can cut access in one click on each platform, with no change needed on our side.
- **No passwords.** We never ask for anyone's login. For TikTok, YouTube and LinkedIn, *their* account owner clicks "Authorize" on the platform's own page.
- **Encrypted and access-controlled.** Keys are encrypted at rest, never shown again after saving, and the page is leaders-only.

## 2. What to ask for, in plain words

> "Could you or whoever manages your developer and business accounts create a **read-only app** for each platform and send me the credentials below? For three of them, the account owner just has to click one approval link that I'll send."

### Quick checklist to hand over

| Platform | What they send you | What they do once |
|---|---|---|
| **TikTok** | Client Key, Client Secret | Account owner clicks our connect link and approves |
| **YouTube** | Client ID, Client Secret | Channel owner clicks our connect link and approves |
| **LinkedIn** | Client ID, Primary Client Secret | A Page **super admin** clicks our connect link and approves |
| **Facebook + Instagram** | App ID, App Secret, System-user token, Facebook Page ID | Nothing more |

**Priority:** TikTok and Meta (Facebook + Instagram) matter most. Get those even if the others wait. X is cheap: about $0.001 per post read. It needs API Key, API Secret, Access Token and Access Token Secret, all generated while signed in as @utahcityutah.

**Return link (redirect URI)** they must register on TikTok, YouTube and LinkedIn. It must match exactly:
```
https://www.utahcity.app/api/owned-social/callback/tiktok
https://www.utahcity.app/api/owned-social/callback/youtube
https://www.utahcity.app/api/owned-social/callback/linkedin
```
These are also shown on our Settings page under each platform card.

## 3. Platform-by-platform setup (for whoever creates the apps)

### TikTok
1. Go to **developers.tiktok.com**, sign in as Utah City, and create an app.
2. Add the **Login Kit** and **Display API** products.
3. Request these scopes: `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`.
4. Add the TikTok return link above.
5. Submit for review. **This can take several days**, so start it today. Sandbox mode works sooner if @utahcityutah is added as a sandbox target user.
6. Send: **Client Key** and **Client Secret**.

### YouTube (Google)
1. In **console.cloud.google.com**, create a project, for example "Utah City Analytics".
2. Enable **YouTube Data API v3** and **YouTube Analytics API**.
3. Set up the OAuth consent screen (External) and **publish it to Production**.
   ⚠️ If it stays in "Testing", Google expires the approval after 7 days and we'd have to keep re-asking.
4. Create credentials: **OAuth client ID** of type **Web application**, and add the YouTube return link above.
5. Send: **Client ID** and **Client Secret**.
6. Whoever owns the @UtahCity channel (often a Brand Account) clicks our connect link.

### LinkedIn
1. In **linkedin.com/developers**, create an app and associate it with the **Utah City** company page. A Page admin has to verify the association.
2. Request the **Community Management API** product. LinkedIn reviews this, so expect a wait.
3. Add the LinkedIn return link above.
4. Send: **Client ID** and **Primary Client Secret**.
5. A Page **super admin** clicks our connect link.
   Note: LinkedIn makes most apps re-approve every ~60 days. Our app flags this ahead of time on the Settings page.

### Facebook + Instagram (Meta)
1. Make sure Instagram @utahcityutah is a **Professional (Business or Creator) account linked to the Utah City Facebook Page**. Without that link we can't read Instagram.
2. In **developers.facebook.com**, create an app of type **Business**.
3. In **Meta Business Suite → Business settings → Users → System users**:
   - Create a system user.
   - **Assign assets:** the Utah City Page **and** the Instagram account (read/insights access).
   - Generate a token for the app with these permissions: `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights`. Set expiry to **Never**.
4. Find the **Page ID** (a number) under Page → About → Page transparency, or in Business settings → Pages.
5. Send: **App ID**, **App Secret**, **System-user token**, **Page ID**.

### X
See the shared setup guide (link at the top). In short: sign in to the X Developer Console as @utahcityutah, add a small prepaid credit, set the app to Read, and generate the API Key/Secret plus the Access Token/Secret.

## 4. How they should send the keys

**Best:** Jacklyn Briggs already has a leader login. On a computer she signs in at www.utahcity.app, opens **Settings → Official account connections**, pastes the keys and clicks **Authorize** herself, so there's nothing to email. **Email also works:** if keys are emailed instead, follow the steps below.

When they arrive:
1. Paste each one into Settings → Official account connections, then click **Save**.
2. Click **Test keys** to confirm each one works.
3. Delete the email (and empty Deleted Items) once everything shows ✓ Working, so the keys don't sit in your inbox.

## 5. During the meeting: confirm it works live

For each platform:
1. Paste the keys and click **Save**.
2. For TikTok, YouTube and LinkedIn, click **Create connect link** and send it to the account owner, who approves it. This can happen right there in the room.
3. Click **Test keys**. A working connection shows:
   - **✓ Working**, the account found (for example @utahcityutah), its follower count, and up to 5 recent posts with views and likes.
   - If you see **"Connected to @X, expected @utahcityutah"**, the wrong account approved. Disconnect and send a new link to the right person.
   - A red **✗ Problem** comes with a plain-English hint, for example "key was rejected, re-check it was copied completely" or "missing permission".

## 6. Questions they may ask

| Question | Answer |
|---|---|
| "Can you post as us?" | No. Only read and analytics scopes are requested, and the platforms enforce that. |
| "How do we revoke it?" | Remove the app from each platform's connected-apps or Business settings. Our side stops working immediately. |
| "Who sees this data?" | Only Utah City leadership accounts in the app. |
| "How far back can you see?" | It varies by platform. YouTube Analytics covers the full channel history. Instagram and Facebook cover posts from the business account, with richer insights for roughly the last two years. TikTok returns all public videos with lifetime view, like, comment and share counts. |
| "Does it cost us anything?" | Only X: about $0.001 per post read, prepaid (roughly $3 for the full history). Everything else is free. |

## 7. After the meeting: your follow-ups

- [ ] Chase the TikTok and LinkedIn app reviews, which are the slowest step.
- [ ] Confirm the YouTube consent screen is published to Production (otherwise the 7-day expiry applies).
- [ ] Once a card shows ✓ Working, click **Run backfill now** on it to pull that account's full post history. After that, the daily job keeps it current.
