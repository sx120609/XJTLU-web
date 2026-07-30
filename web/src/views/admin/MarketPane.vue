<template>
  <div class="market-admin" v-loading="loading">
    <div class="pane-head">
      <div>
        <h2>市集运营</h2>
        <p>管理实体商品品类、交易内容与举报。学生商品款由买家直接支付给卖家。</p>
      </div>
      <el-button @click="load">刷新</el-button>
    </div>

    <LearningCommerceAdminPane />

    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="实体学生商品仍由买卖双方直接交易，平台不代收；历史平台支付、退款、结算与提现记录仅供审计查看。"
    />

    <section class="category-card">
      <header>
        <div>
          <h3>实体商品品类</h3>
          <p>品类会同步到市集和发布页；当前阶段禁止新增或恢复数字商品品类。</p>
        </div>
        <el-button type="primary" size="small" @click="openCategory()">新增品类</el-button>
      </header>
      <el-table :data="categories" size="small">
        <el-table-column label="品类" min-width="180">
          <template #default="{ row }">
            <b>{{ row.icon }} {{ row.name }}</b>
            <small>{{ row.slug }}</small>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="说明" min-width="220" show-overflow-tooltip />
        <el-table-column label="交付" width="115">
          <template #default="{ row }">
            <el-tag :type="row.fulfillmentType === 'digital' ? 'warning' : 'info'">
              {{ row.fulfillmentType === "digital" ? "已停用数字类" : "实体交付" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="图片" width="95">
          <template #default="{ row }">{{ row.imageRequired ? "出售必填" : "选填" }}</template>
        </el-table-column>
        <el-table-column prop="itemCount" label="商品数" width="80" />
        <el-table-column prop="sort" label="排序" width="70" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? "启用" : "停用" }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="145">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="row.fulfillmentType === 'digital'" @click="openCategory(row)">编辑</el-button>
            <el-button link type="danger" :disabled="row.fulfillmentType === 'digital'" @click="removeCategory(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <div class="summary">
      <article><b>{{ overview.counts?.active || 0 }}</b><span>在售</span></article>
      <article><b>{{ overview.counts?.reserved || 0 }}</b><span>已预订</span></article>
      <article><b>{{ overview.counts?.sold || 0 }}</b><span>已成交</span></article>
      <article><b>{{ pendingReview }}</b><span>待审核内容</span></article>
      <article><b>{{ pendingReports }}</b><span>待处理举报</span></article>
      <article><b>{{ pendingAppeals }}</b><span>待处理申诉</span></article>
    </div>

    <el-tabs v-model="tab">
      <el-tab-pane label="发布审核" name="moderation">
        <h3 class="table-title">待审核商品</h3>
        <el-table :data="overview.reviewItems || []" stripe>
          <el-table-column label="商品" min-width="220"><template #default="{ row }"><router-link :to="`/market/item/${row.id}`">{{ row.title }}</router-link><small>{{ row.seller?.nickname || '校园用户' }} · ¥{{ row.price }}</small></template></el-table-column>
          <el-table-column prop="category" label="品类" width="120" /><el-table-column prop="flaws" label="瑕疵说明" min-width="180" show-overflow-tooltip /><el-table-column label="操作" width="210"><template #default="{ row }"><el-button size="small" type="primary" @click="moderateItem(row, 'active')">通过</el-button><el-button size="small" type="danger" plain @click="moderateItem(row, 'hidden')">移除</el-button></template></el-table-column>
        </el-table><el-empty v-if="!overview.reviewItems?.length" description="暂无待审核商品" />

        <h3 class="table-title spaced">求购审核与过期记录</h3>
        <el-table :data="overview.wantedModeration || []" stripe>
          <el-table-column label="求购" min-width="220"><template #default="{ row }"><router-link :to="`/market/wanted/${row.id}`">{{ row.title }}</router-link><small>{{ row.author?.nickname || '校园用户' }} · 预算 ¥{{ row.budgetMin }}–{{ row.budgetMax }}</small></template></el-table-column>
          <el-table-column prop="status" label="状态" width="100"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
          <el-table-column prop="description" label="需求说明" min-width="180" show-overflow-tooltip /><el-table-column label="操作" width="210"><template #default="{ row }"><el-button v-if="row.status !== 'active'" size="small" type="primary" @click="moderateWanted(row, 'active')">通过/恢复</el-button><el-button v-if="row.status !== 'removed'" size="small" type="danger" plain @click="moderateWanted(row, 'removed')">移除</el-button></template></el-table-column>
        </el-table><el-empty v-if="!overview.wantedModeration?.length" description="暂无待审核或过期求购" />
      </el-tab-pane>

      <el-tab-pane label="过期商品" name="expired">
        <el-table :data="overview.expiredItems || []" stripe><el-table-column label="商品" min-width="220"><template #default="{ row }"><router-link :to="`/market/item/${row.id}`">{{ row.title }}</router-link><small>{{ row.seller?.nickname || '校园用户' }} · ¥{{ row.price }}</small></template></el-table-column><el-table-column prop="expiresAt" label="过期时间" min-width="170"><template #default="{ row }">{{ new Date(row.expiresAt).toLocaleString('zh-CN') }}</template></el-table-column><el-table-column label="操作" width="130"><template #default="{ row }"><el-button size="small" @click="moderateItem(row, 'active')">恢复 30 天</el-button></template></el-table-column></el-table><el-empty v-if="!overview.expiredItems?.length" description="暂无过期商品" />
      </el-tab-pane>

      <el-tab-pane label="市集举报" name="reports">
        <el-table :data="overview.reports || []" stripe>
          <el-table-column label="举报对象" min-width="220">
            <template #default="{ row }">
              <router-link v-if="reportRoute(row)" :to="reportRoute(row)">{{ reportTarget(row) }}</router-link><b v-else>{{ reportTarget(row) }}</b>
              <small>{{ reportType(row.type) }} · 举报人：{{ row.reporter?.nickname || "校园用户" }}</small>
              <small v-if="row.reportedUserId">被投诉用户当前好评率：{{ row.reportedUser?.marketPositiveRate ?? 100 }}%</small>
            </template>
          </el-table-column>
          <el-table-column prop="reason" label="原因" width="140" />
          <el-table-column prop="detail" label="详情" min-width="180" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="350">
            <template #default="{ row }">
              <el-button v-if="row.status === 'pending'" size="small" type="danger" @click="handleReport(row, true)">处置并处理</el-button>
              <el-button v-if="row.status === 'pending'" size="small" @click="handleReport(row, false)">驳回</el-button>
              <el-button v-if="auth.isAdmin && row.reportedUserId && row.status === 'resolved'" size="small" type="primary" plain @click="openPositiveRate(row)">调整好评率</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!overview.reports?.length" description="暂无市集举报" />
      </el-tab-pane>

      <el-tab-pane label="信用处理与申诉" name="trust">
        <div class="table-toolbar"><div><h3>违规与功能限制</h3><p>处罚会进入用户自己的信用记录；限制发布和限制交易由接口统一执行。</p></div><el-button type="primary" size="small" @click="violationOpen = true">新增处理</el-button></div>
        <el-table :data="overview.violations || []" stripe><el-table-column label="用户" min-width="130"><template #default="{ row }"><b>{{ row.user?.nickname || `用户 #${row.userId}` }}</b><small>#{{ row.userId }}</small></template></el-table-column><el-table-column prop="reason" label="原因" min-width="220" show-overflow-tooltip /><el-table-column label="等级 / 措施" min-width="160"><template #default="{ row }"><el-tag size="small" :type="row.level === 'serious' ? 'danger' : 'warning'">{{ violationLevel(row.level) }}</el-tag> {{ violationAction(row.action) }}</template></el-table-column><el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'danger' : 'info'">{{ statusLabel(row.status) }}</el-tag></template></el-table-column><el-table-column label="期限" width="170"><template #default="{ row }">{{ row.expiresAt ? new Date(row.expiresAt).toLocaleString('zh-CN') : '长期' }}</template></el-table-column><el-table-column label="操作" width="100"><template #default="{ row }"><el-button v-if="row.status === 'active'" link type="primary" @click="revokeViolation(row)">撤销</el-button></template></el-table-column></el-table>
        <h3 class="table-title spaced">用户申诉</h3>
        <el-table :data="overview.appeals || []" stripe><el-table-column label="用户" min-width="130"><template #default="{ row }">{{ row.user?.nickname || `用户 #${row.userId}` }}</template></el-table-column><el-table-column prop="content" label="申诉说明" min-width="260" show-overflow-tooltip /><el-table-column label="原处理" min-width="190"><template #default="{ row }">{{ row.violation?.reason }} · {{ violationAction(row.violation?.action) }}</template></el-table-column><el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status === 'pending' ? 'warning' : row.status === 'approved' ? 'success' : 'info'">{{ statusLabel(row.status) }}</el-tag></template></el-table-column><el-table-column label="操作" width="150"><template #default="{ row }"><template v-if="row.status === 'pending'"><el-button link type="success" @click="handleAppeal(row, 'approved')">通过</el-button><el-button link type="danger" @click="handleAppeal(row, 'rejected')">驳回</el-button></template></template></el-table-column></el-table><el-empty v-if="!overview.appeals?.length" description="暂无申诉" />
      </el-tab-pane>

      <el-tab-pane label="内容规则" name="rules">
        <div class="table-toolbar"><div><h3>关键词与风险规则</h3><p>规则保存在数据库中，可分别用于市集、广场和付费学习资料；禁止类直接拦截，风险类进入人工复核。</p></div><el-button type="primary" size="small" @click="openRule()">新增规则</el-button></div>
        <el-table :data="overview.safetyRules || []" stripe><el-table-column prop="keyword" label="关键词" min-width="130" /><el-table-column label="作用范围" width="110"><template #default="{ row }">{{ ruleScopeLabel(row.scope) }}</template></el-table-column><el-table-column prop="category" label="风险分类" min-width="150" /><el-table-column label="动作" width="100"><template #default="{ row }"><el-tag :type="row.action === 'block' ? 'danger' : 'warning'">{{ row.action === 'block' ? '禁止发布' : '人工复核' }}</el-tag></template></el-table-column><el-table-column prop="note" label="说明" min-width="220" show-overflow-tooltip /><el-table-column label="状态" width="90"><template #default="{ row }"><el-switch :model-value="row.enabled" @change="toggleRule(row, $event)" /></template></el-table-column><el-table-column label="操作" width="130"><template #default="{ row }"><el-button link type="primary" @click="openRule(row)">编辑</el-button><el-button link type="danger" @click="removeRule(row)">删除</el-button></template></el-table-column></el-table>
      </el-tab-pane>

      <el-tab-pane label="管理日志" name="logs">
        <el-alert type="info" :closable="false" show-icon title="日志不记录联系方式、账户、令牌等敏感字段。" />
        <el-table :data="overview.actionLogs || []" stripe><el-table-column label="时间" width="180"><template #default="{ row }">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</template></el-table-column><el-table-column label="管理员" width="130"><template #default="{ row }">{{ row.actor?.nickname || '系统' }}</template></el-table-column><el-table-column prop="summary" label="操作摘要" min-width="260" /><el-table-column label="对象" min-width="160"><template #default="{ row }">{{ row.targetType }} {{ row.targetId ? `#${row.targetId}` : '' }}</template></el-table-column><el-table-column prop="ip" label="来源 IP" width="150" /></el-table>
      </el-tab-pane>

      <el-tab-pane label="历史交易记录" name="orders">
        <el-table :data="overview.orders || []" stripe>
          <el-table-column prop="id" label="记录" width="90"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
          <el-table-column label="商品" min-width="200"><template #default="{ row }">{{ row.item?.title }}</template></el-table-column>
          <el-table-column label="买家 / 卖家" min-width="170"><template #default="{ row }">{{ row.buyer?.nickname }} / {{ row.seller?.nickname }}</template></el-table-column>
          <el-table-column label="约定价格" width="120"><template #default="{ row }"><b>¥{{ row.amount }}</b></template></el-table-column>
          <el-table-column prop="status" label="状态" width="130"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="categoryOpen" :title="editingCategoryId ? '编辑品类' : '新增品类'" width="500px">
      <el-form label-position="top">
        <div class="category-form-grid">
          <el-form-item label="图标"><el-input v-model="categoryForm.icon" maxlength="12" /></el-form-item>
          <el-form-item label="品类名称"><el-input v-model="categoryForm.name" maxlength="30" /></el-form-item>
        </div>
        <el-form-item label="品类标识">
          <el-input v-model="categoryForm.slug" :disabled="Boolean(editingCategoryId)" maxlength="40" placeholder="仅小写字母、数字、下划线或短横线" />
        </el-form-item>
        <el-form-item label="品类说明"><el-input v-model="categoryForm.description" maxlength="120" /></el-form-item>
        <div class="category-form-grid">
          <el-form-item label="交付类型"><el-select v-model="categoryForm.fulfillmentType" disabled><el-option label="实体交付" value="physical" /></el-select></el-form-item>
          <el-form-item label="排序"><el-input-number v-model="categoryForm.sort" :min="0" :max="9999" /></el-form-item>
        </div>
        <el-switch v-model="categoryForm.imageRequired" active-text="出售时图片必填" inactive-text="图片选填" />
        <el-switch v-model="categoryForm.enabled" active-text="启用品类" inactive-text="停用品类" />
      </el-form>
      <template #footer>
        <el-button @click="categoryOpen = false">取消</el-button>
        <el-button type="primary" :loading="savingCategory" @click="saveCategory">保存</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="ruleOpen" :title="editingRuleId ? '编辑内容规则' : '新增内容规则'" width="500px"><el-form label-position="top"><el-form-item label="关键词"><el-input v-model="ruleForm.keyword" maxlength="80" /></el-form-item><div class="category-form-grid"><el-form-item label="作用范围"><el-select v-model="ruleForm.scope"><el-option label="市集" value="market" /><el-option label="广场" value="forum" /><el-option label="付费学习资料" value="learning" /><el-option label="全部" value="all" /></el-select></el-form-item><el-form-item label="风险分类"><el-input v-model="ruleForm.category" maxlength="80" /></el-form-item><el-form-item label="处理动作"><el-select v-model="ruleForm.action"><el-option label="禁止发布" value="block" /><el-option label="人工复核" value="review" /></el-select></el-form-item></div><el-form-item label="规则说明"><el-input v-model="ruleForm.note" maxlength="500" /></el-form-item><el-switch v-model="ruleForm.enabled" active-text="启用规则" inactive-text="停用规则" /></el-form><template #footer><el-button @click="ruleOpen = false">取消</el-button><el-button type="primary" @click="saveRule">保存</el-button></template></el-dialog>
    <el-dialog v-model="violationOpen" title="新增市集信用处理" width="520px"><el-form label-position="top"><el-form-item label="用户 ID"><el-input-number v-model="violationForm.userId" :min="1" controls-position="right" /></el-form-item><div class="category-form-grid"><el-form-item label="违规类型"><el-input v-model="violationForm.type" maxlength="80" placeholder="例如：禁售物品、交易骚扰" /></el-form-item><el-form-item label="处理等级"><el-select v-model="violationForm.level"><el-option label="提醒" value="warning" /><el-option label="一般" value="moderate" /><el-option label="严重" value="serious" /></el-select></el-form-item></div><div class="category-form-grid"><el-form-item label="处理措施"><el-select v-model="violationForm.action"><el-option label="警告" value="warning" /><el-option label="限制发布" value="restrict_publish" /><el-option label="限制交易" value="restrict_trade" /></el-select></el-form-item><el-form-item label="限制天数（0 为长期）"><el-input-number v-model="violationForm.days" :min="0" :max="3650" controls-position="right" /></el-form-item></div><el-form-item label="处理原因"><el-input v-model="violationForm.reason" type="textarea" :rows="4" maxlength="500" show-word-limit /></el-form-item></el-form><template #footer><el-button @click="violationOpen = false">取消</el-button><el-button type="primary" @click="createViolation">确认处理</el-button></template></el-dialog>
    <el-dialog v-model="positiveRateOpen" title="管理员调整好评率" width="500px" :close-on-click-modal="!positiveRateSaving">
      <el-alert type="warning" :closable="false" show-icon title="好评率只由管理员依据投诉核验结果调整，用户评价不会自动改写。" />
      <el-form label-position="top">
        <el-form-item label="处理对象">
          <el-input :model-value="`${positiveRateForm.nickname}（用户 #${positiveRateForm.userId}）`" disabled />
        </el-form-item>
        <el-form-item label="好评率">
          <el-input-number v-model="positiveRateForm.positiveRate" :min="0" :max="100" :step="1" controls-position="right" />
          <span class="rate-unit">%</span>
        </el-form-item>
        <el-form-item label="调整依据">
          <el-input v-model="positiveRateForm.reason" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="填写投诉核验结论与调整依据，至少 2 个字符" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="positiveRateSaving" @click="positiveRateOpen = false">取消</el-button>
        <el-button type="primary" :loading="positiveRateSaving" @click="savePositiveRate">确认调整</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import LearningCommerceAdminPane from "./LearningCommerceAdminPane.vue";
import {
  marketApi,
  type MarketAdminOverview,
  type MarketAppeal,
  type MarketCategoryOption,
  type MarketItem,
  type MarketItemStatus,
  type MarketReport,
  type MarketSafetyRule,
  type MarketViolation,
  type WantedPost,
} from "@/api/market";

const auth = useAuthStore();
const loading = ref(false);
const tab = ref("moderation");
const overview = reactive<MarketAdminOverview>({
  counts: {},
  reviewItems: [],
  expiredItems: [],
  wantedModeration: [],
  reports: [],
  refunds: [],
  settlements: [],
  orders: [],
  safetyRules: [],
  violations: [],
  appeals: [],
  actionLogs: [],
});
const categories = ref<MarketCategoryOption[]>([]);
const categoryOpen = ref(false);
const editingCategoryId = ref(0);
const savingCategory = ref(false);
const ruleOpen = ref(false);
const editingRuleId = ref(0);
const ruleForm = reactive({ keyword: "", scope: "market" as MarketSafetyRule["scope"], category: "prohibited", action: "block" as "block" | "review", enabled: true, note: "" });
const violationOpen = ref(false);
const violationForm = reactive({ userId: 1, type: "content", level: "warning" as "warning" | "moderate" | "serious", action: "warning" as "warning" | "restrict_publish" | "restrict_trade", days: 7, reason: "" });
const positiveRateOpen = ref(false);
const positiveRateSaving = ref(false);
const positiveRateForm = reactive({ userId: 0, nickname: "", reportId: 0, positiveRate: 100, reason: "" });
const categoryForm = reactive({
  slug: "",
  name: "",
  icon: "📦",
  description: "",
  fulfillmentType: "physical" as const,
  imageRequired: true,
  enabled: true,
  sort: 0,
});

const pendingReports = computed(() => overview.reports.filter((row) => row.status === "pending").length);
const pendingAppeals = computed(() => overview.appeals.filter((row) => row.status === "pending").length);
const pendingReview = computed(() => (overview.reviewItems?.length || 0) + (overview.wantedModeration?.filter((row) => row.status === "reviewing").length || 0));
const labels: Record<string, string> = {
  pending: "待处理",
  approved: "已批准",
  completed: "已完成",
  rejected: "已拒绝",
  failed: "失败",
  available: "待结算（历史）",
  held: "暂缓（历史）",
  settled: "已结算（历史）",
  pending_payment: "待支付（历史）",
  paid: "已支付（历史）",
  delivering: "已预订",
  disputed: "争议中",
  refunded: "已退款（历史）",
  cancelled: "已取消",
  resolved: "已处理",
  reviewing: "审核中",
  active: "进行中",
  expired: "已过期",
  removed: "已移除",
  reserved: "已预订",
  sold: "已成交",
  no_show: "爽约结束",
  revoked: "已撤销",
};

function statusLabel(status: string) {
  return labels[status] || status;
}

function statusType(status: string) {
  if (["completed", "settled", "resolved"].includes(status)) return "success";
  if (["rejected", "failed", "disputed"].includes(status)) return "danger";
  if (["pending", "pending_payment", "available"].includes(status)) return "warning";
  return "info";
}

async function load() {
  loading.value = true;
  try {
    const [nextOverview, nextCategories] = await Promise.all([
      marketApi.adminOverview({ suppressErrorMessage: true }),
      marketApi.adminCategories({ suppressErrorMessage: true }),
    ]);
    Object.assign(overview, nextOverview);
    categories.value = nextCategories;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "市集运营数据加载失败");
  } finally {
    loading.value = false;
  }
}

