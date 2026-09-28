import mammoth from "mammoth";
import { decodeEntities, mergeTurns, speakersOf, squash } from "./text";
import type { ParsedTranscript } from "./types";
import { walkRows, type Row } from "./walk";

export async function docxToHtml(bytes: Uint8Array): Promise<string> {
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return value;
}

type Para = { html: string; text: string };

const plain = (html: string) =>
  squash(decodeEntities(html.replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "")));

function paragraphs(html: string): Para[] {
  return [...html.matchAll(/<(p|h[1-6]|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => {
    const inner = m[2].replace(/<a\b[^>]*>\s*<\/a>/g, ""); // Docs bookmark anchors
    return { html: inner, text: plain(inner) };
  });
}

/** Google Meet's two docx layouts, with a generic fallback.
 *
 *  "Notes by Gemini": Gemini's AI notes come first and are ignored — they are
 *  a machine's summary of what was said, not a record of it. Only the section
 *  after the "📖 Transcript" heading is read. Speaker names are bold, which
 *  matters: a display name can itself contain a colon ("Jen :)").
 *
 *  "Transcript": title, an Attendees paragraph, a Transcript heading, then
 *  plain "Name: text" paragraphs. The attendee list gives the exact names to
 *  split on. */
export function parseMeetHtml(html: string): ParsedTranscript {
  const paras = paragraphs(html);

  const gemini = paras.findIndex((p) => /^📖\s*Transcript$/.test(p.text));
  if (gemini !== -1) {
    const rows: Row[] = paras.slice(gemini + 1).map((p) => {
      const bold = p.html.match(/^<strong>([\s\S]*?)<\/strong>([\s\S]*)$/);
      if (!bold) return { text: p.text };
      const name = plain(bold[1]);
      if (name.endsWith(":")) {
        return { text: p.text, boldName: name.slice(0, -1).trim(), boldRest: plain(bold[2]) };
      }
      const rest = plain(bold[2]);
      return rest.startsWith(":")
        ? { text: p.text, boldName: name, boldRest: rest.slice(1) }
        : { text: p.text };
    });
    return finish("meet-gemini", rows);
  }

  const heading = paras.findIndex((p) => p.text === "Transcript");
  if (heading !== -1) {
    const att = paras.findIndex((p) => p.text === "Attendees");
    const attendees =
      att !== -1 && att < heading
        ? paras[att + 1].text.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    return finish("meet-transcript", paras.slice(heading + 1), attendees);
  }

  return finish("plain", paras);
}

function finish(
  layout: ParsedTranscript["layout"],
  rows: Row[],
  known: string[] = [],
): ParsedTranscript {
  const { segments, durationSecs } = walkRows(rows, known);
  const lines = mergeTurns(segments);
  return { layout, lines, speakers: speakersOf(lines), durationSecs };
}
