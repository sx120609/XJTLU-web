# 阶段 4 验收记录：广场与学习

> 历史说明：本文记录阶段 4 当时的验收结果，其中“免费学习资料”方案已被迭代一的付费原创资料方案取代。当前产品与开发验收以 `iteration-1-paid-learning-commerce-workflow.md` 为准。

日期：2026-07-18

## 验收结论

阶段 4 已完成并通过验收，可以进入阶段 5。广场收敛为四个明确栏目，帖子可以关联商品或求购；学习中心形成“学习好物、学习交流、免费原创、官方学习资源”四部分。改造复用现有 Vue、Express、Prisma、商品、求购、帖子、服务卡片和免费资料领取链路，没有改写登录流程，没有替换品牌标识，也没有恢复付费数字资料交易。

## 已完成范围

### 1. 广场四个栏目

- 广场公开目录严格收敛为“求助与问答、交易咨询与估价、评价与避坑、校园生活”四栏。
- `market` 继续服务市集业务，但不混入广场栏目。
- `general`、`study`、`coursereview` 等旧板块保留数据和直达能力，退出广场主目录并标记为历史板块。
- 广场首页沿用现有卡片、色彩、字体和品牌资源，没有更换图标体系。

### 2. 帖子关联商品和求购

- 帖子新增可选的商品、求购关联字段和数据库外键。
- 发帖页可以选择关联对象，也支持从商品或求购详情页带参数发起讨论。
- 帖子列表和详情会展示关联摘要；创建、编辑和查询接口均返回一致结构。
- 只允许关联公开可见的商品或求购，避免通过关联关系泄露已删除或非公开内容。

### 3. 学习中心

- 新增 `/learning` 学习中心，聚合学习好物、学习交流、免费原创和官方资源。
- 学习好物复用市集实体商品，不建立第二套商品系统。
- 学习交流复用广场“求助与问答”帖子。
- 旧 `/market/learning-materials` 系列地址保留为兼容重定向，新入口统一为 `/learning/free`。

### 4. 免费原创内容

- 原数字资料能力改为“免费原创”，发布价格固定为 0 元。
- 发布必须确认原创/授权类型、原创说明和权利确认。
- 详情、资料库和问题反馈页已移除付费、订单和售后导向文案。
- 现有领取记录、文件权限和问题反馈后台结构继续复用，用于访问审计和版本定位；未删除历史记录。
- 普通市集仍排除该系统分类，管理员不能把它恢复为付费数字商品。

### 5. 官方学习资源

- 服务卡片新增并启用西浦图书馆、Learning Mall Core、XJTLU Knowledge Base。
- 官方入口继续使用现有服务卡片接口和组件，不另造资源目录。
- 已核对官方入口地址，页面统一标明来源和跳转性质。

### 6. 内容审核规则

- 原市集安全规则扩展 `scope`，支持 `market`、`forum`、`learning`、`all`。
- 广场发帖和编辑、免费原创发布和编辑均接入统一规则服务。
- 代写、代做等全局内容直接拦截；作业答案、考试原题、教师课件、盗版电子书等学习内容按规则拦截；网盘资料包进入人工复核。
- 管理后台“禁售规则”扩展为“内容规则”，可按作用范围新增、编辑、启停和删除。

## 修改和新增文件

主要修改：

- `server/prisma/schema.prisma`
- `server/src/routes/topic.ts`
- `server/src/routes/market.ts`
- `server/src/routes/learningMaterials.ts`
- `server/src/services/defaultBoardCatalog.ts`
- `server/src/services/marketTrust.ts`
- `server/src/services/learningMaterials.ts`
- `server/src/services/serviceCards.ts`
- `web/src/router/index.ts`
- `web/src/views/forum/Index.vue`
- `web/src/views/forum/Post.vue`
- `web/src/views/forum/Topic.vue`
- `web/src/components/forum/TopicListItem.vue`
- `web/src/views/market/Detail.vue`
- `web/src/views/market/WantedDetail.vue`
- `web/src/views/market/LearningMaterials.vue`
- `web/src/views/market/LearningMaterialPublish.vue`
- `web/src/views/market/LearningMaterialDetail.vue`
- `web/src/views/market/LearningMaterialLibrary.vue`
- `web/src/views/market/LearningMaterialSupport.vue`
- `web/src/views/admin/MarketPane.vue`
- 对应前端 API 类型、首页入口、测试脚本和既有回归断言。