function reportRoute(row: MarketReport) { if (row.itemId) return `/market/item/${row.itemId}`; if (row.wantedPostId) return `/market/wanted/${row.wantedPostId}`; if (row.reportedUserId) return `/market/seller/${row.reportedUserId}`; return ""; }
function reportTarget(row: MarketReport) { return row.item?.title || row.wantedPost?.title || row.reportedUser?.nickname || (row.order ? `交易 ${row.order.outTradeNo}` : `举报 #${row.id}`); }
function reportType(value: string) { return ({ listing: "商品", wanted: "求购", user: "用户", trade: "交易" } as Record<string, string>)[value] || value; }
function violationLevel(value: string) { return ({ warning: "提醒", moderate: "一般", serious: "严重" } as Record<string, string>)[value] || value; }
function violationAction(value: string) { return ({ warning: "警告", restrict_publish: "限制发布", restrict_trade: "限制交易" } as Record<string, string>)[value] || value; }

function ruleScopeLabel(scope: MarketSafetyRule["scope"]) { return ({ market: "市集", forum: "广场", learning: "付费学习资料", all: "全部" } as const)[scope] || scope; }
function openRule(row?: MarketSafetyRule) { editingRuleId.value = row?.id || 0; Object.assign(ruleForm, row ? { keyword: row.keyword, scope: row.scope, category: row.category, action: row.action, enabled: row.enabled, note: row.note } : { keyword: "", scope: "market", category: "prohibited", action: "block", enabled: true, note: "" }); ruleOpen.value = true; }
async function saveRule() { if (!ruleForm.keyword.trim() || !ruleForm.category.trim()) return void ElMessage.warning("请填写关键词和风险分类"); if (editingRuleId.value) await marketApi.adminUpdateSafetyRule(editingRuleId.value, ruleForm); else await marketApi.adminCreateSafetyRule(ruleForm); ruleOpen.value = false; ElMessage.success("安全规则已保存"); await load(); }
async function toggleRule(row: MarketSafetyRule, value: boolean | string | number) { await marketApi.adminUpdateSafetyRule(row.id, { enabled: Boolean(value) }); await load(); }
async function removeRule(row: MarketSafetyRule) { await ElMessageBox.confirm(`确认删除关键词规则“${row.keyword}”？`, "删除安全规则", { type: "warning" }); await marketApi.adminDeleteSafetyRule(row.id); ElMessage.success("规则已删除"); await load(); }
async function createViolation() { if (!violationForm.userId || violationForm.reason.trim().length < 2) return void ElMessage.warning("请填写用户 ID 和处理原因"); const expiresAt = violationForm.days > 0 ? new Date(Date.now() + violationForm.days * 86400000).toISOString() : null; await marketApi.adminCreateViolation({ userId: violationForm.userId, type: violationForm.type, level: violationForm.level, action: violationForm.action, reason: violationForm.reason, expiresAt }); violationOpen.value = false; violationForm.reason = ""; ElMessage.success("信用处理已生效"); await load(); }
async function revokeViolation(row: MarketViolation) { const { value } = await ElMessageBox.prompt("请填写撤销原因", "撤销市集处理", { inputPattern: /\S{2,}/, inputErrorMessage: "请至少填写 2 个字符" }); await marketApi.adminRevokeViolation(row.id, value); ElMessage.success("处理已撤销"); await load(); }
async function handleAppeal(row: MarketAppeal, status: "approved" | "rejected") { const { value } = await ElMessageBox.prompt("请填写申诉处理结论和依据", status === "approved" ? "通过申诉" : "驳回申诉", { inputPattern: /\S{2,}/, inputErrorMessage: "请至少填写 2 个字符" }); await marketApi.adminHandleAppeal(row.id, { status, note: value }); ElMessage.success("申诉已处理"); await load(); }

