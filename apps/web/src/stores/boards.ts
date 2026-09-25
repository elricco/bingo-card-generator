import { defineStore } from "pinia";

export interface Board {
  id: string;
  name: string;
  size: number;
  labelMode?: string;
  overlayToken?: string;
  checkedCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateBoardInput {
  name: string;
  size: number;
  label_mode: string;
  column_labels?: string[];
}

export interface CellData {
  row: number;
  col: number;
  text: string;
  checked: boolean;
}

export interface BoardDetail {
  id: string;
  name: string;
  size: number;
  labelMode: string;
  columnLabels: string[] | null;
  overlayToken: string;
  createdAt: string;
  updatedAt: string;
  cells: CellData[];
}

export interface PatchBoardInput {
  name?: string;
  label_mode?: string;
  column_labels?: string[];
  cells?: Array<{ row: number; col: number; text: string }>;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3001";

export const useBoardsStore = defineStore("boards", {
  state: () => ({
    boards: [] as Board[],
    isLoading: false,
  }),
  actions: {
    async fetchBoards() {
      this.isLoading = true;
      try {
        const response = await fetch(`${API_BASE_URL}/api/boards`, {
          credentials: "include",
        });
        this.boards = response.ok ? ((await response.json()) as Board[]) : [];
      } finally {
        this.isLoading = false;
      }
    },
    async createBoard(input: CreateBoardInput): Promise<Board> {
      const response = await fetch(`${API_BASE_URL}/api/boards`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          typeof body?.error === "string" ? body.error : "Board konnte nicht erstellt werden"
        );
      }
      return (await response.json()) as Board;
    },
    async deleteBoard(id: string) {
      const response = await fetch(`${API_BASE_URL}/api/boards/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok && response.status !== 404) {
        throw new Error("Board konnte nicht gelöscht werden");
      }
      this.boards = this.boards.filter((board) => board.id !== id);
    },
    async fetchBoard(id: string): Promise<BoardDetail | null> {
      const response = await fetch(`${API_BASE_URL}/api/boards/${id}`, {
        credentials: "include",
      });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as BoardDetail;
    },
    async updateBoard(id: string, input: PatchBoardInput): Promise<BoardDetail> {
      const response = await fetch(`${API_BASE_URL}/api/boards/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          typeof body?.error === "string" ? body.error : "Board konnte nicht gespeichert werden"
        );
      }
      return (await response.json()) as BoardDetail;
    },
    async setCellChecked(
      boardId: string,
      row: number,
      col: number,
      checked: boolean
    ): Promise<void> {
      const response = await fetch(
        `${API_BASE_URL}/api/boards/${boardId}/cells/${row}/${col}/checked`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checked }),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          typeof body?.error === "string" ? body.error : "Häkchen konnte nicht gespeichert werden"
        );
      }
    },
  },
});
