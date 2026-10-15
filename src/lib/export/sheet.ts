import ExcelJS from "exceljs";

export type SheetColumn = { header: string; key: string; width?: number; wrap?: boolean };
export type SheetSpec = { name: string; columns: SheetColumn[]; rows: Record<string, string | number | null>[] };

// Excel's own rules for a sheet name.
const sheetName = (n: string) => n.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";

/** A workbook, one sheet per spec: bold frozen header row, wrapped long text,
 *  filters on. Cells are written as values, never formulas, so a quote that
 *  begins with "=" stays a quote. */
export async function workbook(sheets: SheetSpec[], creator: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  wb.created = new Date();
  for (const spec of sheets) {
    const ws = wb.addWorksheet(sheetName(spec.name), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = spec.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 16,
      style: c.wrap ? { alignment: { wrapText: true, vertical: "top" } } : { alignment: { vertical: "top" } },
    }));
    ws.addRows(spec.rows);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: "middle" };
    if (spec.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
