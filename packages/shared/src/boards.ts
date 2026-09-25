import { z } from "zod";
import {
  boardSizeSchema,
  labelModeSchema,
  boardNameSchema,
  cellTextSchema,
  columnLabelSchema,
} from "./schemas";
import type { BoardSize, LabelMode } from "./constants";

export interface LabelConfigError {
  path: "label_mode" | "column_labels";
  message: string;
}

export function validateLabelConfig(
  size: BoardSize,
  labelMode: LabelMode,
  columnLabels?: string[]
): LabelConfigError | null {
  if (labelMode === "bingo" && size !== 5) {
    return { path: "label_mode", message: 'label_mode "bingo" ist nur bei size=5 erlaubt' };
  }
  if (labelMode === "custom") {
    if (!columnLabels || columnLabels.length !== size) {
      return {
        path: "column_labels",
        message: `column_labels muss genau ${size} Einträge enthalten`,
      };
    }
  } else if (columnLabels !== undefined) {
    return {
      path: "column_labels",
      message: 'column_labels ist nur bei label_mode="custom" erlaubt',
    };
  }
  return null;
}

export const createBoardSchema = z
  .object({
    name: boardNameSchema,
    size: boardSizeSchema,
    label_mode: labelModeSchema,
    column_labels: z.array(columnLabelSchema).optional(),
  })
  .superRefine((data, ctx) => {
    const error = validateLabelConfig(data.size, data.label_mode, data.column_labels);
    if (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: error.message, path: [error.path] });
    }
  });

export type CreateBoardInput = z.infer<typeof createBoardSchema>;

export const patchBoardSchema = z.object({
  name: boardNameSchema.optional(),
  label_mode: labelModeSchema.optional(),
  column_labels: z.array(columnLabelSchema).optional(),
  cells: z
    .array(
      z.object({
        row: z.number().int().min(0),
        col: z.number().int().min(0),
        text: cellTextSchema,
      })
    )
    .optional(),
});

export type PatchBoardInput = z.infer<typeof patchBoardSchema>;
