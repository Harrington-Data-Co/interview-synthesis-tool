/** Colours for data visualization, wherever a chart needs more than one.
 *  Assign them in this order and never cycle them; a catch-all category
 *  ("Other") always takes OTHER_COLOR. Checked with the dataviz skill's
 *  validator on white: every colour clears 3:1, and adjacent pairs pass the
 *  colour-blind checks. Amber beside grey is the weakest pair, so stacked
 *  segments keep a surface gap and printed counts. */
export const DATA_COLORS = ["#127A5B", "#3B6DB3", "#C27A22", "#8B5AA0", "#C0503A"] as const;
export const OTHER_COLOR = "#8A8F94";

/** A series colour pulled toward grey, for series that aren't in focus. */
export const muted = (color: string) => `color-mix(in oklab, ${color} 38%, #D3D6D9)`;