function openPositiveRate(row: MarketReport) {
  if (!auth.isAdmin || !row.reportedUserId) return;
  Object.assign(positiveRateForm, {
    userId: row.reportedUserId,
    nickname: row.reportedUser?.nickname || `用户 #${row.reportedUserId}`,
    reportId: row.id,
    positiveRate: row.reportedUser?.marketPositiveRate ?? 100,
    reason: row.status === "resolved" ? row.handledNote || row.reason : row.reason,
  });
  positiveRateOpen.value = true;
}

async function savePositiveRate() {
  if (!positiveRateForm.userId || positiveRateForm.reason.trim().length < 2) {
    return void ElMessage.warning("请填写至少 2 个字符的调整依据");
  }
  positiveRateSaving.value = true;
  try {
    await marketApi.adminAdjustPositiveRate(positiveRateForm.userId, {
      positiveRate: positiveRateForm.positiveRate,
      reason: positiveRateForm.reason.trim(),
      reportId: positiveRateForm.reportId,
    });
    positiveRateOpen.value = false;
    ElMessage.success("好评率已由管理员更新并写入审计日志");
    await load();
  } finally {
    positiveRateSaving.value = false;
  }
}

function openCategory(row?: MarketCategoryOption) {
  if (row?.fulfillmentType === "digital") return;
  editingCategoryId.value = row?.id || 0;
  const last = categories.value[categories.value.length - 1];
  Object.assign(categoryForm, row ? {
    slug: row.slug,
    name: row.name,
    icon: row.icon,
    description: row.description,
    fulfillmentType: "physical",
    imageRequired: row.imageRequired,
    enabled: row.enabled,
    sort: row.sort,
  } : {
    slug: "",
    name: "",
    icon: "📦",
    description: "",
    fulfillmentType: "physical",
    imageRequired: true,
    enabled: true,
    sort: (last?.sort || 0) + 10,
  });
  categoryOpen.value = true;
}