新增：

- `web/src/views/learning/Hub.vue`
- `server/prisma/migrations/20260718040000_stage_4_square_learning/migration.sql`
- `server/prisma/migrations/20260718041000_stage_4_learning_category/migration.sql`
- `server/tests/phase4SquareLearning.test.ts`
- `server/tests/phase4SquareLearning.integration.test.ts`

## 数据库变化

- `Topic` 新增 `linkedMarketItemId`、`linkedWantedPostId`、索引和外键。
- `MarketSafetyRule` 新增 `scope` 和组合索引。
- 迁移将四个公开栏目确定为 `square`，历史板块转为非公开目录归属但不删数据。
- 新增学习内容规则、三张官方服务卡片，并启用系统“免费原创”分类。
- 当前数据库共 85 张表、9 段活动迁移。
- 空 Schema 从零执行 9 段迁移成功，迁移状态为最新。

## 隐藏或兼容的旧功能

- 历史论坛板块退出广场主目录，原数据和直达路由保留。
- 旧学习资料路由转向新的学习中心路径。
- 付费学习资料的用户界面和发布能力关闭；历史订单、领取、文件和反馈模型保留只读兼容及免费领取审计用途。
- 普通市集不展示系统“免费原创”分类。

## 自动化与实例测试

- 阶段 4 专项单元测试：4/4 通过。
- 阶段 4 真实 HTTP/数据库闭环：1/1 通过。
- 服务端单元与产品回归：63/63 通过。
- 服务端真实集成测试：6/6 通过。
- 服务端 TypeScript 构建：通过。
- 前端 `vue-tsc` 与 Vite 生产构建：通过，2898 个模块完成转换。
- Prisma Schema 校验、迁移部署、迁移状态检查：通过。
- 空库迁移基线演练：85 张表、9 段迁移，全部通过并已清理临时 Schema。
- 生产预览 `/`、`/market`、`/square`、`/learning`、`/learning/free`、旧 `/market/learning-materials`：均返回 HTTP 200 和应用壳。
- 后端 `/api/health`、`/api/boards`、`/api/services`：均返回 HTTP 200。
- 当前开发实例前端 5173、5174 正常；后端 3011 健康检查正常，未终止用户已有进程。
- 阶段 4 测试残留：帖子 0、商品 0、求购 0。
- `git diff --check`：通过，仅有仓库既有 LF/CRLF 提示，无空白错误。

## 登录与后端兼容

- 本阶段未修改登录视图、凭据加密、认证 Store、JWXT Store 或主入口登录初始化。
- 校园身份继续复用现有 XJTLU SSO 结果。
- 商品、求购、论坛、服务卡片、资料文件和领取记录均在现有处理方式上增量扩展。
- 商品款仍由买卖双方线下直接结算，平台不代收；免费原创仍为 0 元。

## 尚存说明

- 内部路由名称和部分后端模型仍保留 `market-learning-materials`、order 等历史命名，这是为旧链接和旧数据兼容而有意保留，不影响用户看到的“免费原创”定位。
- 本阶段未发现阻止进入阶段 5 的缺陷。

## 站点构建技能的影响

遵循站点构建技能，本阶段保留现有 Vue/Express/Prisma 架构、靠浦品牌资产和组件风格；验证使用类型检查、生产构建、真实接口闭环和 HTTP 生产预览，没有引入另一套站点框架。
