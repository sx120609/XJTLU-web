import crypto from "node:crypto";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { LearningPrivateAssetKind, Prisma } from "@prisma/client";
import { Errors } from "../utils/response";

const PRIVATE_ASSET_ROOT = path.resolve(process.cwd(), "runtime", "learning-commerce-assets");
export const MAX_LEARNING_PRIVATE_ASSET_BYTES = 5 * 1024 * 1024;

type UploadedImage = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

function detectImage(buffer: Buffer) {
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mimeType: "image/png", extension: ".png" };
  }
  if (
    buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
  ) {
    return { mimeType: "image/jpeg", extension: ".jpg" };
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: ".webp" };
  }
  throw Errors.badRequest("仅支持真实的 PNG、JPEG 或 WebP 图片");
}

export type PreparedLearningPrivateAsset = {
  absolutePath: string;
  relativePath: string;
  data: {
    ownerId: number;
    kind: LearningPrivateAssetKind;
    originalName: string;
    storedName: string;
    relativePath: string;
    mimeType: string;
    fileSize: number;
    sha256: string;
  };
  cleanup: () => Promise<void>;
};

export async function prepareLearningPrivateAsset(
  ownerId: number,
  kind: LearningPrivateAssetKind,
  file: UploadedImage | undefined,
): Promise<PreparedLearningPrivateAsset> {
  if (!file?.buffer?.length) throw Errors.badRequest("请选择需要上传的图片");
  if (file.size <= 0 || file.size > MAX_LEARNING_PRIVATE_ASSET_BYTES) {
    throw Errors.badRequest("图片大小必须在 5MB 以内");
  }
  const detected = detectImage(file.buffer);
  const date = new Date().toISOString().slice(0, 7);
  const storedName = `${crypto.randomUUID()}${detected.extension}`;
  const relativePath = path.posix.join(String(ownerId), kind, date, storedName);
  const absolutePath = path.resolve(PRIVATE_ASSET_ROOT, relativePath);
  const rootPrefix = `${PRIVATE_ASSET_ROOT}${path.sep}`;
  if (!absolutePath.startsWith(rootPrefix)) throw Errors.forbidden("私密文件路径无效");
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.buffer, { flag: "wx" });
  return {
    absolutePath,
    relativePath,
    data: {
      ownerId,
      kind,
      originalName: path.basename(file.originalname || `image${detected.extension}`).slice(0, 255),
      storedName,
      relativePath,
      mimeType: detected.mimeType,
      fileSize: file.size,
      sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
    },
    cleanup: () => rm(absolutePath, { force: true }).catch(() => undefined),
  };
}

export function resolveLearningPrivateAssetPath(relativePath: string) {
  const absolutePath = path.resolve(PRIVATE_ASSET_ROOT, relativePath);
  const rootPrefix = `${PRIVATE_ASSET_ROOT}${path.sep}`;
  if (!absolutePath.startsWith(rootPrefix)) throw Errors.forbidden("私密文件路径无效");
  return absolutePath;
}

export function learningPrivateAssetCreateData(
  prepared: PreparedLearningPrivateAsset,
): Prisma.LearningPrivateAssetCreateInput {
  return {
    owner: { connect: { id: prepared.data.ownerId } },
    kind: prepared.data.kind,
    originalName: prepared.data.originalName,
    storedName: prepared.data.storedName,
    relativePath: prepared.data.relativePath,
    mimeType: prepared.data.mimeType,
    fileSize: prepared.data.fileSize,
    sha256: prepared.data.sha256,
  };
}
