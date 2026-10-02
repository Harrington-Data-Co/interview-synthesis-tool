import { redirect } from "next/navigation";

/** Moved under Settings, in the account menu. */
export default function MembersPage() {
  redirect("/settings");
}
