<template>
  <div class="grades-pane">
    <div class="ctrl-bar" v-if="parsed">
      <div class="ctrl-left">
        <label class="filter-field compact">
          <span class="lbl">学期</span>
          <el-select v-model="semester" size="small" clearable placeholder="全部学期" @change="onSemesterChange">
            <el-option v-for="s in parsed.semesters" :key="s.value" :value="s.value" :label="s.label" />
          </el-select>
        </label>
        <label class="filter-field wide">
          <span class="lbl">性质</span>
          <el-select v-model="attrFilter" size="small" multiple collapse-tags collapse-tags-tooltip placeholder="全部">
            <el-option v-for="a in attrOptions" :key="a" :value="a" :label="a" />
          </el-select>
        </label>
        <label class="filter-field">
          <span class="lbl">关键词</span>
          <el-input v-model="keyword" size="small" placeholder="课程名 / 代码" clearable />
        </label>
      </div>
      <div class="ctrl-right">
        <span class="stat">📚 显示 {{ filteredList.length }} / {{ parsed.list.length }} 门</span>
        <span class="stat">· 统计 {{ statList.length }} 门</span>
        <span class="stat" v-if="statCredits">· {{ statCredits.toFixed(1) }} 学分</span>
        <span v-if="statGpaCredits" class="stat">
          · 已出分换算 GPA <b>{{ statGpa.toFixed(2) }}</b> / 4.0
        </span>
        <el-tooltip placement="top">
          <template #content>
            非学校官方 GPA；按 XJTLU / 利物浦英国百分制分档换算并按学分加权<br/>
            70–100（First）→ 3.80–4.00<br/>
            60–69（2:1）→ 3.30–3.79 · 50–59（2:2）→ 3.00–3.29<br/>
            40–49（Third）→ 2.00 · 40 以下 → 2.00 以下
          </template>
          <el-icon class="hint-icon"><InfoFilled /></el-icon>
        </el-tooltip>
      </div>
    </div>

    <div v-if="parsed" class="gpa-tool">
      <div class="calc-head">
        <div class="calc-title">
          <b>自定义换算 GPA</b>
          <span>{{ selectionSummaryText }}</span>
        </div>
        <div class="calc-mode-switch" role="group" aria-label="GPA 统计口径">
          <button
            v-for="mode in statModeOptions"
            :key="mode.value"
            type="button"
            class="calc-mode-btn"
            :class="{ active: statMode === mode.value }"
            :aria-pressed="statMode === mode.value"
            :disabled="mode.value !== 'all' && !selectedCourseKeys.length"
            @click="statMode = mode.value"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>
      <div class="calc-controls">
        <label class="filter-field course-picker">
          <span class="lbl">选择课程</span>
          <el-select
            v-model="selectedCourseKeys"
            size="small"
            multiple
            filterable
            clearable
            collapse-tags
            collapse-tags-tooltip
            placeholder="搜索课程名 / 代码"
            :disabled="!filteredList.length"
            @change="activateSelectionMode"
          >
            <el-option v-for="course in courseOptions" :key="course.key" :value="course.key" :label="course.label">
              <div class="course-option">
                <span>{{ course.name }}</span>
                <small>{{ course.meta }}</small>
              </div>
            </el-option>
          </el-select>
        </label>
        <div class="quick-actions">
          <el-button size="small" :icon="Check" :disabled="!parsed.list.length" @click="selectAllCourses">全选</el-button>
          <el-button size="small" :icon="Filter" :disabled="!filteredList.length" @click="selectFilteredCourses">筛选内全选</el-button>
          <el-button size="small" :icon="Switch" :disabled="!filteredList.length" @click="invertFilteredCourses">反选</el-button>
          <el-button size="small" :icon="Close" :disabled="!selectedCourseKeys.length" @click="clearSelection">清空</el-button>
        </div>
      </div>
    </div>

    <div v-if="props.source === 'jwxt'" class="service-reco">
      <div>
        <span class="reco-kicker">服务推荐</span>
        <b>成绩证明办理</b>
        <p>需要开具成绩相关证明时，可前往学校电子证明平台办理。</p>
      </div>
      <a
        class="reco-link"
        href="https://dzpzstu.cpu.edu.cn/student/"
        target="_blank"
        rel="noopener noreferrer"
      >
        前往办理
      </a>
    </div>

    <div v-loading="loading">
      <el-alert
        v-if="loadError"
        type="error"
        :closable="false"
        show-icon
        class="pane-alert"
        :title="loadError"
      >
        <template #default>
          <el-button size="small" :loading="loading" @click="reload">重试</el-button>
        </template>
      </el-alert>
      <el-empty v-if="!loading && !filteredList.length" description="没有符合条件的成绩" />
      <div v-else>
        <div v-for="(rows, semKey) in groupedBySem" :key="semKey" class="sem-block">
          <div class="sem-head">
            <h3>{{ semKey }}</h3>
            <span class="sem-sum">
              {{ rows.length }} 门 · {{ semCredits(rows).toFixed(1) }} 学分
              <template v-if="gpaCredits(rows)"> · 换算 GPA {{ semGpa(rows).toFixed(2) }}</template>
            </span>
          </div>
          <div class="mobile-grade-list">
            <article v-for="row in rows" :key="`${row.semester}-${row.courseCode || row.courseName}`" class="grade-card">
              <div class="grade-card-top">
                <el-checkbox :model-value="isCourseSelected(row)" @change="(checked) => toggleCourse(row, checked)">
                  选择
                </el-checkbox>
                <span v-if="row.courseAttr && props.source === 'ebridge'" class="grade-type-text">{{ row.courseAttr }}</span>
                <el-tag v-else-if="row.courseAttr" class="grade-tag" size="small" :type="attrTagType(row.courseAttr)" effect="plain">{{ row.courseAttr }}</el-tag>
              </div>
              <div class="grade-main">
                <div class="course-title">{{ row.courseName }}</div>
                <div class="course-sub">
                  <span v-if="row.courseCode">{{ row.courseCode }}</span>
                  <span v-if="row.credits">{{ row.credits }} 学分</span>
                  <span v-if="row.hours && props.source === 'jwxt'">{{ row.hours }} 学时</span>
                  <span v-if="props.source === 'jwxt' && row.examType">{{ row.examType }}</span>
                </div>
              </div>
              <div class="score-badges">
                <span class="score-pill" :style="{ color: scoreColor(row.scoreNum) }">总评 {{ row.score || "—" }}</span>
                <span class="score-pill" :style="{ color: gpaColor(row.gpa) }">换算 GPA {{ row.gpa?.toFixed(2) ?? "—" }}</span>
              </div>
              <div v-if="props.source === 'jwxt'" class="grade-detail">
                <span>平时 {{ row.usual || "—" }}</span>
                <span>期中 {{ row.midterm || "—" }}</span>
                <span>期末 {{ row.final || "—" }}</span>
              </div>
              <details v-if="row.components?.length" class="mobile-assessments">
                <summary>分项成绩 {{ row.components.length }} 项</summary>
                <div v-for="component in row.components" :key="`${component.title}-${component.percentage}`" class="assessment-item">
                  <span>
                    <b>{{ component.title }}</b>
                    <small>{{ component.type || 'Assessment' }} · 占比 {{ component.percentage || '—' }}</small>
                  </span>
                  <strong :class="{ pending: !component.mark }">{{ component.mark || "待发布" }}</strong>
                </div>
              </details>
            </article>
          </div>
          <div class="table-scroll">
            <el-table :data="rows" stripe size="default">
              <el-table-column v-if="rows.some((row) => row.components?.length)" type="expand" width="44">
                <template #default="{ row }">
                  <div class="assessment-panel">
                    <div class="assessment-head">
                      <strong>课程分项成绩</strong>
                      <span>总评由各分项按学校公布权重计算</span>
                    </div>
                    <div class="assessment-grid">
                      <div v-for="component in row.components" :key="`${component.title}-${component.percentage}`" class="assessment-item">
                        <span>
                          <b>{{ component.title }}</b>
                          <small>{{ component.type || 'Assessment' }} · 占比 {{ component.percentage || '—' }}</small>
                        </span>
                        <strong :class="{ pending: !component.mark }">{{ component.mark || "待发布" }}</strong>
                      </div>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="选择" width="64" align="center" fixed>
                <template #default="{ row }">
                  <el-checkbox
                    :model-value="isCourseSelected(row)"
                    :aria-label="`选择 ${row.courseName}`"
                    @change="(checked) => toggleCourse(row, checked)"
                  />
                </template>
              </el-table-column>
              <el-table-column v-if="!isMobile" prop="courseCode" label="课程代码" width="110" />
              <el-table-column prop="courseName" label="课程名称" min-width="200" />
              <el-table-column label="总成绩" width="88" align="right">
                <template #default="{ row }">
                  <span :style="{ color: scoreColor(row.scoreNum), fontWeight: 600 }">{{ row.score || "—" }}</span>
                </template>
              </el-table-column>
              <el-table-column label="换算 GPA" width="96" align="right">
                <template #default="{ row }">
                  <span :style="{ color: gpaColor(row.gpa) }">{{ row.gpa?.toFixed(2) ?? "—" }}</span>
                </template>
              </el-table-column>
              <el-table-column v-if="!isMobile" prop="credits" label="学分" width="70" align="right" />
              <el-table-column v-if="!isMobile && props.source === 'jwxt'" prop="hours" label="学时" width="70" align="right" />
              <el-table-column v-if="props.source === 'jwxt'" label="平时" width="60" align="right">
                <template #default="{ row }">{{ row.usual || "—" }}</template>
              </el-table-column>
              <el-table-column v-if="props.source === 'jwxt'" label="期中" width="60" align="right">
                <template #default="{ row }">{{ row.midterm || "—" }}</template>
              </el-table-column>
              <el-table-column v-if="props.source === 'jwxt'" label="期末" width="60" align="right">
                <template #default="{ row }">{{ row.final || "—" }}</template>
              </el-table-column>
              <el-table-column label="性质" width="80">
                <template #default="{ row }">
                  <span v-if="row.courseAttr && props.source === 'ebridge'" class="grade-type-text">{{ row.courseAttr }}</span>
                  <el-tag v-else-if="row.courseAttr" size="small" :type="attrTagType(row.courseAttr)" effect="plain">{{ row.courseAttr }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column v-if="props.source === 'jwxt'" prop="examType" label="考试" width="100" />
            </el-table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { Check, Close, Filter, InfoFilled, Switch } from "@element-plus/icons-vue";
import { jwxtApi } from "@/api/jwxt";

interface GradeRow {
  semester: string;
  courseCode?: string;
  courseName: string;
  score: string;
  scoreNum: number | null;
  usual?: string;
  midterm?: string;
  final?: string;
  credits?: number;
  hours?: number;
  gpa?: number;
  courseAttr?: string;
  examType?: string;
  grade?: string;
  attempt?: string;
  remark?: string;
  components?: Array<{
    title: string;
    type: string;
    percentage: string;
    mark: string;
  }>;
  statKey?: string;
}

type StatMode = "all" | "only" | "exclude";

const statModeOptions: Array<{ value: StatMode; label: string }> = [
  { value: "all", label: "全部" },
  { value: "only", label: "仅选中" },
  { value: "exclude", label: "排除选中" },
];

const props = withDefaults(defineProps<{
  data: any;
  loading?: boolean;
  source?: "jwxt" | "ebridge";
}>(), {
  source: "jwxt",
});
const parsed = ref<any>(props.data?.parsed ?? null);
const loading = ref(props.loading ?? false);
const semester = ref<string>("");
const attrFilter = ref<string[]>([]);
const keyword = ref<string>("");
const statMode = ref<StatMode>("all");
const selectedCourseKeys = ref<string[]>([]);
const loadError = ref("");
let loadSeq = 0;
let disposed = false;

const isMobile = ref(false);
let mql: MediaQueryList | null = null;
function onMqlChange(e: MediaQueryListEvent) {
  isMobile.value = e.matches;
}
onMounted(() => {
  disposed = false;
  if (typeof window === "undefined" || !window.matchMedia) return;
  mql = window.matchMedia("(max-width: 760px)");
  isMobile.value = mql.matches;
  mql.addEventListener?.("change", onMqlChange);
});
onBeforeUnmount(() => {
  disposed = true;
  loadSeq += 1;
  loading.value = false;
  mql?.removeEventListener?.("change", onMqlChange);
  mql = null;
});

watch(() => props.data, (v) => {
  parsed.value = normalizeParsedGrades(v?.parsed ?? null);
  if (v?.parsed) loadError.value = "";
}, { immediate: true });
watch(() => props.loading, (v) => { loading.value = Boolean(v); }, { immediate: true });

function scoreToGpa(score?: string): number | undefined {
  const raw = String(score ?? "").trim();
  if (!raw) return undefined;
  const scoreNum = parseFloat(raw);
  if (!Number.isFinite(scoreNum)) return undefined;
  const mark = Math.min(100, Math.max(0, scoreNum));
  let gpa: number;
  if (mark >= 70) gpa = 3.8 + ((mark - 70) / 30) * 0.2;
  else if (mark >= 60) gpa = 3.3 + ((mark - 60) / 10) * 0.49;
  else if (mark >= 50) gpa = 3.0 + ((mark - 50) / 10) * 0.29;
  else if (mark >= 40) gpa = 2.0;
  else gpa = (mark / 40) * 2.0;
  return Math.round(Math.min(4, Math.max(0, gpa)) * 100) / 100;
}

function normalizeGradeRow(row: GradeRow): GradeRow {
  const gpa = typeof row.gpa === "number" ? row.gpa : Number(row.gpa);
  if (Number.isFinite(gpa)) return { ...row, gpa };
  return { ...row, gpa: scoreToGpa(row.score) };
}

function normalizeParsedGrades(data: any) {
  if (!data || !Array.isArray(data.list)) return data;
  return {
    ...data,
    list: (data.list as GradeRow[]).map((row, index) => {
      const normalized = normalizeGradeRow(row);
      return { ...normalized, statKey: makeCourseKey(normalized, index) };
    }),
  };
}

function makeCourseKey(row: GradeRow, index: number) {
  return [
    row.semester ?? "",
    row.courseCode ?? "",
    row.courseName ?? "",
    row.score ?? "",
    row.credits ?? "",
    row.examType ?? "",
    index,
  ].join("||");
}

function courseKey(row: GradeRow) {
  return row.statKey || [
    row.semester ?? "",
    row.courseCode ?? "",
    row.courseName ?? "",
    row.score ?? "",
    row.credits ?? "",
    row.examType ?? "",
  ].join("||");
}

function orderedKeys(rows: GradeRow[] = parsed.value?.list ?? []) {
  return rows.map(courseKey);
}

function commitSelection(keys: string[]) {
  const known = new Set(orderedKeys());
  selectedCourseKeys.value = Array.from(new Set(keys)).filter((key) => known.has(key));
}

function pruneSelection() {
  commitSelection(selectedCourseKeys.value);
  if (!selectedCourseKeys.value.length && statMode.value !== "all") statMode.value = "all";
}

watch(() => parsed.value?.list, pruneSelection);

/** 数据里出现过的全部课程性质（含空字符串过滤）— 动态生成 */
const attrOptions = computed<string[]>(() => {
  if (!parsed.value) return [];
  const s = new Set<string>();
  for (const g of parsed.value.list as GradeRow[]) {
    if (g.courseAttr) s.add(g.courseAttr);
  }
  return Array.from(s).sort();
});

/** 应用了筛选条件后的列表 */
const filteredList = computed<GradeRow[]>(() => {
  if (!parsed.value) return [];
  const kw = keyword.value.trim().toLowerCase();
  return (parsed.value.list as GradeRow[]).filter((g) => {
    if (semester.value && g.semester !== semester.value) return false;
    if (attrFilter.value.length && !attrFilter.value.includes(g.courseAttr ?? "")) return false;
    if (kw) {
      const hit =
        g.courseName.toLowerCase().includes(kw) ||
        (g.courseCode ?? "").toLowerCase().includes(kw) ||
        (g.examType ?? "").toLowerCase().includes(kw);
      if (!hit) return false;
    }
    return true;
  });
});

const filteredKeySet = computed(() => new Set(filteredList.value.map(courseKey)));
const selectedFilteredCount = computed(() => selectedCourseKeys.value.filter((key) => filteredKeySet.value.has(key)).length);
const hiddenSelectedCount = computed(() => Math.max(0, selectedCourseKeys.value.length - selectedFilteredCount.value));
const selectionSummaryText = computed(() => {
  if (!selectedCourseKeys.value.length) return "未选择课程";
  if (!hiddenSelectedCount.value) return `已选 ${selectedFilteredCount.value} 门`;
  return `当前筛选内 ${selectedFilteredCount.value} 门，另有 ${hiddenSelectedCount.value} 门隐藏`;
});

const statList = computed<GradeRow[]>(() => {
  const list = filteredList.value;
  if (statMode.value === "all") return list;
  const selected = new Set(selectedCourseKeys.value);
  if (statMode.value === "only") return list.filter((row) => selected.has(courseKey(row)));
  return list.filter((row) => !selected.has(courseKey(row)));
});

const courseOptions = computed(() => {
  const selectable = filteredKeySet.value;
  const selected = new Set(selectedCourseKeys.value);
  return ((parsed.value?.list ?? []) as GradeRow[]).filter((row) => {
    const key = courseKey(row);
    return selectable.has(key) || selected.has(key);
  }).map((row) => {
    const meta = [
      row.semester || "未知学期",
      row.courseCode || "",
      typeof row.credits === "number" ? `${row.credits} 学分` : "",
      row.score ? `成绩 ${row.score}` : "",
    ].filter(Boolean).join(" · ");
    return {
      key: courseKey(row),
      label: `${row.courseName} · ${meta}`,
      name: row.courseName,
      meta,
    };
  });
});

const groupedBySem = computed(() => {
  const m: Record<string, GradeRow[]> = {};
  const list = filteredList.value;
  const semesters = Array.from(new Set(list.map((g) => g.semester))).sort().reverse();
  for (const s of semesters) m[s] = [];
  for (const g of list) (m[g.semester || "未知学期"] ??= []).push(g);
  for (const s of Object.keys(m)) {
    m[s] = sortRowsByPublishedScore(m[s]);
  }
  return m;
});

function semCredits(rows: GradeRow[]) {
  return rows.reduce((s, g) => s + (Number.isFinite(g.credits) ? (g.credits as number) : 0), 0);
}
function semGpa(rows: GradeRow[]) {
  let sum = 0, cred = 0;
  for (const g of rows) {
    if (typeof g.gpa === "number" && typeof g.credits === "number") {
      sum += g.gpa * g.credits; cred += g.credits;
    }
  }
  return cred ? sum / cred : 0;
}

function gpaCredits(rows: GradeRow[]) {
  return rows.reduce((sum, grade) => (
    typeof grade.gpa === "number" && typeof grade.credits === "number"
      ? sum + grade.credits
      : sum
  ), 0);
}

const statGpa = computed(() => {
  return semGpa(statList.value);
});

const statCredits = computed(() => {
  return semCredits(statList.value);
});

const statGpaCredits = computed(() => gpaCredits(statList.value));

function activateSelectionMode() {
  if (selectedCourseKeys.value.length && statMode.value === "all") statMode.value = "only";
  if (!selectedCourseKeys.value.length && statMode.value !== "all") statMode.value = "all";
}

function selectAllCourses() {
  commitSelection(orderedKeys());
  activateSelectionMode();
}

function selectFilteredCourses() {
  commitSelection(orderedKeys(filteredList.value));
  activateSelectionMode();
}

function invertFilteredCourses() {
  const selected = new Set(selectedCourseKeys.value);
  for (const key of filteredKeySet.value) {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
  }
  commitSelection(orderedKeys().filter((key) => selected.has(key)));
  activateSelectionMode();
}

function clearSelection() {
  selectedCourseKeys.value = [];
  statMode.value = "all";
}

function isCourseSelected(row: unknown) {
  return selectedCourseKeys.value.includes(courseKey(row as GradeRow));
}

function toggleCourse(row: unknown, checked: string | number | boolean) {
  const grade = row as GradeRow;
  const key = courseKey(grade);
  const next = new Set(selectedCourseKeys.value);
  if (Boolean(checked)) next.add(key);
  else next.delete(key);
  commitSelection(orderedKeys().filter((item) => next.has(item)));
  activateSelectionMode();
}

function hasPublishedScore(row: GradeRow) {
  return Boolean(String(row.score ?? "").trim());
}

function sortRowsByPublishedScore(rows: GradeRow[]) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => Number(hasPublishedScore(b.row)) - Number(hasPublishedScore(a.row)) || a.index - b.index)
    .map(({ row }) => row);
}

