-- 商品和帖子是两个独立领域：出售商品/学习资料不再自动占用论坛 Topic。
-- 旧 Topic 不删除，保留历史回复和审计信息；将其归档并改为普通的商品关联记录。
UPDATE "Topic" AS topic
SET "linkedMarketItemId" = COALESCE(topic."linkedMarketItemId", item."id"),
    "hidden" = TRUE,
    "locked" = TRUE,
    "manualReviewNote" = CASE
      WHEN COALESCE(topic."manualReviewNote", '') = '' THEN '历史商品自动主题已归档；商品与广场帖子现已解耦'
      ELSE topic."manualReviewNote"
    END
FROM "MarketItem" AS item
WHERE item."topicId" = topic."id";

UPDATE "MarketItem"
SET "topicId" = NULL
WHERE "topicId" IS NOT NULL;

-- 自动商品主题曾计入论坛统计，按当前可见 Topic 重新校准。
UPDATE "Board" AS board
SET "topicCount" = (
  SELECT COUNT(*)::INTEGER
  FROM "Topic" AS topic
  WHERE topic."boardId" = board."id"
    AND topic."hidden" = FALSE
);

UPDATE "User" AS account
SET "postCount" = (
  SELECT COUNT(*)::INTEGER
  FROM "Topic" AS topic
  WHERE topic."authorId" = account."id"
    AND topic."hidden" = FALSE
);
