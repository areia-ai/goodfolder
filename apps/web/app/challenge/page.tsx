"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BrandLockup } from "@/components/brand";

/**
 * A stable, memorable judge URL. The query enables the isolated browser-only
 * workspace and does not enter an authenticated GoodFolder account.
 */
export default function ChallengePage() {
  useEffect(() => {
    window.location.replace("/dashboard?demo=1");
  }, []);

  return (
    <main className="gf-shell flex min-h-svh flex-col items-center justify-center px-6 text-center">
      <BrandLockup size={40} />
      <h1 className="mt-8 text-[26px] font-bold tracking-[-.03em]">Opening the WebMCP challenge workspace</h1>
      <p className="gf-body mt-3 max-w-md text-[15px]">
        This isolated workspace includes sample work for an agent to inspect and prepare for review. It does not
        require an account and does not touch a real GoodFolder.
      </p>
      <Link href="/dashboard?demo=1" className="gf-button-primary mt-7">
        Open workspace
      </Link>
    </main>
  );
}