function scoreColor(n: number | null) {
  if (n === null) return "var(--cpu-text)";
  if (n >= 85) return "#16a34a";
  if (n >= 60) return "var(--cpu-text)";
  return "#dc2626";
}
function gpaColor(g?: number) {
  if (g === undefined) return "var(--cpu-text-muted)";
  if (g >= 3.8) return "#16a34a";
  if (g >= 2.0) return "var(--cpu-text)";
  return "#dc2626";
}

function attrTagType(attr?: string): "success" | "warning" | "info" | "primary" | "danger" {
  if (!attr) return "info";
  if (/必修/.test(attr)) return "danger";
  if (/限选|限定选修/.test(attr)) return "warning";
  if (/任选|公选|通识/.test(attr)) return "success";
  if (/选修/.test(attr)) return "primary";
  return "info";
}

async function reload() {
  if (props.source === "ebridge") return;
  if (disposed) return;
  const seq = ++loadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const result = await jwxtApi.grades({ semester: semester.value || undefined }, { silent: true });
    if (!disposed && seq === loadSeq) parsed.value = normalizeParsedGrades(result.parsed);
  } catch (error) {
    if (!disposed && seq === loadSeq) loadError.value = requestMessage(error) || "成绩加载失败，请稍后重试";
  } finally {
    if (!disposed && seq === loadSeq) loading.value = false;
  }
}

