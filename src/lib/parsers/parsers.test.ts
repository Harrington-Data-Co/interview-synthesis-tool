import { describe, expect, it } from "vitest";
import { parseCues } from "./cues";
import { parseMeetHtml } from "./docx";
import { guessFromFilename } from "./filename";
import { parseTranscript, TranscriptParseError } from "./index";
import { parsePlain } from "./plain";
import { decodeEntities, mergeTurns, parseClock, splitSpeaker } from "./text";

// Every sample here is synthetic, shaped after a real export's layout. Real
// client transcripts live in fixtures/private/ and are never committed.

describe("text helpers", () => {
  it("decodes the character references Teams writes into names", () => {
    expect(decodeEntities("Th&#232;o &amp; Ana &#x4E;")).toBe("Thèo & Ana N");
  });

  it("parses clock times in every form the sources use", () => {
    expect(parseClock("00:01:02.500")).toBe(62.5);
    expect(parseClock("00:01:02,5")).toBe(62.5);
    expect(parseClock("01:02")).toBe(62);
    expect(parseClock("1:00:00")).toBe(3600);
    expect(parseClock("soon")).toBeNull();
  });

  it("merges consecutive segments into whole turns", () => {
    const lines = mergeTurns([
      { speaker: "Ana", text: "First part,", tsStart: 1, tsEnd: 2 },
      { speaker: "Ana", text: "second part.", tsStart: 2, tsEnd: 4 },
      { speaker: "Ben", text: "Reply.", tsStart: 5, tsEnd: 6 },
      { speaker: "Ben", text: "   ", tsStart: 6, tsEnd: 7 },
      { speaker: "Ana", text: "Back to me.", tsStart: 8, tsEnd: 9 },
    ]);
    expect(lines).toEqual([
      { n: 1, speaker: "Ana", text: "First part, second part.", tsStart: 1, tsEnd: 4 },
      { n: 2, speaker: "Ben", text: "Reply.", tsStart: 5, tsEnd: 6 },
      { n: 3, speaker: "Ana", text: "Back to me.", tsStart: 8, tsEnd: 9 },
    ]);
  });

  it("splits on a known name even when the name contains a colon", () => {
    expect(splitSpeaker("Pat :): Sounds good", ["Pat :)"])).toEqual({
      speaker: "Pat :)",
      text: " Sounds good",
    });
  });

  it("does not mistake a sentence with a colon for a speaker", () => {
    expect(splitSpeaker("The thing I kept coming back to was this: nobody owns it.")).toBeNull();
    expect(splitSpeaker("Ana Lopez: Hello")).toEqual({ speaker: "Ana Lopez", text: "Hello" });
  });
});

describe("WebVTT and SRT", () => {
  it("reads a Teams export: voice tags, wrapped cues, entities, split utterances", () => {
    const vtt = [
      "WEBVTT",
      "",
      "0a1b/6-0",
      "00:00:06.965 --> 00:00:09.525",
      "<v Ana Lopez>Hello there.",
      "Good to see you.</v>",
      "",
      "0a1b/5-0",
      "00:00:07.045 --> 00:00:07.605",
      "<v Th&#232;o>Hi.</v>",
      "",
      "0a1b/7-0",
      "00:00:10.000 --> 00:00:12.000",
      "<v Th&#232;o>So the first thing,</v>",
      "",
      "0a1b/7-1",
      "00:00:12.000 --> 00:00:15.500",
      "<v Th&#232;o>the reports are late.</v>",
    ].join("\r\n");

    const t = parseCues(vtt, "vtt");
    expect(t.lines).toEqual([
      { n: 1, speaker: "Ana Lopez", text: "Hello there. Good to see you.", tsStart: 6.965, tsEnd: 9.525 },
      { n: 2, speaker: "Thèo", text: "Hi. So the first thing, the reports are late.", tsStart: 7.045, tsEnd: 15.5 },
    ]);
    expect(t.speakers).toEqual(["Ana Lopez", "Thèo"]);
    expect(t.durationSecs).toBe(15.5);
  });

  it("reads Zoom-style cues that prefix the speaker instead of tagging it", () => {
    const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nAna Lopez: Morning.\n\n2\n00:00:02.000 --> 00:00:03.000\nBen Ito: Morning!\n";
    expect(parseCues(vtt, "vtt").lines.map((l) => [l.speaker, l.text])).toEqual([
      ["Ana Lopez", "Morning."],
      ["Ben Ito", "Morning!"],
    ]);
  });

  it("reads SRT with comma decimals", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,250\nAna Lopez: One.\n\n2\n00:00:02,250 --> 00:00:04,000\nAna Lopez: Two.\n";
    const t = parseCues(srt, "srt");
    expect(t.lines).toEqual([{ n: 1, speaker: "Ana Lopez", text: "One. Two.", tsStart: 1, tsEnd: 4 }]);
  });
});

