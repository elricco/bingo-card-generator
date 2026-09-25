export interface PublicCell {
  row: number;
  col: number;
  text: string;
  checked: boolean;
}

export interface PublicBoard {
  size: number;
  labelMode: string;
  columnLabels: string[] | null;
  cells: PublicCell[];
}

interface FullBoardLike {
  size: number;
  labelMode: string;
  columnLabels: string[] | null;
  cells: Array<{ row: number; col: number; text: string; checked: boolean }>;
}

export function toPublicBoard(board: FullBoardLike): PublicBoard {
  return {
    size: board.size,
    labelMode: board.labelMode,
    columnLabels: board.columnLabels,
    cells: board.cells.map((cell) => ({
      row: cell.row,
      col: cell.col,
      text: cell.text,
      checked: cell.checked,
    })),
  };
}
