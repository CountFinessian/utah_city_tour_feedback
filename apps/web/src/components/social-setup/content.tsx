"use client";

import type { ReactNode } from "react";
import { CopyField } from "./CopyField";
import { PlatformKeysPanel } from "./PlatformKeysPanel";
import type { OwnedSocialContext } from "./useOwnedSocial";

/*
 * Walkthrough text, adapted from docs/social-coach/04-Social-Accounts-Setup-Guide.md.
 * The leader is already on this page, so there is no "open Social Accounts" navigation text.
 * Apostrophes are typographic (’) so the JSX stays readable without entity escapes.
 */

const LINK = "text-command-accent hover:underline";

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK}>
      {children}
    </a>
  );
}

/** Numbered steps as a real ordered list. `start` continues numbering across a panel. */
export function Steps({ start, children }: { start?: number; children: ReactNode }) {
  return (
    <ol start={start} className="list-decimal space-y-3 pl-5 text-sm leading-6 text-command-soft marker:font-semibold marker:text-command-muted">
      {children}
    </ol>
  );
}

/** Bullets nested under a step or a paragraph. */
function Bullets({ children }: { children: ReactNode }) {
  return <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-command-soft">{children}</ul>;
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-command-soft">{children}</p>;
}

/** A step that sits between two sections of numbered steps, followed by its key panel. */
export function StepHeading({ children }: { children: ReactNode }) {
  return <h3 className="pt-2 text-sm font-bold text-command-ink">{children}</h3>;
}

function DataTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-command-border">
      <table className="w-full min-w-[30rem] text-left text-xs">
        <thead className="bg-white/[0.03]">
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="border-b border-command-border px-3 py-2 font-semibold text-command-ink">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const TD = "border-b border-command-border px-3 py-2 align-top text-command-soft last:border-b-0";

/** Live return link for a platform, from the admin summary. Never hardcoded. */
function redirectUriFor(ctx: OwnedSocialContext, platform: string): string | undefined {
  return ctx.data?.platforms.find((p) => p.platform === platform)?.redirectUri;
}

export function HowItWorks() {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-bold text-command-ink">How it works</h2>
      <Lead>
        Utah City gives the Host Intelligence app <strong className="text-command-ink">read-only</strong> access to its official social accounts. That lets us back-test past
        campaigns and score new posts as soon as they go live. We can’t post, edit, delete or message on any account.
      </Lead>
      <Lead>
        You won’t need to email any keys. Everything happens on this page: each platform’s keys go in the box right under its steps, and that’s where you click Save,
        Authorize and Test keys.
      </Lead>
      <Steps>
        <li>
          <strong className="text-command-ink">Create a read-only app</strong> on each platform’s developer site (steps below).
        </li>
        <li>
          <strong className="text-command-ink">Register our return link</strong> on TikTok, YouTube and LinkedIn. Each one is shown with a Copy button.
        </li>
        <li>
          <strong className="text-command-ink">Paste the keys</strong> in the box under that platform’s steps and click Save. They’re encrypted immediately, and nobody can view
          them again, including us.
        </li>
        <li>
          <strong className="text-command-ink">Click Authorize</strong> (TikTok, YouTube, LinkedIn only). Sign in as the official Utah City account and approve.
        </li>
        <li>
          <strong className="text-command-ink">Click Test keys.</strong> A green “Working” confirms the right account is connected.
        </li>
      </Steps>
      <Lead>
        After that, nothing else is needed from you. Connections renew themselves every day, and post history and metrics load automatically.
      </Lead>
    </div>
  );
}