describe("Google Meet docx", () => {
  const anchor = (id: string) => `<a id="_${id}"></a>`;

  it("reads only the transcript from a Notes by Gemini doc", () => {
    const html = [
      `<p>${anchor("a1")}<strong>✍️ Quick notes</strong></p>`,
      "<p>Ana Lopez: Gemini says Ana discussed budgets.</p>",
      "<h3>Next steps</h3>",
      "<ul><li>[Ana Lopez] Send the report: by Friday.</li></ul>",
      `<p>${anchor("a2")}<strong>📖 Transcript</strong></p>`,
      "<p>Aug 28, 2026</p>",
      "<p>Ana &amp; Ben (Cy Park) - Transcript</p>",
      `<p>${anchor("t0")}00:00:00</p>`,
      "<p><strong>Ana Lopez: </strong>Welcome, thanks for joining.</p>",
      "<p><strong>Ana Lopez: </strong>Shall we start?</p>",
      "<p><strong>Pat :): </strong>Yes please.</p>",
      `<p>${anchor("t1")}00:00:47</p>`,
      "<p><strong>Cy Park: </strong>We rebuild the roster by hand every month.</p>",
      "<p>Transcription ended after 00:35:04</p>",
      "<p>This editable transcript was computer generated and might contain errors.</p>",
    ].join("");

    const t = parseMeetHtml(html);
    expect(t.layout).toBe("meet-gemini");
    expect(t.lines).toEqual([
      { n: 1, speaker: "Ana Lopez", text: "Welcome, thanks for joining. Shall we start?", tsStart: 0, tsEnd: null },
      { n: 2, speaker: "Pat :)", text: "Yes please.", tsStart: null, tsEnd: null },
      { n: 3, speaker: "Cy Park", text: "We rebuild the roster by hand every month.", tsStart: 47, tsEnd: null },
    ]);
    expect(t.durationSecs).toBe(35 * 60 + 4);
    expect(t.lines.some((l) => l.text.includes("Gemini says"))).toBe(false);
  });

  it("reads a Meet transcript doc, splitting on the attendee list", () => {
    const html = [
      "<h1>Ana &amp; Ben (Cy Park) - 2026/09/22 15:45 EDT - Transcript</h1>",
      "<h2>Attendees</h2>",
      "<p>Ana Lopez, Cy Park, Pat :)</p>",
      "<h2><strong>Transcript</strong></h2>",
      "<p>Ana Lopez: Hi Cy, you are muted.</p>",
      "<p>Cy Park: Sorry, I wasn't…</p>",
      "<p>Pat :): Hi all.</p>",
      "<p>Cy Park: As I was saying,<br />the roster is manual.</p>",
      "<p>This editable transcript was computer generated and might contain errors.</p>",
    ].join("");

    const t = parseMeetHtml(html);
    expect(t.layout).toBe("meet-transcript");
    expect(t.lines.map((l) => [l.speaker, l.text])).toEqual([
      ["Ana Lopez", "Hi Cy, you are muted."],
      ["Cy Park", "Sorry, I wasn't…"],
      ["Pat :)", "Hi all."],
      ["Cy Park", "As I was saying, the roster is manual."],
    ]);
    expect(t.durationSecs).toBeNull();
  });
});

describe("plain text (Wispr Flow, pasted)", () => {
  it("reads Name: text lines with irregular spacing and merges turns", () => {
    const t = parsePlain("Ana Lopez: Hello.\nBen Ito:  Hi, good to\nBen Ito:  see you.\n\nAna Lopez:  Great.");
    expect(t.lines.map((l) => [l.speaker, l.text])).toEqual([
      ["Ana Lopez", "Hello."],
      ["Ben Ito", "Hi, good to see you."],
      ["Ana Lopez", "Great."],
    ]);
  });

  it("honours markdown speaker labels and skips headings", () => {
    const t = parsePlain("## Transcript\n**Ana Lopez:** Hello.\n**Ben Ito**: Hi.\ncontinued here");
    expect(t.lines.map((l) => [l.speaker, l.text])).toEqual([
      ["Ana Lopez", "Hello."],
      ["Ben Ito", "Hi. continued here"],
    ]);
  });
});

describe("filename guesses", () => {
  it("reads participant and date from a Google Meet export name", () => {
    expect(
      guessFromFilename("Ana & Ben (Cy (Cee) Park) - 2026_08_31 09_59 EDT - Notes by Gemini.docx"),
    ).toEqual({ title: "Ana & Ben (Cy (Cee) Park)", participant: "Cy (Cee) Park", recordedOn: "2026-08-31" });
  });

  it("reads the participant from a Teams export name, with no date", () => {
    expect(guessFromFilename("60-min meeting - Cy Park.vtt")).toEqual({
      title: "60-min meeting - Cy Park",
      participant: "Cy Park",
      recordedOn: null,
    });
  });
});

describe("parseTranscript", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it("refuses formats it can't read", async () => {
    await expect(parseTranscript("call.pdf", bytes("x"))).rejects.toBeInstanceOf(TranscriptParseError);
  });

  it("refuses a file with no speaker turns, such as a pasted summary", async () => {
    const summary = "### Data Strategy\n- The plan is circulating\n- Funding is pending";
    await expect(parseTranscript("notes.md", bytes(summary))).rejects.toBeInstanceOf(TranscriptParseError);
  });

  it("detects WebVTT by content even with a .txt name", async () => {
    const t = await parseTranscript("export.txt", bytes("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Ana>Hi.</v>\n"));
    expect(t.layout).toBe("vtt");
  });
});
