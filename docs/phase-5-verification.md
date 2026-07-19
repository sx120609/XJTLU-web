# 阶段 5 验收记录：商业化

日期：2026-07-18

## 验收结论

阶段 5 已完成并通过验收。商品置顶、求购加急、首页推广、合作商户主页、推广订单、明确标识、去重曝光/点击和后台可配置价格均已形成闭环。推广首期采用“订单记录 + 管理员线下核验 + 人工确认”，没有接入自动支付，也没有改变学生商品款由买卖双方线下直接结算的边界。

本阶段继续复用 Vue 3、Express、Prisma、现有商品/求购/用户/评价/举报/通知/管理后台与媒体上传能力；未替换靠浦品牌、图标体系或整体视觉风格，未修改现有登录页面与登录流程。

## 已完成范围

### 1. 四类商业服务

- 商品置顶：有效实体商品可申请置顶，确认后在市集列表优先展示并标记“置顶”。
- 求购加急：有效求购可申请加急，确认后在求购列表优先展示并标记“加急”。
- 首页推广：有效实体商品进入首页底部独立“推广推荐”区，与自然推荐分开展示并标记“推广”。
- 合作商户主页：服务者先提交独立商户资料，经管理员审核后才能申请主页推广；主页标记“合作商户”。

### 2. 商户主页和隐私

- 商户资料独立于普通商品，包括介绍、价格范围、图片、服务区域、学生优惠和业务联系方式。
- 联系方式加密入库，公开页只返回脱敏值；已登录且通过校园身份验证的用户主动咨询后才返回明文。
- 主页展示真实浏览、收藏、咨询数据，并复用站内已完成交易评价，不生成伪造评分或评价。
- 支持收藏、咨询、分享和举报；后台可审核、驳回或暂停商户资料。

### 3. 推广订单和配置

- 推广订单状态为 `pending`、`confirmed`、`rejected`、`cancelled`、`expired`。
- 订单保存方案名称、价格、时长和展示位置快照；后续调价不会改写历史订单。
- 管理后台新增“推广”页，可人工确认/驳回订单、审核商户、配置方案价格/时长/启停状态。
- 运行时价格只从 `PromotionPlan` 读取，业务源码无硬编码推广价格。
- 推广订单固定 `paymentMode=manual`，与现有赞助和 EasyPay 逻辑隔离。

### 4. 标识、排序和数据

- 商品列表/详情、首页自然商品卡片、求购列表/详情、首页推广区、商户目录/详情和统一搜索均保留商业标识。
- 首页推广使用独立区域，并明确说明为付费推广，不伪装成普通评价或自然推荐。
- 曝光和点击按推广订单、事件类型、访客摘要和自然日去重。
- 只存储不可逆访客摘要和去重键，不保存原始 IP 或完整 User-Agent。
- 定时清理到期推广，同时在相关查询前执行幂等到期刷新。

### 5. 统一搜索

- 已审核且推广有效的合作商户进入统一搜索的独立分组。
- 搜索结果中的置顶商品、加急求购和合作商户均显示商业标识，并记录去重曝光/点击。

## 主要修改和新增文件

后端主要修改：

- `server/prisma/schema.prisma`
- `server/src/app.ts`
- `server/src/routes/market.ts`
- `server/src/routes/home.ts`
- `server/src/routes/search.ts`
- `server/package.json`
- `server/scripts/verify-migration-baseline.ts`

后端新增：

- `server/prisma/migrations/20260718050000_stage_5_promotions/migration.sql`
- `server/src/routes/marketPromotions.ts`
- `server/src/services/promotion.ts`
- `server/tests/phase5Commercialization.test.ts`
- `server/tests/phase5Commercialization.integration.test.ts`

前端主要修改：

