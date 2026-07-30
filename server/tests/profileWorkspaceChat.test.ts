import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("profile, trade workspace, favorites, point promotion and chat share the V1 contract", () => {
  const schema = source("../prisma/schema.prisma");
  const userRoute = source("../src/routes/user.ts");
  const topicRoute = source("../src/routes/topic.ts");
  const favorites = source("../src/services/profileFavorites.ts");
  const points = source("../src/services/pointPromotionService.ts");
  const chatRoute = source("../src/routes/marketConversation.ts");
  const chatService = source("../src/services/marketConversationService.ts");
  const mine = source("../../web/src/views/market/Mine.vue");
  const profile = source("../../web/src/views/profile/Index.vue");
  const messages = source("../../web/src/views/market/Messages.vue");
  const marketIndex = source("../../web/src/views/market/Index.vue");
  const promotionCenter = source("../../web/src/views/market/PromotionCenter.vue");
  const appearance = source("../../web/src/stores/appearance.ts");
  const layout = source("../../web/src/layouts/MainLayout.vue");
  const trustService = source("../src/services/marketTrust.ts");
  const governance = source("../src/services/marketGovernanceService.ts");

  assert.match(schema, /model TopicFavorite/);
  assert.match(schema, /model MarketMessageAttachment/);
  assert.match(schema, /model MarketConversationBlock/);
  assert.doesNotMatch(schema, /model MarketContactCard|contactVisibility/);

  assert.match(userRoute, /"\/me\/trust"/);
  assert.match(userRoute, /"\/me\/points"/);
  assert.match(userRoute, /"\/me\/favorites"/);
  assert.match(topicRoute, /"\/:id\/favorite"/);
  for (const type of ["topic", "market_item", "learning_material"]) {
    assert.match(favorites, new RegExp(`"${type}"`));
  }
  assert.doesNotMatch(favorites, /"merchant"/);

  assert.deepEqual(
    [...mine.matchAll(/<el-tab-pane label="([^"]+)"/g)].map((match) => match[1]),
    ["我的发布", "求购需求"],
  );
  assert.deepEqual(
    [...mine.matchAll(/\{ label: "([^"]+)", value: "(?:all|active|sold|draft|withdrawn)" \}/g)]
      .map((match) => match[1]),
    ["全部", "在售", "已售出", "草稿", "已下架"],
  );
  assert.doesNotMatch(mine, /<el-tab-pane label="校园身份与信用"|<el-tab-pane label="我的收藏"/);
  assert.doesNotMatch(mine, /class="head-actions"|发布求购<\/el-button>|出售物品/);
  assert.match(marketIndex, /market-messages[\s\S]*market-mine/);
  assert.match(marketIndex, /unread-dot[\s\S]*交易消息[\s\S]*tradeUnreadCount/);
  assert.doesNotMatch(layout, /footer-inner|页脚导航|footer-safety/);
  assert.match(mine, /编辑后重新发布/);
  assert.doesNotMatch(mine, /wantedLifecycle\([^)]*'renew'/);
  assert.match(profile, /id="trust"/);
  assert.match(profile, /id="favorites"/);
  assert.match(profile, /帖子、商品和学习资料/);
  assert.doesNotMatch(profile, /商家/);
  assert.doesNotMatch(profile, /赞助本站|sponsorOptions|paymentsApi|USER_QQ_GROUP/);
  assert.doesNotMatch(profile, /跟随系统|value: "system"/);
  assert.doesNotMatch(layout, /跟随系统|value: "system"|mode === "system"/);
  assert.match(appearance, /export type AppearanceMode = "light" \| "dark"/);
  assert.doesNotMatch(appearance, /prefers-color-scheme|installSystemListener|"system"/);
  assert.match(profile, /群号暂未填写/);
  assert.doesNotMatch(profile, /复制群号|加入群聊/);
  assert.match(trustService, /physicalSellingItemCount \+ physicalSoldItemCount/);
  assert.match(trustService, /physicalSoldItemCount \/ physicalClosedTradeCount/);
  assert.match(trustService, /positiveRate: user\.marketPositiveRate/);
  assert.match(governance, /requireMarketPositiveRateAdmin/);
  assert.match(governance, /只有管理员可以调整用户好评率/);
  assert.match(governance, /report\.status !== "resolved"/);

  assert.match(points, /enabled: false/);
  assert.match(points, /mechanisms: \[\]/);
  assert.match(points, /不会扣除积分/);
  assert.match(promotionCenter, /机制设计中/);
  assert.doesNotMatch(promotionCenter, /10 积分|24 小时/);

  assert.match(chatRoute, /"\/conversations\/events"/);
  assert.match(chatRoute, /"\/conversations\/unread-count"/);
  assert.match(chatRoute, /"\/conversations\/:id\/confirm-completion"/);
  assert.match(chatRoute, /"\/conversations\/:id\/read"/);
  assert.match(chatRoute, /"\/conversations\/:id\/block"/);
  assert.match(chatRoute, /"\/conversations\/:id\/messages\/:messageId\/report"/);
  assert.match(chatService, /conversationId_senderId_clientMessageId/);
  assert.match(chatService, /nextCursor/);
  assert.match(messages, /EventSource/);
  assert.match(messages, /发送失败，重试/);
  assert.match(messages, /confirmConversationCompletion/);
  assert.match(messages, /ElMessageBox\.confirm/);
  assert.match(messages, /任意一方未确认都不会发放积分/);
  assert.match(messages, /本次私聊已关闭；历史消息仍可查看/);
  assert.match(messages, /买家 \{\{ buyerConfirmed \? "已确认" : "待确认" \}\}/);
  assert.doesNotMatch(messages, /endNegotiation|结束洽谈/);
  assert.match(messages, /举报消息/);
  assert.match(messages, /屏蔽对方/);
  assert.match(messages, /图片/);
});
