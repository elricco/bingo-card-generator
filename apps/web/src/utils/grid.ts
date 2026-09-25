export type GridCell =
  | { kind: "empty" }
  | { kind: "label"; text: string }
  | { kind: "cell"; row: number; col: number };

export function buildGridCells(
  size: number,
  columnLabels: string[],
  rowLabels: string[]
): GridCell[] {
  const cells: GridCell[] = [];
  const totalCols = size + 2;
  const totalRows = size + 2;

  for (let gridRow = 0; gridRow < totalRows; gridRow++) {
    for (let gridCol = 0; gridCol < totalCols; gridCol++) {
      const isTopOrBottomRow = gridRow === 0 || gridRow === totalRows - 1;
      const isLeftOrRightCol = gridCol === 0 || gridCol === totalCols - 1;

      if (isTopOrBottomRow && isLeftOrRightCol) {
        cells.push({ kind: "empty" });
      } else if (isTopOrBottomRow) {
        cells.push({ kind: "label", text: columnLabels[gridCol - 1] ?? "" });
      } else if (isLeftOrRightCol) {
        cells.push({ kind: "label", text: rowLabels[gridRow - 1] ?? "" });
      } else {
        cells.push({ kind: "cell", row: gridRow - 1, col: gridCol - 1 });
      }
    }
  }

  return cells;
}
