import { describe, it, expect } from "vitest";
import { toPublicBoard } from "./public-board";

describe("toPublicBoard", () => {
  const fullBoard = {
    id: "board-uuid",
    userId: "user-uuid",
    name: "Mein geheimes Board",
    size: 3,
    labelMode: "letters",
    columnLabels: null as string[] | null,
    overlayToken: "geheimer-token",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    cells: [
      {
        boardId: "board-uuid",
        row: 0,
        col: 0,
        text: "Zelle A",
        checked: true,
        checkedAt: new Date("2024-01-03"),
      },
      {
        boardId: "board-uuid",
        row: 0,
        col: 1,
        text: "",
        checked: false,
        checkedAt: null,
      },
    ],
  };

  it("enthält size, labelMode, columnLabels und cells", () => {
    const result = toPublicBoard(fullBoard);

    expect(result.size).toBe(3);
    expect(result.labelMode).toBe("letters");
    expect(result.columnLabels).toBeNull();
    expect(result.cells).toEqual([
      { row: 0, col: 0, text: "Zelle A", checked: true },
      { row: 0, col: 1, text: "", checked: false },
    ]);
  });

  it("enthält keine internen IDs, keine user_id, keinen Namen und keine Zeitstempel", () => {
    const result = toPublicBoard(fullBoard) as unknown as Record<string, unknown>;

    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("overlayToken");
    expect(result).not.toHaveProperty("name");
    expect(result).not.toHaveProperty("createdAt");
    expect(result).not.toHaveProperty("updatedAt");
  });

  it("enthält pro Zelle keine boardId und kein checkedAt", () => {
    const result = toPublicBoard(fullBoard);
    const cell = result.cells[0] as unknown as Record<string, unknown>;

    expect(cell).not.toHaveProperty("boardId");
    expect(cell).not.toHaveProperty("checkedAt");
  });

  it("gibt columnLabels unverändert weiter, wenn gesetzt", () => {
    const result = toPublicBoard({ ...fullBoard, columnLabels: ["WIN", "GG", "GLHF"] });

    expect(result.columnLabels).toEqual(["WIN", "GG", "GLHF"]);
  });
});