async function saveCategory() {
  if (!categoryForm.name.trim() || !categoryForm.slug.trim()) return ElMessage.warning("请填写品类名称和标识");
  savingCategory.value = true;
  try {
    if (editingCategoryId.value) {
      await marketApi.adminUpdateCategory(editingCategoryId.value, {
        name: categoryForm.name.trim(),
        icon: categoryForm.icon.trim() || "📦",
        description: categoryForm.description.trim(),
        fulfillmentType: "physical",
        imageRequired: categoryForm.imageRequired,
        enabled: categoryForm.enabled,
        sort: categoryForm.sort,
      });
    } else {
      await marketApi.adminCreateCategory({
        ...categoryForm,
        fulfillmentType: "physical",
        slug: categoryForm.slug.trim(),
        name: categoryForm.name.trim(),
        icon: categoryForm.icon.trim() || "📦",
        description: categoryForm.description.trim(),
      });
    }
    categoryOpen.value = false;
    ElMessage.success("商品品类已保存");
    await load();
  } finally {
    savingCategory.value = false;
  }
}

async function removeCategory(row: MarketCategoryOption) {
  if (row.fulfillmentType === "digital") return ElMessage.warning("历史数字品类已冻结，不能修改或删除");
  if (row.itemCount) return ElMessage.warning(`该品类已有 ${row.itemCount} 件商品，请编辑并停用`);
  await ElMessageBox.confirm("删除后不可恢复，确认继续？", "删除品类", { type: "warning" });
  await marketApi.adminDeleteCategory(row.id);
  ElMessage.success("品类已删除");
  await load();
}

