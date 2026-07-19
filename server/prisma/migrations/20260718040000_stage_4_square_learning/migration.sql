ALTER TABLE "Topic"
  ADD COLUMN "linkedMarketItemId" INTEGER,
  ADD COLUMN "linkedWantedPostId" INTEGER;

CREATE INDEX "Topic_linkedMarketItemId_createdAt_idx" ON "Topic"("linkedMarketItemId", "createdAt");
CREATE INDEX "Topic_linkedWantedPostId_createdAt_idx" ON "Topic"("linkedWantedPostId", "createdAt");

ALTER TABLE "Topic"
  ADD CONSTRAINT "Topic_linkedMarketItemId_fkey" FOREIGN KEY ("linkedMarketItemId") REFERENCES "MarketItem"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Topic_linkedWantedPostId_fkey" FOREIGN KEY ("linkedWantedPostId") REFERENCES "WantedPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MarketSafetyRule"
  ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'market';

DROP INDEX "MarketSafetyRule_enabled_action_category_idx";
CREATE INDEX "MarketSafetyRule_enabled_scope_action_category_idx" ON "MarketSafetyRule"("enabled", "scope", "action", "category");

-- 广场只公开四个栏目；旧板块及其帖子继续保留，可通过历史链接访问。
UPDATE "Board"
SET "section" = NULL
WHERE "section" IN ('general', 'study', 'social')
  AND "slug" NOT IN ('question', 'life');

UPDATE "Board"
SET "name" = '求助与问答',
    "description" = '课程、校园办事与日常问题互助，鼓励补充背景并反馈解决结果',
    "icon" = '❓',
    "color" = '#3b82f6',
    "order" = 10,
    "type" = 'question',
    "section" = 'square'
WHERE "slug" = 'question';

UPDATE "Board"
SET "name" = '校园生活',
    "description" = '食堂、校车、宿舍、活动与校园周边生活交流',
    "icon" = '🍜',
    "color" = '#f59e0b',
    "order" = 40,
    "type" = 'normal',
    "section" = 'square'
WHERE "slug" = 'life';

INSERT INTO "Board" ("slug", "name", "description", "icon", "color", "order", "section", "type", "readOnly", "anonymousEnabled") VALUES
  ('trade-talk', '交易咨询与估价', '购买前咨询、物品估价、验货建议与交易流程讨论', '💬', '#168776', 20, 'square', 'normal', false, false),
  ('reviews', '评价与避坑', '分享真实交易体验、商品评价与校园消费避坑信息', '🛡️', '#8b5cf6', 30, 'square', 'normal', false, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "icon" = EXCLUDED."icon",
  "color" = EXCLUDED."color",
  "order" = EXCLUDED."order",
  "section" = EXCLUDED."section",
  "type" = EXCLUDED."type",
  "readOnly" = EXCLUDED."readOnly",
  "anonymousEnabled" = EXCLUDED."anonymousEnabled";

UPDATE "MarketSafetyRule" SET "scope" = 'all' WHERE "keyword" IN ('代考', '替考');

INSERT INTO "MarketSafetyRule" ("keyword", "scope", "category", "action", "note", "updatedAt") VALUES
  ('代写', 'all', 'academic_integrity', 'block', '禁止代写论文、作业或实验报告', CURRENT_TIMESTAMP),
  ('代做', 'all', 'academic_integrity', 'block', '禁止代做作业、项目或实验', CURRENT_TIMESTAMP),
  ('作业答案', 'learning', 'academic_integrity', 'block', '禁止上传或传播可直接提交的作业答案', CURRENT_TIMESTAMP),
  ('往届作业', 'learning', 'academic_integrity', 'block', '禁止重新上传往届学生作业', CURRENT_TIMESTAMP),
  ('实验报告答案', 'learning', 'academic_integrity', 'block', '禁止上传可直接提交的实验报告答案', CURRENT_TIMESTAMP),
  ('考试原题', 'learning', 'exam_security', 'block', '禁止个人重新上传考试原题', CURRENT_TIMESTAMP),
  ('试卷答案', 'learning', 'exam_security', 'block', '禁止上传试卷答案或当前考试内容', CURRENT_TIMESTAMP),
  ('教师课件', 'learning', 'copyright', 'block', '禁止未经授权重新上传教师课件', CURRENT_TIMESTAMP),
  ('PPT原文件', 'learning', 'copyright', 'block', '禁止未经授权重新上传课堂演示原文件', CURRENT_TIMESTAMP),
  ('教材PDF', 'learning', 'copyright', 'block', '禁止上传教材扫描件或电子版', CURRENT_TIMESTAMP),
  ('盗版电子书', 'learning', 'copyright', 'block', '禁止上传盗版电子书', CURRENT_TIMESTAMP),
  ('课堂录音', 'learning', 'privacy', 'block', '禁止未经授权上传课堂录音', CURRENT_TIMESTAMP),
  ('课程录屏', 'learning', 'privacy', 'block', '禁止未经授权上传课程录屏', CURRENT_TIMESTAMP),
  ('网盘资料包', 'learning', 'copyright', 'review', '网盘打包资料需要人工复核来源和授权', CURRENT_TIMESTAMP)
ON CONFLICT ("keyword") DO UPDATE SET
  "scope" = EXCLUDED."scope",
  "category" = EXCLUDED."category",
  "action" = EXCLUDED."action",
  "note" = EXCLUDED."note",
  "enabled" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

-- 官方学习资源使用独立 code 幂等写入，不覆盖用户或管理员维护的其他服务卡片。
INSERT INTO "ServiceCard" ("code", "name", "category", "owner", "icon", "description", "url", "materials", "duration", "contact", "needSso", "order", "hidden") VALUES
  ('XJTLU_LIBRARY', '西浦图书馆', '学习', '西交利物浦大学图书馆', '📚', '检索馆藏、电子资源、数据库、学习空间与研究支持', 'https://lib.xjtlu.edu.cn/', '部分资源需学校统一身份认证', '即时', 'Library-Service@xjtlu.edu.cn', false, 10, false),
  ('XJTLU_LM_CORE', 'Learning Mall Core', '学习', '西交利物浦大学学习超市', '🎓', '校内在线教学平台，访问课程模块、学习活动与教学资源', 'https://core.xjtlu.edu.cn/', '学校统一身份认证账号', '即时', 'learningmall@xjtlu.edu.cn', true, 20, false),
  ('XJTLU_KNOWLEDGE_BASE', 'XJTLU Knowledge Base', '学习', '西交利物浦大学', '🧭', '查询学校系统与学习平台的官方使用指南和帮助文档', 'https://knowledgebase.xjtlu.edu.cn/', '无需材料', '即时', '', false, 30, false)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "category" = EXCLUDED."category",
  "owner" = EXCLUDED."owner",
  "icon" = EXCLUDED."icon",
  "description" = EXCLUDED."description",
  "url" = EXCLUDED."url",
  "materials" = EXCLUDED."materials",
  "duration" = EXCLUDED."duration",
  "contact" = EXCLUDED."contact",
  "needSso" = EXCLUDED."needSso",
  "order" = EXCLUDED."order",
  "hidden" = EXCLUDED."hidden";
