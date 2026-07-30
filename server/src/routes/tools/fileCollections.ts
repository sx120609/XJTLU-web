import { Router, type RequestHandler } from "express";
import multer from "multer";
import path from "node:path";
import { mkdir, readFile, unlink, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma";
import { authOptional, authRequired } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { Errors, ok } from "../../utils/response";
import {
  buildOfficeViewerUrl,
  canUseOfficeWebViewer,
  isOfficePreviewFile,
  joinPublicUrl,
  normalizePreviewPublicOrigin,
  officeWebViewerLimitMessage,
  requestPublicOrigin,
  signFileCollectPreviewToken,
  verifyFileCollectPreviewToken,
} from "../../utils/officePreview";
import { normalizeMulterOriginalNames, normalizeUploadOriginalName } from "../../utils/uploadFilename";
import { getSiteOrigin } from "../../services/siteSettings";
import {
  assertToolUsable,
  hasToolContentManagePermission,
  isSiteAdmin,
} from "../../services/serviceTools";
import {
  deleteMediaAsset,
  ensureMediaLocalPathFromUploadUrl,
  saveMediaAsset,
} from "../../services/mediaStorage";
import {
  getOneDriveChinaItemMetadata,
  resolveOneDriveChinaDirectDownloadUrl,
  resolveOneDriveChinaPreviewUrl,
} from "../../services/oneDriveChina";
import { repairFileCollectTaskFilenames } from "../../services/fileCollectFilenameRepair";
import {
  acquireFileCollectSubmissionLock,
  acquireFileCollectTaskLock,
} from "../../services/fileCollectLockService";
import {
  assertNoActiveFileCollectUploads,
  deleteUploadingFileCollectSubmission,
  refreshFileCollectTaskCounters,
  removeStaleFileCollectUploadsForIdentity,
} from "../../services/fileCollectSubmissionService";
import { acquireToolSlugLock } from "../../services/toolSlugLockService";
import {
  fileCollectSlugBase,
  nextFileCollectSlug,
} from "../../services/toolSlugService";
import {
  createFileCollectSchema,
  createFileCollectTemplateSchema,
  fileCollectFieldSchema,
  fileCollectRuleSchema,
  patchFileCollectSchema,
  type CreateFileCollectInput,
  type CreateFileCollectTemplateInput,
  type FileCollectField,
  type FileCollectRules,
  type PatchFileCollectInput,
} from "../../services/toolSchemas";

const toolsRouter = Router();
export { toolsRouter as toolFileCollectionsRouter };

const fileCollectTmpDir = path.resolve(process.cwd(), "runtime", "file-collect-tmp");
const fileCollectUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      mkdir(fileCollectTmpDir, { recursive: true })
        .then(() => cb(null, fileCollectTmpDir))
        .catch((error) => cb(error, fileCollectTmpDir));
    },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${path.extname(normalizeUploadOriginalName(file.originalname))}`),
  }),
  limits: {
    files: 20,
    fileSize: 100 * 1024 * 1024,
    fieldSize: 1024 * 1024,
  },
});
toolsRouter.get("/file-collection-templates", authRequired, async (req, res, next) => {
  try {
    if (!(await hasToolContentManagePermission("file_collect", req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    const canSeeAll = isSiteAdmin(req.user?.role);
    const list = await prisma.fileCollectTemplate.findMany({
      where: canSeeAll ? {} : { createdById: req.user!.userId },
      orderBy: [{ updatedAt: "desc" }],
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    ok(res, list.map(normalizeFileCollectTemplate));
  } catch (e) { next(e); }
});

toolsRouter.post("/file-collection-templates", authRequired, validate(createFileCollectTemplateSchema), async (req, res, next) => {
  try {
    if (!(await hasToolContentManagePermission("file_collect", req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    const payload = normalizeFileCollectTemplateInput(req.body);
    const row = await prisma.fileCollectTemplate.create({
      data: {
        name: payload.name,
        description: payload.description || null,
        visibility: payload.visibility ?? "public",
        fields: JSON.stringify(payload.fields),
        fileRules: JSON.stringify(payload.fileRules),
        renameTemplate: payload.renameTemplate,
        folderTemplate: payload.folderTemplate,
        expectedEntries: payload.expectedEntries || "",
        createdById: req.user!.userId,
      },
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    ok(res, normalizeFileCollectTemplate(row));
  } catch (e) { next(e); }
});

toolsRouter.delete("/file-collection-templates/:id", authRequired, async (req, res, next) => {
  try {
    const id = positiveRouteId(req.params.id);
    const current = await prisma.fileCollectTemplate.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("模板不存在");
    const canDelete = current.createdById === req.user!.userId || isSiteAdmin(req.user?.role);
    if (!canDelete) throw Errors.forbidden("没有该模板的管理权限");
    await prisma.fileCollectTemplate.delete({ where: { id } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

toolsRouter.get("/file-collections", authRequired, async (req, res, next) => {
  try {
    if (req.query.manage !== "1") {
      ok(res, []);
      return;
    }
    if (!(await hasToolContentManagePermission("file_collect", req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    const canSeeAll = isSiteAdmin(req.user?.role);
    const list = await prisma.fileCollectTask.findMany({
      where: canSeeAll ? {} : { createdById: req.user!.userId },
      orderBy: [{ createdAt: "desc" }],
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    ok(res, list.map(normalizeFileCollectTask));
  } catch (e) { next(e); }
});

toolsRouter.get("/file-collections/:slug", authOptional, async (req, res, next) => {
  try {
    const task = await prisma.fileCollectTask.findUnique({
      where: { slug: String(req.params.slug) },
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    if (!task) throw Errors.notFound("收集任务不存在");
    const canManage = await canManageFileCollectTask(task, req.user);
    if (!canManage) await ensureToolUsableForRequest("file_collect", req.user);
    if (task.status !== "open" && !canManage) throw Errors.notFound("收集任务不存在或未开放");
    if (task.visibility === "login" && !req.user?.userId && !canManage) throw Errors.unauthorized("请先登录后提交");
    ok(res, {
      ...normalizeFileCollectTask(task),
      canManage,
    });
  } catch (e) { next(e); }
});

toolsRouter.post("/file-collections", authRequired, validate(createFileCollectSchema), async (req, res, next) => {
  try {
    if (!(await hasToolContentManagePermission("file_collect", req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    const payload = normalizeFileCollectInput(req.body);
    const now = new Date();
    const row = await prisma.$transaction(async (tx) => {
      await acquireToolSlugLock(tx, "file-collect", fileCollectSlugBase(payload.title));
      return tx.fileCollectTask.create({
        data: {
          slug: await nextFileCollectSlug(payload.title, tx),
          title: payload.title,
          description: payload.description || null,
          status: payload.status ?? "open",
          visibility: payload.visibility ?? "public",
          fields: JSON.stringify(payload.fields),
          fileRules: JSON.stringify(payload.fileRules),
          renameTemplate: payload.renameTemplate,
          folderTemplate: payload.folderTemplate,
          expectedEntries: payload.expectedEntries || "",
          createdById: req.user!.userId,
          publishedAt: (payload.status ?? "open") === "open" ? now : null,
          closedAt: payload.status === "closed" ? now : null,
        },
        include: {
          createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        },
      });
    });
    ok(res, normalizeFileCollectTask(row));
  } catch (e) { next(e); }
});

toolsRouter.patch("/file-collections/:id", authRequired, validate(patchFileCollectSchema), async (req, res, next) => {
  try {
    const id = positiveRouteId(req.params.id);
    const current = await prisma.fileCollectTask.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("收集任务不存在");
    if (!(await canManageFileCollectTask(current, req.user))) throw Errors.forbidden("没有该收集任务的管理权限");
    const payload = normalizeFileCollectPatch(req.body);
    const now = new Date();
    const row = await prisma.$transaction(async (tx) => {
      await acquireFileCollectTaskLock(tx, id);
      const locked = await tx.fileCollectTask.findUnique({ where: { id } });
      if (!locked) throw Errors.notFound("收集任务不存在");
      if (!isSiteAdmin(req.user?.role) && locked.createdById !== req.user!.userId) {
        throw Errors.forbidden("没有该收集任务的管理权限");
      }
      return tx.fileCollectTask.update({
        where: { id },
        data: {
          title: payload.title,
          description: req.body.description === undefined ? undefined : (payload.description || null),
          status: payload.status,
          visibility: payload.visibility,
          fields: payload.fields ? JSON.stringify(payload.fields) : undefined,
          fileRules: payload.fileRules ? JSON.stringify(payload.fileRules) : undefined,
          renameTemplate: payload.renameTemplate,
          folderTemplate: payload.folderTemplate,
          expectedEntries: req.body.expectedEntries === undefined ? undefined : (payload.expectedEntries || ""),
          publishedAt: payload.status === "open" && !locked.publishedAt ? now : undefined,
          closedAt: payload.status === "closed" ? now : payload.status === "open" ? null : undefined,
        },
        include: {
          createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        },
      });
    });
    ok(res, normalizeFileCollectTask(row));
  } catch (e) { next(e); }
});

toolsRouter.delete("/file-collections/:id", authRequired, async (req, res, next) => {
  try {
    const id = positiveRouteId(req.params.id);
    const current = await prisma.fileCollectTask.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("收集任务不存在");
    if (!(await canManageFileCollectTask(current, req.user))) throw Errors.forbidden("没有该收集任务的管理权限");
    const paths = await prisma.$transaction(async (tx) => {
      await acquireFileCollectTaskLock(tx, id);
      const locked = await tx.fileCollectTask.findUnique({ where: { id } });
      if (!locked) throw Errors.notFound("收集任务不存在");
      if (!isSiteAdmin(req.user?.role) && locked.createdById !== req.user!.userId) {
        throw Errors.forbidden("没有该收集任务的管理权限");
      }
      await assertNoActiveFileCollectUploads(
        tx,
        id,
        () => Errors.conflict("仍有文件正在上传，请稍后再删除任务"),
      );
      const files = await tx.fileCollectFile.findMany({
        where: { submission: { taskId: id } },
        select: { path: true },
      });
      await tx.fileCollectTask.delete({ where: { id } });
      return files.map((file) => file.path);
    });
    await Promise.all(paths.map((relativePath) => unlinkFileCollectPath(relativePath)));
    await rm(path.resolve(process.cwd(), "uploads", "file-collect", String(id)), { recursive: true, force: true });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

toolsRouter.get("/file-collections/:id/submissions", authRequired, async (req, res, next) => {
  try {
    const id = positiveRouteId(req.params.id);
    const task = await prisma.fileCollectTask.findUnique({ where: { id } });
    if (!task) throw Errors.notFound("收集任务不存在");
    if (!(await canManageFileCollectTask(task, req.user))) throw Errors.forbidden("没有该收集任务的管理权限");
    const list = await prisma.fileCollectSubmission.findMany({
      where: { taskId: id },
      orderBy: { createdAt: "desc" },
      include: {
        submitter: { select: { id: true, username: true, nickname: true, role: true } },
        files: { orderBy: { id: "asc" } },
      },
    });
    ok(res, {
      task: normalizeFileCollectTask(task),
      list: list.map(normalizeFileCollectSubmission),
    });
  } catch (e) { next(e); }
});

toolsRouter.post("/file-collections/:id/repair-filenames", authRequired, async (req, res, next) => {
  try {
    const id = positiveRouteId(req.params.id);
    const task = await prisma.fileCollectTask.findUnique({ where: { id } });
    if (!task) throw Errors.notFound("收集任务不存在");
    if (!(await canManageFileCollectTask(task, req.user))) throw Errors.forbidden("没有该收集任务的管理权限");
    ok(res, await repairFileCollectTaskFilenames(id));
  } catch (e) { next(e); }
});

toolsRouter.post("/file-collections/:slug/submissions", authOptional, fileCollectUpload.array("files", 20), async (req, res, next) => {
  const uploadedFiles = normalizeMulterOriginalNames((req.files as Express.Multer.File[] | undefined) ?? []);
  const storedRelativePaths: string[] = [];
  let pendingSubmissionId: number | null = null;
  try {
    const initialTask = await prisma.fileCollectTask.findUnique({ where: { slug: String(req.params.slug) } });
    if (!initialTask) throw Errors.notFound("收集任务不存在");
    await ensureToolUsableForRequest("file_collect", req.user);
    assertFileCollectTaskAcceptsSubmission(initialTask, req.user);

    const fields = parseFileCollectFields(initialTask.fields);
    const rules = parseFileCollectRules(initialTask.fileRules);
    const data = normalizeFileCollectSubmissionData(fields, parseJsonObject(String(req.body.data || "{}")));
    validateFileCollectUpload(uploadedFiles, rules);
    const identity = fileCollectIdentity(data, fields);
    const lockIdentity = identity || `anonymous:${randomUUID()}`;
    const pending = await prisma.$transaction(async (tx) => {
      await acquireFileCollectSubmissionLock(tx, initialTask.id, lockIdentity);
      const task = await tx.fileCollectTask.findUnique({ where: { id: initialTask.id } });
      if (!task) throw Errors.notFound("收集任务不存在");
      assertFileCollectTaskAcceptsSubmission(task, req.user);
      const stalePaths = await removeStaleFileCollectUploadsForIdentity(
        tx,
        task.id,
        identity,
        () => Errors.conflict("同一身份的文件正在上传，请稍后重试"),
      );
      const submission = await tx.fileCollectSubmission.create({
        data: {
          taskId: task.id,
          submitterId: req.user?.userId ?? null,
          identity,
          data: JSON.stringify(data),
          ip: req.ip,
          status: "uploading",
        },
      });
      return { submission, stalePaths };
    });
    pendingSubmissionId = pending.submission.id;
    await Promise.all(pending.stalePaths.map((relativePath) => unlinkFileCollectPath(relativePath)));

    const fileData: Array<{
      originalName: string;
      storedName: string;
      mimeType: string;
      size: number;
      path: string;
    }> = [];
    for (let index = 0; index < uploadedFiles.length; index += 1) {
      const file = uploadedFiles[index];
      const storedName = renderFileCollectName(initialTask.renameTemplate, data, file.originalname, index + 1, uploadedFiles.length);
      const physicalName = `${pending.submission.id}-${index + 1}-${randomUUID()}-${safeStoredFilename(storedName)}`;
      const relativePath = path.posix.join("file-collect", String(initialTask.id), physicalName);
      const buffer = await readFile(file.path);
      await saveMediaAsset({
        relativePath,
        buffer,
        contentType: file.mimetype || "application/octet-stream",
      });
      storedRelativePaths.push(relativePath);
      await unlink(file.path).catch(() => null);
      fileData.push({
        originalName: file.originalname,
        storedName,
        mimeType: file.mimetype || "application/octet-stream",
        size: file.size,
        path: relativePath,
      });
    }

    await ensureToolUsableForRequest("file_collect", req.user);
    const result = await prisma.$transaction(async (tx) => {
      await acquireFileCollectSubmissionLock(tx, initialTask.id, lockIdentity);
      const current = await tx.fileCollectSubmission.findUnique({
        where: { id: pending.submission.id },
        include: { task: true },
      });
      if (!current || current.taskId !== initialTask.id) throw Errors.notFound("提交记录不存在");
      if (current.status !== "uploading") throw Errors.conflict("提交状态已发生变化，请重新提交");
      assertFileCollectTaskAcceptsSubmission(current.task, req.user);

      const oldPaths: string[] = [];
      if (identity) {
        const oldRows = await tx.fileCollectSubmission.findMany({
          where: {
            taskId: current.taskId,
            identity,
            status: "submitted",
            id: { not: current.id },
          },
          include: { files: true },
        });
        for (const old of oldRows) {
          await tx.fileCollectSubmission.delete({ where: { id: old.id } });
          oldPaths.push(...old.files.map((file) => file.path));
        }
      }

      const fileRows = [];
      for (const file of fileData) {
        fileRows.push(await tx.fileCollectFile.create({
          data: {
            submissionId: current.id,
            originalName: file.originalName,
            storedName: file.storedName,
            mimeType: file.mimeType,
            size: file.size,
            path: file.path,
          },
        }));
      }
      const submission = await tx.fileCollectSubmission.update({
        where: { id: current.id },
        data: { status: "submitted" },
      });
      await refreshFileCollectTaskCounters(tx, current.taskId);
      return { submission, files: fileRows, oldPaths };
    });
    pendingSubmissionId = null;
    await Promise.all(result.oldPaths.map((relativePath) => unlinkFileCollectPath(relativePath)));
    ok(res, {
      id: result.submission.id,
      createdAt: result.submission.createdAt,
      files: result.files.map((file) => file.storedName),
    });
  } catch (e) {
    if (pendingSubmissionId) {
      await deleteUploadingFileCollectSubmission(pendingSubmissionId).catch(() => null);
    }
    await Promise.all([
      ...uploadedFiles.map((file) => unlink(file.path).catch(() => null)),
      ...storedRelativePaths.map((relativePath) => unlinkFileCollectPath(relativePath)),
    ]);
    next(e);
  }
});

toolsRouter.get("/file-collection-files/:id/access", authRequired, async (req, res, next) => {
  try {
    const id = positiveRouteId(req.params.id);
    const file = await prisma.fileCollectFile.findUnique({
      where: { id },
      include: { submission: { include: { task: true } } },
    });
    if (!file) throw Errors.notFound("文件不存在");
    if (!(await canManageFileCollectTask(file.submission.task, req.user))) throw Errors.forbidden("没有该文件的下载权限");
    const meta = await getOneDriveChinaItemMetadata(file.path).catch(() => null);
    const rawRemoteUrl = meta?.kind === "file"
      ? meta.downloadUrl || await resolveOneDriveChinaDirectDownloadUrl(file.path).catch(() => "")
      : "";
    const remoteDownloadNameSafe = meta?.kind === "file" && remoteDownloadNameMatchesStoredName(meta.name, file.storedName);
    const action = req.query.action === "preview" ? "preview" : "download";
    const remoteUrl = action === "download" && !remoteDownloadNameSafe ? "" : rawRemoteUrl;
    const remotePreviewUrl = action === "preview" && rawRemoteUrl
      ? await resolveOneDriveChinaPreviewUrl(file.path).catch(() => "")
      : "";
    const origin = normalizePreviewPublicOrigin(getSiteOrigin()) || requestPublicOrigin(req);
    const previewToken = signFileCollectPreviewToken(file);
    const publicOfficePreviewUrl = origin && action === "preview" && !remotePreviewUrl && !remoteUrl && canUseOfficeWebViewer(file)
      ? joinPublicUrl(origin, `/api/tools/file-collection-files/${file.id}/public-preview/${encodeURIComponent(previewToken)}/${encodeURIComponent(file.storedName)}`)
      : "";
    const previewSourceUrl = action === "preview" && isOfficePreviewFile(file.storedName)
      ? publicOfficePreviewUrl
      : "";
    const viewerUrl = previewSourceUrl ? buildOfficeViewerUrl(previewSourceUrl) : "";
    const previewUrl = remotePreviewUrl || viewerUrl;
    const previewMessage = action === "preview" && isOfficePreviewFile(file.storedName) && !previewUrl
      ? officeWebViewerLimitMessage(file) || "该文件暂不支持在线预览，请下载后查看。"
      : "";
    ok(res, {
      id: file.id,
      action,
      backend: remoteUrl ? "onedrive-cn" : "local",
      url: action === "preview" ? previewUrl : remoteUrl,
      viewer: remotePreviewUrl ? "onedrive" : (viewerUrl ? "office" : null),
      previewMessage,
      filename: file.storedName,
      mimeType: file.mimeType || "application/octet-stream",
    });
  } catch (e) { next(e); }
});

const fileCollectPublicPreviewHandler: RequestHandler = async (req, res, next) => {
  try {
    const id = positiveRouteId(req.params.id);
    const token = String(req.params.token || req.query.token || "");
    const file = await prisma.fileCollectFile.findUnique({
      where: { id },
      include: { submission: { include: { task: true } } },
    });
    if (!file || !verifyFileCollectPreviewToken(token, file)) {
      throw Errors.notFound("文件不存在");
    }
    if (!isOfficePreviewFile(file.storedName)) throw Errors.badRequest("该文件不支持在线预览");
    const meta = await getOneDriveChinaItemMetadata(file.path).catch(() => null);
    const remoteUrl = meta?.kind === "file"
      ? meta.downloadUrl || await resolveOneDriveChinaDirectDownloadUrl(file.path).catch(() => "")
      : "";
    if (remoteUrl) {
      res.redirect(302, remoteUrl);
      return;
    }
    const absolute = await ensureMediaLocalPathFromUploadUrl(`/uploads/${file.path}`);
    if (!absolute) throw Errors.notFound("文件已丢失");
    res.type(file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.storedName)}`);
    res.sendFile(absolute);
  } catch (e) { next(e); }
};

