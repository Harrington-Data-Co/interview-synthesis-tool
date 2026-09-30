import { kindsInUse, nearestOfKind, orgLabel, type OrgOption } from "@/lib/directory";
import { NONE, type Column } from "./view";

/** A column per organization kind in use (Agency, Department, Division…),
 *  outermost first. A row sits under the nearest organization of that kind
 *  at or above each of its organizations: group people by Department and a
 *  unit of the Office of Early Learning counts under the Department of
 *  Education. Keys are "kind:<kind>". */
export function kindColumns<R>(orgs: OrgOption[], orgIdsOf: (r: R) => string[]): Column<R>[] {
  const byId = new Map(orgs.map((o) => [o.id, o]));
  return kindsInUse(orgs).map((kind) => {
    const under = (r: R) =>
      [
        ...new Set(
          orgIdsOf(r)
            .map((id) => nearestOfKind(id, kind, orgs)?.id)
            .filter((id): id is string => !!id),
        ),
      ].sort((a, b) => (byId.get(a)?.path ?? "").localeCompare(byId.get(b)?.path ?? ""));
    const name = (id: string) => {
      const o = byId.get(id);
      return o ? orgLabel(o) : "Removed organization";
    };
    return {
      key: `kind:${kind.toLowerCase()}`,
      name: kind,
      bucket: (r: R) => under(r).join("|") || NONE,
      label: (b: string) => (b === NONE ? `No ${kind.toLowerCase()}` : b.split("|").map(name).join(", ")),
      rank: (b: string) =>
        b === NONE
          ? ""
          : b
              .split("|")
              .map((id) => byId.get(id)?.path ?? "")
              .join(", ")
              .toLowerCase(),
      sortValue: (r: R) => under(r).map(name).join(", ").toLowerCase() || null,
      sortLabels: ["A → Z", "Z → A"] as [string, string],
    };
  });
}