export function Checklist() {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-bold text-command-ink">Checklist</h2>
      <Lead>
        TikTok and Meta (Facebook + Instagram) matter most, so start with those. Start the TikTok and LinkedIn apps first, because those platforms review apps before granting
        access, which can take days.
      </Lead>
      <DataTable headers={["Priority", "Platform", "Official account", "What you paste in the box", "Authorize click?", "Cost"]}>
        <tr>
          <td className={TD}>1</td>
          <td className={TD}>TikTok</td>
          <td className={TD}>
            <ExtLink href="https://www.tiktok.com/@utahcityutah">@utahcityutah</ExtLink>
          </td>
          <td className={TD}>Client Key, Client Secret</td>
          <td className={TD}>Yes</td>
          <td className={TD}>Free</td>
        </tr>
        <tr>
          <td className={TD}>1</td>
          <td className={TD}>Facebook + Instagram</td>
          <td className={TD}>
            <ExtLink href="https://www.facebook.com/utahcityutah/">Facebook</ExtLink> ·{" "}
            <ExtLink href="https://www.instagram.com/utahcityutah/">Instagram</ExtLink>
          </td>
          <td className={TD}>System-user token (Page ID optional)</td>
          <td className={TD}>No</td>
          <td className={TD}>Free</td>
        </tr>
        <tr>
          <td className={TD}>2</td>
          <td className={TD}>YouTube</td>
          <td className={TD}>
            <ExtLink href="https://www.youtube.com/@UtahCity">@UtahCity</ExtLink>
          </td>
          <td className={TD}>Client ID, Client Secret</td>
          <td className={TD}>Yes</td>
          <td className={TD}>Free</td>
        </tr>
        <tr>
          <td className={TD}>2</td>
          <td className={TD}>X</td>
          <td className={TD}>
            <ExtLink href="https://x.com/utahcityutah">@utahcityutah</ExtLink>
          </td>
          <td className={TD}>API Key, API Secret, Access Token, Access Token Secret</td>
          <td className={TD}>No</td>
          <td className={TD}>About $0.001 per post read, prepaid</td>
        </tr>
        <tr>
          <td className={TD}>3</td>
          <td className={TD}>LinkedIn</td>
          <td className={TD}>
            <ExtLink href="https://www.linkedin.com/company/utah-city/">utah-city</ExtLink>
          </td>
          <td className={TD}>Client ID, Primary Client Secret</td>
          <td className={TD}>Yes</td>
          <td className={TD}>Free</td>
        </tr>
      </DataTable>
    </div>
  );
}

export function ReturnLinks({ ctx }: { ctx: OwnedSocialContext }) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-bold text-command-ink">Return links and connect links</h2>
      <Lead>These are two different links, and you’ll deal with both:</Lead>
      <Bullets>
        <li>
          <strong className="text-command-ink">Connect link (also called the Authorize button):</strong> the link the <em>account owner clicks</em> to start approving access. It
          takes them to TikTok’s, Google’s or LinkedIn’s own sign-in page. In each platform’s box below it’s the Authorize button. Jacob can also email one directly to whoever owns
          the account.
        </li>
        <li>
          <strong className="text-command-ink">Return link (the “redirect URI”):</strong> the address the <em>platform sends the owner back to</em> after they click Allow. It
          carries a one-time approval code that our app swaps for the access key. Nobody clicks it; you only register it once in each platform’s developer settings.
        </li>
      </Bullets>
      <Lead>
        The flow: owner clicks <strong className="text-command-ink">Authorize</strong> → platform sign-in page → owner clicks <strong className="text-command-ink">Allow</strong> →
        the platform sends them to the <strong className="text-command-ink">return link</strong> → our app saves the key → “Connected”.
      </Lead>
      <Lead>
        <strong className="text-command-ink">Why it must match exactly:</strong> platforms only send approval codes to addresses registered in advance, so nobody can intercept them.
        The comparison is character for character. A missing <code className="font-mono text-command-ink">www</code>, <code className="font-mono text-command-ink">http</code> instead
        of <code className="font-mono text-command-ink">https</code>, or an extra <code className="font-mono text-command-ink">/</code> at the end all count as a different address, and
        the owner gets a “redirect_uri mismatch” error right after clicking Allow. Use the Copy button below rather than retyping.
      </Lead>
      <DataTable headers={["Platform", "Paste exactly this", "Where it goes"]}>
        <tr>
          <td className={TD}>TikTok</td>
          <td className={`${TD} min-w-[16rem]`}>
            <CopyField value={redirectUriFor(ctx, "tiktok")} />
          </td>
          <td className={TD}>
            <ExtLink href="https://developers.tiktok.com/">TikTok for Developers</ExtLink> → your app → <strong className="text-command-ink">Login Kit</strong> →{" "}
            <strong className="text-command-ink">Redirect URI</strong> → Save
          </td>
        </tr>
        <tr>
          <td className={TD}>YouTube</td>
          <td className={`${TD} min-w-[16rem]`}>
            <CopyField value={redirectUriFor(ctx, "youtube")} />
          </td>
          <td className={TD}>
            <ExtLink href="https://console.cloud.google.com/">Google Cloud Console</ExtLink> → APIs &amp; Services → <strong className="text-command-ink">Credentials</strong> → your
            OAuth client → <strong className="text-command-ink">Authorized redirect URIs</strong> → Add URI → Save
          </td>
        </tr>
        <tr>
          <td className={TD}>LinkedIn</td>
          <td className={`${TD} min-w-[16rem]`}>
            <CopyField value={redirectUriFor(ctx, "linkedin")} />
          </td>
          <td className={TD}>
            <ExtLink href="https://www.linkedin.com/developers/apps">LinkedIn Developers</ExtLink> → your app → <strong className="text-command-ink">Auth</strong> tab →{" "}
            <strong className="text-command-ink">Authorized redirect URLs for your app</strong> → Add → Update
          </td>
        </tr>
      </DataTable>
      <Lead>Facebook + Instagram and X don’t use a return link.</Lead>
    </div>
  );
}

