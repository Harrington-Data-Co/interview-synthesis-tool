/** The roles, with what each may do, for the members screens. A plain
 *  module, not the client component: a server component that imports a
 *  value from a "use client" file gets a reference to it, not the value. */

export const PROJECT_ROLES = [
  ["owner", "Owner", "Everything an editor can, plus members and invitations."],
  ["editor", "Editor", "Adds transcripts; codes, notes, themes and every deliverable."],
  ["viewer", "Viewer", "Reads everything; changes nothing."],
  ["client", "Client", "Reads the deliverables. See below."],
] as const;

export const WORKSPACE_ROLES = [
  ["owner", "Owner", "Sees and manages every project and every member."],
  ["editor", "Editor", "Starts projects; edits People, Organizations and the template library; uploads to Unassigned."],
  ["viewer", "Viewer", "Reads People, Organizations and the template library."],
  ["", "None", "From outside Harrington: sees only the projects they're invited to."],
] as const;

export const CLIENT_ACCESS = [
  ["deliverables", "Deliverables", "The memo, deck, process flows and architecture, confirmed themes, and the quotes they cite — by title, never by name. No transcripts, notes or people."],
  ["full", "Everything, read-only", "Also the transcripts, codes, notes, chain and corpus, with names. Changes nothing."],
] as const;