async function handleReport(row: MarketReport, hideItem: boolean) {
  const action = hideItem ? "resolved" : "rejected";
  const { value } = await ElMessageBox.prompt(hideItem ? "填写处置说明" : "填写驳回说明", "处理市集举报", {
    inputValue: "",
    confirmButtonText: "确认",
  });
  await marketApi.adminHandleReport(row.id, { status: action, note: value, hideItem });
  ElMessage.success("举报已处理");
  await load();
}

async function moderateItem(row: MarketItem, status: MarketItemStatus) {
  const { value } = await ElMessageBox.prompt(status === "active" ? "可填写审核说明（选填）" : "请填写移除原因", status === "active" ? "通过商品" : "移除商品", { inputValue: "", inputPattern: status === "active" ? undefined : /\S+/, inputErrorMessage: "请填写移除原因" });
  await marketApi.adminUpdateItem(row.id, { status, note: value });
  ElMessage.success("商品状态已更新");
  await load();
}

async function moderateWanted(row: WantedPost, status: "active" | "removed") {
  const { value } = await ElMessageBox.prompt(status === "active" ? "可填写审核说明（选填）" : "请填写移除原因", status === "active" ? "通过求购" : "移除求购", { inputValue: "", inputPattern: status === "active" ? undefined : /\S+/, inputErrorMessage: "请填写移除原因" });
  await marketApi.adminUpdateWanted(row.id, { status, note: value });
  ElMessage.success("求购状态已更新");
  await load();
}

