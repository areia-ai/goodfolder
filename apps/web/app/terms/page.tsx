import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of service | GoodFolder",
  description: "The terms that apply to the hosted GoodFolder service.",
  alternates: { canonical: "/terms" },
};

const UPDATED = "19 September 2026";

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal · Terms"
      title="Terms of service"
      summary="These terms apply to the hosted GoodFolder service. They set out what GoodFolder does, what remains your responsibility, and how paid access works."
      updated={UPDATED}
    >
      <h2 id="agreement">Agreement and operator</h2>
      <p>
        GoodFolder is operated by Carlos Marcial in Portugal. By creating an account, using the hosted service at trygoodfolder.com,
        or authorising a service to use it, you agree to these terms and the <a href="/privacy">privacy policy</a>. If you use GoodFolder
        for an organisation, you confirm that you can accept these terms for it.
      </p>
      <p>Email <a href="mailto:contact@trygoodfolder.com">contact@trygoodfolder.com</a> with questions about these terms.</p>

      <h2 id="the-service">What GoodFolder does</h2>
      <p>
        GoodFolder gives a folder a readable history. A Save records the folder at that moment; Sync carries saved work between connected
        computers; Timeline shows what happened; Restore creates a new Save matching an earlier one. The hosted service keeps a copy of
        protected files and history so you can view them in a browser and use them on another connected computer.
      </p>
      <p>
        GoodFolder is not a continuous backup or a general cloud drive. It only protects work that has been Saved, so you should keep the
        backup you already trust. There is no desktop installer yet; setup uses a compatible agent or the command-line tools.
      </p>

      <h2 id="accounts-and-access">Accounts and access</h2>
      <p>
        You sign in through a one-time email link. Keep control of that inbox and promptly revoke a computer, collaborator, service key,
        or assistant that should no longer have access. You are responsible for activity performed through credentials you authorised until
        you revoke them or tell us they are compromised.
      </p>
      <p>
        A connected service receives only the scopes you approve. It cannot reach billing, invite people, delete folders, or access another
        account through a service key. Third-party assistants and services also have their own terms.
      </p>

      <h2 id="your-content">Your content</h2>
      <p>
        You keep ownership of your files, saved history, comments, and proposals. You give GoodFolder a limited licence to host, copy,
        transmit, and process that content only as needed to provide, secure, and support the service. This licence ends when the content is
        deleted, except where a short-lived technical copy or a legally required record must remain.
      </p>
      <p>
        You must have the right to upload and share the content you place in GoodFolder. Do not use the service for illegal material, malware,
        infringement, unauthorised access, harassment, or attempts to overload or bypass service limits. We may remove content or suspend
        access when reasonably necessary to stop harm, investigate abuse, or comply with law.
      </p>

      <h2 id="agents-and-ai">Agents and AI-generated text</h2>
      <p>
        Agents can make consequential changes to files. Review their work and make a Save before a risky edit. Browser assistants can prepare
        a Change Proposal, but a person must accept it before it joins the folder. Restore records another Save rather than erasing later history.
      </p>
      <p>
        GoodFolder may ask a language model to write a short Save label from a capped change excerpt. Labels can be incomplete or wrong; the
        saved file history, not the label, is the record of what changed. The <a href="/privacy#ai-labels">privacy policy</a> explains what is sent.
      </p>

      <h2 id="plans-and-payment">Plans, trials, and payment</h2>
      <p>
        Hosted plans, included capacity, overage rates, billing interval, and trial terms appear before checkout. Stripe processes payment and
        manages the billing portal. By starting a paid subscription, you authorise the recurring charges and any metered storage charges shown
        at checkout until cancellation takes effect.
      </p>
      <p>
        You can manage or cancel a subscription through the billing portal. The portal and checkout show the effective date, price, taxes, and
        renewal terms that apply to your purchase. Statutory consumer rights still apply. If you are an EEA consumer and want to exercise a right
        of withdrawal, email <a href="mailto:contact@trygoodfolder.com">contact@trygoodfolder.com</a> within the applicable period.
      </p>

      <h2 id="ending-access">Ending access and deleting data</h2>
      <p>
        When hosted access ends, the account enters read-and-export mode for 30 days before protected folder data is scheduled for deletion.
        Delete or export anything you need during that period. Deleting an individual folder is permanent and removes its stored files and history.
      </p>
      <p>
        You may stop using GoodFolder at any time. We may suspend or terminate hosted access for a material breach, non-payment, security risk,
        unlawful use, or conduct that could harm the service or other people. Where the problem can be fixed safely, we will try to give notice and
        a reasonable chance to correct it.
      </p>

      <h2 id="open-source">Open-source version</h2>
      <p>
        The source code is available under the GNU Affero General Public License v3.0. Self-hosted installations are run by their own operator,
        not by the hosted GoodFolder service. The open-source licence governs the code; these terms govern the hosted service.
      </p>

      <h2 id="availability">Availability and changes</h2>
      <p>
        We work to keep the hosted service available and to preserve saved data, but no online service is uninterrupted or error-free. We may
        change features, limits, or prices as the product develops. We will give reasonable notice before a material change takes effect for an
        existing paid subscription, unless an urgent security or legal issue prevents advance notice.
      </p>

      <h2 id="warranties-and-liability">Warranties and liability</h2>
      <p>
        To the extent the law permits, the hosted service is provided as available and without promises beyond these terms. GoodFolder is not
        liable for indirect or consequential loss, loss caused by content or credentials under your control, or work that was never Saved.
      </p>
      <p>
        Nothing in these terms excludes liability that law does not allow us to exclude, including liability for fraud, deliberate misconduct,
        gross negligence, or personal injury where applicable. Mandatory consumer guarantees and remedies remain unchanged.
      </p>

      <h2 id="governing-law">Governing law</h2>
      <p>
        Portuguese law governs these terms. Courts in Portugal have jurisdiction, but consumers keep any mandatory protections and right to use
        the courts available under the law of their country of residence.
      </p>

      <h2 id="changes">Changes to these terms</h2>
      <p>
        We will update the date at the top when these terms change. If a change materially affects an account or paid plan, we will give reasonable
        notice through the service or by email. Continuing to use the hosted service after the new terms take effect means you accept them; if you
        do not, stop using the service and cancel the subscription before renewal.
      </p>
    </LegalPage>
  );
}
