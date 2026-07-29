import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

function normalizedTitle(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function slugifyToolTitle(title: string) {
  const normalized = normalizedTitle(title);
  const ascii = normalized
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (/^[a-z0-9-]+$/.test(ascii)) return ascii;
  if (!normalized) return "";
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `q-${digest}`;
}

export function questionnaireSlugBase(title: string) {
  return slugifyToolTitle(title) || "questionnaire";
}

export function gradeCheckSlugBase(title: string) {
  const base = slugifyToolTitle(title);
  return base && !base.startsWith("q-") ? base : "grade-check";
}

export function fileCollectSlugBase(title: string) {
  const base = slugifyToolTitle(title);
  return base && !base.startsWith("q-") ? base : "file-collect";
}

async function nextAvailableSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
) {
  let slug = base;
  for (let index = 0; index < 20; index += 1) {
    if (!(await exists(slug))) return slug;
    slug = `${base}-${Date.now().toString(36).slice(-5)}${index ? `-${index}` : ""}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function nextQuestionnaireSlug(
  title: string,
  client: Pick<Prisma.TransactionClient, "questionnaire"> = prisma,
) {
  return nextAvailableSlug(
    questionnaireSlugBase(title),
    async (slug) => Boolean(
      await client.questionnaire.findUnique({ where: { slug }, select: { id: true } }),
    ),
  );
}

export function nextGradeCheckSlug(
  title: string,
  client: Pick<Prisma.TransactionClient, "gradeCheckTable"> = prisma,
) {
  return nextAvailableSlug(
    gradeCheckSlugBase(title),
    async (slug) => Boolean(
      await client.gradeCheckTable.findUnique({ where: { slug }, select: { id: true } }),
    ),
  );
}

export function nextFileCollectSlug(
  title: string,
  client: Pick<Prisma.TransactionClient, "fileCollectTask"> = prisma,
) {
  return nextAvailableSlug(
    fileCollectSlugBase(title),
    async (slug) => Boolean(
      await client.fileCollectTask.findUnique({ where: { slug }, select: { id: true } }),
    ),
  );
}
