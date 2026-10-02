import { redirect } from "next/navigation";

/** Moved to the Workspace area. */
export default function SettingsPage() {
  redirect("/workspace/settings");
}
