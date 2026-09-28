/** Details guessed from an export's filename. Every field is a suggestion the
 *  uploader confirms or edits; nothing here is trusted. */
export type FilenameGuess = {
  title: string;
  participant: string | null;
  /** ISO date, "YYYY-MM-DD". */
  recordedOn: string | null;
};

/** The text inside the final balanced parentheses: "Ryan & Jen (Elizabeth
 *  (Betty Gail) Timm)" → "Elizabeth (Betty Gail) Timm". */
function trailingParens(s: string): string | null {
  const t = s.trimEnd();
  if (!t.endsWith(")")) return null;
  let depth = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] === ")") depth++;
    else if (t[i] === "(" && --depth === 0) return t.slice(i + 1, -1).trim() || null;
  }
  return null;
}

export function guessFromFilename(fileName: string): FilenameGuess {
  const base = fileName.replace(/\.[^.]+$/, "").trim();

  // Google Meet: "<meeting> - 2026_08_31 09_59 EDT - Notes by Gemini|Transcript"
  const meet = base.match(
    /^(.*?)\s+-\s+(\d{4})_(\d{2})_(\d{2})\s+\d{2}_\d{2}(?:\s+[A-Z]{2,5})?\s+-\s+(?:Notes by Gemini|Transcript)$/,
  );
  if (meet) {
    const [, title, y, m, d] = meet;
    return { title, participant: trailingParens(title), recordedOn: `${y}-${m}-${d}` };
  }

  // Teams and most others: "<meeting> - <participant>"
  const dash = base.lastIndexOf(" - ");
  return {
    title: base,
    participant: dash > 0 ? base.slice(dash + 3).trim() || null : trailingParens(base),
    recordedOn: null,
  };
}
