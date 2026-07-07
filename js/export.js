/* ============================================================
 * export.js — builds the export ZIP:
 *   • estimate.xlsx  — full cost breakdown (SheetJS)
 *   • photos/...     — every photo captured in the walkthrough
 *   • estimate.csv   — plain-text fallback so the data is readable
 *                      even without Excel
 *
 * Depends on: XLSX (vendor/xlsx.full.min.js), JSZip (vendor/jszip.min.js),
 * and the Estimate model passed in by app.js.
 * ============================================================ */

const Exporter = (() => {

  function safeName(s) {
    return (s || 'estimate').replace(/[^a-z0-9\-_ ]/gi, '').trim().replace(/\s+/g, '_') || 'estimate';
  }

  function money(n) { return Math.round(n * 100) / 100; }

  // Build the worksheet rows from the computed estimate model.
  // model = { projectName, generatedAt, rooms:[{label, lines:[{name,qty,unit,cost,total}], subtotal}], grandTotal, deal }
  function buildRows(model) {
    const rows = [];
    rows.push(['Spark Homes — Repair Estimate']);
    rows.push(['Project', model.projectName]);
    rows.push(['Generated', model.generatedAt]);
    if (model.projectNote) rows.push(['Project Notes', model.projectNote]);
    rows.push([]);
    rows.push(['Room / Section', 'Line Item', 'Qty', 'Unit', 'Unit Cost', 'Line Total', 'Notes']);

    model.rooms.forEach(room => {
      room.lines.forEach(l => {
        rows.push([room.label, l.name, l.qty, l.unit, money(l.cost), money(l.total), l.note || '']);
      });
      rows.push([room.label + ' — Subtotal', '', '', '', '', money(room.subtotal)]);
      rows.push([]);
    });

    rows.push(['GRAND TOTAL', '', '', '', '', money(model.grandTotal)]);

    if (model.deal && (model.deal.purchase || model.deal.arv)) {
      rows.push([]);
      rows.push(['Deal Analysis']);
      rows.push(['Purchase Price', '', '', '', '', money(model.deal.purchase)]);
      rows.push(['Repair Estimate', '', '', '', '', money(model.grandTotal)]);
      if (model.deal.extra) rows.push(['Other Costs (holding/closing)', '', '', '', '', money(model.deal.extra)]);
      rows.push(['After Repair Value (ARV)', '', '', '', '', money(model.deal.arv)]);
      rows.push(['Projected Profit', '', '', '', '', money(model.deal.profit)]);
      rows.push(['Return on Cost', '', '', '', '', (model.deal.roi != null ? (model.deal.roi * 100).toFixed(1) + '%' : '—')]);
    }
    return rows;
  }

  function buildWorkbook(model) {
    const rows = buildRows(model);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 28 }, { wch: 44 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 40 }];

    // Light styling where xlsx-js-style supports it.
    // Locate the column-header row by content (its position shifts if a
    // project-notes row is present).
    let headerRow = rows.findIndex(r => r[0] === 'Room / Section');
    if (headerRow < 0) headerRow = 4;
    ['A','B','C','D','E','F','G'].forEach(col => {
      const cell = ws[col + (headerRow + 1)];
      if (cell) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '111827' } } };
    });
    const titleCell = ws['A1'];
    if (titleCell) titleCell.s = { font: { bold: true, sz: 14, color: { rgb: 'EA580C' } } };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Estimate');
    return wb;
  }

  function buildCSV(model) {
    const rows = buildRows(model);
    return rows.map(r => r.map(cell => {
      const s = cell == null ? '' : String(cell);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
  }

  function extOf(type) {
    if (!type) return 'jpg';
    if (type.includes('png')) return 'png';
    if (type.includes('webp')) return 'webp';
    if (type.includes('heic')) return 'heic';
    return 'jpg';
  }

  // photos: array of IndexedDB records { id, roomId, itemId, blob, type, serial }
  // roomLabelById / itemNameById: lookup maps for nice filenames.
  async function buildZip(model, photos, lookups) {
    const zip = new JSZip();
    const wb = buildWorkbook(model);
    const xlsxArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    zip.file('estimate.xlsx', xlsxArray);
    zip.file('estimate.csv', buildCSV(model));

    if (photos && photos.length) {
      const pf = zip.folder('photos');
      const counts = {};
      for (const p of photos) {
        const roomLabel = safeName(lookups.roomLabelById[p.roomId] || 'general');
        const itemName = safeName(lookups.itemNameById[p.itemId] || p.itemId || 'photo');
        const base = `${roomLabel}__${itemName}`;
        counts[base] = (counts[base] || 0) + 1;
        const suffix = counts[base] > 1 ? `_${counts[base]}` : '';
        const serialTag = p.serial ? `__SN-${safeName(p.serial)}` : '';
        pf.file(`${base}${serialTag}${suffix}.${extOf(p.type)}`, p.blob);
      }
    }

    return zip.generateAsync({ type: 'blob' });
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function exportProject(model, photos, lookups) {
    const blob = await buildZip(model, photos, lookups);
    triggerDownload(blob, `${safeName(model.projectName)}_estimate.zip`);
  }

  return { exportProject, buildWorkbook, buildCSV };
})();

window.Exporter = Exporter;
