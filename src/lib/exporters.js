import * as XLSX from 'xlsx';

/* ----------------------------- Excel ----------------------------------
   sheets = [{ name, columns:[{header,key}], rows:[{key:value}] }]            */
export function exportExcel(filename, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((s) => {
    const aoa = [s.columns.map((c) => c.header)];
    s.rows.forEach((r) => aoa.push(s.columns.map((c) => r[c.key])));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = s.columns.map((c) => ({ wch: Math.max(10, String(c.header).length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, (s.name || 'Sheet').slice(0, 31));
  });
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

/* ------------------------------- PDF -----------------------------------
   Rasterizes a rendered DOM node into a paginated A4 PDF. We render the HTML
   (which the browser shapes correctly, including Tamil) rather than drawing
   text in jsPDF — whose built-in fonts have no Tamil glyphs.                */
export async function exportElementPDF(node, filename) {
  if (!node) return;
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'), import('html2canvas'),
  ]);
  const canvas = await html2canvas(node, {
    scale: 2, backgroundColor: '#ffffff', useCORS: true, windowWidth: node.scrollWidth,
  });
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const margin = 28;
  const usableW = pw - margin * 2;
  const usableH = ph - margin * 2;
  const ratio = usableW / canvas.width;
  const pageHpx = usableH / ratio;

  let rendered = 0; let first = true;
  while (rendered < canvas.height) {
    const sliceH = Math.min(pageHpx, canvas.height - rendered);
    const slice = document.createElement('canvas');
    slice.width = canvas.width; slice.height = sliceH;
    slice.getContext('2d').drawImage(canvas, 0, rendered, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
    if (!first) doc.addPage();
    doc.addImage(slice.toDataURL('image/png'), 'PNG', margin, margin, usableW, sliceH * ratio);
    rendered += sliceH; first = false;
  }
  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

/* ------------------------------ Print ----------------------------------
   Prints only the certified print-sheet (interactive UI hidden via a body class). */
export function printCertified(cls = 'printing-certified') {
  document.body.classList.add(cls);
  const cleanup = () => { document.body.classList.remove(cls); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
