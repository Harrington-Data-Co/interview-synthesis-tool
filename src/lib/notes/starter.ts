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
