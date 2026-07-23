-- 市集草稿曾错误创建为公开 Topic，导致草稿出现在首页热议、论坛聚合与搜索中。
-- 保留草稿及其关联问答记录，但将所有尚未发布的商品 Topic 修复为私有隐藏状态。
UPDATE "Topic" AS topic
SET "hidden" = TRUE
FROM "MarketItem" AS item
WHERE item."topicId" = topic."id"
  AND item."status" = 'draft'
  AND topic."hidden" = FALSE;