toolsRouter.get("/file-collection-files/:id/public-preview/:filename?", fileCollectPublicPreviewHandler);
toolsRouter.head("/file-collection-files/:id/public-preview/:filename?", fileCollectPublicPreviewHandler);
toolsRouter.get("/file-collection-files/:id/public-preview/:token/:filename?", fileCollectPublicPreviewHandler);
toolsRouter.head("/file-collection-files/:id/public-preview/:token/:filename?", fileCollectPublicPreviewHandler);

toolsRouter.get("/file-collection-files/:id/:action(download|preview)", authRequired, async (req, res, next) => {
  try {
    const id = positiveRouteId(req.params.id);
    const file = await prisma.fileCollectFile.findUnique({
      where: { id },
      include: { submission: { include: { task: true } } },
    });
    if (!file) throw Errors.notFound("文件不存在");
    if (!(await canManageFileCollectTask(file.submission.task, req.user))) throw Errors.forbidden("没有该文件的下载权限");
    const absolute = await ensureMediaLocalPathFromUploadUrl(`/uploads/${file.path}`);
    if (!absolute) throw Errors.notFound("文件已丢失");
    if (req.params.action === "preview") {
      res.type(file.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.storedName)}`);
      res.sendFile(absolute);
      return;
    }
    res.download(absolute, file.storedName);
  } catch (e) { next(e); }
});

toolsRouter.delete("/file-collection-files/:id", authRequired, async (req, res, next) => {
  try {
    const id = positiveRouteId(req.params.id);
    const file = await prisma.fileCollectFile.findUnique({
      where: { id },
      include: { submission: { include: { task: true } } },
    });
    if (!file) throw Errors.notFound("文件不存在");
    if (!(await canManageFileCollectTask(file.submission.task, req.user))) throw Errors.forbidden("没有该文件的管理权限");
    const deletedPath = await prisma.$transaction(async (tx) => {
      await acquireFileCollectSubmissionLock(
        tx,
        file.submission.taskId,
        file.submission.identity || `submission:${file.submission.id}`,
      );
      const current = await tx.fileCollectFile.findUnique({
        where: { id },
        include: { submission: { include: { task: true } } },
      });
      if (!current) throw Errors.notFound("文件不存在");
      if (!isSiteAdmin(req.user?.role) && current.submission.task.createdById !== req.user!.userId) {
        throw Errors.forbidden("没有该文件的管理权限");
      }
      await tx.fileCollectFile.delete({ where: { id } });
      await refreshFileCollectTaskCounters(tx, current.submission.taskId);
      return current.path;
    });
    await unlinkFileCollectPath(deletedPath);
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

toolsRouter.delete("/file-collection-submissions/:id", authRequired, async (req, res, next) => {
  try {
    const id = positiveRouteId(req.params.id);
    const submission = await prisma.fileCollectSubmission.findUnique({
      where: { id },
      include: { task: true, files: true },
    });
    if (!submission) throw Errors.notFound("提交记录不存在");
    if (!(await canManageFileCollectTask(submission.task, req.user))) throw Errors.forbidden("没有该提交记录的管理权限");
    const deletedPaths = await prisma.$transaction(async (tx) => {
      await acquireFileCollectSubmissionLock(
        tx,
        submission.taskId,
        submission.identity || `submission:${submission.id}`,
      );
      const current = await tx.fileCollectSubmission.findUnique({
        where: { id },
        include: { task: true, files: true },
      });
      if (!current) throw Errors.notFound("提交记录不存在");
      if (!isSiteAdmin(req.user?.role) && current.task.createdById !== req.user!.userId) {
        throw Errors.forbidden("没有该提交记录的管理权限");
      }
      await tx.fileCollectSubmission.delete({ where: { id } });
      await refreshFileCollectTaskCounters(tx, current.taskId);
      return current.files.map((file) => file.path);
    });
    await Promise.all(deletedPaths.map((relativePath) => unlinkFileCollectPath(relativePath)));
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseFileCollectFields(raw: string | null | undefined): FileCollectField[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      const legacy = item && typeof item === "object"
        ? item as Record<string, unknown>
        : {};
      return fileCollectFieldSchema.parse({
        id: legacy.id ?? legacy.key,
        label: legacy.label,
        ...(legacy.required === undefined ? {} : { required: Boolean(legacy.required) }),
        ...(legacy.placeholder === undefined ? {} : { placeholder: legacy.placeholder }),
        ...(legacy.pattern === undefined ? {} : { pattern: legacy.pattern }),
      });
    });
  } catch {
    return [];
  }
}

function parseFileCollectRules(raw: string | null | undefined): FileCollectRules {
  if (!raw) return fileCollectRuleSchema.parse({});
  try {
    return fileCollectRuleSchema.parse(JSON.parse(raw));
  } catch {
    return fileCollectRuleSchema.parse({});
  }
}

function normalizeFileCollectInput(input: CreateFileCollectInput) {
  const fieldIds = new Set<string>();
  for (const field of input.fields) {
    if (fieldIds.has(field.id)) throw Errors.badRequest(`字段 ID 重复：${field.id}`);
    if (field.pattern) {
      try {
        new RegExp(field.pattern);
      } catch {
        throw Errors.badRequest(`字段“${field.label}”的正则规则不合法`);
      }
    }
    fieldIds.add(field.id);
  }
  return {
    ...input,
    status: input.status ?? "open",
    visibility: input.visibility ?? "public",
    description: input.description ?? "",
    expectedEntries: input.expectedEntries ?? "",
    renameTemplate: input.renameTemplate || "{name}-{student_id}",
    folderTemplate: input.folderTemplate || "{name}-{student_id}",
    fileRules: fileCollectRuleSchema.parse(input.fileRules ?? {}),
  };
}

function normalizeFileCollectPatch(input: PatchFileCollectInput) {
  const merged = { ...input };
  if (merged.fields) normalizeFileCollectInput({
    title: merged.title || "patch",
    fields: merged.fields,
    fileRules: merged.fileRules ?? fileCollectRuleSchema.parse({}),
    renameTemplate: merged.renameTemplate ?? "{name}-{student_id}",
    folderTemplate: merged.folderTemplate ?? "{name}-{student_id}",
  });
  if (merged.fileRules) merged.fileRules = fileCollectRuleSchema.parse(merged.fileRules);
  return merged;
}

function normalizeFileCollectTemplateInput(input: CreateFileCollectTemplateInput) {
  const normalized = normalizeFileCollectInput({
    title: input.name,
    description: input.description,
    visibility: input.visibility ?? "public",
    fields: input.fields,
    fileRules: input.fileRules,
    renameTemplate: input.renameTemplate,
    folderTemplate: input.folderTemplate,
    expectedEntries: input.expectedEntries,
  });
  return {
    name: input.name,
    description: normalized.description,
    visibility: normalized.visibility,
    fields: normalized.fields,
    fileRules: normalized.fileRules,
    renameTemplate: normalized.renameTemplate,
    folderTemplate: normalized.folderTemplate,
    expectedEntries: normalized.expectedEntries,
  };
}

function normalizeFileCollectTask(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    fields: parseFileCollectFields(row.fields),
    fileRules: parseFileCollectRules(row.fileRules),
    renameTemplate: row.renameTemplate,
    folderTemplate: row.folderTemplate,
    expectedEntries: row.expectedEntries,
    submissionCount: row.submissionCount,
    fileCount: row.fileCount,
    publishedAt: row.publishedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy ? {
      id: row.createdBy.id,
      nickname: row.createdBy.nickname,
      username: row.createdBy.username,
      role: row.createdBy.role,
    } : null,
  };
}

function normalizeFileCollectTemplate(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    fields: parseFileCollectFields(row.fields),
    fileRules: parseFileCollectRules(row.fileRules),
    renameTemplate: row.renameTemplate,
    folderTemplate: row.folderTemplate,
    expectedEntries: row.expectedEntries,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy ? {
      id: row.createdBy.id,
      nickname: row.createdBy.nickname,
      username: row.createdBy.username,
      role: row.createdBy.role,
    } : null,
  };
}

function normalizeFileCollectSubmission(row: any) {
  return {
    id: row.id,
    taskId: row.taskId,
    identity: row.identity,
    data: parseJsonObject(row.data),
    ip: row.ip,
    createdAt: row.createdAt,
    submitter: row.submitter ? {
      id: row.submitter.id,
      nickname: row.submitter.nickname,
      username: row.submitter.username,
      role: row.submitter.role,
    } : null,
    files: (row.files ?? []).map((file: any) => ({
      id: file.id,
      originalName: file.originalName,
      storedName: file.storedName,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
    })),
  };
}

function normalizeFileCollectSubmissionData(fields: FileCollectField[], input: Record<string, unknown>) {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const value = String(input[field.id] ?? "").trim();
    if (field.required && !value) throw Errors.badRequest(`请填写：${field.label}`);
    if (value && field.pattern && !(new RegExp(field.pattern).test(value))) {
      throw Errors.badRequest(`“${field.label}”格式不正确`);
    }
    result[field.id] = value.slice(0, 300);
  }
  return result;
}

function validateFileCollectUpload(files: Express.Multer.File[], rules: FileCollectRules) {
  if (!files.length) throw Errors.badRequest("请至少上传一个文件");
  if (files.length > rules.maxCount) throw Errors.badRequest(`最多只能上传 ${rules.maxCount} 个文件`);
  const allowed = new Set(rules.allowedTypes);
  const maxBytes = rules.maxSizeMb * 1024 * 1024;
  for (const file of files) {
    const ext = path.extname(file.originalname || "").slice(1).toLowerCase();
    if (allowed.size && !allowed.has(ext)) throw Errors.badRequest(`${file.originalname} 类型不允许`);
    if (file.size > maxBytes) throw Errors.badRequest(`${file.originalname} 超过 ${rules.maxSizeMb} MB`);
  }
}

function fileCollectIdentity(data: Record<string, string>, fields: FileCollectField[]) {
  const preferred = ["student_id", "exam_id", "id", "name"];
  const preferredKey = preferred.find((key) => data[key]);
  if (preferredKey) return data[preferredKey].replace(/\s+/g, "");
  const firstRequired = fields.find((field) => field.required && data[field.id]);
  return firstRequired ? data[firstRequired.id].replace(/\s+/g, "") : "";
}

function assertFileCollectTaskAcceptsSubmission(
  task: { status: string; visibility: string; deadline: Date | null },
  user: Express.Request["user"],
) {
  if (task.status !== "open") throw Errors.badRequest("收集任务当前未开放提交");
  if (task.deadline && Date.now() > task.deadline.getTime()) throw Errors.badRequest("已超过截止时间");
  if (task.visibility === "login" && !user?.userId) throw Errors.unauthorized("请先登录后提交");
}

function safeStoredFilename(value: string) {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 160);
  return cleaned || "file";
}

function remoteDownloadNameMatchesStoredName(remoteName: string | null | undefined, storedName: string) {
  return safeStoredFilename(String(remoteName || "")) === safeStoredFilename(storedName);
}

function renderFileCollectName(template: string, data: Record<string, string>, originalName: string, index: number, total: number) {
  const ext = path.extname(originalName || "").toLowerCase();
  const stem = path.basename(originalName || "file", path.extname(originalName || ""));
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, safeStoredFilename(value)])),
    original: safeStoredFilename(stem),
    index: total > 1 ? String(index) : "",
  };
  const rendered = template.replace(/\{([a-zA-Z0-9_\u4e00-\u9fa5]+)(?:\|(last|first):(\d{1,2}))?\}/g, (_match, key, op, rawCount) => {
    const value = values[key] || "";
    const count = Number(rawCount || 0);
    if (op === "last") return count > 0 ? value.slice(-count) : "";
    if (op === "first") return count > 0 ? value.slice(0, count) : "";
    return value;
  });
  const base = safeStoredFilename(rendered).replace(/[-_ ]{2,}/g, "-").replace(/^[\s\-_.]+|[\s\-_.]+$/g, "") || "file";
  const withIndex = total > 1 && !template.includes("{index}") ? `${base}-${index}` : base;
  return `${withIndex}${ext}`;
}

function resolveFileCollectPath(relative: string) {
  const uploadRoot = path.resolve(process.cwd(), "uploads");
  const absolute = path.resolve(uploadRoot, relative);
  if (!absolute.startsWith(path.resolve(uploadRoot, "file-collect") + path.sep)) {
    throw Errors.forbidden("文件路径不合法");
  }
  return absolute;
}

async function unlinkFileCollectPath(relative: string) {
  await deleteMediaAsset(relative).catch(() => null);
}

async function canManageFileCollectTask(row: { createdById: number | null }, user: Express.Request["user"]) {
  if (!user?.userId) return false;
  if (isSiteAdmin(user.role)) return true;
  return row.createdById === user.userId && await hasToolContentManagePermission("file_collect", user);
}

async function ensureToolUsableForRequest(toolCode: string, user: any) {
  try {
    await assertToolUsable(toolCode, user);
  } catch (e: any) {
    if (e?.message === "TOOL_LOGIN_REQUIRED") throw Errors.unauthorized("该小工具需要登录后使用");
    if (e?.message === "INVALID_TOOL_CODE") throw Errors.badRequest("小工具不合法");
    throw e;
  }
}

function positiveRouteId(value: unknown) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest("资源 ID 不合法");
  return id;
}
