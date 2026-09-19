import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy | GoodFolder",
  description: "How the hosted GoodFolder service collects, uses, shares, and deletes personal data.",
  alternates: { canonical: "/privacy" },
};

const UPDATED = "19 September 2026";

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal · Privacy"
      title="Privacy policy"
      summary="This page explains what the hosted GoodFolder service knows about you and your folders, why it needs that information, and what you can ask us to do with it."
      updated={UPDATED}
    >
      <h2 id="who-is-responsible">Who is responsible</h2>
      <p>
        GoodFolder is operated by Carlos Marcial in Portugal. For the hosted service at trygoodfolder.com,
        Carlos Marcial is the data controller. Email <a href="mailto:contact@trygoodfolder.com">contact@trygoodfolder.com</a> for
        privacy questions or requests.
      </p>
      <p>
        If you run the open-source version yourself, the person or organisation running that installation controls its data.
        This policy does not describe their practices.
      </p>

      <h2 id="data-we-handle">Data we handle</h2>
      <ul>
        <li><strong>Account data:</strong> your email address, sign-in records, approved computers, invited collaborators, and revocable service credentials.</li>
        <li><strong>Folder data:</strong> folder and file names, file contents, saved versions, change summaries, comments, proposals, and the people or agents connected to that history.</li>
        <li><strong>Billing data:</strong> your plan, storage use, subscription state, and Stripe customer or subscription identifiers. Stripe handles payment-card details; GoodFolder does not store them.</li>
        <li><strong>Support and service data:</strong> messages you send us, security and activity records, delivery status for account emails, and enough technical information to diagnose a failed request.</li>
        <li><strong>Limited product analytics:</strong> page views and named actions such as opening a timeline or starting checkout, with counts and broad context. Analytics events exclude file names and file contents. We disable automatic click capture, session recording, heatmaps, surveys, and persistent browser storage.</li>
      </ul>

      <h2 id="how-we-use-it">Why we use this data</h2>
      <p>We use personal data for four purposes:</p>
      <ul>
        <li>To provide the service you asked for: sign you in, store and sync folders, show their history, restore saved versions, manage collaborators, and answer support requests. The legal basis is performance of our contract with you.</li>
        <li>To bill for hosted plans, keep accounting records, and meet tax or other legal duties. The legal bases are performance of our contract and compliance with legal obligations.</li>
        <li>To secure GoodFolder, investigate abuse, keep an activity record, and learn whether core product actions work. The legal basis is our legitimate interest in running a safe and reliable service.</li>
        <li>To send product or marketing messages when you have asked for them. The legal basis is consent, which you can withdraw.</li>
      </ul>
      <p>
        GoodFolder does not sell personal data. We do not use folder contents for advertising.
      </p>

      <h2 id="ai-labels">AI-written Save labels</h2>
      <p>
        When you make a Save without supplying a label, the hosted service may send OpenRouter a change summary and a capped
        text excerpt so a language model can write a short label. File names or text from a changed file may appear in that excerpt;
        media contributes names rather than its bytes. A failed model request falls back to a local summary and never blocks the Save.
        OpenRouter may route the request to the configured model provider, so its provider terms also apply to that request.
      </p>

      <h2 id="who-receives-data">Who receives data</h2>
      <p>We share only what each provider needs for its job:</p>
      <ul>
        <li><a href="https://stripe.com/privacy" rel="noreferrer">Stripe</a> processes checkout, subscriptions, invoices, and payments.</li>
        <li><a href="https://resend.com/legal/privacy-policy" rel="noreferrer">Resend</a> delivers one-time sign-in links and service emails.</li>
        <li><a href="https://posthog.com/privacy" rel="noreferrer">PostHog</a> receives the limited product analytics described above through its EU service.</li>
        <li><a href="https://openrouter.ai/privacy" rel="noreferrer">OpenRouter</a> and the selected model provider process the small change excerpt used for an AI-written label.</li>
        <li>Infrastructure and object-storage providers host the service, database, folder history, and large files.</li>
      </ul>
      <p>
        A service or assistant you approve, including a Muse connector, receives only the folders and actions allowed by the scopes
        you select. Its own privacy terms govern what it does after receiving that data. We may also disclose information when law
        requires it or when necessary to protect people, the service, or legal rights.
      </p>

      <h2 id="international-transfers">International transfers</h2>
      <p>
        Some providers operate outside the European Economic Area. When personal data crosses borders, we rely on an adequacy
        decision or contractual safeguards recognised by EU law, as applicable. Contact us if you want information about the safeguard
        used for a particular provider.
      </p>

      <h2 id="retention">How long we keep it</h2>
      <ul>
        <li>Account and folder data stays while your hosted account is active, unless you delete a folder or ask us to erase eligible data sooner.</li>
        <li>After hosted access ends, protected folder data remains available in read-and-export mode for 30 days, then enters scheduled deletion.</li>
        <li>Unaccepted uploaded proposal files expire after seven days.</li>
        <li>Billing, fraud-prevention, security, and audit records remain as long as reasonably needed for legal duties, disputes, and service safety.</li>
      </ul>
      <p>Deleting a folder permanently removes its stored content and history from the live service. We may keep the minimum record needed to prove that the deletion occurred.</p>

      <h2 id="security">Security</h2>
      <p>
        GoodFolder uses one-time email sign-in, short-lived or revocable credentials, encrypted network connections, scoped service
        access, and activity records. The internal file-transport service has no public port and does not receive an end-user credential.
        No internet service can promise perfect security, so keep the backup you already trust.
      </p>

      <h2 id="your-rights">Your rights</h2>
      <p>
        Depending on where you live, you may ask to access, correct, export, restrict, object to, or erase personal data. You may also
        withdraw consent where consent is the legal basis. Email <a href="mailto:contact@trygoodfolder.com">contact@trygoodfolder.com</a>;
        we may need to confirm that the account is yours before acting.
      </p>
      <p>
        People in the EEA can complain to their local supervisory authority. In Portugal, that is the
        {" "}<a href="https://www.cnpd.pt/" rel="noreferrer">Comissão Nacional de Proteção de Dados</a> (CNPD).
      </p>

      <h2 id="children">Children</h2>
      <p>
        The hosted service is not directed to children. If you believe a child supplied personal data without the permission required
        by local law, contact us so we can investigate and remove it where appropriate.
      </p>

      <h2 id="changes">Changes to this policy</h2>
      <p>
        We will update the date at the top when this policy changes. If a change materially affects how we use account or folder data,
        we will give account holders reasonable notice through the service or by email.
      </p>
    </LegalPage>
  );
}
