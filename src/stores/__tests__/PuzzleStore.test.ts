import { describe, it, expect, beforeEach } from "@jest/globals";
import { getTestPuzzleConfigString, getTestPuzzleConfigObject } from "../../common/utils.ts";
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
    const config = getTestPuzzleConfigObject();
    const puzzle = PuzzleStore.addPuzzle(config);
    expect(puzzle).toBeDefined();
    expect(puzzle.id).toBeDefined();
  });

  it("should return the correct puzzle count", () => {
    const config = getTestPuzzleConfigObject();
    PuzzleStore.addPuzzle(config);
    PuzzleStore.addPuzzle(config);
    PuzzleStore.addPuzzle(config);
    expect(PuzzleStore.countPuzzles()).toBe(3);
  });

  it("should get a puzzle by ID", () => {
    const config = getTestPuzzleConfigObject();
    const puzzle1 = PuzzleStore.addPuzzle(config);
    const puzzle2 = PuzzleStore.addPuzzle(config);
    expect(PuzzleStore.getPuzzle(puzzle1.id)).toEqual(puzzle1);
    expect(PuzzleStore.getPuzzle(puzzle2.id)).toEqual(puzzle2);
  });

  it("should update a puzzle", () => {
    const config = getTestPuzzleConfigObject();
    const puzzle = PuzzleStore.addPuzzle(config);
    puzzle.performAction("Open");
    PuzzleStore.updatePuzzle(puzzle);
    expect(puzzle.getCurrentState()?.name).toEqual("Opened");
    expect(PuzzleStore.getPuzzle(puzzle.id)).toEqual(puzzle);
  });

  it("should clear all puzzles", () => {
    const config = getTestPuzzleConfigObject();
    PuzzleStore.addPuzzle(config);
    PuzzleStore.addPuzzle(config);
    PuzzleStore.addPuzzle(config);
    PuzzleStore.clearPuzzles();
    expect(PuzzleStore.countPuzzles()).toBe(0);
  });
});
