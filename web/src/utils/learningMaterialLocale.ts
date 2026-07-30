const optionEnglish: Record<string, string> = {
  Y1S1: "Year 1 · Semester 1",
  Y1S2: "Year 1 · Semester 2",
  Y2S1: "Year 2 · Semester 1",
  Y2S2: "Year 2 · Semester 2",
  Y3S1: "Year 3 · Semester 1",
  Y3S2: "Year 3 · Semester 2",
  Y4S1: "Year 4 · Semester 1",
  Y4S2: "Year 4 · Semester 2",
  ZIP: "Archive / ZIP",
  TXT: "Text / Markdown",
  IMAGE: "Images",
  OTHER: "Other",
  "zh-CN": "Chinese",
  en: "English",
  bilingual: "Chinese & English",
  other: "Other",
  original: "Original work",
  authorized: "Licensed / authorized",
  public_compilation: "Compiled from public sources",
  usage: "How to use the material",
  file_unavailable: "File cannot be opened",
  missing_content: "Missing content",
  not_as_described: "Not as described",
  update_request: "Request an update",
  duplicate_purchase: "Duplicate purchase",
  copyright: "Copyright or policy issue",
};

const defaultTypeEnglish: Record<string, string> = {
  课程笔记: "Course notes",
  复习提纲: "Revision outline",
  知识点总结: "Concept summary",
  自编习题与解析: "Original exercises & solutions",
  实验指南: "Lab guide",
  项目学习指南: "Project study guide",
  教材补充资料: "Textbook supplements",
  思维导图与速查表: "Mind maps & quick reference",
  课程资源包: "Course resource pack",
  其他: "Other",
};

export function learningMaterialOptionLabel(
  option: { value: string; label: string } | undefined,
  isEnglish: boolean,
) {
  if (!option || !isEnglish) return option?.label || "";
  return optionEnglish[option.value] || option.label;
}

export function learningMaterialTypeLabel(name: string | null | undefined, isEnglish: boolean) {
  if (!name || !isEnglish) return name || "";
  return defaultTypeEnglish[name] || name;
}