export function TikTokGuide({ ctx }: { ctx: OwnedSocialContext }) {
  return (
    <div className="space-y-4">
      <Lead>
        <strong className="text-command-ink">You don’t have to wait for review to get the keys.</strong> The Client Key and Client Secret appear as soon as you create the app.
        What review controls is whether the app can be used with real accounts. Until it’s approved, you can use <strong className="text-command-ink">Sandbox</strong> mode with a test
        account.
      </Lead>
      <Steps>
        <li>
          Go to <ExtLink href="https://developers.tiktok.com/">TikTok for Developers</ExtLink>, sign in, and click <strong className="text-command-ink">Manage apps → Connect an app</strong>.
          Name it something like “Utah City Analytics”.
        </li>
        <li>
          Fill in the app details by pasting these three links:
          <Bullets>
            <li>
              <CopyField label="Website" value="https://www.utahcity.app" />
            </li>
            <li>
              <CopyField label="Terms of Service" value="https://www.utahcity.app/terms" />
            </li>
            <li>
              <CopyField label="Privacy Policy" value="https://www.utahcity.app/privacy" />
            </li>
          </Bullets>
        </li>
        <li>
          <strong className="text-command-ink">Verify the utahcity.app domain.</strong> TikTok won’t review the app until you do.
          <Bullets>
            <li>
              In the app, open <strong className="text-command-ink">URL properties → Add URL property</strong>, choose <strong className="text-command-ink">Domain</strong>, and
              enter <code className="font-mono text-command-ink">utahcity.app</code>. TikTok shows a verification string. Copy it.
            </li>
            <li>
              Jacob adds it at Namecheap, which hosts utahcity.app’s DNS: <strong className="text-command-ink">Domain List → utahcity.app → Manage → Advanced DNS → Add New
              Record</strong>.
            </li>
            <li>
              Type: <strong className="text-command-ink">TXT Record</strong>. Host: <code className="font-mono text-command-ink">@</code>. Value: paste TikTok’s string. TTL:{" "}
              <strong className="text-command-ink">Automatic</strong>. Click the green check to save.
            </li>
            <li>
              Wait 5 to 30 minutes, then click <strong className="text-command-ink">Verify</strong> in TikTok.
            </li>
          </Bullets>
        </li>
        <li>
          Click <strong className="text-command-ink">Add products</strong> and add <strong className="text-command-ink">Login Kit</strong> and{" "}
          <strong className="text-command-ink">Display API</strong>.
        </li>
        <li>
          Under <strong className="text-command-ink">Scopes</strong>, tick <code className="font-mono text-command-ink">user.info.basic</code>,{" "}
          <code className="font-mono text-command-ink">user.info.profile</code>, <code className="font-mono text-command-ink">user.info.stats</code> and{" "}
          <code className="font-mono text-command-ink">video.list</code>. These are all read-only.
        </li>
        <li>
          Go to <strong className="text-command-ink">Login Kit → Redirect URI</strong> and paste this return link exactly, then click <strong className="text-command-ink">Save</strong>.
          <div className="mt-2">
            <CopyField label="Return link" value={redirectUriFor(ctx, "tiktok")} />
          </div>
        </li>
      </Steps>

      <StepHeading>Step 7 — Paste your Sandbox keys here, then Authorize and Test keys</StepHeading>
      <Lead>
        Switch the app to <strong className="text-command-ink">Sandbox</strong> and add a TikTok account you own under <strong className="text-command-ink">Target users</strong>.
        Jacob’s own account is fine. Paste the Sandbox Client Key and Secret in the box below, click Save, then click Authorize. After approval, the Production keys go in this same box.
      </Lead>
      <PlatformKeysPanel platform="tiktok" ctx={ctx} />

      <StepHeading>Step 8 — Record the demo video using the script below</StepHeading>
      <div className="space-y-3 rounded-lg border border-command-border p-4">
        <p className="text-sm font-semibold text-command-ink">The demo video</p>
        <Lead>
          Yes: it’s a screen recording of the data being pulled into the app. It must happen on the real site, www.utahcity.app, and every permission has to visibly appear. Keep it
          to about two minutes and under 50 MB:
        </Lead>
        <Steps>
          <li>
            Open www.utahcity.app, sign in, and go to <strong className="text-command-ink">Social Accounts</strong>.
          </li>
          <li>On the TikTok box, show the Sandbox Client Key is saved, then click <strong className="text-command-ink">Authorize</strong>.</li>
          <li>On TikTok’s screen, show the permission list and click <strong className="text-command-ink">Allow</strong>.</li>
          <li>
            Back in the app, show the card reading <strong className="text-command-ink">Connected</strong> with the account name. This demonstrates{" "}
            <code className="font-mono text-command-ink">user.info.basic</code> and <code className="font-mono text-command-ink">user.info.profile</code>.
          </li>
          <li>
            Click <strong className="text-command-ink">Test keys</strong>. Show the follower count (<code className="font-mono text-command-ink">user.info.stats</code>) and recent
            videos with views and likes (<code className="font-mono text-command-ink">video.list</code>).
          </li>
          <li>
            Click <strong className="text-command-ink">Run backfill now</strong>, then open the dashboard tab and show the TikTok videos and their numbers.
          </li>
        </Steps>
      </div>

      <Steps start={9}>
        <li>
          <strong className="text-command-ink">Submit.</strong> Switch the app back to <strong className="text-command-ink">Production</strong>, and in the{" "}
          <strong className="text-command-ink">App review</strong> section write one sentence per product and permission. For example: “<code className="font-mono text-command-ink">video.list</code>:
          reads our own videos’ view and like counts for campaign analytics.” Upload the video and click <strong className="text-command-ink">Submit for review</strong>. Approval
          often takes a few days to two weeks.
        </li>
        <li>
          <strong className="text-command-ink">After approval:</strong> paste the <em>Production</em> Client Key and Secret into the TikTok box above. Click{" "}
          <strong className="text-command-ink">Authorize</strong> and sign in as @utahcityutah. Sandbox and production keys are different.
        </li>
      </Steps>
    </div>
  );
}