onMounted(load);
</script>

<style scoped>
.market-admin { padding: 4px; }
.pane-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.pane-head h2 { margin: 0 0 6px; }
.pane-head p { margin: 0; color: var(--cpu-text-secondary); }
.el-alert { margin-bottom: 14px; }
.category-card { margin: 16px 0; padding: 16px 18px; border: 1px solid var(--cpu-border-soft); border-radius: 13px; background: var(--cpu-card); }
.category-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.category-card h3 { margin: 0 0 5px; }
.category-card p { margin: 0; color: var(--cpu-text-secondary); font-size: 12px; }
.category-form-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 14px; }
.summary { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin: 16px 0; }
.summary article { display: flex; flex-direction: column; padding: 16px; background: var(--cpu-surface-soft); border: 1px solid var(--cpu-border-soft); border-radius: 12px; }
.summary b { font-size: 26px; color: var(--cpu-primary); }
.summary span, .el-table small { color: var(--cpu-text-secondary); }
.el-table small, .el-table b { display: block; }
.el-table small { margin-top: 4px; }
.el-table a { color: var(--cpu-primary); text-decoration: none; }
.table-title { margin: 6px 0 12px; font-size: 15px; }.table-title.spaced { margin-top: 26px; }
.table-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin: 6px 0 14px; }.table-toolbar h3 { margin: 0 0 5px; }.table-toolbar p { margin: 0; color: var(--cpu-text-secondary); font-size: 12px; }
.rate-unit { margin-left: 8px; color: var(--cpu-text-secondary); }
@media (max-width: 1000px) { .summary { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) {
  .summary { grid-template-columns: 1fr; }
  .pane-head, .category-card > header { align-items: flex-start; flex-direction: column; gap: 12px; }
  .pane-head p { font-size: 12px; }
  .category-form-grid { grid-template-columns: 1fr; }
}
</style>
