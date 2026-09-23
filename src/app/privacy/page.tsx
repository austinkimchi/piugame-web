import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How MyPIU collects, uses, retains, and deletes account, gameplay, and device data.",
  alternates: {
    canonical: "/privacy",
  },
};

const sections = [
  { id: "data-we-collect", label: "Data we collect" },
  { id: "how-we-use-data", label: "How we use data" },
  { id: "sharing", label: "Sharing" },
  { id: "retention", label: "Retention" },
  { id: "your-choices", label: "Your choices" },
  { id: "security", label: "Security" },
  { id: "children", label: "Children" },
  { id: "changes", label: "Changes" },
  { id: "contact", label: "Contact" },
];

export default function PrivacyPage() {
  return (
    <main className="flex-1 bg-[#f7f8f2] text-[#171916]">
      <header className="border-b border-[#d9ded2] bg-[#fbfcf7]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-10">
          <Link className="text-lg font-black hover:text-[#168b38]" href="/">
            MyPIU
          </Link>
          <Link className="text-sm font-bold text-[#4f5849] hover:text-[#168b38]" href="/">
            Song catalog
          </Link>
        </div>
      </header>

      <section className="border-b border-[#d9ded2] bg-white">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
          <p className="text-xs font-black uppercase text-[#168b38]">Legal</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-black sm:text-5xl">Privacy Policy</h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-[#56604e]">
            This policy explains what MyPIU collects across the website, native mobile app, browser extension,
            and linked Discord bot features, and how you can control that data.
          </p>
          <p className="mt-4 text-sm font-bold text-[#66705f]">
            Effective <time dateTime="2026-09-21">September 21, 2026</time>
          </p>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:px-10 lg:py-16">
        <nav aria-label="Privacy policy sections" className="lg:sticky lg:top-6 lg:self-start">
          <p className="text-xs font-black uppercase text-[#596153]">On this page</p>
          <ul className="mt-4 grid gap-2 border-l border-[#cfd7c8] pl-4 text-sm font-bold text-[#4f5849]">
            {sections.map((section) => (
              <li key={section.id}>
                <a className="hover:text-[#168b38]" href={`#${section.id}`}>
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="min-w-0 max-w-3xl space-y-12 text-[0.95rem] leading-7 text-[#3f473a]">
          <section aria-labelledby="scope-heading">
            <h2 className="text-2xl font-black text-[#171916]" id="scope-heading">Scope</h2>
            <p className="mt-4">
              MyPIU is an independent Pump It Up companion service operated by Austin Kim. This policy applies to
              MyPIU services. It does not govern PIUGAME, Google, Discord, Apple, ANDAMIRO, or websites linked from
              the catalog. MyPIU is not affiliated with ANDAMIRO.
            </p>
          </section>

          <section aria-labelledby="data-we-collect">
            <h2 className="text-2xl font-black text-[#171916]" id="data-we-collect">Data we collect</h2>
            <div className="mt-5 space-y-6">
              <PolicyItem title="Account and sign-in data">
                Your name, email address, profile image, username, Google, Discord, or Apple account identifier, linked
                provider username, session records, and account preferences.
              </PolicyItem>
              <PolicyItem title="PIUGAME profile and gameplay data">
                Your PIUGAME username, display name, title, game ID, Pump tag, avatar, Pumbility and other profile
                totals, recent arcade and access information, song and chart identifiers, scores, grades, plates,
                judgments, clear status, and play timestamps. A recent arcade value may identify a general venue or
                area and is treated as coarse location data. When available, MyPIU associates that value with newly
                observed plays in the current session so session history can be grouped by venue.
              </PolicyItem>
              <PolicyItem title="Content and activity">
                Saved songs, favorites, notes, tag contributions and votes, community posts, moderation records,
                catalog settings, and feature preferences associated with your account.
              </PolicyItem>
              <PolicyItem title="App, extension, and device data">
                A randomly generated installation identifier, platform, app version, sync source, sync timestamps,
                idempotency keys, and short-lived authorization or rate-limit records used to deliver and protect
                device sync.
              </PolicyItem>
              <PolicyItem title="Messages and technical data">
                When you send feedback, we store the message, any contact detail you provide, the page URL, your
                account details if signed in, IP address, browser user agent, and submission time. Hosting systems
                may also process ordinary request and security logs.
              </PolicyItem>
            </div>

            <div className="mt-7 border-l-4 border-[#28c950] bg-[#eef7ed] px-5 py-4 text-[#33402f]">
              <p className="font-black text-[#171916]">Mobile sync boundary</p>
              <p className="mt-2">
                The native app fetches PIUGAME pages on your device and sends normalized profile and play data to
                MyPIU. The mobile sync API rejects PIUGAME passwords, cookies, credentials, and raw HTML. Your
                PIUGAME password is stored in the device Keychain for on-device access and is not uploaded by mobile
                sync. If you separately enable server-side PIUGAME sync on the website, MyPIU stores that credential
                encrypted so the requested sync can run.
              </p>
            </div>
          </section>

          <section aria-labelledby="how-we-use-data">
            <h2 className="text-2xl font-black text-[#171916]" id="how-we-use-data">How we use data</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 marker:text-[#168b38]">
              <li>Authenticate accounts and link the services you choose.</li>
              <li>Sync, display, summarize, and personalize your PIUGAME performance history.</li>
              <li>Provide saved songs, notes, community features, recommendations, and Discord bot features.</li>
              <li>Prevent abuse, enforce rate limits, investigate errors, and keep the service secure.</li>
              <li>Respond to feedback, privacy requests, corrections, and support messages.</li>
              <li>Maintain and improve MyPIU using aggregated or de-identified operational information.</li>
            </ul>
            <p className="mt-4">MyPIU does not sell personal data or use it for cross-app advertising or tracking.</p>
          </section>

          <section aria-labelledby="sharing">
            <h2 className="text-2xl font-black text-[#171916]" id="sharing">When data is shared</h2>
            <p className="mt-4">
              MyPIU sends the minimum information needed to Google, Discord, or Apple when you use those providers to sign
              in or link an account. It accesses PIUGAME at your direction to retrieve your profile and plays. Cloud
              hosting, database, and infrastructure providers process data for MyPIU under their service terms.
              Public community posts, display names, and contributions are visible to other users as part of the
              feature you choose to use. Data may also be disclosed when required by law, to protect users or the
              service, or as part of a service transfer with appropriate notice and safeguards.
            </p>
          </section>

          <section aria-labelledby="retention">
            <h2 className="text-2xl font-black text-[#171916]" id="retention">Retention</h2>
            <p className="mt-4">
              Account, gameplay, preference, and community data is generally retained while your account is active.
              Short-lived authorization codes, access tokens, rate-limit records, and mobile import receipts expire
              on configured security schedules. Feedback and security records are retained only as long as reasonably
              needed to respond, prevent abuse, maintain records, or meet legal obligations. Backups and provider logs
              may take additional time to cycle out after deletion.
            </p>
          </section>

          <section aria-labelledby="your-choices">
            <h2 className="text-2xl font-black text-[#171916]" id="your-choices">Your choices</h2>
            <p className="mt-4">
              You can change account preferences, disconnect supported integrations, and remove content through the
              available account and community controls. The native app includes <strong>Delete MyPIU Account</strong>,
              which initiates deletion of your MyPIU identity and associated synced scores, saved content, community
              content, and linked Discord bot data.
            </p>
            <p className="mt-4">
              Deleting MyPIU does not delete your PIUGAME, Google, Discord, or Apple account. It also does not delete
              your separate on-device PIUGAME login; use the app&apos;s PIUGAME disconnect control to remove that Keychain
              credential. For access, correction, deletion, or other privacy requests, use the <strong>Message</strong>
              button in the page footer and select <strong>Privacy, credit, or removal request</strong>. Include a way
              to contact you so the request can be verified and answered.
            </p>
          </section>

          <section aria-labelledby="security">
            <h2 className="text-2xl font-black text-[#171916]" id="security">Security</h2>
            <p className="mt-4">
              MyPIU uses measures such as HTTPS, scoped authorization, Keychain storage on Apple devices, encryption
              for server-stored PIUGAME credentials, access controls, rate limits, and account-scoped deletion. No
              method of storage or transmission can be guaranteed completely secure.
            </p>
          </section>

          <section aria-labelledby="children">
            <h2 className="text-2xl font-black text-[#171916]" id="children">Children</h2>
            <p className="mt-4">
              MyPIU is not directed to children under 13, and the service does not knowingly collect personal data
              from a child under 13. If you believe a child has provided data, submit a privacy request so it can be
              investigated and removed.
            </p>
          </section>

          <section aria-labelledby="changes">
            <h2 className="text-2xl font-black text-[#171916]" id="changes">Changes to this policy</h2>
            <p className="mt-4">
              This policy may be updated as MyPIU changes. The effective date above will be revised when material
              updates are published. Additional notice will be provided in the service when a change materially
              affects how personal data is handled.
            </p>
          </section>

          <section aria-labelledby="contact">
            <h2 className="text-2xl font-black text-[#171916]" id="contact">Contact</h2>
            <p className="mt-4">
              MyPIU is operated by Austin Kim. Use the <strong>Message</strong> button in the footer and choose the
              privacy request option to contact the operator about this policy or your data.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}

function PolicyItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-black text-[#171916]">{title}</h3>
      <p className="mt-1">{children}</p>
    </div>
  );
}