export function MetaGuide({ ctx }: { ctx: OwnedSocialContext }) {
  return (
    <div className="space-y-4">
      <Lead>
        <strong className="text-command-ink">Only one value is required: the system-user token.</strong> One Meta setup covers both Facebook and Instagram, and it never expires.
      </Lead>
      <DataTable headers={["Field", "Needed?", "What it is"]}>
        <tr>
          <td className={TD}>System-user token</td>
          <td className={TD}>
            <strong className="text-command-ink">Required</strong>
          </td>
          <td className={TD}>The actual key. It lets the app read the Page’s and Instagram account’s posts and insights.</td>
        </tr>
        <tr>
          <td className={TD}>Facebook Page ID</td>
          <td className={TD}>Optional</td>
          <td className={TD}>Which Page to read. Leave blank and the app finds the Utah City Page from the token.</td>
        </tr>
        <tr>
          <td className={TD}>App Secret</td>
          <td className={TD}>Optional</td>
          <td className={TD}>Only needed if the Meta app has <strong className="text-command-ink">Require App Secret</strong> turned on, which adds a signature to every request.</td>
        </tr>
        <tr>
          <td className={TD}>App ID</td>
          <td className={TD}>Optional</td>
          <td className={TD}>Identifies the Meta app. Kept for reference only; the app doesn’t use it to connect.</td>
        </tr>
      </DataTable>
      <Lead>
        <strong className="text-command-ink">Before you start:</strong> Instagram @utahcityutah must be a <strong className="text-command-ink">Professional</strong> (Business or
        Creator) account <strong className="text-command-ink">linked to the Utah City Facebook Page</strong>. Otherwise Meta won’t share Instagram data.
      </Lead>
      <Steps>
        <li>
          In <ExtLink href="https://developers.facebook.com/apps">Meta for Developers</ExtLink>, create an app of type <strong className="text-command-ink">Business</strong> and attach
          it to Utah City’s business portfolio.
        </li>
        <li>
          In <ExtLink href="https://business.facebook.com/settings">Meta Business Suite → Business settings</ExtLink> → <strong className="text-command-ink">Users → System users</strong>,
          add a system user (role: Admin).
        </li>
        <li>
          Click <strong className="text-command-ink">Assign assets</strong> and give that system user the Utah City Page and the Instagram account, with full analytics access.
        </li>
        <li>
          Click <strong className="text-command-ink">Generate new token</strong>, choose the app, and set <strong className="text-command-ink">Token expiration: Never</strong>. Tick
          these permissions:
          <Bullets>
            <li>
              <code className="font-mono text-command-ink">pages_show_list</code>
            </li>
            <li>
              <code className="font-mono text-command-ink">pages_read_engagement</code>
            </li>
            <li>
              <code className="font-mono text-command-ink">read_insights</code>
            </li>
            <li>
              <code className="font-mono text-command-ink">instagram_basic</code>
            </li>
            <li>
              <code className="font-mono text-command-ink">instagram_manage_insights</code>
            </li>
          </Bullets>
        </li>
      </Steps>

      <StepHeading>Step 5 — Paste the system-user token here, then Test keys</StepHeading>
      <Lead>
        Copy the token right away, because Meta shows it only once. Paste it in the box below and click Test keys. A green result lists both Facebook and Instagram.
      </Lead>
      <PlatformKeysPanel platform="meta" ctx={ctx} />
    </div>
  );
}

