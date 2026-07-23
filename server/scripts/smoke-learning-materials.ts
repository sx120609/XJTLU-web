import assert from "node:assert/strict";
import path from "node:path";
import { rm } from "node:fs/promises";
import { prisma } from "../src/prisma";
import { signToken } from "../src/utils/jwt";

const baseUrl = String(process.env.MATERIALS_SMOKE_URL || "http://127.0.0.1:3011/api").replace(/\/$/, "");
const smokeTitle = "资料专区自动化冒烟测试（自动清理）";

async function cleanupMaterialSupportNotificationResidue() {
  const notifications = await prisma.notification.findMany({
    where: { link: { startsWith: "/market/learning-materials/support?ticket=" } },
    select: { id: true, link: true, content: true },
  });
  const ticketIds = notifications
    .map((notification) => Number(notification.link?.match(/[?&]ticket=(\d+)/)?.[1] || 0))
    .filter((id) => id > 0);
  const existingTickets = ticketIds.length
    ? await prisma.learningMaterialSupportTicket.findMany({ where: { id: { in: ticketIds } }, select: { id: true } })
    : [];
  const existingTicketIds = new Set(existingTickets.map((ticket) => ticket.id));
  const staleNotificationIds = notifications
    .filter((notification) => {
      const ticketId = Number(notification.link?.match(/[?&]ticket=(\d+)/)?.[1] || 0);
      return notification.content.includes(smokeTitle) || (ticketId > 0 && !existingTicketIds.has(ticketId));
    })
    .map((notification) => notification.id);
  if (staleNotificationIds.length) {
    await prisma.notification.deleteMany({ where: { id: { in: staleNotificationIds } } });
  }
}

async function cleanupSmokeItem(itemId: number) {
  const item = await prisma.marketItem.findUnique({ where: { id: itemId }, select: { topicId: true, learningMaterial: { select: { id: true } } } });
  if (!item) {
    await cleanupMaterialSupportNotificationResidue();
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.marketOrder.deleteMany({ where: { itemId } });
    await tx.marketOffer.deleteMany({ where: { itemId } });
    await tx.marketItem.delete({ where: { id: itemId } });
    if (item.topicId) await tx.topic.delete({ where: { id: item.topicId } }).catch(() => null);
  });
  if (item.learningMaterial?.id) {
    const privateRoot = path.resolve(process.cwd(), "runtime", "learning-materials");
    const target = path.resolve(privateRoot, String(item.learningMaterial.id));
    if (target.startsWith(`${privateRoot}${path.sep}`)) await rm(target, { recursive: true, force: true }).catch(() => null);
  }
  await cleanupMaterialSupportNotificationResidue();
}

