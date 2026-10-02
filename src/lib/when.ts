/** The time zone dates are shown in when they're formatted on the server.
 *  Vercel's servers run on UTC, so without this an upload made at 4pm in
 *  Delaware would read 8pm. */
export const APP_TIME_ZONE = process.env.NEXT_PUBLIC_TIME_ZONE || "America/New_York";

/** "Sep 30, 2026, 4:12 PM" in the app's time zone. */
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: APP_TIME_ZONE });

/** "today", "yesterday", "3 days ago", "Sep 2": for when someone last signed
 *  in. Worked out on the server, so a page doesn't change on re-render. */
export function sinceText(iso: string | null, now = Date.now()): string {
  if (!iso) return "never signed in";
  const then = new Date(iso);
  const days = Math.floor((now - then.getTime()) / 86_400_000);
  if (days <= 0) return "signed in today";
  if (days === 1) return "signed in yesterday";
  if (days < 30) return `signed in ${days} days ago`;
  return `last signed in ${then.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: APP_TIME_ZONE })}`;
}
