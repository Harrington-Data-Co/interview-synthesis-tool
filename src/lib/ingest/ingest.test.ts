import { describe, expect, it } from "vitest";
import { readCommitFields } from "./fields";
import { buildPreview } from "./preview";
import { ApiError } from "@/lib/api";
import { MAX_UPLOAD_BYTES, readSource, sha256Hex, storagePath } from "./source";
import type { ParsedTranscript } from "@/lib/parsers";

const form = (entries: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

describe("readSource", () => {
  it("reads an uploaded file", async () => {
    const s = await readSource(form({ file: new File(["WEBVTT"], "call.vtt", { type: "text/vtt" }) }));
    expect(s).toMatchObject({ fileName: "call.vtt", contentType: "text/vtt", pasted: false });
  });

  it("stores pasted text as a .txt with a safe name", async () => {
    const s = await readSource(form({ pasted: "Ana: hi", pastedName: 'Profisee / "Delaware"' }));
    expect(s.fileName).toBe("Profisee - -Delaware-.txt");
    expect(s.pasted).toBe(true);
    expect(new TextDecoder().decode(s.bytes)).toBe("Ana: hi");
  });

  it("refuses unsupported types, oversized files, and empty requests", async () => {
    await expect(readSource(form({ file: new File(["x"], "deck.pdf") }))).rejects.toThrow(ApiError);
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "big.vtt");
    await expect(readSource(form({ file: big }))).rejects.toMatchObject({ status: 413 });
    await expect(readSource(form({ pasted: "   " }))).rejects.toThrow(ApiError);
  });
});

describe("checksums and storage keys", () => {
  it("hashes bytes as lowercase hex", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("keys storage by checksum, keeping only a clean extension", () => {
    expect(storagePath("ab".repeat(32), "Thère du Pont.VTT")).toBe(`${"ab".repeat(32)}.vtt`);
  });
});

describe("buildPreview", () => {
  const parsed: ParsedTranscript = {
    layout: "meet-gemini",
    durationSecs: 25 * 60 + 12,
    speakers: ["Ryan Harrington", "Elizabeth Timm", "Pat :)"],
    lines: [
      { n: 1, speaker: "Ryan Harrington", text: "Thanks for joining.", tsStart: 0, tsEnd: null },
      { n: 2, speaker: "Elizabeth Timm", text: "Happy to help out today.", tsStart: null, tsEnd: null },
      { n: 3, speaker: "Pat :)", text: "Hi both.", tsStart: null, tsEnd: null },
      { n: 4, speaker: "Elizabeth Timm", text: "So.", tsStart: null, tsEnd: null },
    ],
  };

  it("pre-fills from the filename and guesses roles by first name", () => {
    const p = buildPreview({
      parsed,
      fileName: "Ryan & Pat (Elizabeth (Betty) Timm) - 2026_09_10 14_15 EDT - Notes by Gemini.docx",
      sha256: "0".repeat(64),
      pasted: false,
      uploaderName: "Ryan Harrington",
      duplicateOf: null,
    });
    expect(p).toMatchObject({
      participant: "Elizabeth (Betty) Timm",
      recordedOn: "2026-09-10",
      source: "meet",
      lineCount: 4,
      durationMins: 25,
    });
    expect(p.speakers.map((s) => [s.name, s.role, s.turns, s.words])).toEqual([
      ["Ryan Harrington", "interviewer", 1, 3],
      ["Elizabeth Timm", "participant", 2, 6],
      ["Pat :)", "other", 1, 2],
    ]);
  });

  it("guesses Wispr Flow for pasted text", () => {
    const p = buildPreview({
      parsed: { ...parsed, layout: "plain" },
      fileName: "Pasted transcript.txt",
      sha256: "0".repeat(64),
      pasted: true,
      uploaderName: "Ryan Harrington",
      duplicateOf: null,
    });
    expect(p.source).toBe("wispr");
  });
});

describe("readCommitFields", () => {
  const base = { sha256: "a".repeat(64), title: "Interview" };

  it("accepts a complete form and keeps only valid roles", () => {
    const f = readCommitFields(
      form({
        ...base,
        participant: " Cy Park ",
        recordedOn: "2026-09-10",
        source: "meet",
        roles: JSON.stringify({ "Cy Park": "participant", Ana: "boss" }),
      }),
    );
    expect(f).toMatchObject({ participant: "Cy Park", recordedOn: "2026-09-10", source: "meet", projectId: null });
    expect(f.roles).toEqual({ "Cy Park": "participant" });
  });

  it("refuses a missing title, bad date, unknown source, bad project id, or missing checksum", () => {
    expect(() => readCommitFields(form({ sha256: base.sha256 }))).toThrow(/title/);
    expect(() => readCommitFields(form({ ...base, recordedOn: "10/09/2026" }))).toThrow(/date/);
    expect(() => readCommitFields(form({ ...base, source: "fax" }))).toThrow(/source/);
    expect(() => readCommitFields(form({ ...base, projectId: "x" }))).toThrow(/project/);
    expect(() => readCommitFields(form({ title: "x" }))).toThrow(/checksum/);
  });
});
