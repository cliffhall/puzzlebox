import { describe, it, expect, beforeEach } from "@jest/globals";
import { addPuzzle } from "../puzzles.ts";
import PuzzleStore from "../../stores/PuzzleStore.ts";
import {getTestPuzzleConfig} from "../../common/utils.ts";


/**
 * Test addPuzzle
 */
describe("addPuzzle", () => {
  beforeEach(() => {
    PuzzleStore.clearPuzzles();
  });

  it("should register a new puzzle with a unique ID", () => {
    const testPuzzle = getTestPuzzleConfig();
    const result = addPuzzle(testPuzzle);
    expect(result).toHaveProperty("puzzleId");
    expect(typeof result.puzzleId).toBe("string");
    //expect(Puzzle.getAgent(result.agentId)).not.toBeNull();
  });

  it("should increment the agent count", () => {
    const testPuzzle = getTestPuzzleConfig();
    const initialCount = PuzzleStore.countPuzzles();
    addPuzzle(testPuzzle);
    expect(PuzzleStore.countPuzzles()).toBe(initialCount + 1);
  });
});