export function YouTubeGuide({ ctx }: { ctx: OwnedSocialContext }) {
  return (
    <div className="space-y-4">
      <Lead>
        <strong className="text-command-ink">The one setting that matters most: publish the consent screen to Production.</strong> If it’s left in “Testing”, Google cancels the
        connection every 7 days.
      </Lead>
      <Steps>
        <li>
          In <ExtLink href="https://console.cloud.google.com/">Google Cloud Console</ExtLink>, create a project called “Utah City Analytics”.
        </li>
        <li>
          Under <strong className="text-command-ink">APIs &amp; Services → Library</strong>, enable <strong className="text-command-ink">YouTube Data API v3</strong> and{" "}
          <strong className="text-command-ink">YouTube Analytics API</strong>.
        </li>
        <li>
          Under <strong className="text-command-ink">APIs &amp; Services → OAuth consent screen</strong>, set up the screen people see when they approve (“Utah City Analytics wants
          to access your Google Account”):
          <Bullets>
            <li>
              User type: <strong className="text-command-ink">External</strong>. If the channel’s Google account belongs to Utah City’s own Google Workspace, choose{" "}
              <strong className="text-command-ink">Internal</strong> instead. That avoids both the 7-day limit and Google’s warning screen.
            </li>
            <li>App name and support email.</li>
            <li>
              <CopyField label="Application home page" value="https://www.utahcity.app" />
            </li>
            <li>
              <CopyField label="Privacy policy link" value="https://www.utahcity.app/privacy" />
            </li>
            <li>
              <CopyField label="Terms of service link" value="https://www.utahcity.app/terms" />
            </li>
            <li>
              Scopes: <code className="font-mono text-command-ink">youtube.readonly</code> and <code className="font-mono text-command-ink">yt-analytics.readonly</code>.
            </li>
          </Bullets>
        </li>
        <li>
          Under <strong className="text-command-ink">Credentials → Create credentials → OAuth client ID</strong>, choose <strong className="text-command-ink">Web application</strong>.
          Under <strong className="text-command-ink">Authorized redirect URIs</strong>, click <strong className="text-command-ink">Add URI</strong>, paste this return link exactly, and
          click <strong className="text-command-ink">Save</strong>.
          <div className="mt-2">
            <CopyField label="Return link" value={redirectUriFor(ctx, "youtube")} />
          </div>
        </li>
        <li>
          Back on the consent screen, click <strong className="text-command-ink">Publish app</strong> so the status reads <strong className="text-command-ink">In production</strong>. You
          can skip Google’s verification review. An unverified app works for up to 100 people, and only one needs to connect.
        </li>
      </Steps>

      <StepHeading>Step 6 — Paste your Client ID and Client Secret here, then Authorize</StepHeading>
      <Lead>
        Paste the Client ID and Client Secret in the box below, click Save, then click Authorize. Sign in with the Google account that owns the @UtahCity channel. If the channel is a
        Brand Account, pick it when Google asks which channel to use.
      </Lead>
      <PlatformKeysPanel platform="youtube" ctx={ctx} />

      <Steps start={7}>
        <li>
          Google will show a “Google hasn’t verified this app” warning. Click <strong className="text-command-ink">Advanced → Go to Utah City Analytics</strong> to continue.
          This is expected and safe.
        </li>
      </Steps>
    </div>
  );
}

