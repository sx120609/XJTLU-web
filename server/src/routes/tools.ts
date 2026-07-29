import { Router } from "express";
import { ensureSystemQuestionnaires } from "../services/questionnaires";
import {
  createFileCollectSchema,
  createFileCollectTemplateSchema,
  createGradeCheckSchema,
  createQuestionnaireSchema,
  patchFileCollectSchema,
  patchGradeCheckSchema,
  patchQuestionnaireSchema,
  questionnaireResponseSchema,
} from "../services/toolSchemas";
import { toolCoreRouter } from "./tools/core";
import { toolFileCollectionsRouter } from "./tools/fileCollections";
import { toolGradesRouter } from "./tools/grades";
import { toolQuestionnairesRouter } from "./tools/questionnaires";

export const toolsRouter = Router();

export {
  createFileCollectSchema,
  createFileCollectTemplateSchema,
  createGradeCheckSchema,
  createQuestionnaireSchema,
  patchFileCollectSchema,
  patchGradeCheckSchema,
  patchQuestionnaireSchema,
  questionnaireResponseSchema as responseSchema,
};

toolsRouter.use(async (_req, _res, next) => {
  try {
    await ensureSystemQuestionnaires();
    next();
  } catch (error) {
    next(error);
  }
});

toolsRouter.use(toolCoreRouter);
toolsRouter.use(toolGradesRouter);
toolsRouter.use(toolQuestionnairesRouter);
toolsRouter.use(toolFileCollectionsRouter);
