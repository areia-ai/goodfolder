import { redirect } from "next/navigation";

/** A stable, direct judge URL for the isolated browser-only workspace. */
export default function ChallengePage() {
  redirect("/dashboard?demo=1");
}
