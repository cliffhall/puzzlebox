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
   * Update a puzzle
   * @param puzzle
   */
  static updatePuzzle(puzzle: Puzzle): boolean {
    let success = false;
    if (this.puzzles.has(puzzle.id)) {
      this.puzzles.set(puzzle.id, puzzle);
      success = true;
    }
    return success;
  }

  /**
   * Get a puzzle by ID
   * @param puzzleId
   */
  static getPuzzle(puzzleId: string): Puzzle | undefined {
    return this.puzzles.get(puzzleId);
  }

  /**
   * Get a list of registered puzzle ids
   */
  static getPuzzleList():string[] {
    return Array.from(this.puzzles.keys());
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
