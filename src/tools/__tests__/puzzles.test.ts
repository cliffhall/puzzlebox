import { addPuzzle, getPuzzleSnapshot, performAction } from "../puzzles.ts";
import { getTestPuzzleConfig } from "../../common/utils.ts";
import { describe, it, expect, beforeEach } from "@jest/globals";
import { PuzzleConfig } from "../../common/schemas.js";
import PuzzleStore from "../../stores/PuzzleStore.ts";

/**
 * Test addPuzzle
 */
describe("addPuzzle", () => {
  beforeEach(() => {
    PuzzleStore.clearPuzzles();
  });

  it("should register a new puzzle with a unique ID", () => {
    const testPuzzle: PuzzleConfig = getTestPuzzleConfig();
    const result = addPuzzle(testPuzzle);
    expect(result).toHaveProperty("puzzleId");
    expect(result).toHaveProperty("success");
    expect(result).not.toHaveProperty("error");
    expect(result.success).toBe(true);
    expect(result.puzzleId).toContain("puzzle-");
  });

  it("should increment the puzzle count", () => {
    const testPuzzle = getTestPuzzleConfig();
    const initialCount = PuzzleStore.countPuzzles();
    addPuzzle(testPuzzle);
    expect(PuzzleStore.countPuzzles()).toBe(initialCount + 1);
  });

  it("should get a snapshot of a puzzle by ID", () => {
    const testPuzzle = getTestPuzzleConfig();
    const result = addPuzzle(testPuzzle);
    expect(result).toHaveProperty("puzzleId");
    const id = result.puzzleId || "";
    const snapshot = getPuzzleSnapshot(id);
    expect(snapshot).toHaveProperty("currentState");
    expect(snapshot).toHaveProperty("availableActions");
    expect(snapshot.currentState).toEqual("Closed");
    expect(snapshot.availableActions).toEqual(["Open", "Lock"]);
  });

  it("should perform an action on a puzzle", async () => {
    const testPuzzle = getTestPuzzleConfig();
    const result1 = addPuzzle(testPuzzle);
    const id = result1.puzzleId || "";
    const ACTION_NAME = "Open";
    const result2 = await performAction(id, ACTION_NAME);
    expect(result2.success).toBe(true);
    const snapshot = getPuzzleSnapshot(id);
    expect(snapshot.currentState).toEqual("Opened");
  });
});