function onSemesterChange() {
  if (props.source === "ebridge") return;
  void reload();
}

function requestMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.grades-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
.ctrl-left {
  display: grid;
  grid-template-columns: minmax(130px, 150px) minmax(170px, 220px) minmax(150px, 190px);
  gap: 10px;
  align-items: end;
  min-width: 0;
}
.ctrl-right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.filter-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.filter-field :deep(.el-select),
.filter-field :deep(.el-input) {
  width: 100%;
}
.filter-field :deep(.el-select .el-select__wrapper),
.filter-field :deep(.el-input .el-input__wrapper) {
  min-height: 36px;
}
.lbl { font-size: 12px; color: var(--cpu-text-secondary); }
.stat { font-size: 13px; color: var(--cpu-text-secondary); }
.stat b { color: var(--cpu-primary); font-size: 15px; }
.hint-icon { color: var(--cpu-text-secondary); cursor: help; margin-left: 4px; font-size: 14px; }
code { background: rgba(255,255,255,0.12); padding: 1px 4px; border-radius: 3px; }

.gpa-tool {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-card);
}

.calc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.calc-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.calc-title b {
  color: var(--cpu-text);
  font-size: 14px;
}

.calc-title span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.calc-mode-switch {
  display: inline-grid;
  grid-template-columns: repeat(3, minmax(72px, 1fr));
  gap: 2px;
  flex: 0 0 auto;
  padding: 3px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-subtle);
}

