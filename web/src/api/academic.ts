import { request, type RequestOptions } from "./request";
import type { CalendarResult, ScheduleResult } from "@/views/schedule/types";

export interface AcademicStatus {
  active: boolean;
  connecting?: boolean;
  connectionFailed?: boolean;
  connectionError?: string;
  username?: string;
  displayName?: string;
}

export interface AcademicGrade {
  academicYear: string;
  period: string;
  moduleCode: string;
  moduleTitle: string;
  credit: string;
  mark: string;
  gpa: number | null;
  letterGrade: string;
  grade: string;
  attempt: string;
  additionalLearning: boolean;
  components: AcademicAssessment[];
}

export interface AcademicAssessment {
  title: string;
  type: string;
  percentage: string;
  mark: string;
}

export interface AcademicExam {
  moduleCode: string;
  moduleTitle: string;
  date: string;
  day: string;
  admissionTime: string;
  startTime: string;
  duration: string;
  room: string;
  seat: string;
  area: string;
  entrance: string;
}

export interface AcademicOverview {
  student: { id: string; name: string };
  academicYear: string;
  grades: AcademicGrade[];
  gpaSummary: { gpa: number | null; credits: number; courseCount: number };
  exams: AcademicExam[];
  updatedAt: string;
}

export interface AcademicSchedule {
  available?: boolean;
  message?: string;
  parsed: ScheduleResult;
  calendar: CalendarResult;
  source: {
    fetchedAt: string;
    semesterLabel: string;
    activityCount: number;
  };
}

export type AcademicRequestOptions = RequestOptions & { refresh?: boolean };

function academicGet<T>(path: string, options?: AcademicRequestOptions) {
  const { refresh = false, ...requestOptions } = options ?? {};
  return request.get<T>(path, refresh ? { refresh: "1" } : undefined, requestOptions);
}

export const academicApi = {
  status: (options?: AcademicRequestOptions) => academicGet<AcademicStatus>("/academic/status", options),
  overview: (options?: AcademicRequestOptions) => academicGet<AcademicOverview>("/academic/overview", options),
  schedule: (options?: AcademicRequestOptions) => academicGet<AcademicSchedule>("/academic/schedule", options),
};
