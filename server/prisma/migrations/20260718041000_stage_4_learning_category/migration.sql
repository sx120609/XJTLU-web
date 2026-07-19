INSERT INTO "MarketCategory" (
  "slug", "name", "icon", "description", "fulfillmentType", "imageRequired", "enabled", "sort", "updatedAt"
) VALUES (
  'digital_goods',
  '免费原创',
  '📁',
  '同学原创、已获授权或基于公开资料整理的免费学习内容',
  'digital',
  false,
  true,
  30,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "icon" = EXCLUDED."icon",
  "description" = EXCLUDED."description",
  "fulfillmentType" = EXCLUDED."fulfillmentType",
  "imageRequired" = EXCLUDED."imageRequired",
  "enabled" = EXCLUDED."enabled",
  "sort" = EXCLUDED."sort",
  "updatedAt" = CURRENT_TIMESTAMP;
