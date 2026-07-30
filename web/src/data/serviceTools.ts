import { ChatDotRound, DataLine, Document, DocumentChecked, FolderOpened, Tools } from "@element-plus/icons-vue";
import type { Component } from "vue";

export type ServiceToolStatus = "ready" | "planned";

export interface ServiceTool {
  slug: string;
  name: string;
  nameEn: string;
  summary: string;
  summaryEn: string;
  description: string;
  descriptionEn: string;
  icon: string;
  status: ServiceToolStatus;
  category: string;
  categoryEn: string;
  routeName: string;
  componentKey: "feedback" | "questionnaire" | "grade_check" | "file_collect" | "pdf_tools";
  accent: string;
  iconComponent: Component;
}

export const serviceTools: ServiceTool[] = [
  {
    slug: "feedback",
    name: "需求反馈",
    nameEn: "Feedback",
    summary: "先把校园服务里的工具想法集中收集起来",
    summaryEn: "Share ideas, suggestions, and issues for campus tools",
    description: "用于承接后续工具需求、使用建议和问题反馈，之后可以替换为完整的在线问卷能力。",
    descriptionEn: "Collect requests, usage suggestions, and issue reports for future campus tools.",
    icon: "💬",
    status: "ready",
    category: "反馈",
    categoryEn: "Feedback",
    routeName: "service-tool-detail",
    componentKey: "feedback",
    accent: "#168776",
    iconComponent: ChatDotRound,
  },
  {
    slug: "pdf_tools",
    name: "PDF 工具",
    nameEn: "PDF Tools",
    summary: "合并、拆分、压缩、转图片和提取文字",
    summaryEn: "Merge, split, compress, convert to images, and extract text",
    description: "浏览器本地处理常见 PDF 操作，适合整理作业、通知和课程材料。",
    descriptionEn: "Handle common PDF tasks locally in your browser for assignments, notices, and course materials.",
    icon: "📄",
    status: "ready",
    category: "文件",
    categoryEn: "Files",
    routeName: "service-tool-detail",
    componentKey: "pdf_tools",
    accent: "#0f766e",
    iconComponent: Document,
  },
  {
    slug: "questionnaire",
    name: "在线问卷",
    nameEn: "Questionnaires",
    summary: "预留问卷发布、填写与结果统计入口",
    summaryEn: "Create, complete, and review online questionnaires",
    description: "后续可扩展问卷编辑器、链接分享、匿名填写和数据导出等能力。",
    descriptionEn: "Create questionnaires, share links, collect anonymous responses, and export results.",
    icon: "📝",
    status: "ready",
    category: "表单",
    categoryEn: "Forms",
    routeName: "service-tool-detail",
    componentKey: "questionnaire",
    accent: "#d97706",
    iconComponent: DocumentChecked,
  },
  {
    slug: "grade_check",
    name: "成绩表核对",
    nameEn: "Grade Sheet Check",
    summary: "上传 Excel 后按学号开放个人查询",
    summaryEn: "Upload an Excel sheet for private student-ID-based lookup",
    description: "发起者上传带有学号字段的成绩或信息表，学生登录后只能查看自己学号对应的记录。",
    descriptionEn: "Upload a grade or information sheet with student IDs. Signed-in students can only view their own record.",
    icon: "📊",
    status: "ready",
    category: "查询",
    categoryEn: "Lookup",
    routeName: "service-tool-detail",
    componentKey: "grade_check",
    accent: "#2563eb",
    iconComponent: DataLine,
  },
  {
    slug: "file_collect",
    name: "文件收集",
    nameEn: "File Collection",
    summary: "集中收作业、材料和照片",
    summaryEn: "Collect assignments, documents, and photos in one place",
    description: "发起者创建收集任务并分享提交链接，系统负责字段校验、文件命名、提交统计和批量下载。",
    descriptionEn: "Create a collection task and share its submission link. The system validates fields, names files, tracks submissions, and supports bulk download.",
    icon: "📁",
    status: "ready",
    category: "收集",
    categoryEn: "Collection",
    routeName: "service-tool-detail",
    componentKey: "file_collect",
    accent: "#0f766e",
    iconComponent: FolderOpened,
  },
];

export const toolHubIntro = {
  title: "校园工具",
  titleEn: "Campus Tools",
  subtitle: "一些轻量入口会集中放在这里，适合处理反馈、表单和临时查询这类小任务。",
  subtitleEn: "Lightweight tools for feedback, forms, file handling, and quick lookups.",
  iconComponent: Tools,
};

export function findServiceTool(slug: string) {
  return serviceTools.find((tool) => tool.slug === slug);
}