async function main() {
  await cleanupMaterialSupportNotificationResidue();
  const staleItems = await prisma.marketItem.findMany({ where: { title: smokeTitle }, select: { id: true } });
  for (const stale of staleItems) await cleanupSmokeItem(stale.id);
  const operator = await prisma.user.findFirst({ where: { role: "admin", status: "active" }, orderBy: { id: "asc" } });
  const seller = await prisma.user.findFirst({ where: { role: { notIn: ["admin", "mod"] }, status: "active" }, orderBy: { id: "asc" } });
  const buyer = await prisma.user.findFirst({ where: { role: { notIn: ["admin", "mod"] }, status: "active", id: { not: seller?.id } }, orderBy: { id: "asc" } });
  assert(operator, "需要一个管理员账号运行资料专区冒烟测试");
  assert(seller, "需要一个普通卖家账号运行资料专区冒烟测试");
  assert(buyer, "需要另一个普通买家账号运行资料专区冒烟测试");
  const sellerWasStudentSso = seller.studentSso;
  const buyerWasStudentSso = buyer.studentSso;
  if (!seller.studentSso) await prisma.user.update({ where: { id: seller.id }, data: { studentSso: true } });
  if (!buyer.studentSso) await prisma.user.update({ where: { id: buyer.id }, data: { studentSso: true } });
  const sellerToken = signToken({ userId: seller.id, studentId: seller.username, role: seller.role, campus: "" });
  const buyerToken = signToken({ userId: buyer.id, studentId: buyer.username, role: buyer.role, campus: "" });
  const operatorToken = signToken({ userId: operator.id, studentId: operator.username, role: operator.role, campus: "" });
  let itemId = 0;

  const jsonCall = async (token: string, apiPath: string, init: RequestInit = {}) => {
    const response = await fetch(`${baseUrl}${apiPath}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
    const body = await response.json();
    assert.equal(response.ok, true, `${apiPath}: HTTP ${response.status} ${body?.message || ""}`);
    assert.equal(body.code, 0, `${apiPath}: ${body?.message || "接口失败"}`);
    return body.data;
  };
  const expectRejected = async (token: string, apiPath: string, init: RequestInit = {}) => {
    const response = await fetch(`${baseUrl}${apiPath}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
    const body = await response.json();
    assert.equal(response.ok, false, `${apiPath} 本应被拒绝`);
    assert.notEqual(body.code, 0);
  };

  try {
    const meta = await jsonCall(sellerToken, "/market/materials/meta");
    assert.equal(meta.semesters.length, 8);
    assert(meta.types.length >= 8);
    assert(meta.supportCategories.some((item: { value: string }) => item.value === "file_unavailable"));
    await expectRejected(sellerToken, "/market/items", { method: "POST", body: JSON.stringify({ catalog: "learning_materials", listingType: "sell", title: "绕过专属接口", description: "该请求必须被拒绝", category: "digital_goods", price: 0, condition: "good", tradeMode: "online", images: [], digitalDelivery: "legacy", draft: true }) });
    const beforeConversations = await prisma.marketConversation.count();
    const created = await jsonCall(sellerToken, "/market/materials/items", {
      method: "POST",
      body: JSON.stringify({
        title: smokeTitle,
        description: "用于核验草稿、私有版本、发布、购买、下载与订单售后闭环。",
        price: 0,
        images: [],
        draft: true,
        profile: { courseCode: "SMOKE101", applicableSemester: "Y1S1", typeId: meta.types[0].id, fileFormats: ["TXT"], pageCount: 1, versionLabel: "测试版", language: "zh-CN", originalityKind: "original", originalityStatement: "自动化测试文件", rightsConfirmed: true },
      }),
    });
    itemId = created.id;
    assert.equal(created.status, "draft");
    assert.equal(created.topicId, null, "学习资料不应自动生成广场帖子");
    await expectRejected(sellerToken, `/market/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ title: "绕过专属编辑接口" }) });

    const form = new FormData();
    form.append("files", new Blob(["Kaopu learning materials smoke test"], { type: "text/plain" }), "smoke-notes.txt");
    form.append("label", "v1.0 smoke");
    form.append("releaseNotes", "自动化上传版本");
    const uploadResponse = await fetch(`${baseUrl}/market/materials/items/${itemId}/versions`, { method: "POST", headers: { Authorization: `Bearer ${sellerToken}` }, body: form });
    const uploadBody = await uploadResponse.json();
    assert.equal(uploadResponse.ok, true, `上传版本失败：${uploadBody?.message || uploadResponse.status}`);
    const version = uploadBody.data;
    assert.equal(version.files.length, 1);
    await jsonCall(sellerToken, `/market/materials/items/${itemId}/versions/${version.id}/publish`, { method: "POST", body: "{}" });
    const published = await jsonCall(sellerToken, `/market/materials/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) });
    assert.equal(published.status, "active");
    assert.equal(published.material.activeVersion.id, version.id);

    const ordinary = await jsonCall(sellerToken, "/market/items?q=SMOKE101");
    assert.equal(ordinary.list.some((item: { id: number }) => item.id === itemId), false);
    const materials = await jsonCall(sellerToken, "/market/materials/items?courseCode=SMOKE101");
    assert(materials.list.some((item: { id: number }) => item.id === itemId));
    await expectRejected(buyerToken, `/market/items/${itemId}/conversations`, { method: "POST", body: JSON.stringify({ message: "购买前私聊" }) });
    await expectRejected(buyerToken, `/market/items/${itemId}/offers`, { method: "POST", body: JSON.stringify({ price: 0, message: "购买意向" }) });

    const order = await jsonCall(buyerToken, `/market/materials/items/${itemId}/purchase`, { method: "POST", body: "{}" });
    assert.equal(order.free, true);
    assert.equal(order.status, "completed");
    assert.equal(await prisma.marketConversation.count(), beforeConversations, "学习资料购买不应创建普通私聊");
    const library = await jsonCall(buyerToken, "/market/materials/library");
    const entry = library.find((row: { order: { id: number } }) => row.order.id === order.id);
    assert(entry, "购买后的资料未出现在资料库");
    const fileId = entry.version.files[0].id;
    const download = await fetch(`${baseUrl}/market/materials/files/${fileId}/download`, { headers: { Authorization: `Bearer ${buyerToken}` } });
    assert.equal(download.ok, true, "已购资料下载失败");
    assert.equal(await download.text(), "Kaopu learning materials smoke test");

    const support = await jsonCall(buyerToken, `/market/materials/orders/${order.id}/support`, { method: "POST", body: JSON.stringify({ category: "file_unavailable", message: "自动化测试：核验订单售后留痕。" }) });
    assert.equal(support.status, "waiting_seller");
    await jsonCall(sellerToken, `/market/materials/support/${support.id}/messages`, { method: "POST", body: JSON.stringify({ content: "自动化测试：卖家已检查资料版本。" }) });
    const sellerResolution = await jsonCall(sellerToken, `/market/materials/support/${support.id}`, { method: "PATCH", body: JSON.stringify({ action: "resolve" }) });
    assert.equal(sellerResolution.status, "waiting_buyer", "卖家不能单方面最终关闭售后");
    const escalated = await jsonCall(buyerToken, `/market/materials/support/${support.id}`, { method: "PATCH", body: JSON.stringify({ action: "escalate" }) });
    assert.equal(escalated.status, "escalated");
    const adminOverview = await jsonCall(operatorToken, "/market/materials/admin/overview");
    assert(adminOverview.activeItems >= 1);
    assert(adminOverview.escalatedTickets >= 1);
    const resolved = await jsonCall(operatorToken, `/market/materials/support/${support.id}`, { method: "PATCH", body: JSON.stringify({ action: "resolve" }) });
    assert.equal(resolved.status, "resolved");
    assert.equal((await prisma.marketOrder.findUnique({ where: { id: order.id }, select: { status: true } }))?.status, "completed", "平台解决售后后应恢复已完成订单状态");

    console.log(JSON.stringify({ ok: true, checks: ["eight-semesters", "block-generic-create", "draft", "block-generic-edit", "private-upload", "version-publish", "catalog-boundary", "block-presale-chat", "block-generic-offer", "direct-purchase", "no-presale-chat", "library", "authorized-download", "support", "seller-reply", "seller-cannot-close", "platform-escalation", "admin-overview", "platform-resolution"] }));
  } finally {
    if (itemId) await cleanupSmokeItem(itemId).catch(() => null);
    await cleanupMaterialSupportNotificationResidue().catch(() => null);
    if (!sellerWasStudentSso) await prisma.user.update({ where: { id: seller.id }, data: { studentSso: false } }).catch(() => null);
    if (!buyerWasStudentSso) await prisma.user.update({ where: { id: buyer.id }, data: { studentSso: false } }).catch(() => null);
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
