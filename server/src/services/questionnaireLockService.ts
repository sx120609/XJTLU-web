import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

export const QUESTIONNAIRE_LOCK_SCOPE = 1_205_070;
export const QUESTIONNAIRE_RESPONDENT_LOCK_SCOPE = 1_205_071;

function scopedLockKey(scope: number, value: string | number) {
  const digest = createHash("sha256")
    .update(String(value))
    .digest();
  const hash = BigInt(digest.readUInt32BE(0));
  return BigInt(scope) * 4_294_967_296n + hash;
}

export function questionnaireLockKey(questionnaireId: number) {
  return scopedLockKey(QUESTIONNAIRE_LOCK_SCOPE, questionnaireId);
}

export function questionnaireRespondentLockKey(
  questionnaireId: number,
  respondentId: number,
) {
  return scopedLockKey(
    QUESTIONNAIRE_RESPONDENT_LOCK_SCOPE,
    `${questionnaireId}:${respondentId}`,
  );
}

export async function acquireQuestionnaireLock(
  tx: Prisma.TransactionClient,
  questionnaireId: number,
) {
  const lockKey = questionnaireLockKey(questionnaireId);
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(${lockKey})
  `;
}

export async function acquireQuestionnaireResponseLock(
  tx: Prisma.TransactionClient,
  questionnaireId: number,
  respondentId?: number,
) {
  await acquireQuestionnaireLock(tx, questionnaireId);
  if (!respondentId) return;
  const lockKey = questionnaireRespondentLockKey(
    questionnaireId,
    respondentId,
  );
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(${lockKey})
  `;
}
