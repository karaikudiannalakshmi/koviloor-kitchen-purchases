// Export bar: Print (certified HTML), Excel (data), PDF (rasterized print-sheet → correct Tamil).
// Props:
//   filename      base name (no extension)
//   printSheetId  id of the <PrintSheet> to print / rasterize
//   excelSheets   [{ name, columns, rows }] for the .xlsx
//   disabled
export default function ReportActions({ filename, printSheetId, excelSheets, disabled }) {
  async function doPrint() {
    const { printCertified } = await import('../lib/exporters');
    printCertified();
  }
  async function doExcel() {
    const { exportExcel } = await import('../lib/exporters');
    exportExcel(filename, excelSheets);
  }
  async function doPDF() {
    const { exportElementPDF } = await import('../lib/exporters');
    await exportElementPDF(document.getElementById(printSheetId), filename);
  }
  return (
    <div className="report-actions">
      <button className="btn btn-ghost btn-sm" onClick={doPrint} disabled={disabled}>🖨 Print</button>
      <button className="btn btn-ghost btn-sm" onClick={doExcel} disabled={disabled}>⤓ Excel</button>
      <button className="btn btn-ghost btn-sm" onClick={doPDF} disabled={disabled}>⤓ PDF</button>
    </div>
  );
}