.calc-mode-btn {
  min-width: 0;
  height: 30px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.calc-mode-btn:hover:not(:disabled) {
  color: var(--cpu-primary);
}

.calc-mode-btn.active {
  background: var(--cpu-card);
  color: var(--cpu-primary);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
}

.calc-mode-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--cpu-primary) 45%, transparent);
  outline-offset: 2px;
}

.calc-mode-btn:disabled {
  color: var(--cpu-text-muted);
  cursor: not-allowed;
}

.calc-controls {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.quick-actions :deep(.el-button) {
  margin-left: 0;
}

.course-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.course-option span {
  min-width: 0;
  overflow: hidden;
  color: var(--cpu-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.course-option small {
  flex: 0 0 auto;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.service-reco {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(20, 143, 123, 0.26);
  border-radius: 8px;
  background: rgba(20, 143, 123, 0.08);
}

.service-reco b {
  display: block;
  margin-top: 2px;
  color: var(--cpu-text);
  font-size: 14px;
}

.service-reco p {
  margin: 3px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.reco-kicker {
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 600;
}

.reco-link {
  flex: 0 0 auto;
  border: 1px solid var(--cpu-primary);
  border-radius: 8px;
  padding: 7px 12px;
  color: var(--cpu-primary);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

.reco-link:hover {
  background: var(--cpu-primary);
  color: #fff;
}

.pane-alert {
  margin-bottom: 12px;
}

.pane-alert :deep(.el-alert__content) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
}

.sem-block { margin-bottom: 20px; }
.sem-block:last-child { margin-bottom: 0; }
.sem-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 0 0 8px;
}
.sem-head h3 { margin: 0; font-size: 15px; color: var(--cpu-primary); font-weight: 600; }
.sem-sum { font-size: 12px; color: var(--cpu-text-muted); }
.table-scroll {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.table-scroll :deep(.el-table) {
  min-width: 1060px;
}
.mobile-grade-list { display: none; }

.grade-card {
  position: relative;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-card);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.grade-main {
  min-width: 0;
}

.grade-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.grade-card-top :deep(.el-checkbox) {
  height: auto;
}

.grade-card-top :deep(.el-checkbox__label) {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.course-title {
  color: var(--cpu-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
}

.course-sub,
.grade-detail {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 7px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.score-badges {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.score-badges.single {
  grid-template-columns: 1fr;
}

.score-pill {
  border-radius: 6px;
  background: var(--cpu-surface-subtle);
  padding: 7px 8px;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
}

.grade-tag {
  flex: 0 1 auto;
  max-width: 112px;
}

.grade-type-text {
  display: inline-flex;
  align-items: center;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
}

.assessment-panel { padding: 4px 18px 14px 58px; }
.assessment-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
.assessment-head strong { color: var(--cpu-text); font-size: 13px; }
.assessment-head span { color: var(--cpu-text-muted); font-size: 11px; }
.assessment-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
.assessment-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-subtle);
}
.assessment-item > span { min-width: 0; }
.assessment-item b,
.assessment-item small { display: block; }
.assessment-item b { overflow: hidden; color: var(--cpu-text); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.assessment-item small { margin-top: 3px; color: var(--cpu-text-secondary); font-size: 10px; }
.assessment-item > strong { flex: 0 0 auto; color: var(--cpu-primary); font-size: 14px; }
.assessment-item > strong.pending { color: var(--cpu-text-muted); font-size: 11px; font-weight: 500; }
.mobile-assessments { margin-top: 10px; border-top: 1px dashed var(--cpu-border-soft); padding-top: 9px; }
.mobile-assessments summary { color: var(--cpu-primary); font-size: 12px; font-weight: 600; cursor: pointer; }
.mobile-assessments .assessment-item { margin-top: 7px; }

@media (max-width: 760px) {
  .ctrl-bar {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .ctrl-left {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ctrl-left .wide {
    grid-column: span 2;
  }

  .ctrl-right {
    width: 100%;
    gap: 6px;
    line-height: 1.6;
    flex-wrap: wrap;
  }

  .stat {
    display: inline-flex;
    align-items: center;
    padding: 6px 10px;
    border-radius: 999px;
    background: var(--cpu-surface-subtle);
    white-space: nowrap;
  }

  .calc-head,
  .calc-controls {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .course-picker {
    display: none;
  }

  .calc-head {
    flex-direction: column;
  }

  .calc-mode-switch {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
  }

  .calc-mode-btn {
    height: 34px;
    padding-inline: 4px;
    font-size: 13px;
  }

  .quick-actions {
    justify-content: flex-start;
  }

  .quick-actions :deep(.el-button) {
    flex: 1 1 calc(50% - 4px);
    min-width: 0;
  }

  .service-reco {
    padding: 14px;
    align-items: stretch;
    flex-direction: column;
    border-radius: 12px;
  }

  .reco-link {
    text-align: center;
  }

  .sem-head {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .table-scroll { display: none; }

  .mobile-grade-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
}

@media (max-width: 430px) {
  .ctrl-left {
    grid-template-columns: 1fr;
  }

  .ctrl-left .wide {
    grid-column: auto;
  }
}

@media (max-width: 380px) {
  .score-badges {
    grid-template-columns: 1fr;
  }
  .grade-tag {
    max-width: none;
  }
}
</style>
