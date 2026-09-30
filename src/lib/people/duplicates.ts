/** Letters only, lower case: "Dana R." → ["dana", "r"]. */
const words = (name: string) =>
  name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(/[^\p{L}]+/u)
    .filter(Boolean);

/** Could these two be the same person? Same first name, and either one has
 *  no surname or the surnames start alike ("Dana", "Dana Reyes", "Dana R.").
 *  A prompt to look, never a merge. */
export function maybeSame(a: string, b: string): boolean {
  const [x, y] = [words(a), words(b)];
  if (!x.length || !y.length || x[0] !== y[0]) return false;
  const [xl, yl] = [x.at(-1)!, y.at(-1)!];
  if (x.length === 1 || y.length === 1) return true;
  return xl[0] === yl[0] && (xl.length === 1 || yl.length === 1 || xl === yl);
}

/** The ids of people who might be someone else in the list. */
export function possibleDuplicates(people: { id: string; name: string }[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < people.length; i++)
    for (let j = i + 1; j < people.length; j++)
      if (maybeSame(people[i].name, people[j].name)) {
        out.add(people[i].id);
        out.add(people[j].id);
      }
  return out;
}
