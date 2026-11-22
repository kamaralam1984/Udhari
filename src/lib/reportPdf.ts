import PDFDocument from "pdfkit";

export interface ReportPdfData {
  business: string;
  rangeLabel: string;
  generatedAt: string;
  showMoney: boolean;
  kpis: { label: string; value: string }[];
  statusBreakdown: { label: string; count: number }[];
  topCustomers: { name: string; outstanding: string; risk: string }[];
  staff: { name: string; calls: number; collected: string }[];
}

/** One-/two-page management summary of the selected analytics window. */
export function buildReportPdf(d: ReportPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 44, info: { Title: `${d.business} — Analytics report` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const violet = "#6d28d9";
    const grey = "#6b7280";
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.rect(0, 0, doc.page.width, 78).fill(violet);
    doc.fillColor("#ffffff").fontSize(20).text(d.business, left, 24, { width });
    doc.fontSize(10).text(`AI Calling — Analytics report · ${d.rangeLabel}`, left, 50, { width });
    doc.fillColor("#111827");
    doc.y = 100;

    // KPI grid (3 per row)
    const cols = 3;
    const cellW = width / cols;
    let row = 0;
    d.kpis.forEach((k, i) => {
      const x = left + (i % cols) * cellW;
      const y = 100 + Math.floor(i / cols) * 54;
      doc.roundedRect(x, y, cellW - 8, 46, 6).strokeColor("#ddd6fe").lineWidth(1).stroke();
      doc.fillColor(grey).fontSize(8).text(k.label.toUpperCase(), x + 8, y + 8, { width: cellW - 24 });
      doc.fillColor("#111827").fontSize(15).text(k.value, x + 8, y + 22, { width: cellW - 24 });
      row = Math.floor(i / cols);
    });
    doc.y = 100 + (row + 1) * 54 + 12;

    const section = (title: string) => {
      doc.moveDown(0.6).fillColor(violet).fontSize(12).text(title, left, doc.y);
      doc.moveTo(left, doc.y + 2).lineTo(left + width, doc.y + 2).strokeColor("#ddd6fe").stroke();
      doc.moveDown(0.5).fillColor("#111827").fontSize(9.5);
    };
    const line = (cells: string[], widths: number[], bold = false) => {
      const y = doc.y;
      if (y > doc.page.height - 70) doc.addPage();
      let x = left;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica");
      cells.forEach((c, i) => {
        doc.text(c, x, doc.y > y && i > 0 ? y : y, { width: widths[i] - 6, lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      doc.y = y + 15;
      doc.font("Helvetica");
    };

    section("Call outcomes");
    const totalCalls = d.statusBreakdown.reduce((a, s) => a + s.count, 0) || 1;
    for (const s of d.statusBreakdown) {
      line([s.label, String(s.count), `${Math.round((s.count / totalCalls) * 100)}%`], [220, 80, 80]);
    }

    if (d.staff.length) {
      section(d.showMoney ? "Staff performance" : "Your activity");
      line(d.showMoney ? ["Staff", "Calls started", "Collected"] : ["Staff", "Calls started"], d.showMoney ? [220, 110, 140] : [220, 110], true);
      for (const s of d.staff) line(d.showMoney ? [s.name, String(s.calls), s.collected] : [s.name, String(s.calls)], d.showMoney ? [220, 110, 140] : [220, 110]);
    }

    if (d.showMoney && d.topCustomers.length) {
      section("Top outstanding customers");
      line(["Customer", "Outstanding", "Risk"], [240, 130, 90], true);
      for (const c of d.topCustomers) line([c.name, c.outstanding, c.risk], [240, 130, 90]);
    }

    doc.fillColor(grey).fontSize(8).text(`Generated ${d.generatedAt}`, left, doc.page.height - 50, { width, align: "right" });
    doc.end();
  });
}
