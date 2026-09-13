/**
 * Links the control plane hands out that open in a browser: invitations and
 * proposal review pages. They point at the dashboard, which is a different
 * origin from the API whenever the two are hosted separately.
 *
 * WEB_URL is read at call time, not captured at startup, so a test can set
 * it without a reload and a changed environment never leaves a stale link
 * behind. Unset, links go to the hosted dashboard.
 */
export function dashboardLink(path: string): string {
  const webUrl = (process.env.WEB_URL ?? "https://trygoodfolder.com").trim().replace(/\/+$/, "");
  return `${webUrl}/dashboard${path}`;
}
