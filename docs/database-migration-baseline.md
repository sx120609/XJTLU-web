# PostgreSQL 迁移基线与回滚手册

## 目标

阶段 0 审计发现仓库有 63 段历史迁移，而现有数据库的 `_prisma_migrations` 只登记了 2 段。旧迁移已原样归档到 `server/prisma/legacy-migrations`，不再自动执行。

新的活动迁移链以 `server/prisma/migrations` 中的目录为准。最初建立基线时包含以下 13 段：

1. 两段与现有数据库记录同名的兼容标记；
2. `20260718000000_baseline`：完整 PostgreSQL 空库基线；
3. `20260718010000_stage_0_5_market_safety`：佣金归零、数字商品分类冻结和“市集”术语更新；
4. `20260718020000_stage_2_trade_core`：购买意向、求购和预订交易核心；
5. `20260718021000_stage_2_moderation_fields`：阶段 2 审核兼容字段；
6. `20260718030000_stage_3_market_trust`：联系隐私、举报、处罚、申诉和信用；
7. `20260718040000_stage_4_square_learning`：广场四栏、内容关联、规则范围和官方资源；
8. `20260718041000_stage_4_learning_category`：免费原创分类兼容；
9. `20260718050000_stage_5_promotions`：推广方案/订单/事件和合作商户。
10. `20260719010000_stage_8_matching_fulfillment`：供需偏好、可解释匹配通知和约见提醒；
11. `20260719020000_stage_9_operations_manual_revenue`：运营漏斗与盈利订单人工核验字段；
12. `20260719030000_stage_10_sustainable_operations`：推广库存、人工售后留痕、商户周期复核、效果快照与运营索引。

第一项包含 2 段兼容迁移，因此初始活动目录合计为 13 段；此后新增迁移继续按目录名顺序应用，不应依赖文档中的固定总数。

## 空数据库演练

在一套全新的 PostgreSQL 数据库中设置 `DATABASE_URL`，然后执行：

```bash
cd server
npx prisma migrate deploy
npx prisma validate
```

验收要求：迁移全部成功，`npx prisma migrate status` 显示数据库与活动迁移一致，并运行 `npm run db:verify:baseline` 验证空库重放结果与当前 Prisma Schema 一致。需要开发数据时再单独执行 `npm run db:seed`，不要在生产环境运行 seed。

## 接管已有数据库

必须在维护窗口操作，并先完成可恢复备份。示例命令中的连接串和文件名应由部署环境提供，不得写入仓库：

```bash
pg_dump --format=custom --file=pre-baseline.dump "$DATABASE_URL"
```

备份完成并验证文件可读取后，在 `server` 目录执行：

```bash
npx prisma validate
npx prisma migrate status
npx prisma migrate resolve --applied 20260718000000_baseline
npx prisma migrate deploy
npx prisma migrate status
```

说明：`resolve --applied` 只用于已经拥有当前完整 Schema 的数据库。它不会创建表，只告诉 Prisma 这份基线已由既有结构满足。两段兼容标记在已审计数据库中已经登记，无需重复处理。如果目标数据库的迁移记录与审计结果不同，应停止操作并先比对 `_prisma_migrations`，不能猜测执行。

## 阶段 0—10 数据检查

部署后需要确认：

```sql
SELECT "commissionBps", "learningMaterialCommissionBps" FROM "MarketConfig" WHERE "id" = 1;
SELECT "slug", "enabled", "fulfillmentType" FROM "MarketCategory" WHERE "slug" = 'digital_goods';
SELECT "slug", "name" FROM "Board" WHERE "slug" = 'market';
SELECT "code", "priceCents", "manualCostCents", "durationDays", "maxActive", "enabled" FROM "PromotionPlan" ORDER BY "sort";
SELECT "status", COUNT(*) FROM "PromotionOrder" GROUP BY "status" ORDER BY "status";
SELECT "type", COUNT(*), SUM("amountCents") FROM "PromotionAdjustment" GROUP BY "type" ORDER BY "type";
SELECT COUNT(*) FROM "MerchantProfile" WHERE "status" = 'approved' AND "reviewDueAt" IS NULL;
SELECT COUNT(*) FROM "MarketItem" WHERE "priceCents" > 0 AND "id" IN (SELECT "itemId" FROM "LearningMaterialProfile");
```

预期结果分别为佣金 `0/0`、数字商品分类停用、板块名称“市集”、4 条可配置推广方案、付费原创内容 `0` 条；新通过复核的商户必须有复核日期。`PromotionAdjustment` 仅记录管理员已在线下完成的退款、补偿、票据或投诉处理，不会自动划款。历史订单、支付、退款、结算、资料访问和文件记录不会被删除。

## 回滚

Prisma 迁移不自动生成向下迁移。发生异常时：

1. 立即停止应用写入；
2. 保存故障后的数据库快照和应用日志；
3. 使用部署前的 custom-format 备份恢复到一套新数据库；
4. 校验表数量、核心记录数量和 `_prisma_migrations` 后再切换连接；
5. 回滚应用版本。

不要通过重新启用数字商品分类或恢复学生商品平台支付来“回滚”安全边界。若只是展示文案或页面故障，应回滚应用代码，保留佣金归零和数字品类冻结。

## 本地实例执行记录

阶段 0.5 在应用现有实例迁移前，已使用本地 PostgreSQL 16.14 的 `pg_dump` 创建 `runtime/backups/pre-stage-0-5-20260718.dump`，并通过 `pg_restore --list` 校验到 819 个目录项。备份位于被忽略的运行时目录，不提交到 Git。

随后已执行基线标记、`prisma migrate deploy`、`prisma migrate status` 和 `prisma validate`。当前迁移数量、空库表数量和 Schema 一致性由 `npm run db:verify:baseline` 动态校验，不再维护容易过期的固定数字。其他部署环境仍必须独立备份，不能复用本机执行结果。