export function XGuide({ ctx }: { ctx: OwnedSocialContext }) {
  return (
    <div className="space-y-4">
      <Lead>
        <strong className="text-command-ink">Reading your own posts costs about $0.001 per post on X’s pay-per-use plan.</strong> That puts the full post history at roughly $3,
        and daily updates at pennies. There’s no subscription: you add prepaid credit in the X Developer Console. The app also stops after 300 posts per run, so costs stay
        predictable. Rates have changed several times in 2026, so check the console before buying credit. Figures are from{" "}
        <ExtLink href="https://www.outstand.so/blog/x-api-pricing">Outstand</ExtLink> and <ExtLink href="https://opentweet.io/x-api-pricing">OpenTweet</ExtLink>.
      </Lead>
      <Lead>
        The $0.001 rate only applies when the app reads posts <em>as</em> @utahcityutah. That’s why we need the Access Token and Secret, and why they must be generated while signed
        in as @utahcityutah.
      </Lead>
      <Steps>
        <li>
          Sign in to the <ExtLink href="https://developer.x.com/">X Developer Console</ExtLink> <strong className="text-command-ink">as @utahcityutah</strong>. Create a Project and an
          App, and add a small prepaid credit, such as $10.
        </li>
        <li>
          Under <strong className="text-command-ink">User authentication settings</strong>, set App permissions to <strong className="text-command-ink">Read</strong>.
        </li>
        <li>
          Under <strong className="text-command-ink">Keys and tokens</strong>, generate the <strong className="text-command-ink">API Key</strong> and{" "}
          <strong className="text-command-ink">API Secret</strong>, then the <strong className="text-command-ink">Access Token</strong> and{" "}
          <strong className="text-command-ink">Access Token Secret</strong>.
        </li>
      </Steps>

      <StepHeading>Step 4 — Paste all four keys here, then Test keys</StepHeading>
      <Lead>
        Paste all four into the box below and click Test keys. It should report @utahcityutah. The Bearer Token is optional, so leave it blank.
      </Lead>
      <PlatformKeysPanel platform="x" ctx={ctx} />

      <div className="rounded-lg border border-command-border p-4">
        <Lead>
          <strong className="text-command-ink">The free alternative, Download Your Data:</strong> in X, go to <strong className="text-command-ink">Settings → Your account →
          Download an archive of your data</strong>. It contains every post with likes and reposts, but no views. It can’t be automated: each request is made by hand, needs a
          password and a verification code, and takes about a day to arrive. It’s still useful once if Utah City has more than 3,200 posts, because the API only reaches back that far.
          If so, send Jacob the archive file and he can import it.
        </Lead>
      </div>
    </div>
  );
}

export function LinkedInGuide({ ctx }: { ctx: OwnedSocialContext }) {
  return (
    <div className="space-y-4">
      <Lead>LinkedIn needs a Page admin to verify the app and a product approval from LinkedIn, so start it early.</Lead>
      <Steps>
        <li>
          In <ExtLink href="https://www.linkedin.com/developers/apps">LinkedIn Developers</ExtLink>, click <strong className="text-command-ink">Create app</strong>. Under{" "}
          <strong className="text-command-ink">LinkedIn Page</strong>, choose <strong className="text-command-ink">Utah City</strong>. A Page admin must approve the verification request
          LinkedIn sends.
        </li>
        <li>
          On the <strong className="text-command-ink">Products</strong> tab, request <strong className="text-command-ink">Community Management API</strong>. LinkedIn reviews this
          request and may ask what the app is for. Answer: “Read-only analytics for our own company page.”
        </li>
        <li>
          On the <strong className="text-command-ink">Auth</strong> tab, under <strong className="text-command-ink">Authorized redirect URLs for your app</strong>, click{" "}
          <strong className="text-command-ink">Add redirect URL</strong>, paste this return link exactly, and click <strong className="text-command-ink">Update</strong>.
          <div className="mt-2">
            <CopyField label="Return link" value={redirectUriFor(ctx, "linkedin")} />
          </div>
        </li>
      </Steps>

      <StepHeading>Step 4 — Paste your Client ID and Primary Client Secret here, then Authorize as a Super admin</StepHeading>
      <Lead>
        Paste the Client ID and Primary Client Secret in the box below and click Save. Then click Authorize and sign in as someone who is a{" "}
        <strong className="text-command-ink">Super admin</strong> of the Utah City Page.
      </Lead>
      <PlatformKeysPanel platform="linkedin" ctx={ctx} />
    </div>
  );
}

