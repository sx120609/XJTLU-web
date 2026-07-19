-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "email" TEXT,
    "avatar" TEXT,
    "bio" TEXT,
    "college" TEXT,
    "enrollYear" INTEGER,
    "role" TEXT NOT NULL DEFAULT 'user',
    "studentSso" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "mutedUntil" TIMESTAMP(3),
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginClient" TEXT,
    "usedIosClient" BOOLEAN NOT NULL DEFAULT false,
    "usedAndroidClient" BOOLEAN NOT NULL DEFAULT false,
    "usedHarmonyClient" BOOLEAN NOT NULL DEFAULT false,
    "topicSubmissionLocked" BOOLEAN NOT NULL DEFAULT false,
    "aiReviewWhitelisted" BOOLEAN NOT NULL DEFAULT false,
    "dataAuthAgreedAt" TIMESTAMP(3),
    "forumEnabled" BOOLEAN NOT NULL DEFAULT false,
    "forumEnabledAt" TIMESTAMP(3),
    "anonymousCredits" INTEGER NOT NULL DEFAULT 0,
    "anonymousWeekKey" TEXT,
    "anonymousCreditsFrozen" BOOLEAN NOT NULL DEFAULT false,
    "sponsorTotalCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "section" TEXT,
    "type" TEXT NOT NULL DEFAULT 'normal',
    "readOnly" BOOLEAN NOT NULL DEFAULT false,
    "anonymousEnabled" BOOLEAN NOT NULL DEFAULT false,
    "topicCount" INTEGER NOT NULL DEFAULT 0,
    "feedSourceId" INTEGER,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" SERIAL NOT NULL,
    "boardId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "aiReviewStatus" TEXT NOT NULL DEFAULT 'none',
    "aiRiskLevel" TEXT,
    "aiRiskScore" INTEGER,
    "aiReviewReason" TEXT,
    "aiReviewDetail" TEXT,
    "aiModel" TEXT,
    "aiReviewedAt" TIMESTAMP(3),
    "manualReviewedById" INTEGER,
    "manualReviewedAt" TIMESTAMP(3),
    "manualReviewNote" TEXT,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "anonymousAlias" TEXT,
    "editCount" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "lastReplyAt" TIMESTAMP(3),
    "lastReplyById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reply" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "aiReviewStatus" TEXT NOT NULL DEFAULT 'none',
    "aiRiskLevel" TEXT,
    "aiRiskScore" INTEGER,
    "aiReviewReason" TEXT,
    "aiReviewDetail" TEXT,
    "aiModel" TEXT,
    "aiReviewedAt" TIMESTAMP(3),
    "parentReplyId" INTEGER,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "anonymousAlias" TEXT,
    "floor" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Like" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "topicId" INTEGER,
    "replyId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Like_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumImageAsset" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "detail" TEXT,
    "reviewModel" TEXT,
    "reviewEndpoint" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdById" INTEGER,
    "manualReviewedById" INTEGER,
    "manualReviewedAt" TIMESTAMP(3),
    "manualReviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForumImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumVideoAsset" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "hasAudio" BOOLEAN NOT NULL DEFAULT false,
    "transcript" TEXT,
    "transcriptStatus" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "detail" TEXT,
    "reviewModel" TEXT,
    "reviewEndpoint" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdById" INTEGER,
    "manualReviewedById" INTEGER,
    "manualReviewedAt" TIMESTAMP(3),
    "manualReviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForumVideoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiReviewLog" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" INTEGER,
    "targetLabel" TEXT,
    "targetUrl" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "endpoint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'started',
    "requestSummary" TEXT NOT NULL DEFAULT '',
    "responseSummary" TEXT NOT NULL DEFAULT '',
    "errorMessage" TEXT,
    "createdById" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicTag" (
    "topicId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    CONSTRAINT "TopicTag_pkey" PRIMARY KEY ("topicId","tagId")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teacher" TEXT NOT NULL,
    "credits" DOUBLE PRECISION,
    "category" TEXT,
    "college" TEXT,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "avgDifficulty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgReward" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgRecommend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgScore" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "college" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseTeacher" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user-add',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseTeacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCourse" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "semester" TEXT,
    "score" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserScheduleEdit" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "semester" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserScheduleEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleWidgetToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenSuffix" TEXT NOT NULL,
    "jwxtToken" TEXT NOT NULL,
    "cachedPayload" TEXT,
    "cachedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleWidgetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseRating" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "courseTeacherId" INTEGER,
    "authorId" INTEGER NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "reward" INTEGER NOT NULL,
    "recommend" INTEGER NOT NULL,
    "givingScore" INTEGER NOT NULL,
    "semester" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolFeedSource" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "homepage" TEXT NOT NULL,
    "listUrl" TEXT NOT NULL,
    "pageSize" INTEGER NOT NULL DEFAULT 14,
    "maxPages" INTEGER NOT NULL DEFAULT 2,
    "parser" TEXT NOT NULL DEFAULT 'school-cms-v1',
    "cronMinutes" INTEGER NOT NULL DEFAULT 15,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "botUserId" INTEGER NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastRunOk" BOOLEAN,
    "lastError" TEXT,

    CONSTRAINT "SchoolFeedSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolFeedItem" (
    "id" SERIAL NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "topicId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolFeedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XjtluAnnouncement" (
    "id" SERIAL NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishedAtText" TEXT NOT NULL DEFAULT '',
    "author" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '通知',
    "url" TEXT NOT NULL,
    "sourceOrder" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XjtluAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XjtluAnnouncementSyncConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sourceUserId" INTEGER,
    "sourceUsername" TEXT NOT NULL DEFAULT '',
    "encryptedSession" TEXT NOT NULL DEFAULT '',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "lastRunAt" TIMESTAMP(3),
    "lastRunOk" BOOLEAN,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XjtluAnnouncementSyncConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeiwallSyncConfig" (
    "id" SERIAL NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://s.weiwall.com',
    "schoolEn" TEXT NOT NULL DEFAULT 'cpu',
    "tenantId" INTEGER NOT NULL DEFAULT 7,
    "token" TEXT NOT NULL DEFAULT '',
    "intervalSeconds" INTEGER NOT NULL DEFAULT 120,
    "topicPages" INTEGER NOT NULL DEFAULT 3,
    "commentPageSize" INTEGER NOT NULL DEFAULT 20,
    "maxCommentPages" INTEGER NOT NULL DEFAULT 10,
    "maxReplyPages" INTEGER NOT NULL DEFAULT 10,
    "boardId" INTEGER,
    "lastRunAt" TIMESTAMP(3),
    "lastRunOk" BOOLEAN,
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeiwallSyncConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeiwallTopicMap" (
    "id" SERIAL NOT NULL,
    "externalTopicId" TEXT NOT NULL,
    "localTopicId" INTEGER NOT NULL,
    "externalAuthorKey" TEXT,
    "externalAuthorUuid" TEXT,
    "externalAuthorName" TEXT,
    "externalAuthorAvatar" TEXT,
    "externalCreatedAt" TIMESTAMP(3),
    "lastCommentCount" INTEGER NOT NULL DEFAULT 0,
    "lastLikeCount" INTEGER NOT NULL DEFAULT 0,
    "lastStatus" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeiwallTopicMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeiwallReplyMap" (
    "id" SERIAL NOT NULL,
    "externalReplyId" TEXT NOT NULL,
    "localReplyId" INTEGER NOT NULL,
    "externalTopicId" TEXT NOT NULL,
    "externalCommentId" TEXT,
    "parentExternalReplyId" TEXT,
    "externalAuthorUuid" TEXT,
    "externalAuthorName" TEXT,
    "externalAuthorAvatar" TEXT,
    "externalCreatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeiwallReplyMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCard" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "materials" TEXT,
    "duration" TEXT,
    "contact" TEXT,
    "needSso" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolPermission" (
    "id" SERIAL NOT NULL,
    "toolCode" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'manager',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolSetting" (
    "id" SERIAL NOT NULL,
    "toolCode" TEXT NOT NULL,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "requireLogin" BOOLEAN NOT NULL DEFAULT false,
    "allowPublicManage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Questionnaire" (
    "id" SERIAL NOT NULL,
    "toolCode" TEXT NOT NULL DEFAULT 'questionnaire',
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "allowAnonymous" BOOLEAN NOT NULL DEFAULT true,
    "oneResponsePerUser" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "qqBotNotifyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "qqBotNotifyConfig" TEXT NOT NULL DEFAULT '{}',
    "fields" TEXT NOT NULL DEFAULT '[]',
    "createdById" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Questionnaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireResponse" (
    "id" SERIAL NOT NULL,
    "questionnaireId" INTEGER NOT NULL,
    "respondentId" INTEGER,
    "answers" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionnaireResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeCheckTable" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "studentIdColumn" TEXT NOT NULL DEFAULT '学号',
    "columns" TEXT NOT NULL DEFAULT '[]',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "feedbackQuestionnaireSlug" TEXT,
    "qqBotNotifyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "qqBotNotifyConfig" TEXT NOT NULL DEFAULT '{}',
    "createdById" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeCheckTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeCheckRow" (
    "id" SERIAL NOT NULL,
    "tableId" INTEGER NOT NULL,
    "studentId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeCheckRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileCollectTask" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "fields" TEXT NOT NULL DEFAULT '[]',
    "surveyFields" TEXT NOT NULL DEFAULT '[]',
    "fileRules" TEXT NOT NULL DEFAULT '{}',
    "renameTemplate" TEXT NOT NULL DEFAULT '{name}-{student_id}',
    "folderTemplate" TEXT NOT NULL DEFAULT '{name}-{student_id}',
    "expectedEntries" TEXT NOT NULL DEFAULT '',
    "deadline" TIMESTAMP(3),
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "qqBotNotifyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "qqBotNotifyConfig" TEXT NOT NULL DEFAULT '{}',
    "createdById" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileCollectTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileCollectTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "fields" TEXT NOT NULL DEFAULT '[]',
    "surveyFields" TEXT NOT NULL DEFAULT '[]',
    "fileRules" TEXT NOT NULL DEFAULT '{}',
    "renameTemplate" TEXT NOT NULL DEFAULT '{name}-{student_id}',
    "folderTemplate" TEXT NOT NULL DEFAULT '{name}-{student_id}',
    "expectedEntries" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileCollectTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileCollectSubmission" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "submitterId" INTEGER,
    "identity" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL DEFAULT '{}',
    "answers" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileCollectSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileCollectFile" (
    "id" SERIAL NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileCollectFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpayConfig" (
    "id" SERIAL NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "gatewayUrl" TEXT NOT NULL DEFAULT '',
    "pid" TEXT NOT NULL DEFAULT '',
    "merchantKey" TEXT NOT NULL DEFAULT '',
    "signType" TEXT NOT NULL DEFAULT 'MD5',
    "defaultType" TEXT NOT NULL DEFAULT 'alipay',
    "enabledTypes" TEXT NOT NULL DEFAULT '["alipay","wxpay"]',
    "notifyUrl" TEXT NOT NULL DEFAULT '',
    "returnUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EpayConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorOrder" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "outTradeNo" TEXT NOT NULL,
    "tradeNo" TEXT,
    "payType" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "displayMode" TEXT NOT NULL DEFAULT 'public',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SponsorOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorPaymentLog" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER,
    "outTradeNo" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'epay',
    "event" TEXT NOT NULL DEFAULT 'notify',
    "rawPayload" TEXT NOT NULL DEFAULT '{}',
    "signOk" BOOLEAN NOT NULL DEFAULT false,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SponsorPaymentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketItem" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER,
    "sellerId" INTEGER NOT NULL,
    "listingType" TEXT NOT NULL DEFAULT 'sell',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "deliveryType" TEXT NOT NULL DEFAULT 'physical',
    "digitalDeliveryEncrypted" TEXT,
    "priceCents" INTEGER NOT NULL,
    "originalPriceCents" INTEGER,
    "negotiable" BOOLEAN NOT NULL DEFAULT false,
    "condition" TEXT NOT NULL DEFAULT 'good',
    "tradeMode" TEXT NOT NULL DEFAULT 'meetup',
    "campus" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "favoriteCount" INTEGER NOT NULL DEFAULT 0,
    "offerCount" INTEGER NOT NULL DEFAULT 0,
    "soldAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketImage" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketFavorite" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketOffer" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "buyerId" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketOrder" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "offerId" INTEGER NOT NULL,
    "buyerId" INTEGER NOT NULL,
    "sellerId" INTEGER NOT NULL,
    "outTradeNo" TEXT NOT NULL,
    "tradeNo" TEXT,
    "payType" TEXT NOT NULL DEFAULT '',
    "amountCents" INTEGER NOT NULL,
    "platformFeeCents" INTEGER NOT NULL DEFAULT 0,
    "sellerAmountCents" INTEGER NOT NULL,
    "deliveryType" TEXT NOT NULL DEFAULT 'physical',
    "digitalDeliveryEncrypted" TEXT,
    "digitalDeliveredAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "meetupTime" TIMESTAMP(3),
    "meetupLocation" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "buyerConfirmedAt" TIMESTAMP(3),
    "sellerConfirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketConversation" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "buyerId" INTEGER NOT NULL,
    "sellerId" INTEGER NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketMessage" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "senderId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketReview" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "targetUserId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketReport" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "handledById" INTEGER,
    "handledNote" TEXT NOT NULL DEFAULT '',
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPaymentLog" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER,
    "outTradeNo" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'epay',
    "event" TEXT NOT NULL DEFAULT 'notify',
    "rawPayload" TEXT NOT NULL DEFAULT '{}',
    "signOk" BOOLEAN NOT NULL DEFAULT false,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketPaymentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketRefund" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "providerRefundNo" TEXT,
    "handledById" INTEGER,
    "handledNote" TEXT NOT NULL DEFAULT '',
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSettlement" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "sellerId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "availableAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPayoutProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'alipay',
    "accountEncrypted" TEXT NOT NULL,
    "accountMasked" TEXT NOT NULL,
    "realNameEncrypted" TEXT NOT NULL,
    "realNameMasked" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketPayoutProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "commissionBps" INTEGER NOT NULL DEFAULT 0,
    "learningMaterialCommissionBps" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketCategory" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '📦',
    "description" TEXT NOT NULL DEFAULT '',
    "fulfillmentType" TEXT NOT NULL DEFAULT 'physical',
    "imageRequired" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningMaterialType" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'builtin',
    "status" TEXT NOT NULL DEFAULT 'approved',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER,
    "mergedIntoId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningMaterialType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningMaterialProfile" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "typeId" INTEGER,
    "courseCode" TEXT,
    "college" TEXT,
    "major" TEXT,
    "applicableSemester" TEXT,
    "declaredFormats" TEXT NOT NULL DEFAULT '[]',
    "pageCount" INTEGER,
    "versionLabel" TEXT,
    "language" TEXT,
    "originalityKind" TEXT,
    "originalityStatement" TEXT,
    "rightsConfirmedAt" TIMESTAMP(3),
    "activeVersionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningMaterialProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningMaterialVersion" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "releaseNotes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningMaterialVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningMaterialFile" (
    "id" SERIAL NOT NULL,
    "versionId" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "fileSize" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "pageCount" INTEGER,
    "sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningMaterialFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningMaterialAccess" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "versionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "downloadCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LearningMaterialAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningMaterialSupportTicket" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "buyerId" INTEGER NOT NULL,
    "sellerId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "responseDueAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningMaterialSupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningMaterialSupportMessage" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "senderId" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'user',
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningMaterialSupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "category" TEXT NOT NULL,
    "targetClient" TEXT,
    "level" TEXT NOT NULL DEFAULT 'normal',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "link" TEXT,
    "source" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageSetting" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "quietStart" TEXT NOT NULL DEFAULT '23:00',
    "quietEnd" TEXT NOT NULL DEFAULT '07:00',
    "qqBotNotifyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "subscribeReply" BOOLEAN NOT NULL DEFAULT true,
    "subscribeLike" BOOLEAN NOT NULL DEFAULT true,
    "subscribeSchool" BOOLEAN NOT NULL DEFAULT true,
    "subscribeSystem" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MessageSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QqBotConfig" (
    "id" SERIAL NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "botQqId" TEXT NOT NULL DEFAULT '',
    "napcatBaseUrl" TEXT NOT NULL DEFAULT '',
    "accessToken" TEXT NOT NULL DEFAULT '',
    "webhookSecret" TEXT NOT NULL DEFAULT '',
    "defaultBoardSlug" TEXT NOT NULL DEFAULT 'general',
    "allowPrivatePost" BOOLEAN NOT NULL DEFAULT true,
    "allowGroupPost" BOOLEAN NOT NULL DEFAULT false,
    "notificationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyCategories" TEXT NOT NULL DEFAULT '["reply","mention","like","system","service-tool","school-feed"]',
    "superAdminQqIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QqBotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QqBotBinding" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "qqId" TEXT NOT NULL,
    "nickname" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QqBotBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QqBotBindToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QqBotBindToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QqBotGroup" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowPosting" BOOLEAN NOT NULL DEFAULT false,
    "defaultBoardSlug" TEXT,
    "notificationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyCategories" TEXT NOT NULL DEFAULT '["system","school-feed"]',
    "notifyAudiences" TEXT NOT NULL DEFAULT '["public"]',
    "memberWelcomeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "memberWelcomeMessage" TEXT NOT NULL DEFAULT '欢迎加入本群，请先查看群公告了解群内规则和使用说明。

如果想把课表添加到手机桌面，可以先打开站内课表页，再按页面提示完成添加。

也欢迎前往个人中心绑定本 QQBot，绑定后可在 QQ 同步接收站内通知。建议顺手把本 QQBot 添加为好友，消息接收和后续操作体验会更顺畅。后续还会陆续接入更多实用功能，敬请期待。',
    "adFilterEnabled" BOOLEAN NOT NULL DEFAULT false,
    "joinReviewEnabled" BOOLEAN NOT NULL DEFAULT false,
    "allowMute" BOOLEAN NOT NULL DEFAULT false,
    "allowKick" BOOLEAN NOT NULL DEFAULT false,
    "allowKickAndBlock" BOOLEAN NOT NULL DEFAULT false,
    "commandUserQqIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QqBotGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QqBotGroupJoinRequest" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "qqId" TEXT NOT NULL,
    "nickname" TEXT,
    "comment" TEXT,
    "flag" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "handledAction" TEXT,
    "handledByQqId" TEXT,
    "rawPayload" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "QqBotGroupJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QqBotGroupBlockedUser" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "qqId" TEXT NOT NULL,
    "nickname" TEXT,
    "blockedByQqId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QqBotGroupBlockedUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QqBotGroupAdStrike" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "qqId" TEXT NOT NULL,
    "nickname" TEXT,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastReason" TEXT,
    "lastRiskScore" INTEGER,
    "lastModel" TEXT,
    "lastHitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QqBotGroupAdStrike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QqBotMessageLog" (
    "id" SERIAL NOT NULL,
    "direction" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "qqId" TEXT,
    "groupId" TEXT,
    "messageId" TEXT,
    "userId" INTEGER,
    "topicId" INTEGER,
    "notificationId" INTEGER,
    "command" TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    "result" TEXT NOT NULL DEFAULT '',
    "rawPayload" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QqBotMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QqBotConversation" (
    "id" SERIAL NOT NULL,
    "qqId" TEXT NOT NULL,
    "groupId" TEXT,
    "scene" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "step" TEXT NOT NULL,
    "draftTitle" TEXT,
    "draftContent" TEXT NOT NULL DEFAULT '',
    "draftBoardSlug" TEXT,
    "sourceMessageId" TEXT,
    "sourceSummary" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QqBotConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSetting" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseBotQuota" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "aiBalance" INTEGER NOT NULL DEFAULT 0,
    "totalConsumed" INTEGER NOT NULL DEFAULT 0,
    "totalGranted" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseBotQuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseBotUsageLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "questionHash" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "aiAnswer" TEXT NOT NULL,
    "correct" BOOLEAN,
    "cost" INTEGER NOT NULL DEFAULT 1,
    "model" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'chaoxing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseBotUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminDailyLogin" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "dateKey" TEXT NOT NULL,
    "client" TEXT,
    "firstLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminDailyLogin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Board_slug_key" ON "Board"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Board_feedSourceId_key" ON "Board"("feedSourceId");

-- CreateIndex
CREATE INDEX "Board_order_idx" ON "Board"("order");

-- CreateIndex
CREATE INDEX "Board_section_order_idx" ON "Board"("section", "order");

-- CreateIndex
CREATE INDEX "Board_type_order_idx" ON "Board"("type", "order");

-- CreateIndex
CREATE INDEX "Topic_boardId_lastReplyAt_idx" ON "Topic"("boardId", "lastReplyAt");

-- CreateIndex
CREATE INDEX "Topic_boardId_hidden_createdAt_idx" ON "Topic"("boardId", "hidden", "createdAt");

-- CreateIndex
CREATE INDEX "Topic_hidden_createdAt_idx" ON "Topic"("hidden", "createdAt");

-- CreateIndex
CREATE INDEX "Topic_hidden_lastReplyAt_idx" ON "Topic"("hidden", "lastReplyAt");

-- CreateIndex
CREATE INDEX "Topic_authorId_idx" ON "Topic"("authorId");

-- CreateIndex
CREATE INDEX "Topic_authorId_aiReviewStatus_idx" ON "Topic"("authorId", "aiReviewStatus");

-- CreateIndex
CREATE INDEX "Reply_topicId_floor_idx" ON "Reply"("topicId", "floor");

-- CreateIndex
CREATE INDEX "Reply_topicId_hidden_floor_idx" ON "Reply"("topicId", "hidden", "floor");

-- CreateIndex
CREATE UNIQUE INDEX "Like_userId_topicId_replyId_key" ON "Like"("userId", "topicId", "replyId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumImageAsset_url_key" ON "ForumImageAsset"("url");

-- CreateIndex
CREATE INDEX "ForumImageAsset_status_nextRetryAt_createdAt_idx" ON "ForumImageAsset"("status", "nextRetryAt", "createdAt");

-- CreateIndex
CREATE INDEX "ForumImageAsset_createdById_createdAt_idx" ON "ForumImageAsset"("createdById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ForumVideoAsset_url_key" ON "ForumVideoAsset"("url");

-- CreateIndex
CREATE INDEX "ForumVideoAsset_status_nextRetryAt_createdAt_idx" ON "ForumVideoAsset"("status", "nextRetryAt", "createdAt");

-- CreateIndex
CREATE INDEX "ForumVideoAsset_createdById_createdAt_idx" ON "ForumVideoAsset"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "AiReviewLog_kind_startedAt_idx" ON "AiReviewLog"("kind", "startedAt");

-- CreateIndex
CREATE INDEX "AiReviewLog_status_startedAt_idx" ON "AiReviewLog"("status", "startedAt");

-- CreateIndex
CREATE INDEX "AiReviewLog_targetId_kind_startedAt_idx" ON "AiReviewLog"("targetId", "kind", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Course_code_key" ON "Course"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_name_key" ON "Teacher"("name");

-- CreateIndex
CREATE INDEX "CourseTeacher_courseId_idx" ON "CourseTeacher"("courseId");

-- CreateIndex
CREATE INDEX "CourseTeacher_teacherId_idx" ON "CourseTeacher"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseTeacher_courseId_teacherId_key" ON "CourseTeacher"("courseId", "teacherId");

-- CreateIndex
CREATE INDEX "UserCourse_userId_idx" ON "UserCourse"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCourse_userId_courseId_key" ON "UserCourse"("userId", "courseId");

-- CreateIndex
CREATE INDEX "UserScheduleEdit_userId_updatedAt_idx" ON "UserScheduleEdit"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserScheduleEdit_userId_semester_key" ON "UserScheduleEdit"("userId", "semester");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleWidgetToken_tokenHash_key" ON "ScheduleWidgetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ScheduleWidgetToken_userId_revokedAt_idx" ON "ScheduleWidgetToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "ScheduleWidgetToken_lastUsedAt_idx" ON "ScheduleWidgetToken"("lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourseRating_topicId_key" ON "CourseRating"("topicId");

-- CreateIndex
CREATE INDEX "CourseRating_courseId_idx" ON "CourseRating"("courseId");

-- CreateIndex
CREATE INDEX "CourseRating_courseTeacherId_idx" ON "CourseRating"("courseTeacherId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolFeedSource_slug_key" ON "SchoolFeedSource"("slug");

-- CreateIndex
CREATE INDEX "SchoolFeedSource_enabled_idx" ON "SchoolFeedSource"("enabled");

-- CreateIndex
CREATE INDEX "SchoolFeedItem_sourceId_idx" ON "SchoolFeedItem"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolFeedItem_sourceId_externalId_key" ON "SchoolFeedItem"("sourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "XjtluAnnouncement_externalId_key" ON "XjtluAnnouncement"("externalId");

-- CreateIndex
CREATE INDEX "XjtluAnnouncement_lastSeenAt_sourceOrder_idx" ON "XjtluAnnouncement"("lastSeenAt", "sourceOrder");

-- CreateIndex
CREATE INDEX "WeiwallSyncConfig_enabled_idx" ON "WeiwallSyncConfig"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "WeiwallTopicMap_externalTopicId_key" ON "WeiwallTopicMap"("externalTopicId");

-- CreateIndex
CREATE UNIQUE INDEX "WeiwallTopicMap_localTopicId_key" ON "WeiwallTopicMap"("localTopicId");

-- CreateIndex
CREATE INDEX "WeiwallTopicMap_lastSyncedAt_idx" ON "WeiwallTopicMap"("lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeiwallReplyMap_externalReplyId_key" ON "WeiwallReplyMap"("externalReplyId");

-- CreateIndex
CREATE UNIQUE INDEX "WeiwallReplyMap_localReplyId_key" ON "WeiwallReplyMap"("localReplyId");

-- CreateIndex
CREATE INDEX "WeiwallReplyMap_externalTopicId_externalCreatedAt_idx" ON "WeiwallReplyMap"("externalTopicId", "externalCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCard_code_key" ON "ServiceCard"("code");

-- CreateIndex
CREATE INDEX "ServiceCard_hidden_order_idx" ON "ServiceCard"("hidden", "order");

-- CreateIndex
CREATE INDEX "ToolPermission_toolCode_idx" ON "ToolPermission"("toolCode");

-- CreateIndex
CREATE INDEX "ToolPermission_userId_idx" ON "ToolPermission"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolPermission_toolCode_userId_key" ON "ToolPermission"("toolCode", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolSetting_toolCode_key" ON "ToolSetting"("toolCode");

-- CreateIndex
CREATE INDEX "ToolSetting_isVisible_idx" ON "ToolSetting"("isVisible");

-- CreateIndex
CREATE INDEX "ToolSetting_requireLogin_idx" ON "ToolSetting"("requireLogin");

-- CreateIndex
CREATE INDEX "ToolSetting_allowPublicManage_idx" ON "ToolSetting"("allowPublicManage");

-- CreateIndex
CREATE UNIQUE INDEX "Questionnaire_slug_key" ON "Questionnaire"("slug");

-- CreateIndex
CREATE INDEX "Questionnaire_toolCode_status_idx" ON "Questionnaire"("toolCode", "status");

-- CreateIndex
CREATE INDEX "Questionnaire_createdById_idx" ON "Questionnaire"("createdById");

-- CreateIndex
CREATE INDEX "QuestionnaireResponse_questionnaireId_createdAt_idx" ON "QuestionnaireResponse"("questionnaireId", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionnaireResponse_respondentId_idx" ON "QuestionnaireResponse"("respondentId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeCheckTable_slug_key" ON "GradeCheckTable"("slug");

-- CreateIndex
CREATE INDEX "GradeCheckTable_status_idx" ON "GradeCheckTable"("status");

-- CreateIndex
CREATE INDEX "GradeCheckTable_createdById_idx" ON "GradeCheckTable"("createdById");

-- CreateIndex
CREATE INDEX "GradeCheckRow_studentId_idx" ON "GradeCheckRow"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeCheckRow_tableId_studentId_key" ON "GradeCheckRow"("tableId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "FileCollectTask_slug_key" ON "FileCollectTask"("slug");

-- CreateIndex
CREATE INDEX "FileCollectTask_status_idx" ON "FileCollectTask"("status");

-- CreateIndex
CREATE INDEX "FileCollectTask_createdById_idx" ON "FileCollectTask"("createdById");

-- CreateIndex
CREATE INDEX "FileCollectTemplate_createdById_idx" ON "FileCollectTemplate"("createdById");

-- CreateIndex
CREATE INDEX "FileCollectSubmission_taskId_createdAt_idx" ON "FileCollectSubmission"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "FileCollectSubmission_submitterId_idx" ON "FileCollectSubmission"("submitterId");

-- CreateIndex
CREATE INDEX "FileCollectSubmission_identity_idx" ON "FileCollectSubmission"("identity");

-- CreateIndex
CREATE INDEX "FileCollectSubmission_status_idx" ON "FileCollectSubmission"("status");

-- CreateIndex
CREATE INDEX "FileCollectFile_submissionId_idx" ON "FileCollectFile"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "SponsorOrder_outTradeNo_key" ON "SponsorOrder"("outTradeNo");

-- CreateIndex
CREATE INDEX "SponsorOrder_userId_status_idx" ON "SponsorOrder"("userId", "status");

-- CreateIndex
CREATE INDEX "SponsorOrder_status_createdAt_idx" ON "SponsorOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SponsorOrder_status_expiresAt_idx" ON "SponsorOrder"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "SponsorPaymentLog_outTradeNo_idx" ON "SponsorPaymentLog"("outTradeNo");

-- CreateIndex
CREATE INDEX "SponsorPaymentLog_createdAt_idx" ON "SponsorPaymentLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketItem_topicId_key" ON "MarketItem"("topicId");

-- CreateIndex
CREATE INDEX "MarketItem_status_createdAt_idx" ON "MarketItem"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketItem_category_status_createdAt_idx" ON "MarketItem"("category", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketItem_sellerId_status_updatedAt_idx" ON "MarketItem"("sellerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "MarketItem_listingType_status_createdAt_idx" ON "MarketItem"("listingType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketItem_priceCents_idx" ON "MarketItem"("priceCents");

-- CreateIndex
CREATE INDEX "MarketImage_itemId_sort_idx" ON "MarketImage"("itemId", "sort");

-- CreateIndex
CREATE INDEX "MarketFavorite_userId_createdAt_idx" ON "MarketFavorite"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketFavorite_itemId_userId_key" ON "MarketFavorite"("itemId", "userId");

-- CreateIndex
CREATE INDEX "MarketOffer_itemId_status_createdAt_idx" ON "MarketOffer"("itemId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketOffer_buyerId_status_createdAt_idx" ON "MarketOffer"("buyerId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketOrder_offerId_key" ON "MarketOrder"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketOrder_outTradeNo_key" ON "MarketOrder"("outTradeNo");

-- CreateIndex
CREATE INDEX "MarketOrder_buyerId_status_createdAt_idx" ON "MarketOrder"("buyerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketOrder_sellerId_status_createdAt_idx" ON "MarketOrder"("sellerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketOrder_status_expiresAt_idx" ON "MarketOrder"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "MarketOrder_itemId_createdAt_idx" ON "MarketOrder"("itemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketConversation_orderId_key" ON "MarketConversation"("orderId");

-- CreateIndex
CREATE INDEX "MarketConversation_buyerId_lastMessageAt_idx" ON "MarketConversation"("buyerId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "MarketConversation_sellerId_lastMessageAt_idx" ON "MarketConversation"("sellerId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketConversation_itemId_buyerId_sellerId_key" ON "MarketConversation"("itemId", "buyerId", "sellerId");

-- CreateIndex
CREATE INDEX "MarketMessage_conversationId_createdAt_idx" ON "MarketMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketMessage_senderId_createdAt_idx" ON "MarketMessage"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketReview_targetUserId_createdAt_idx" ON "MarketReview"("targetUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketReview_orderId_authorId_key" ON "MarketReview"("orderId", "authorId");

-- CreateIndex
CREATE INDEX "MarketReport_status_createdAt_idx" ON "MarketReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketReport_itemId_reporterId_key" ON "MarketReport"("itemId", "reporterId");

-- CreateIndex
CREATE INDEX "MarketPaymentLog_outTradeNo_idx" ON "MarketPaymentLog"("outTradeNo");

-- CreateIndex
CREATE INDEX "MarketPaymentLog_createdAt_idx" ON "MarketPaymentLog"("createdAt");

-- CreateIndex
CREATE INDEX "MarketRefund_orderId_status_idx" ON "MarketRefund"("orderId", "status");

-- CreateIndex
CREATE INDEX "MarketRefund_status_createdAt_idx" ON "MarketRefund"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSettlement_orderId_key" ON "MarketSettlement"("orderId");

-- CreateIndex
CREATE INDEX "MarketSettlement_sellerId_status_createdAt_idx" ON "MarketSettlement"("sellerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketSettlement_status_availableAt_idx" ON "MarketSettlement"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketPayoutProfile_userId_key" ON "MarketPayoutProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketCategory_slug_key" ON "MarketCategory"("slug");

-- CreateIndex
CREATE INDEX "MarketCategory_enabled_sort_idx" ON "MarketCategory"("enabled", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "LearningMaterialType_normalizedName_key" ON "LearningMaterialType"("normalizedName");

-- CreateIndex
CREATE INDEX "LearningMaterialType_status_enabled_sort_idx" ON "LearningMaterialType"("status", "enabled", "sort");

-- CreateIndex
CREATE INDEX "LearningMaterialType_createdById_status_idx" ON "LearningMaterialType"("createdById", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LearningMaterialProfile_itemId_key" ON "LearningMaterialProfile"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningMaterialProfile_activeVersionId_key" ON "LearningMaterialProfile"("activeVersionId");

-- CreateIndex
CREATE INDEX "LearningMaterialProfile_courseCode_applicableSemester_idx" ON "LearningMaterialProfile"("courseCode", "applicableSemester");

-- CreateIndex
CREATE INDEX "LearningMaterialProfile_typeId_applicableSemester_idx" ON "LearningMaterialProfile"("typeId", "applicableSemester");

-- CreateIndex
CREATE INDEX "LearningMaterialProfile_college_major_idx" ON "LearningMaterialProfile"("college", "major");

-- CreateIndex
CREATE INDEX "LearningMaterialVersion_profileId_status_createdAt_idx" ON "LearningMaterialVersion"("profileId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningMaterialVersion_profileId_versionNumber_key" ON "LearningMaterialVersion"("profileId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LearningMaterialFile_relativePath_key" ON "LearningMaterialFile"("relativePath");

-- CreateIndex
CREATE INDEX "LearningMaterialFile_versionId_status_idx" ON "LearningMaterialFile"("versionId", "status");

-- CreateIndex
CREATE INDEX "LearningMaterialFile_sha256_idx" ON "LearningMaterialFile"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "LearningMaterialAccess_orderId_key" ON "LearningMaterialAccess"("orderId");

-- CreateIndex
CREATE INDEX "LearningMaterialAccess_userId_revokedAt_grantedAt_idx" ON "LearningMaterialAccess"("userId", "revokedAt", "grantedAt");

-- CreateIndex
CREATE INDEX "LearningMaterialAccess_versionId_userId_idx" ON "LearningMaterialAccess"("versionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningMaterialSupportTicket_orderId_key" ON "LearningMaterialSupportTicket"("orderId");

-- CreateIndex
CREATE INDEX "LearningMaterialSupportTicket_buyerId_status_updatedAt_idx" ON "LearningMaterialSupportTicket"("buyerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "LearningMaterialSupportTicket_sellerId_status_updatedAt_idx" ON "LearningMaterialSupportTicket"("sellerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "LearningMaterialSupportTicket_status_responseDueAt_idx" ON "LearningMaterialSupportTicket"("status", "responseDueAt");

-- CreateIndex
CREATE INDEX "LearningMaterialSupportMessage_ticketId_createdAt_idx" ON "LearningMaterialSupportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "LearningMaterialSupportMessage_senderId_createdAt_idx" ON "LearningMaterialSupportMessage"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_category_createdAt_idx" ON "Notification"("userId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_category_createdAt_idx" ON "Notification"("category", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_targetClient_createdAt_idx" ON "Notification"("targetClient", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationRead_userId_readAt_idx" ON "NotificationRead"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRead_userId_notificationId_key" ON "NotificationRead"("userId", "notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageSetting_userId_key" ON "MessageSetting"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "QqBotBinding_qqId_key" ON "QqBotBinding"("qqId");

-- CreateIndex
CREATE INDEX "QqBotBinding_userId_idx" ON "QqBotBinding"("userId");

-- CreateIndex
CREATE INDEX "QqBotBinding_enabled_idx" ON "QqBotBinding"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "QqBotBindToken_token_key" ON "QqBotBindToken"("token");

-- CreateIndex
CREATE INDEX "QqBotBindToken_userId_expiresAt_idx" ON "QqBotBindToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "QqBotGroup_groupId_key" ON "QqBotGroup"("groupId");

-- CreateIndex
CREATE INDEX "QqBotGroup_enabled_idx" ON "QqBotGroup"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "QqBotGroupJoinRequest_flag_key" ON "QqBotGroupJoinRequest"("flag");

-- CreateIndex
CREATE INDEX "QqBotGroupJoinRequest_groupId_status_createdAt_idx" ON "QqBotGroupJoinRequest"("groupId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "QqBotGroupJoinRequest_qqId_status_createdAt_idx" ON "QqBotGroupJoinRequest"("qqId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "QqBotGroupBlockedUser_groupId_createdAt_idx" ON "QqBotGroupBlockedUser"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "QqBotGroupBlockedUser_qqId_createdAt_idx" ON "QqBotGroupBlockedUser"("qqId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QqBotGroupBlockedUser_groupId_qqId_key" ON "QqBotGroupBlockedUser"("groupId", "qqId");

-- CreateIndex
CREATE INDEX "QqBotGroupAdStrike_groupId_lastHitAt_idx" ON "QqBotGroupAdStrike"("groupId", "lastHitAt");

-- CreateIndex
CREATE INDEX "QqBotGroupAdStrike_qqId_lastHitAt_idx" ON "QqBotGroupAdStrike"("qqId", "lastHitAt");

-- CreateIndex
CREATE UNIQUE INDEX "QqBotGroupAdStrike_groupId_qqId_key" ON "QqBotGroupAdStrike"("groupId", "qqId");

-- CreateIndex
CREATE INDEX "QqBotMessageLog_eventType_createdAt_idx" ON "QqBotMessageLog"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "QqBotMessageLog_qqId_createdAt_idx" ON "QqBotMessageLog"("qqId", "createdAt");

-- CreateIndex
CREATE INDEX "QqBotMessageLog_userId_createdAt_idx" ON "QqBotMessageLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "QqBotMessageLog_notificationId_userId_idx" ON "QqBotMessageLog"("notificationId", "userId");

-- CreateIndex
CREATE INDEX "QqBotConversation_qqId_status_updatedAt_idx" ON "QqBotConversation"("qqId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "QqBotConversation_groupId_status_updatedAt_idx" ON "QqBotConversation"("groupId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SiteSetting_key_key" ON "SiteSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CourseBotQuota_userId_key" ON "CourseBotQuota"("userId");

-- CreateIndex
CREATE INDEX "CourseBotQuota_aiBalance_idx" ON "CourseBotQuota"("aiBalance");

-- CreateIndex
CREATE INDEX "CourseBotUsageLog_userId_createdAt_idx" ON "CourseBotUsageLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CourseBotUsageLog_questionHash_idx" ON "CourseBotUsageLog"("questionHash");

-- CreateIndex
CREATE INDEX "CourseBotUsageLog_userId_questionHash_idx" ON "CourseBotUsageLog"("userId", "questionHash");

-- CreateIndex
CREATE INDEX "AdminDailyLogin_dateKey_idx" ON "AdminDailyLogin"("dateKey");

-- CreateIndex
CREATE INDEX "AdminDailyLogin_dateKey_userId_idx" ON "AdminDailyLogin"("dateKey", "userId");

-- CreateIndex
CREATE INDEX "AdminDailyLogin_userId_lastLoginAt_idx" ON "AdminDailyLogin"("userId", "lastLoginAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminDailyLogin_userId_dateKey_key" ON "AdminDailyLogin"("userId", "dateKey");

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_feedSourceId_fkey" FOREIGN KEY ("feedSourceId") REFERENCES "SchoolFeedSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_manualReviewedById_fkey" FOREIGN KEY ("manualReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_parentReplyId_fkey" FOREIGN KEY ("parentReplyId") REFERENCES "Reply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "Reply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumImageAsset" ADD CONSTRAINT "ForumImageAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumImageAsset" ADD CONSTRAINT "ForumImageAsset_manualReviewedById_fkey" FOREIGN KEY ("manualReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumVideoAsset" ADD CONSTRAINT "ForumVideoAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumVideoAsset" ADD CONSTRAINT "ForumVideoAsset_manualReviewedById_fkey" FOREIGN KEY ("manualReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReviewLog" ADD CONSTRAINT "AiReviewLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicTag" ADD CONSTRAINT "TopicTag_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicTag" ADD CONSTRAINT "TopicTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseTeacher" ADD CONSTRAINT "CourseTeacher_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseTeacher" ADD CONSTRAINT "CourseTeacher_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCourse" ADD CONSTRAINT "UserCourse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCourse" ADD CONSTRAINT "UserCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserScheduleEdit" ADD CONSTRAINT "UserScheduleEdit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleWidgetToken" ADD CONSTRAINT "ScheduleWidgetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseRating" ADD CONSTRAINT "CourseRating_courseTeacherId_fkey" FOREIGN KEY ("courseTeacherId") REFERENCES "CourseTeacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolFeedSource" ADD CONSTRAINT "SchoolFeedSource_botUserId_fkey" FOREIGN KEY ("botUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeiwallSyncConfig" ADD CONSTRAINT "WeiwallSyncConfig_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeiwallTopicMap" ADD CONSTRAINT "WeiwallTopicMap_localTopicId_fkey" FOREIGN KEY ("localTopicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeiwallReplyMap" ADD CONSTRAINT "WeiwallReplyMap_localReplyId_fkey" FOREIGN KEY ("localReplyId") REFERENCES "Reply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolPermission" ADD CONSTRAINT "ToolPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Questionnaire" ADD CONSTRAINT "Questionnaire_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireResponse" ADD CONSTRAINT "QuestionnaireResponse_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireResponse" ADD CONSTRAINT "QuestionnaireResponse_respondentId_fkey" FOREIGN KEY ("respondentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeCheckTable" ADD CONSTRAINT "GradeCheckTable_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeCheckRow" ADD CONSTRAINT "GradeCheckRow_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "GradeCheckTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileCollectTask" ADD CONSTRAINT "FileCollectTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileCollectTemplate" ADD CONSTRAINT "FileCollectTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileCollectSubmission" ADD CONSTRAINT "FileCollectSubmission_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "FileCollectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileCollectSubmission" ADD CONSTRAINT "FileCollectSubmission_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileCollectFile" ADD CONSTRAINT "FileCollectFile_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FileCollectSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorOrder" ADD CONSTRAINT "SponsorOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorPaymentLog" ADD CONSTRAINT "SponsorPaymentLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SponsorOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketItem" ADD CONSTRAINT "MarketItem_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketItem" ADD CONSTRAINT "MarketItem_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketImage" ADD CONSTRAINT "MarketImage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketFavorite" ADD CONSTRAINT "MarketFavorite_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketFavorite" ADD CONSTRAINT "MarketFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOffer" ADD CONSTRAINT "MarketOffer_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOffer" ADD CONSTRAINT "MarketOffer_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOrder" ADD CONSTRAINT "MarketOrder_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOrder" ADD CONSTRAINT "MarketOrder_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "MarketOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOrder" ADD CONSTRAINT "MarketOrder_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOrder" ADD CONSTRAINT "MarketOrder_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketConversation" ADD CONSTRAINT "MarketConversation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketConversation" ADD CONSTRAINT "MarketConversation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketConversation" ADD CONSTRAINT "MarketConversation_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketConversation" ADD CONSTRAINT "MarketConversation_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketMessage" ADD CONSTRAINT "MarketMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MarketConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketMessage" ADD CONSTRAINT "MarketMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketReview" ADD CONSTRAINT "MarketReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketReview" ADD CONSTRAINT "MarketReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketReview" ADD CONSTRAINT "MarketReview_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketReport" ADD CONSTRAINT "MarketReport_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketReport" ADD CONSTRAINT "MarketReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPaymentLog" ADD CONSTRAINT "MarketPaymentLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketRefund" ADD CONSTRAINT "MarketRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketRefund" ADD CONSTRAINT "MarketRefund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSettlement" ADD CONSTRAINT "MarketSettlement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSettlement" ADD CONSTRAINT "MarketSettlement_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPayoutProfile" ADD CONSTRAINT "MarketPayoutProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialType" ADD CONSTRAINT "LearningMaterialType_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialType" ADD CONSTRAINT "LearningMaterialType_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "LearningMaterialType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialProfile" ADD CONSTRAINT "LearningMaterialProfile_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialProfile" ADD CONSTRAINT "LearningMaterialProfile_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "LearningMaterialType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialProfile" ADD CONSTRAINT "LearningMaterialProfile_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "LearningMaterialVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialVersion" ADD CONSTRAINT "LearningMaterialVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LearningMaterialProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialVersion" ADD CONSTRAINT "LearningMaterialVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialFile" ADD CONSTRAINT "LearningMaterialFile_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LearningMaterialVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialAccess" ADD CONSTRAINT "LearningMaterialAccess_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialAccess" ADD CONSTRAINT "LearningMaterialAccess_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LearningMaterialVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialAccess" ADD CONSTRAINT "LearningMaterialAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialSupportTicket" ADD CONSTRAINT "LearningMaterialSupportTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialSupportTicket" ADD CONSTRAINT "LearningMaterialSupportTicket_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialSupportTicket" ADD CONSTRAINT "LearningMaterialSupportTicket_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialSupportMessage" ADD CONSTRAINT "LearningMaterialSupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "LearningMaterialSupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterialSupportMessage" ADD CONSTRAINT "LearningMaterialSupportMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageSetting" ADD CONSTRAINT "MessageSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QqBotBinding" ADD CONSTRAINT "QqBotBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QqBotBindToken" ADD CONSTRAINT "QqBotBindToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QqBotMessageLog" ADD CONSTRAINT "QqBotMessageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseBotQuota" ADD CONSTRAINT "CourseBotQuota_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseBotUsageLog" ADD CONSTRAINT "CourseBotUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminDailyLogin" ADD CONSTRAINT "AdminDailyLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
