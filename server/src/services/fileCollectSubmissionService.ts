import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import {
  acquireFileCollectSubmissionLock,
  FILE_COLLECT_UPLOAD_STALE_MS,
} from "./fileCollectLockService";

type ActiveUploadErrorFactory = () => Error;

function activeUploadCutoff(now = Date.now()) {
  return new Date(now - FILE_COLLECT_UPLOAD_STALE_MS);
}

export async function assertNoActiveFileCollectUploads(
  tx: Prisma.TransactionClient,
  taskId: number,
  activeUploadError: ActiveUploadErrorFactory,
) {
  const activeUploads = await tx.fileCollectSubmission.count({
    where: {
      taskId,
      status: "uploading",
      createdAt: { gte: activeUploadCutoff() },
    },
  });
  if (activeUploads > 0) throw activeUploadError();
}

export async function removeStaleFileCollectUploadsForIdentity(
  tx: Prisma.TransactionClient,
  taskId: number,
  identity: string,
  activeUploadError: ActiveUploadErrorFactory,
) {
  if (!identity) return [] as string[];

  const uploadingRows = await tx.fileCollectSubmission.findMany({
    where: { taskId, identity, status: "uploading" },
    include: { files: { select: { path: true } } },
  });
  const cutoff = activeUploadCutoff();
  if (uploadingRows.some((row) => row.createdAt >= cutoff)) {
    throw activeUploadError();
  }

  const stalePaths = uploadingRows.flatMap((row) => row.files.map((file) => file.path));
  for (const row of uploadingRows) {
    await tx.fileCollectSubmission.delete({ where: { id: row.id } });
  }
  return stalePaths;
}

export async function deleteUploadingFileCollectSubmission(submissionId: number) {
  const pending = await prisma.fileCollectSubmission.findUnique({
    where: { id: submissionId },
    select: { id: true, taskId: true, identity: true, status: true },
  });
  if (!pending || pending.status !== "uploading") return [] as string[];

  return prisma.$transaction(async (tx) => {
    await acquireFileCollectSubmissionLock(
      tx,
      pending.taskId,
      pending.identity || `pending:${pending.id}`,
    );
    const current = await tx.fileCollectSubmission.findUnique({
      where: { id: pending.id },
      include: { files: { select: { path: true } } },
    });
    if (!current || current.status !== "uploading") return [] as string[];

    await tx.fileCollectSubmission.delete({ where: { id: current.id } });
    return current.files.map((file) => file.path);
  });
}

export async function refreshFileCollectTaskCounters(
  tx: Prisma.TransactionClient,
  taskId: number,
) {
  const submissionCount = await tx.fileCollectSubmission.count({
    where: { taskId, status: "submitted" },
  });
  const fileCount = await tx.fileCollectFile.count({
    where: { submission: { taskId, status: "submitted" } },
  });
  await tx.fileCollectTask.update({
    where: { id: taskId },
    data: { submissionCount, fileCount },
  });
  return { submissionCount, fileCount };
}
