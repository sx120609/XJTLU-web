-- Every discussion channel now uses the same existing anonymous-posting policy.
-- The market board itself remains identity-bound; structured wanted demands store
-- their anonymous presentation separately and still retain authorId for audits.
UPDATE "Board"
SET "anonymousEnabled" = true
WHERE "slug" IN (
  'general', 'wanted-demand', 'freshman', 'question',
  'study', 'ielts', 'study-abroad', 'coursereview',
  'life', 'clubs', 'treehole', 'friends',
  'lost-found', 'trade-talk', 'reviews'
);

UPDATE "Board"
SET "color" = '#ea580c'
WHERE "slug" = 'wanted-demand';

ALTER TABLE "WantedPost"
ADD COLUMN "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "anonymousAlias" TEXT;
