import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("V1 removes user levels and QQ/message settings from every active product layer", () => {
  const serverRouter = source("../src/routes/index.ts");
  const adminRouter = source("../src/routes/admin/index.ts");
  const messageRoute = source("../src/routes/message.ts");
  const workers = source("../src/runtime/backgroundWorkers.ts");
  const authRoute = source("../src/routes/auth.ts");
  const trustService = source("../src/services/userTrust.ts");
  const publicUser = source("../src/utils/publicUser.ts");
  const messagesView = source("../../web/src/views/messages/Index.vue");
  const profileView = source("../../web/src/views/profile/Index.vue");
  const publicProfileView = source("../../web/src/views/profile/User.vue");
  const webRouter = source("../../web/src/router/index.ts");
  const mainLayout = source("../../web/src/layouts/MainLayout.vue");
  const messageApi = source("../../web/src/api/message.ts");
  const authApi = source("../../web/src/api/auth.ts");
  const adminView = source("../../web/src/views/admin/Index.vue");

  assert.doesNotMatch(serverRouter, /qqbot/i);
  assert.doesNotMatch(adminRouter, /qqbot/i);
  assert.doesNotMatch(messageRoute, /\/settings|messageSetting/i);
  assert.doesNotMatch(workers, /qqbot/i);
  assert.doesNotMatch(authRoute, /messageSetting|qqbot/i);

  assert.doesNotMatch(trustService, /reputationLevel|resolveReputationLevel/);
  assert.doesNotMatch(publicUser, /reputationLevel/);
  assert.doesNotMatch(profileView, /reputationLevel|Lv\./);
  assert.doesNotMatch(publicProfileView, /reputationLevel|Lv\./);

  assert.doesNotMatch(messagesView, /name="settings"|QQ 私聊|qqBot/i);
  assert.doesNotMatch(webRouter, /qqbot-reminders/i);
  assert.doesNotMatch(mainLayout, /消息设置|tab=settings/);
  assert.doesNotMatch(messageApi, /MessageSettings|\/messages\/settings/);
  assert.doesNotMatch(authApi, /QqBot|\/qqbot/i);
  assert.doesNotMatch(adminView, /QqBotPane|name="qqbot"/i);

  assert.equal(
    existsSync(new URL("../src/routes/qqbot.ts", import.meta.url)),
    false,
  );
  assert.equal(
    existsSync(new URL("../../web/src/views/admin/QqBotPane.vue", import.meta.url)),
    false,
  );
});

test("retirement keeps legacy database tables available for historical data", () => {
  const schema = source("../prisma/schema.prisma");
  assert.match(schema, /model MessageSetting \{/);
  assert.match(schema, /model QqBotBinding \{/);
});
