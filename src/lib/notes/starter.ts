/** The template offered when the library is empty: sections for a process-
 *  discovery interview, each filled by the code types that belong there.
 *  "Role & context" takes any type — background comes from anywhere. Edit it
 *  freely once it's in the library. */
export const STARTER_TEMPLATE = {
  name: "Discovery interview",
  scope: "One person's account of how their work happens today: the steps, the systems, what goes wrong, and what they need.",
  sections: [
    {
      name: "Role & context",
      requires: [] as string[],
      note: "Who they are, what their team is responsible for, and who they work with.",
    },
    {
      name: "How the work happens today",
      requires: ["Step"],
      note: "The process as they actually run it, in order where the order matters.",
    },
    {
      name: "Systems & data",
      requires: ["Tool"],
      note: "The systems, spreadsheets, reports and data sources involved, and how each is used.",
    },
    {
      name: "Pain points",
      requires: ["Pain"],
      note: "What costs time, accuracy or trust, and the workarounds it forces.",
    },
    {
      name: "Constraints",
      requires: ["Constraint"],
      note: "Rules, funding terms, capacity limits and dependencies that shape the work.",
    },
    {
      name: "Goals",
      requires: ["Goal"],
      note: "What they want to be able to do, decide or see.",
    },
    {
      name: "Open questions",
      requires: ["Question"],
      note: "What they don't know or can't yet find out.",
    },
  ],
};

/** The memo template offered when the memo library is empty. "Findings"
 *  takes one or two paragraphs per confirmed theme. */
export const STARTER_MEMO_TEMPLATE = {
  name: "Findings memo",
  scope: "What the interviews found, for the client: the headline findings, the evidence behind each, and what's still open.",
  sections: [
    {
      name: "Summary",
      requires: ["themes"],
      note: "Two or three sentences: the most important findings, stated plainly, for a reader who reads nothing else.",
    },
    {
      name: "Findings",
      requires: ["themes"],
      note: "One or two paragraphs per confirmed theme, most-supported first: the finding, then what the interviews showed.",
    },
    {
      name: "Open questions",
      requires: ["Question"],
      note: "What the interviews couldn't answer, and who might be able to.",
    },
  ],
};

/** The deck template offered when the deck library is empty: a readout for
 *  the client, one slide per finding with the evidence and a participant's
 *  own words. */
export const STARTER_DECK_TEMPLATE = {
  name: "Findings readout",
  scope: "A slide deck for the client readout: the headline, a slide per key finding with its evidence and a participant's words, and what's still open.",
  sections: [
    {
      name: "Headline",
      requires: ["themes"],
      note: "One statement slide: the single most important finding, as a full sentence.",
    },
    {
      name: "Findings",
      requires: ["themes"],
      note: "One slide per confirmed theme, most-supported first: the finding as the headline, two to four bullets on what the interviews showed, and a participant's quote where one says it best.",
    },
    {
      name: "In their words",
      requires: ["themes"],
      note: "Two or three quote slides: participants' own words that capture the findings best.",
    },
    {
      name: "Open questions",
      requires: ["Question"],
      note: "What the interviews couldn't answer, and who might be able to.",
    },
  ],
};
