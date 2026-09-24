import { createClient } from "@/lib/supabase/server";

export type SeatRole = "owner" | "editor" | "viewer";

export type Seat = {
  user_id: string;
  name: string;
  initials: string;
  email: string;
  role: SeatRole;
  title: string | null;
};

/** The signed-in person's seat, or null if they have a Supabase account but no
 *  seat on this workspace. Those are different things: authentication says who
 *  you are, the seat says whether you belong here and what you may change. */
export async function currentSeat(): Promise<Seat | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("seat")
    .select("user_id,name,initials,email,role,title")
    .eq("user_id", user.id)
    .maybeSingle();

  return (data as Seat) ?? null;
}

export function canEdit(seat: Seat | null): boolean {
  return !!seat && seat.role !== "viewer";
}
