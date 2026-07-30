import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("heat reasons remain an internal ranking detail and are absent from user-facing pages", () => {
  const pages = [
    "../../web/src/components/forum/TopicListItem.vue",
    "../../web/src/views/forum/Topic.vue",
    "../../web/src/views/market/Index.vue",
    "../../web/src/views/market/LearningMaterials.vue",
    "../../web/src/views/market/WantedList.vue",
  ].map(source).join("\n");

  assert.doesNotMatch(pages, /hotReasons/);
  assert.doesNotMatch(pages, /热度原因/);
});

test("learning publishing is open while moderation and governance remain enforced", () => {
  const service = source("../src/services/learningCommerceService.ts");
  const route = source("../src/routes/learningMaterials.ts");
  const publisherCenter = source("../../web/src/views/market/LearningCreatorCenter.vue");

  assert.match(service, /ensureLearningPublisherProfile/);
  assert.match(service, /publishingAllowed/);
  assert.match(route, /ensureLearningPublisherProfile/);
  assert.match(route, /\/my-items/);
  assert.match(publisherCenter, /学习资料发布中心/);
  assert.match(publisherCenter, /learningMaterialsApi\.myItems/);
  assert.match(publisherCenter, /Promise\.allSettled/);
  assert.doesNotMatch(publisherCenter, /资料发布权限当前为 \$\{context\.profile\?\.status\}/);
  assert.doesNotMatch(publisherCenter, /申请成为创作者|提交认证申请/);
});

test("homepage has one clear entry into the full marketplace", () => {
  const home = source("../../web/src/views/Home.vue");

  assert.equal((home.match(/<router-link to="\/market"/g) || []).length, 1);
  assert.match(home, /<router-link to="\/market">\{\{ t\("home\.enterMarket"\) \}\}/);
  assert.doesNotMatch(home, />实体商品<\/router-link>|>学习资料 <el-icon/);
});

test("physical and learning catalogs stay isolated outside the mixed homepage recommendations", () => {
  const catalogRoute = source("../src/routes/marketCatalog.ts");
  const workspace = source("../src/services/marketWorkspaceService.ts");
  const home = source("../../web/src/views/Home.vue");
  const learningHub = source("../../web/src/views/learning/Hub.vue");

  assert.match(catalogRoute, /deliveryType:\s*scope === "market" \? "physical" : "digital"/);
  assert.match(catalogRoute, /item\.deliveryType !== "physical"/);
  assert.match(workspace, /deliveryType:\s*"physical"/);
  assert.match(home, /marketApi\.items/);
  assert.match(home, /learningMaterialsApi\.items/);
  assert.match(home, /\/market\/item\//);
  assert.match(home, /\/learning\/materials\/item\//);
  assert.doesNotMatch(learningHub, /learningMaterialsApi\.items/);
});

test("wanted posts share one domain while learning responses only link approved learning items", () => {
  const catalog = source("../src/services/marketCatalogService.ts");
  const writer = source("../src/services/marketWantedWriteService.ts");
  const responses = source("../src/services/marketWantedResponseService.ts");
  const publish = source("../../web/src/views/market/WantedPublish.vue");
  const detail = source("../../web/src/views/market/WantedDetail.vue");

  assert.match(catalog, /LEARNING_MATERIAL_WANTED_CATEGORY = "learning_materials"/);
  assert.match(catalog, /wantedCategories/);
  assert.match(writer, /LEARNING_MATERIAL_WANTED_CATEGORY/);
  assert.match(responses, /item\?\.category === "digital_goods" && item\?\.deliveryType === "digital"/);
  assert.match(responses, /学习资料求购只能关联已在专区审核上架的资料/);
  assert.match(publish, /learning-wanted-form/);
  assert.match(detail, /learningMaterialsApi\.myItems/);
  assert.match(detail, /name:\s*"market-learning-material-item"/);
});

test("ordinary posts can associate either physical items or learning materials", () => {
  const post = source("../../web/src/views/forum/Post.vue");
  const topic = source("../../web/src/views/forum/Topic.vue");
  const topicRoute = source("../src/routes/topic.ts");

  assert.match(post, /marketApi\.items/);
  assert.match(post, /learningMaterialsApi\.items/);
  assert.match(topic, /关联实体商品/);
  assert.match(topic, /关联学习资料/);
  assert.match(topicRoute, /deliveryType:\s*true/);
});
