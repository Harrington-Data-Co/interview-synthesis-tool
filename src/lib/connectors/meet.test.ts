import { describe, expect, it } from "vitest";
import { docxName, meetQuery, parseMeetName } from "./meet";

describe("parseMeetName", () => {
  it("reads the meeting and date from Meet's names", () => {
    expect(parseMeetName("Longwood & HDC (Sierra) - 2026/09/29 14:00 EDT - Transcript")).toEqual({ title: "Longwood & HDC (Sierra)", recordedOn: "2026-09-29", time: "14:00 EDT" });
    expect(parseMeetName("DOE / OEL - Licensing walkthrough - 2026/09/12 9:30 EDT - Transcript (1)")).toEqual({ title: "DOE / OEL - Licensing walkthrough", recordedOn: "2026-09-12", time: "9:30 EDT" });
    expect(parseMeetName("Kickoff - 2026/01/05 10:00 - Transcript").recordedOn).toBe("2026-01-05");
  });

  it("keeps any other name as the title", () => {
    expect(parseMeetName("Renamed notes - Transcript")).toEqual({ title: "Renamed notes", recordedOn: null, time: null });
    expect(parseMeetName("Transcript of the call")).toEqual({ title: "Transcript of the call", recordedOn: null, time: null });
  });
});

describe("meetQuery", () => {
  it("finds Google Docs named Transcript, without Gemini's notes", () => {
    const q = meetQuery();
    expect(q).toContain("mimeType='application/vnd.google-apps.document'");
    expect(q).toContain("name contains 'Transcript'");
    expect(q).toContain("not name contains 'Notes by Gemini'");
  });

  it("narrows by each word, escaping quotes", () => {
    expect(meetQuery("O'Brien  licensing")).toContain("(name contains 'O\\'Brien' or fullText contains 'O\\'Brien') and (name contains 'licensing'");
  });
});

describe("docxName", () => {
  it("names a Doc the way Drive's .docx download does", () => {
    expect(docxName("A & B (Sierra) - 2026/09/10 14:00 EDT - Transcript")).toBe("A & B (Sierra) - 2026_09_10 14_00 EDT - Transcript.docx");
  });
});