export function StayingConnected() {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-bold text-command-ink">Staying connected</h2>
      <Lead>
        Once set up, the connections keep themselves alive. Every morning the app renews the TikTok, YouTube and LinkedIn keys, then pulls new posts and metrics. If anything can’t
        be renewed automatically, an email goes to support@utahcity.app before it lapses, with the one step needed to fix it.
      </Lead>
      <DataTable headers={["Platform", "How it stays connected", "When a person might need to step in"]}>
        <tr>
          <td className={TD}>TikTok</td>
          <td className={TD}>Renewed daily; the key rolls forward each time</td>
          <td className={TD}>If @utahcityutah removes the app, or after about a year if TikTok stops extending it</td>
        </tr>
        <tr>
          <td className={TD}>YouTube</td>
          <td className={TD}>Renewed daily; doesn’t expire while the consent screen is In production</td>
          <td className={TD}>If it’s left in Testing (every 7 days), or if the channel owner revokes access</td>
        </tr>
        <tr>
          <td className={TD}>LinkedIn</td>
          <td className={TD}>Renewed when LinkedIn allows it; access lasts 60 days</td>
          <td className={TD}>
            LinkedIn requires a fresh Authorize click every 60 days to 12 months, depending on the app’s approval. An email goes out 7 days before
          </td>
        </tr>
        <tr>
          <td className={TD}>Facebook + Instagram</td>
          <td className={TD}>System-user token set to never expire</td>
          <td className={TD}>If the system user is deleted or its assets are removed</td>
        </tr>
        <tr>
          <td className={TD}>X</td>
          <td className={TD}>Access Token doesn’t expire</td>
          <td className={TD}>If the tokens are regenerated or the prepaid credit runs out</td>
        </tr>
      </DataTable>
      <Lead>If a re-approval is ever needed, click Authorize again in that platform’s box. It’s one click for the account owner.</Lead>
    </div>
  );
}

export function FaqSection() {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-bold text-command-ink">FAQ</h2>
      <DataTable headers={["Question", "Answer"]}>
        <tr>
          <td className={TD}>Can the app post, edit or delete as Utah City?</td>
          <td className={TD}>No. Only read and analytics permissions are requested, and each platform enforces that.</td>
        </tr>
        <tr>
          <td className={TD}>How do we cut off access?</td>
          <td className={TD}>Remove the app in each platform’s connected-apps or Business settings. Access stops immediately.</td>
        </tr>
        <tr>
          <td className={TD}>Who can see the keys?</td>
          <td className={TD}>Nobody. They’re encrypted when saved and are never shown again, not even to Jacob.</td>
        </tr>
        <tr>
          <td className={TD}>Who sees the data?</td>
          <td className={TD}>Only Utah City leadership accounts in the Host Intelligence app.</td>
        </tr>
        <tr>
          <td className={TD}>Can we email the keys instead?</td>
          <td className={TD}>
            Yes, but this page is safer and faster, because the keys never sit in an inbox. If you do email them, delete the email once they’re saved.
          </td>
        </tr>
        <tr>
          <td className={TD}>Does it cost anything?</td>
          <td className={TD}>Only X, at about $0.001 per post read (roughly $3 for the full history). Everything else is free.</td>
        </tr>
        <tr>
          <td className={TD}>How far back does history go?</td>
          <td className={TD}>
            YouTube, TikTok, Instagram and Facebook: posts from the start of the account, with the deepest metrics on recent posts. LinkedIn: all company-page posts. X: the latest
            3,200 posts through the API, or everything through the archive.
          </td>
        </tr>
        <tr>
          <td className={TD}>What if Test keys shows a red Problem?</td>
          <td className={TD}>
            Read the hint under it. It usually means a key was copied incompletely, a permission box was missed, or the wrong account was signed in. Fix it, save again, and test again.
          </td>
        </tr>
      </DataTable>
    </div>
  );
}
