import { Puzzle } from "../common/Puzzle.ts";
import { createId } from "../common/utils.ts";

class PuzzleStore {
  // Singleton Puzzle Store
  protected static puzzles: Map<string, Puzzle> = new Map<string, Puzzle>();

  /**
   * Add a puzzle
   */
  static addPuzzle(puzzleConfig: object): Puzzle {
    const puzzleId = createId("puzzle");
    const puzzle: Puzzle = new Puzzle(puzzleId, puzzleConfig);
    this.puzzles.set(puzzle.id, puzzle);
    return puzzle;
  }

  /**
   * Get a puzzle by ID
   * @param puzzleId
   */
  static getPuzzle(puzzleId: string): Puzzle | undefined {
    return this.puzzles.get(puzzleId);
  }

  /**
   * Clear all puzzles
   */
  static clearPuzzles() {
    PuzzleStore.puzzles = new Map<string, Puzzle>();
  }

  /**
   * Get a count of all puzzles
   * @returns number
   */
  static countPuzzles(): number {
    return PuzzleStore.puzzles.size;
  }
}

export default PuzzleStore;
