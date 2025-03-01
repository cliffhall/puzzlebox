import { Puzzle } from "../../common/puzzle.ts";
import { createId } from "../../common/utils.ts";

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
   * Get a count of all puzzles
   * @returns number
   */
  static countPuzzles(): number {
    return PuzzleStore.puzzles.size;
  }
}

export default PuzzleStore;
