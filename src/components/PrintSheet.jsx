// Certified-ledger print layout, modelled on the Kashi/Annakshetra vendor ledger.
// `detail` (optional) renders a per-vendor date-wise section after the abstract:
//   detail = { columns:[{header,key,align}], groups:[{ vendor, rows:[...], total:{...} }] }
export default function PrintSheet({ id, title, period, columns, rows, total, note, sign = true, detail, detailLabel = 'Vendor-wise Bill Detail' }) {
  const cls = (c) => (c.align === 'right' ? 'r' : '');
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return (
    <div className="print-sheet" id={id}>
      <div className="ps-head">
        <div className="ps-org">கோவிலூர் மடாலயம் · Koviloor Kitchen</div>
        <div className="ps-sub">Purchase Ledger</div>
      </div>

      <div className="ps-title-box">
        <div className="ps-title">{title}</div>
        {period && <div className="ps-period">{period}</div>}
      </div>
      <div className="ps-ref">Generated: {today}</div>

      <div className="ps-section-label">Vendor Abstract</div>
      <table className="ps-table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={cls(c)}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{columns.map((c) => <td key={c.key} className={cls(c)}>{r[c.key]}</td>)}</tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr>{columns.map((c) => <td key={c.key} className={cls(c)}>{total[c.key] ?? ''}</td>)}</tr>
          </tfoot>
        )}
      </table>

      {detail && detail.groups.length > 0 && (
        <div className="ps-detail">
          <div className="ps-section-label">{detailLabel}</div>
          {detail.groups.map((g, gi) => (
            <div className="ps-vendor" key={gi}>
              <div className="ps-vendor-name">{g.vendor}</div>
              <table className="ps-table">
                <thead>
                  <tr>{detail.columns.map((c) => <th key={c.key} className={cls(c)}>{c.header}</th>)}</tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr key={i}>{detail.columns.map((c) => <td key={c.key} className={cls(c)}>{r[c.key]}</td>)}</tr>
                  ))}
                </tbody>
                {g.total && (
                  <tfoot>
                    <tr>{detail.columns.map((c) => <td key={c.key} className={cls(c)}>{g.total[c.key] ?? ''}</td>)}</tr>
                  </tfoot>
                )}
              </table>
            </div>
          ))}
        </div>
      )}

      {note && <div className="ps-note">{note}</div>}

      {sign && (
        <div className="ps-sign">
          <div className="ps-line" />
          <div className="ps-sign-name">Certified by</div>
          <div className="ps-sign-role">Purchase In-charge</div>
        </div>
      )}
    </div>
  );
}
