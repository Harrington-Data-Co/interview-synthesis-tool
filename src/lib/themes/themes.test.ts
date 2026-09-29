import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { gateThemes } from "./gate";
import { themeMessage, type ThemeCode } from "./prompt";
import { proposeThemes } from "./run";

const code = (key: string, type = "Pain"): ThemeCode => ({ id: key.toLowerCase(), key, type, label: `${key} label`, verbatim: `${key} quote` });
const codes = [code("I1:PAIN-01"), code("I2:PAIN-01"), code("I2:STEP-01", "Step")];

describe("gateThemes", () => {
  it("resolves keys across interviews, tolerating case and spacing", () => {
    const { accepted, rejected } = gateThemes(
      [{ title: " Rosters are\nrebuilt by hand ", description: "Both.", codes: ["I1:PAIN-01", "i2: pain-01", "I1:PAIN-01"] }],
      codes,
    );
    expect(rejected).toEqual([]);
    expect(accepted).toEqual([{ title: "Rosters are rebuilt by hand", description: "Both.", code_ids: ["i1:pain-01", "i2:pain-01"] }]);
  });

  it("keeps a theme without its unknown keys, and records them for review", () => {
    const { accepted, rejected } = gateThemes(
      [{ title: "Rebuilt by hand", description: "", codes: ["I1:PAIN-01", "I9:PAIN-04", "I2:GOAL-02"] }],
      codes,
    );
    expect(accepted).toEqual([{ title: "Rebuilt by hand", description: "", code_ids: ["i1:pain-01"] }]);
    expect(rejected).toEqual([
      {
        proposal: { title: "Rebuilt by hand", description: "", codes: ["I9:PAIN-04", "I2:GOAL-02"] },
        reason: '"Rebuilt by hand" was kept, but I9:PAIN-04, I2:GOAL-02 aren\'t codes in this project, so they were left out.',
      },
    ]);
  });

  it("rejects a theme with no real codes, or no title", () => {
    const { accepted, rejected } = gateThemes(
      [
        { title: "Made up", description: "", codes: ["I7:PAIN-01"] },
        { title: " ", description: "", codes: ["I1:PAIN-01"] },
      ],
      codes,
    );
    expect(accepted).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual([
      "None of the theme's codes are codes in this project.",
      "The theme has no title.",
    ]);
  });
});

describe("themeMessage", () => {
  it("keys interviews and codes, and lists established themes so they aren't repeated", () => {
    const msg = themeMessage(
      "PDG",
      [{ key: "I1", title: "60-min", participant: "Liz Harris", organization: "DOE › OEL" }],
      [{ ref: "TH-1", title: "Rosters are rebuilt by hand" }],
      codes,
    );
    expect(msg).toContain("I1. 60-min — Liz Harris, DOE › OEL");
    expect(msg).toContain("<established_themes>\nTH-1. Rosters are rebuilt by hand\n</established_themes>");
    expect(msg).toContain("I2:STEP-01 [Step] I2:STEP-01 label — “I2:STEP-01 quote”");
  });
});

describe("proposeThemes", () => {
  it("returns Claude's themes", async () => {
    const themes = [{ title: "T", description: "D", codes: ["I1:PAIN-01"] }];
    const client = {
      beta: {
        messages: {
          stream: () => ({
            finalMessage: async () => ({
              model: "claude-opus-5-5",
              stop_reason: "end_turn",
              usage: { input_tokens: 30000, output_tokens: 4000 },
              content: [{ type: "text", text: JSON.stringify({ themes }) }],
            }),
          }),
        },
      },
    } as unknown as Anthropic;
    const r = await proposeThemes("PDG", [], [], codes, client);
    expect(r.proposals).toEqual(themes);
    expect(r.usage.cost_usd).toBeCloseTo(0.2);
  });
});