- `web/src/router/index.ts`
- `web/src/api/request.ts`
- `web/src/api/market.ts`
- `web/src/api/home.ts`
- `web/src/api/search.ts`
- `web/src/views/Home.vue`
- `web/src/views/search/Result.vue`
- `web/src/views/market/Index.vue`
- `web/src/views/market/Detail.vue`
- `web/src/views/market/WantedList.vue`
- `web/src/views/market/WantedDetail.vue`
- `web/src/views/market/UserProfile.vue`
- `web/src/views/admin/Index.vue`
- `web/src/components/market/MarketSectionNav.vue`

前端新增：

- `web/src/components/market/PromotionLabel.vue`
- `web/src/views/market/PromotionCenter.vue`
- `web/src/views/market/MerchantApply.vue`
- `web/src/views/market/MerchantList.vue`
- `web/src/views/market/MerchantProfile.vue`
- `web/src/views/admin/PromotionPane.vue`

## 数据库变化

- `MarketItem` 新增置顶、首页推广有效期及当前推广订单引用。
- `WantedPost` 新增加急有效期及当前推广订单引用。
- 新增 6 张表：`MerchantProfile`、`MerchantFavorite`、`MerchantInquiry`、`PromotionPlan`、`PromotionOrder`、`PromotionEvent`。
- 迁移写入 4 条初始方案配置；它们只是数据库初始值，运行时可在后台修改。
- 当前活动迁移共 10 段，空 Schema 从零迁移后共 91 张表。
- 迁移为增量式，没有删除商品、求购、订单、评价、支付或历史资料数据。

## 保留或隐藏的旧能力

- 普通商品的支付、订单、意向、预订和线下确认写法继续保留；学生商品支付开关仍为关闭。
- 现有 EasyPay 与赞助订单继续服务原模块，推广订单没有复用其收款回调或财务汇总。
- 付费数字学习资料仍关闭，免费原创价格保持 0 元。
- 本阶段没有删除旧表或旧路由；未启用钱包、提现、担保交易或商品款平台代收。

## 自动化和实例核验

- 阶段 5 专项单元/源码测试：5/5 通过。
- 阶段 5 真实 HTTP/数据库闭环：1/1 通过。
- 全量单元与产品回归：68/68 通过。
- 全量真实集成测试：7/7 通过。
- 后端 TypeScript 生产构建：通过。
- 前端 `vue-tsc` 与 Vite 生产构建：通过，2916 个模块完成转换。
- Prisma Schema 校验和迁移状态：通过，10 段迁移全部最新。
- 空库迁移基线演练：91 张表、10 段迁移，全部通过并已清理临时 Schema。
- 生产预览 `/`、`/market`、`/market/promotions`、`/market/merchants`、`/market/merchant/apply`、`/admin`、`/learning/free` 和旧学习资料地址：均返回 HTTP 200 和应用壳。
- 后端健康检查、推广方案、商户列表和统一搜索接口均可正常访问。
- 市集与免费原创数据库检查通过；付费学习内容 0 条。
- 阶段 5 测试残留：用户 0、主题 0、推广订单 0；方案价格已恢复初始配置。
- 临时生产预览已停止，端口已释放；未终止用户原有的 3011、5173、5174 进程。

## 尚存说明

- 首期推广费需要线下核验后人工确认，没有自动支付；这是原计划允许的上线边界。
- 当前只实现计划内四类商业服务，未盲目增加自动刷新、专题合作或自动续费。
- 曝光/点击是去重运营数据，不是第三方广告归因系统。
- 商户资料通过审核后仍需存在已确认且有效的主页推广订单，才会公开出现在商户目录和搜索中。
- 未发现阻止阶段 5 上线的缺陷。

## 站点构建技能的影响

遵循站点构建技能，本阶段在现有 Vue/Express/Prisma 架构内增量实现，复用靠浦品牌、卡片、颜色变量、Element Plus 和已有市场组件；验证采用类型检查、生产构建、真实接口闭环和 HTTP 生产预览，没有引入第二套站点框架。
