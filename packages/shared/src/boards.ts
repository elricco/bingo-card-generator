import { z } from "zod";
import { boardSizeSchema, labelModeSchema, boardNameSchema, columnLabelSchema } from "./schemas";

export const createBoardSchema = z
  .object({
    name: boardNameSchema,
    size: boardSizeSchema,
    label_mode: labelModeSchema,
    column_labels: z.array(columnLabelSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.label_mode === "bingo" && data.size !== 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'label_mode "bingo" ist nur bei size=5 erlaubt',
        path: ["label_mode"],
      });
    }
    if (data.label_mode === "custom") {
      if (!data.column_labels || data.column_labels.length !== data.size) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `column_labels muss genau ${data.size} Einträge enthalten`,
          path: ["column_labels"],
        });
      }
    } else if (data.column_labels !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'column_labels ist nur bei label_mode="custom" erlaubt',
        path: ["column_labels"],
      });
    }
  });

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
