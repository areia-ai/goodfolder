import Link from "next/link";
import { BrandLockup } from "@/components/brand";

export function LegalPage({
  eyebrow,
  title,
  summary,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-svh bg-[var(--gf-surface-sunken)]">
      <a href="#main" className="gf-skip-link">Skip to content</a>
      <header className="border-b border-[var(--gf-line)] bg-white">
        <div className="gf-wrap flex h-16 items-center justify-between gap-4">
          <Link href="/" aria-label="GoodFolder home"><BrandLockup size={34} /></Link>
          <nav aria-label="Legal pages" className="flex items-center gap-1">
            <Link href="/privacy" className="gf-button-ghost">Privacy</Link>
            <Link href="/terms" className="gf-button-ghost">Terms</Link>
          </nav>
        </div>
      </header>

      <main id="main" className="gf-wrap py-14 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <p className="gf-eyebrow">{eyebrow}</p>
          <h1 className="gf-h2 mt-4">{title}</h1>
          <p className="gf-lead mt-5">{summary}</p>
          <p className="gf-faint mt-4 text-[13px]">Last updated {updated}</p>
          <article className="gf-doc mt-12">{children}</article>
        </div>
      </main>

      <footer className="border-t border-[var(--gf-line)] bg-white">
        <div className="gf-wrap flex flex-col gap-4 py-8 text-[13px] sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="underline underline-offset-4">Back to GoodFolder</Link>
          <p className="gf-faint">
            Questions? <a href="mailto:contact@trygoodfolder.com" className="underline underline-offset-4">contact@trygoodfolder.com</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
