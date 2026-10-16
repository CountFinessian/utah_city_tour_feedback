# Utah City Social Accounts — Connection Setup Guide

_Last updated Oct 16, 2026 · Jacob Williams_

## How it works

Utah City gives the Host Intelligence app **read-only** access to its official social accounts. That lets us back-test past campaigns and score new posts as soon as they go live. We can't post, edit, delete or message on any account.

You won't need to email any keys. On a **computer**, sign in at [www.utahcity.app](https://www.utahcity.app) with your Utah City account and open **Social Accounts** in the side menu. Everything happens on that page, and this guide is there too. (On a phone, the app opens the capture screen instead.)

1. **Create a read-only app** on each platform's developer site (steps below).
2. **Register our return link** on TikTok, YouTube and LinkedIn. It's shown on the Social Accounts page with a Copy button.
3. **Paste the keys** into the Social Accounts page and click Save. They're encrypted immediately, and nobody can view them again, including us.
4. **Click Authorize** (TikTok, YouTube, LinkedIn only). Sign in as the official Utah City account and approve.
5. **Click Test keys.** A green "Working" confirms the right account is connected.

After that, nothing else is needed from you. Connections renew themselves every day, and post history and metrics load automatically.

## Checklist

TikTok and Meta (Facebook + Instagram) matter most, so start with those. Start the TikTok and LinkedIn apps first, because those platforms review apps before granting access, which can take days.

