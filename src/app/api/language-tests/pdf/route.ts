import path from "node:path";
import { pathToFileURL } from "node:url";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { extractUtterance } from "@/lib/nlu/extract";

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_LINES = 100; // cap batch size so one huge PDF can't run away

/**
 * Batch-import counterpart to the text/audio Language Lab flows. Extracts
 * text from an uploaded PDF (a list of real customer sentences, a call
 * transcript document, etc.), splits it into lines, and runs each
 * non-trivial line through the same NLU pipeline as a typed sample — every
 * line becomes its own LanguageTest row for staff PASS/FAIL review, exactly
 * like the text/audio flows. No AI-reply/TTS preview here (that's a
 * per-utterance thing); this is purely a bulk-import shortcut so a written
 * document of real customer sentences doesn't have to be typed in one by one.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart/form-data with a pdf file." }, { status: 400 });

  const file = form.get("pdf");
  if (!(file instanceof File)) return NextResponse.json({ error: "pdf file is required." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "PDF file is empty." }, { status: 400 });
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: `PDF too large (max ${MAX_PDF_BYTES / 1024 / 1024}MB).` }, { status: 400 });
  }

  const outstandingRaw = form.get("outstandingAmount");
  const outstandingAmount = typeof outstandingRaw === "string" && outstandingRaw.trim() ? parseFloat(outstandingRaw) : null;

  const pdfBuffer = Buffer.from(await file.arrayBuffer());

  let extractedText: string;
  try {
    // pdfjs-dist (Mozilla's own, actively maintained PDF.js) — the "legacy"
    // build runs in plain Node without a browser/worker, unlike the older
    // pdf-parse package (which bundles a long-outdated pdf.js that chokes on
    // modern PDF output — cross-reference streams, PDF 1.5+ compression —
    // from common tools like LibreOffice's PDF export).
    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Next.js's server bundler rewrites module specifiers, so pdfjs-dist's
    // own relative worker lookup (based on import.meta.url post-bundling)
    // resolves to a chunk path that doesn't exist. Pointing workerSrc at the
    // real on-disk file via process.cwd() bypasses the bundler entirely.
    GlobalWorkerOptions.workerSrc = pathToFileURL(
      path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")
    ).href;
    const doc = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // getTextContent() returns position-tagged runs, not lines — join runs
      // with a space, but start a new line wherever the source content
      // itself marked one (item.hasEOL), or the whole page collapses to one
      // giant line and every sentence gets glued together.
      let pageText = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        pageText += item.str;
        pageText += item.hasEOL ? "\n" : " ";
      }
      pageTexts.push(pageText);
    }
    await doc.destroy();
    extractedText = pageTexts.join("\n");
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? `PDF parse failed: ${err.message}` : "PDF parse failed." }, { status: 422 });
  }

  const lines = extractedText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3)
    .slice(0, MAX_LINES);

  if (lines.length === 0) {
    return NextResponse.json({ error: "No usable text lines found in this PDF (it may be a scanned image, not real text)." }, { status: 422 });
  }

  const tests = [];
  for (const line of lines) {
    const result = extractUtterance(line, { outstandingAmount });
    const test = await db.languageTest.create({
      data: {
        inputText: line,
        detectedLanguage: result.language.label,
        extractedAmount: result.amount.amount,
        extractedDate: result.date.date,
        extractedIntent: result.intent.intent,
        confidence: result.overallConfidence,
        aiInterpretation: result.aiInterpretation,
        verdict: "UNREVIEWED",
        createdById: session.sub,
      },
    });
    tests.push(test);
  }

  return NextResponse.json({ imported: tests.length, totalLinesFound: lines.length, tests }, { status: 201 });
}
