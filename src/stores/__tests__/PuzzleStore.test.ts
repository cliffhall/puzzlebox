import { describe, it, expect, beforeEach } from "@jest/globals";
import {getTestPuzzleConfig} from "../../common/utils.ts";
import PuzzleStore from "../PuzzleStore.ts";

/**
 * Test PuzzleStore
 */
describe("PuzzleStore", () => {
  beforeEach(() => {
    // Clear existing puzzles before each test
    PuzzleStore.clearPuzzles();
  });

  it("should register a puzzle with a unique id", () => {
    const config = JSON.parse(getTestPuzzleConfig())
    const puzzle = PuzzleStore.addPuzzle(config);
    expect(puzzle).toBeDefined();
    expect(puzzle.id).toBeDefined();
  });

  it("should return the correct puzzle count", () => {
    const config = JSON.parse(getTestPuzzleConfig())
    PuzzleStore.addPuzzle(config);
    PuzzleStore.addPuzzle(config);
    PuzzleStore.addPuzzle(config);
    expect(PuzzleStore.countPuzzles()).toBe(3);
  });

});
