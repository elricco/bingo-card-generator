ALTER TABLE "boards" ADD CONSTRAINT "boards_size_check" CHECK ("size" IN (3, 5, 7, 9));
--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_label_mode_check" CHECK ("label_mode" IN ('letters', 'bingo', 'custom'));
