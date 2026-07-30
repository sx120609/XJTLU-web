import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { ok, Errors, HttpError } from "../utils/response";
import { withCache } from "../services/cache";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { invalidateCourseCaches } from "../services/cacheInvalidation";
import { isFeatureOn } from "../services/siteSettings";
import { ensureForumAccessEnabled, forumAccessErrorMessage, resolveForumAccess } from "../services/forumAccess";
import { verifyToken } from "../utils/jwt";

export const courseRouter = Router();

function assertCourseReviewEnabled() {
  if (!isFeatureOn("coursereview")) throw Errors.forbidden("课程点评当前已关闭");
}

async function ensureCanReadCourseReview(req: { headers: Record<string, any> }) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) throw Errors.forbidden(forumAccessErrorMessage(false));
  let token;
  try {
    token = verifyToken(auth.slice(7));
  } catch {
    throw Errors.forbidden(forumAccessErrorMessage(false));
  }
  const allowed = await resolveForumAccess(token.userId, token.role);
  if (!allowed) throw Errors.forbidden(forumAccessErrorMessage(true));
}

/** 把 Course 的 courseTeachers 关联展开成 teachers: { id, name, courseTeacherId }[] */
function withTeachers(course: any) {
  if (!course) return course;
  const teachers = (course.courseTeachers ?? []).map((ct: any) => ({
    id: ct.teacher.id,
    name: ct.teacher.name,
    courseTeacherId: ct.id,
  }));
  const { courseTeachers, ...rest } = course;
  return { ...rest, teachers };
}

courseRouter.get("/", async (req, res, next) => {
  try {
    assertCourseReviewEnabled();
    await ensureCanReadCourseReview(req);
    const q = String(req.query.q ?? "").trim();
    const mine = req.query.mine === "1";
    const where: any = {};

    if (mine) {
      // 解析 token 拿 userId（公开路由，软鉴权）
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) return ok(res, []);
      try {
        const { verifyToken } = await import("../utils/jwt");
        const userId = verifyToken(auth.slice(7)).userId;
        const ucs = await prisma.userCourse.findMany({ where: { userId }, select: { courseId: true } });
        if (!ucs.length) return ok(res, []);
        where.id = { in: ucs.map((u) => u.courseId) };
      } catch { return ok(res, []); }
    }
    if (q) where.OR = [
      { name: { contains: q } },
      { code: { contains: q } },
      { teacher: { contains: q } }, // 兼容旧字段
      { courseTeachers: { some: { teacher: { name: { contains: q } } } } },
    ];

    const list = mine
      ? await prisma.course.findMany({
          where,
          orderBy: [{ ratingCount: "desc" }, { id: "asc" }],
          take: 200,
          include: {
            courseTeachers: { include: { teacher: true } },
          },
        })
      : await withCache("courses", ["list", q || ""], 5 * 60_000, async () => prisma.course.findMany({
          where,
          orderBy: [{ ratingCount: "desc" }, { id: "asc" }],
          take: 200,
          include: {
            courseTeachers: { include: { teacher: true } },
          },
        }));
    ok(res, list.map(withTeachers));
  } catch (e) { next(e); }
});

courseRouter.get("/:id", async (req, res, next) => {
  try {
    assertCourseReviewEnabled();
    await ensureCanReadCourseReview(req);
    const id = Number(req.params.id);
    const course = await withCache("courses", ["detail", id], 5 * 60_000, async () => prisma.course.findUnique({
      where: { id },
      include: {
        courseTeachers: { include: { teacher: true } },
      },
    }));
    if (!course) throw Errors.notFound("课程不存在");
    const ratings = await withCache("courses", ["ratings", id], 5 * 60_000, async () => prisma.courseRating.findMany({
      where: { courseId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        courseTeacher: { include: { teacher: true } },
      },
    }));
    // 评分上也把老师名展开，前端可显示"@王老师"
    const ratingsOut = ratings.map((r: any) => ({
      ...r,
      teacherName: r.courseTeacher?.teacher?.name ?? null,
      teacherId: r.courseTeacher?.teacher?.id ?? null,
      courseTeacher: undefined,
    }));
    ok(res, { course: withTeachers(course), ratings: ratingsOut });
  } catch (e) { next(e); }
});

/** 为某门课添加授课老师；登录用户即可，重复时返回已有 */
const addTeacherSchema = z.object({
  name: z.string().trim().min(1).max(40),
});
courseRouter.post("/:id/teachers", authRequired, validate(addTeacherSchema), async (req, res, next) => {
  try {
    assertCourseReviewEnabled();
    await ensureForumAccessEnabled(req.user!.userId, req.user!.role);
    const courseId = Number(req.params.id);
    const name = String(req.body.name).trim();
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw Errors.notFound("课程不存在");

    const teacher = await prisma.teacher.upsert({
      where: { name },
      update: {},
      create: { name, createdById: req.user!.userId },
    });
    const ct = await prisma.courseTeacher.upsert({
      where: { courseId_teacherId: { courseId, teacherId: teacher.id } },
      update: {},
      create: { courseId, teacherId: teacher.id, source: "user-add" },
    });
    await invalidateCourseCaches();
    ok(res, { id: teacher.id, name: teacher.name, courseTeacherId: ct.id });
  } catch (e) { next(e); }
});

/** XJTLU 课程同步将在教务接口完成适配后重新实现。 */
courseRouter.post("/sync", (_req, _res, next) => {
  next(new HttpError(501, 5501, "XJTLU 教务课程同步尚未接入"));
});
