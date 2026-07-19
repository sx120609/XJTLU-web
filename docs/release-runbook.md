# 灰度发布、回滚与数据核对手册

## 发布前

1. 记录负责人、版本号、计划开始/结束时间和上一稳定版本。
2. 执行 `npm run verify:release`，必须全部通过。
3. 生成 custom-format PostgreSQL 备份并完成 `pg_restore --list` 验证。
4. 在后台关闭“推广与合作商户展示”，保留交易、求购、学习中心和登录可用。
5. 记录迁移前核心表数量、推广订单状态分布、确认金额和售后调整金额。

## 灰度顺序

1. 部署应用和 13 段活动迁移，保持商业展示关闭。
2. 管理员验证登录、健康面板、首页、市集、求购、学习中心、发布和一条人工推广核验流程。
3. 核对接口 P95、缓存命中率、任务最近成功时间和数据库延迟，无持续 5xx 后再开启商业展示。
4. 开启后观察待确认订单、库存冲突、投诉率、净贡献和商户咨询转化；异常时只关闭商业展示，不扩大故障面。

## 数据核对

```sql
SELECT "status", COUNT(*), COALESCE(SUM("amountCents"), 0)
FROM "PromotionOrder" GROUP BY "status" ORDER BY "status";

SELECT "type", COUNT(*), COALESCE(SUM("amountCents"), 0)
FROM "PromotionAdjustment" GROUP BY "type" ORDER BY "type";

SELECT COUNT(*) AS "orphanAdjustments"
FROM "PromotionAdjustment" a LEFT JOIN "PromotionOrder" o ON o."id" = a."orderId"
WHERE o."id" IS NULL;

SELECT COUNT(*) AS "approvedWithoutReviewDue"
FROM "MerchantProfile" WHERE "status" = 'approved' AND "reviewDueAt" IS NULL;

SELECT COUNT(*) AS "studentOrdersWithPlatformFee"
FROM "MarketOrder" WHERE "deliveryType" = 'physical' AND "platformFeeCents" <> 0;
```

孤立售后记录、缺失复核日期和学生实体订单平台费均应为 `0`。

## 回滚

应用异常但数据库完整：先关闭商业展示，回滚应用到上一稳定版本，重新构建并验证核心主线。新增表和可空字段保持不动，旧代码可以忽略。

必须回滚数据库：停止写入，保留故障后快照，把发布前备份恢复到新的空数据库，核对表数、核心记录数和 `_prisma_migrations` 后切换连接。禁止 `migrate reset`、`db push`、删除迁移文件或直接覆盖故障库。

## 版本复盘模板

- 版本与时间：
- 发布负责人 / 验收人：
- 用户影响与持续时间：
- 推广毛额 / 净贡献 / 人工核验耗时：
- 投诉率 / CTR / 商户咨询转化：
- P95 / 缓存命中率 / 5xx：
- 触发的回滚或商业开关：
- 根因与证据：
- 后续动作、负责人和截止时间：
