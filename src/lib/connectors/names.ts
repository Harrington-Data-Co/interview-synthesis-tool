/** Meet transcript names: pure, so the browser can use them too. */

/** The meeting's title and date from a Meet transcript's file name. Names
 *  that don't follow Meet's pattern keep their whole name as the title. */
export function parseMeetName(name: string): { title: string; recordedOn: string | null; time: string | null } {
  const m = name.match(/^(.*?)\s+-\s+(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}:\d{2}(?:\s*[A-Z]{2,5})?)\s+-\s+Transcript(?:\s*\(.*\))?\s*$/);
  if (!m) return { title: name.replace(/\s+-\s+Transcript\s*$/, "").trim(), recordedOn: null, time: null };
  return { title: m[1].trim(), recordedOn: `${m[2]}-${m[3]}-${m[4]}`, time: m[5].trim() };
}

/** The file name Drive's own "Download as .docx" gives a Doc: characters
 *  that can't be in a file name ("/" in the date, ":" in the time, and the
 *  like) become "_". Imports are named the same way, so a transcript looks
 *  the same whether it was downloaded by hand or imported. */
export const docxName = (name: string) => `${name.replace(/[\\/:*?"<>|]/g, "_").trim()}.docx`;