| Priority | Platform | Official account | What you paste on the Social Accounts page | Authorize click? | Cost |
| --- | --- | --- | --- | --- | --- |
| 1 | TikTok | [@utahcityutah](https://www.tiktok.com/@utahcityutah) | Client Key, Client Secret | Yes | Free |
| 1 | Facebook + Instagram | [Facebook](https://www.facebook.com/utahcityutah/) · [Instagram](https://www.instagram.com/utahcityutah/) | System-user token (Page ID optional) | No | Free |
| 2 | YouTube | [@UtahCity](https://www.youtube.com/@UtahCity) | Client ID, Client Secret | Yes | Free |
| 2 | X | [@utahcityutah](https://x.com/utahcityutah) | API Key, API Secret, Access Token, Access Token Secret | No | About $0.001 per post read, prepaid |
| 3 | LinkedIn | [utah-city](https://www.linkedin.com/company/utah-city/) | Client ID, Primary Client Secret | Yes | Free |

## Return links and connect links

These are two different links, and you'll deal with both:

- **Connect link (also called the Authorize button):** the link the *account owner clicks* to start approving access. It takes them to TikTok's, Google's or LinkedIn's own sign-in page. On the Social Accounts page it's the **Authorize** button. Jacob can also email one directly to whoever owns the account.
- **Return link (the "redirect URI"):** the address the *platform sends the owner back to* after they click Allow. It carries a one-time approval code that our app swaps for the access key. Nobody clicks it; you only register it once in each platform's developer settings.

The flow: owner clicks **Authorize** → platform sign-in page → owner clicks **Allow** → the platform sends them to the **return link** → our app saves the key → "Connected".

**Why it must match exactly:** platforms only send approval codes to addresses registered in advance, so nobody can intercept them. The comparison is character for character. A missing `www`, `http` instead of `https`, or an extra `/` at the end all count as a different address, and the owner gets a "redirect_uri mismatch" error right after clicking Allow. Use the Copy button on the Social Accounts page rather than retyping.

| Platform | Paste exactly this | Where it goes |
| --- | --- | --- |
| TikTok | `https://www.utahcity.app/api/owned-social/callback/tiktok` | [TikTok for Developers](https://developers.tiktok.com/) → your app → **Login Kit** → **Redirect URI** → Save |
| YouTube | `https://www.utahcity.app/api/owned-social/callback/youtube` | [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → **Credentials** → your OAuth client → **Authorized redirect URIs** → Add URI → Save |
| LinkedIn | `https://www.utahcity.app/api/owned-social/callback/linkedin` | [LinkedIn Developers](https://www.linkedin.com/developers/apps) → your app → **Auth** tab → **Authorized redirect URLs for your app** → Add → Update |

Facebook + Instagram and X don't use a return link.

## TikTok

**You don't have to wait for review to get the keys.** The Client Key and Client Secret appear as soon as you create the app. What review controls is whether the app can be used with real accounts. Until it's approved, you can use **Sandbox** mode with a test account.

1. Go to [TikTok for Developers](https://developers.tiktok.com/), sign in, and click **Manage apps → Connect an app**. Name it something like "Utah City Analytics".
2. Fill in the app details by pasting these three links:
   - Website:

     ```
     https://www.utahcity.app
     ```
   - Terms of Service:

     ```
     https://www.utahcity.app/terms
     ```
   - Privacy Policy:

     ```
     https://www.utahcity.app/privacy
     ```
3. **Verify the utahcity.app domain.** TikTok won't review the app until you do.
   - In the app, open **URL properties → Add URL property**, choose **Domain**, and enter `utahcity.app`. TikTok shows a verification string. Copy it.
   - Jacob adds it at Namecheap, which hosts utahcity.app's DNS: **Domain List → utahcity.app → Manage → Advanced DNS → Add New Record**.
   - Type: **TXT Record**. Host: `@`. Value: paste TikTok's string. TTL: **Automatic**. Click the green check to save.
   - Wait 5 to 30 minutes, then click **Verify** in TikTok.
4. Click **Add products** and add **Login Kit** and **Display API**.
5. Under **Scopes**, tick `user.info.basic`, `user.info.profile`, `user.info.stats` and `video.list`. These are all read-only.
6. Go to **Login Kit → Redirect URI** and paste this return link exactly, then click **Save**:

   ```
   https://www.utahcity.app/api/owned-social/callback/tiktok
   ```
7. **Try it in Sandbox.** Switch the app to **Sandbox** and add a TikTok account you own under **Target users**. Jacob's own account is fine. Paste the *Sandbox* Client Key and Secret into the **Social Accounts** page in the Utah City app, then click **Authorize**.
8. **Record the demo video** using the script below.
9. **Submit.** Switch the app back to **Production**, and in the **App review** section write one sentence per product and permission. For example: "`video.list`: reads our own videos' view and like counts for campaign analytics." Upload the video and click **Submit for review**. Approval often takes a few days to two weeks.
10. **After approval:** paste the *Production* Client Key and Secret into the TikTok card on **Social Accounts**. Click **Authorize** and sign in as @utahcityutah. Sandbox and production keys are different.

**The demo video.** Yes: it's a screen recording of the data being pulled into the app. It must happen on the real site, www.utahcity.app, and every permission has to visibly appear. Keep it to about two minutes and under 50 MB:

1. Open www.utahcity.app, sign in, and go to **Social Accounts**.
2. On the TikTok card, show the Sandbox Client Key is saved, then click **Authorize**.
3. On TikTok's screen, show the permission list and click **Allow**.
4. Back in the app, show the card reading **Connected** with the account name. This demonstrates `user.info.basic` and `user.info.profile`.
5. Click **Test keys**. Show the follower count (`user.info.stats`) and recent videos with views and likes (`video.list`).
6. Click **Run backfill now**, then open the dashboard tab and show the TikTok videos and their numbers.

## YouTube

The one setting that matters most: **publish the consent screen to Production.** If it's left in "Testing", Google cancels the connection every 7 days.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project called "Utah City Analytics".
2. Under **APIs & Services → Library**, enable **YouTube Data API v3** and **YouTube Analytics API**.
3. Under **APIs & Services → OAuth consent screen**, set up the screen people see when they approve ("Utah City Analytics wants to access your Google Account"):
   - User type: **External**. If the channel's Google account belongs to Utah City's own Google Workspace, choose **Internal** instead. That avoids both the 7-day limit and Google's warning screen.
   - App name and support email.
   - Application home page:

     ```
     https://www.utahcity.app
     ```
   - Privacy policy link:

     ```
     https://www.utahcity.app/privacy
     ```
   - Terms of service link:

     ```
     https://www.utahcity.app/terms
     ```
   - Scopes: `youtube.readonly` and `yt-analytics.readonly`.
4. Under **Credentials → Create credentials → OAuth client ID**, choose **Web application**. Under **Authorized redirect URIs**, click **Add URI**, paste this return link exactly, and click **Save**:

   ```
   https://www.utahcity.app/api/owned-social/callback/youtube
   ```
5. Back on the consent screen, click **Publish app** so the status reads **In production**. You can skip Google's verification review. An unverified app works for up to 100 people, and only one needs to connect.
6. **In the Utah City app, open Social Accounts and find the YouTube card**. Paste the **Client ID** and **Client Secret**, click **Save**, then click **Authorize**. Sign in with the Google account that owns the @UtahCity channel. If the channel is a Brand Account, pick it when Google asks which channel to use.
7. Google will show a "Google hasn't verified this app" warning. Click **Advanced → Go to Utah City Analytics** to continue. This is expected and safe.

## LinkedIn

LinkedIn needs a Page admin to verify the app and a product approval from LinkedIn, so start it early.

1. In [LinkedIn Developers](https://www.linkedin.com/developers/apps), click **Create app**. Under **LinkedIn Page**, choose **Utah City**. A Page admin must approve the verification request LinkedIn sends.
2. On the **Products** tab, request **Community Management API**. LinkedIn reviews this request and may ask what the app is for. Answer: "Read-only analytics for our own company page."
3. On the **Auth** tab, under **Authorized redirect URLs for your app**, click **Add redirect URL**, paste this return link exactly, and click **Update**:

   ```
   https://www.utahcity.app/api/owned-social/callback/linkedin
   ```
4. **In the Utah City app, open Social Accounts and find the LinkedIn card**. Paste the **Client ID** and **Primary Client Secret** and click **Save**.
5. Click **Authorize** and sign in as someone who is a **Super admin** of the Utah City Page.

## Facebook + Instagram (Meta)

**Only one value is required: the system-user token.** One Meta setup covers both Facebook and Instagram, and it never expires.

| Field | Needed? | What it is |
| --- | --- | --- |
| System-user token | **Required** | The actual key. It lets the app read the Page's and Instagram account's posts and insights. |
| Facebook Page ID | Optional | Which Page to read. Leave blank and the app finds the Utah City Page from the token. |
| App Secret | Optional | Only needed if the Meta app has **Require App Secret** turned on, which adds a signature to every request. |
| App ID | Optional | Identifies the Meta app. Kept for reference only; the app doesn't use it to connect. |

**Before you start:** Instagram @utahcityutah must be a **Professional** (Business or Creator) account **linked to the Utah City Facebook Page**. Otherwise Meta won't share Instagram data.

1. In [Meta for Developers](https://developers.facebook.com/apps), create an app of type **Business** and attach it to Utah City's business portfolio.
2. In [Meta Business Suite → Business settings](https://business.facebook.com/settings) → **Users → System users**, add a system user (role: Admin).
3. Click **Assign assets** and give that system user the **Utah City Page** and the **Instagram account**, with full analytics access.
4. Click **Generate new token**, choose the app, and set **Token expiration: Never**. Tick these permissions:
   - `pages_show_list`
   - `pages_read_engagement`
   - `read_insights`
   - `instagram_basic`
   - `instagram_manage_insights`
5. Copy the token right away, because Meta shows it only once. Paste it into the Social Accounts page and click **Test keys**. A green result lists both Facebook and Instagram.

## X

**Reading your own posts costs about $0.001 per post on X's pay-per-use plan.** That puts the full post history at roughly $3, and daily updates at pennies. There's no subscription: you add prepaid credit in the X Developer Console. The app also stops after 300 posts per run, so costs stay predictable. Rates have changed several times in 2026, so check the console before buying credit. Figures are from [Outstand](https://www.outstand.so/blog/x-api-pricing) and [OpenTweet](https://opentweet.io/x-api-pricing).

The $0.001 rate only applies when the app reads posts *as* @utahcityutah. That's why we need the Access Token and Secret, and why they must be generated while signed in as @utahcityutah.

1. Sign in to the [X Developer Console](https://developer.x.com/) **as @utahcityutah**. Create a Project and an App, and add a small prepaid credit, such as $10.
2. Under **User authentication settings**, set App permissions to **Read**.
3. Under **Keys and tokens**, generate the **API Key** and **API Secret**, then the **Access Token** and **Access Token Secret**.
4. Paste all four into the Social Accounts page and click **Test keys**. It should report @utahcityutah. The Bearer Token is optional, so leave it blank.

**The free alternative, Download Your Data:** in X, go to Settings → Your account → **Download an archive of your data**. It contains every post with likes and reposts, but no views. It can't be automated: each request is made by hand, needs a password and a verification code, and takes about a day to arrive. It's still useful once if Utah City has more than 3,200 posts, because the API only reaches back that far. If so, send Jacob the archive file and he can import it.

## Staying connected

Once set up, the connections keep themselves alive. Every morning the app renews the TikTok, YouTube and LinkedIn keys, then pulls new posts and metrics. If anything can't be renewed automatically, an email goes to support@utahcity.app before it lapses, with the one step needed to fix it.

| Platform | How it stays connected | When a person might need to step in |
| --- | --- | --- |
| TikTok | Renewed daily; the key rolls forward each time | If @utahcityutah removes the app, or after about a year if TikTok stops extending it |
| YouTube | Renewed daily; doesn't expire while the consent screen is In production | If it's left in Testing (every 7 days), or if the channel owner revokes access |
| LinkedIn | Renewed when LinkedIn allows it; access lasts 60 days | LinkedIn requires a fresh Authorize click every 60 days to 12 months, depending on the app's approval. An email goes out 7 days before |
| Facebook + Instagram | System-user token set to never expire | If the system user is deleted or its assets are removed |
| X | Access Token doesn't expire | If the tokens are regenerated or the prepaid credit runs out |

If a re-approval is ever needed, click **Authorize** again on that card. It's one click for the account owner.

## FAQ

| Question | Answer |
| --- | --- |
| Can the app post, edit or delete as Utah City? | No. Only read and analytics permissions are requested, and each platform enforces that. |
| How do we cut off access? | Remove the app in each platform's connected-apps or Business settings. Access stops immediately. |
| Who can see the keys? | Nobody. They're encrypted when saved and are never shown again, not even to Jacob. |
| Who sees the data? | Only Utah City leadership accounts in the Host Intelligence app. |
| Can we email the keys instead? | Yes, but the Social Accounts page is safer and faster, because the keys never sit in an inbox. If you do email them, delete the email once they're saved. |
| Does it cost anything? | Only X, at about $0.001 per post read (roughly $3 for the full history). Everything else is free. |
| How far back does history go? | YouTube, TikTok, Instagram and Facebook: posts from the start of the account, with the deepest metrics on recent posts. LinkedIn: all company-page posts. X: the latest 3,200 posts through the API, or everything through the archive. |
| What if Test keys shows a red Problem? | Read the hint under it. It usually means a key was copied incompletely, a permission box was missed, or the wrong account was signed in. Fix it, save again, and test again. |
