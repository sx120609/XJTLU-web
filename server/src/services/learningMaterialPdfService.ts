import crypto from "node:crypto";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { Errors } from "../utils/response";

const MAX_PREVIEW_PAGES = 10;

function assertPdfMagic(buffer: Buffer) {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw Errors.badRequest("PDF 文件签名无效，请重新导出后上传");
  }
}

async function loadPdf(buffer: Buffer) {
  assertPdfMagic(buffer);
  try {
    return await PDFDocument.load(buffer, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch {
    throw Errors.badRequest("PDF 无法解析或已加密，请上传未加密且可正常打开的 PDF");
  }
}

function safeLabel(value: string, maxLength: number) {
  return value
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function stampDocument(document: PDFDocument, lines: string[], strong = false) {
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  for (const page of document.getPages()) {
    const { width, height } = page.getSize();
    const diagonal = safeLabel(lines[0] || "KAOPU", 80);
    page.drawText(diagonal, {
      x: Math.max(18, width * 0.12),
      y: Math.max(80, height * 0.45),
      size: Math.max(16, Math.min(30, width / 18)),
      font: bold,
      color: rgb(0.45, 0.12, 0.55),
      opacity: strong ? 0.18 : 0.1,
      rotate: degrees(28),
    });
    lines.slice(0, 3).forEach((line, index) => {
      page.drawText(safeLabel(line, 110), {
        x: 18,
        y: 14 + (index * 9),
        size: 6.5,
        font,
        color: rgb(0.35, 0.1, 0.42),
        opacity: 0.72,
      });
    });
  }
}

export async function inspectLearningPdf(buffer: Buffer) {
  const document = await loadPdf(buffer);
  return { pageCount: document.getPageCount() };
}

export function validateLearningPdfPreviewRange(
  pageCount: number,
  start: number,
  end: number,
) {
  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 1
    || end < start
    || end > pageCount
  ) {
    throw Errors.badRequest(`PDF 试读页范围必须在 1-${pageCount} 页内`);
  }
  if (end - start + 1 > MAX_PREVIEW_PAGES) {
    throw Errors.badRequest(`单个 PDF 最多开放 ${MAX_PREVIEW_PAGES} 页试读`);
  }
}

export async function createLearningPdfSample(
  source: Buffer,
  start: number,
  end: number,
) {
  const original = await loadPdf(source);
  validateLearningPdfPreviewRange(original.getPageCount(), start, end);
  const sample = await PDFDocument.create();
  const indexes = Array.from({ length: end - start + 1 }, (_, index) => start - 1 + index);
  const pages = await sample.copyPages(original, indexes);
  pages.forEach((page) => sample.addPage(page));
  await stampDocument(sample, [
    "KAOPU SAMPLE - NOT FOR RESALE",
    `PREVIEW PAGES ${start}-${end}`,
    "Purchase to unlock the licensed full copy",
  ], true);
  return Buffer.from(await sample.save({ useObjectStreams: true }));
}

export async function createLicensedLearningPdf(
  source: Buffer,
  input: {
    userId: number;
    orderId: number;
    fileId: number;
    accessedAt: Date;
    watermarkCode: string;
  },
) {
  const document = await loadPdf(source);
  await stampDocument(document, [
    `KAOPU LICENSED COPY / CODE ${safeLabel(input.watermarkCode, 24)}`,
    `USER ${input.userId} / ORDER ${input.orderId} / FILE ${input.fileId}`,
    `ACCESS ${input.accessedAt.toISOString()}`,
  ], true);
  return Buffer.from(await document.save({ useObjectStreams: true }));
}

export function newLearningWatermarkCode() {
  return crypto.randomBytes(8).toString("hex").toUpperCase();
}

export function hashLearningAccessValue(value: string, secret: string) {
  if (!value) return "";
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}
