import { AccessLog } from "@/components/members/AccessLog";

/** Every invitation, acceptance, role change and removal, newest first. */
export default function ActivityPage() {
  return (
    <>
      <p className="meta" style={{ margin: 0, maxWidth: 720 }}>
        Who invited, added, changed or removed whom, and when. The database records these itself, so nothing gets
        past it. A project&apos;s owners see their project&apos;s on its Members tab.
      </p>
      <AccessLog limit={200} heading={false} />
    </>
  );
}
