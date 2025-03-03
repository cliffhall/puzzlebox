import { describe, it, expect, beforeEach } from "@jest/globals";
import { addPuzzle, getPuzzleSnapshot, performAction } from "../puzzles.ts";
import PuzzleStore from "../../stores/PuzzleStore.ts";
import { getTestPuzzleConfigString } from "../../common/utils.ts";

/**
 * Test addPuzzle
 */
describe("addPuzzle", () => {
  beforeEach(() => {
    PuzzleStore.clearPuzzles();
  });

  it("should return error if config is not valid", () => {
    const testPuzzle:string = "Not a valid puzzle";
    const result = addPuzzle(testPuzzle);
    expect(result).not.toHaveProperty("puzzleId");
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("error");
    expect(result.success).toBe(false);
    expect(result.error).toContain("is not valid JSON");
  });

  it("should register a new puzzle with a unique ID", () => {
    const testPuzzle:string = getTestPuzzleConfigString();
    const result = addPuzzle(testPuzzle);
    expect(result).toHaveProperty("puzzleId");
    expect(result).toHaveProperty("success");
    expect(result).not.toHaveProperty("error");
    expect(result.success).toBe(true);
    expect(result.puzzleId).toContain("puzzle-");
  });

  it("should increment the puzzle count", () => {
    const testPuzzle = getTestPuzzleConfigString();
    const initialCount = PuzzleStore.countPuzzles();
    addPuzzle(testPuzzle);
    expect(PuzzleStore.countPuzzles()).toBe(initialCount + 1);
  });

  it("should get a snapshot of a puzzle by ID", () => {
    const testPuzzle = getTestPuzzleConfigString();
    const result =  addPuzzle(testPuzzle);
    expect(result).toHaveProperty("puzzleId");
    const id = result.puzzleId || "";
    const snapshot = getPuzzleSnapshot(id);
    expect(snapshot).toHaveProperty("currentState");
    expect(snapshot).toHaveProperty("availableActions");
    expect(snapshot.currentState).toEqual("Closed");
    expect(snapshot.availableActions).toEqual(["Open", "Lock"]);

  });

  it("should perform an action on a puzzle", async () => {
    const testPuzzle = getTestPuzzleConfigString();
    const result1 =  addPuzzle(testPuzzle);
    const id = result1.puzzleId || "";
    const ACTION_NAME = "Open";
    const result2 = await performAction(id, ACTION_NAME);
    expect(result2.success).toBe(true);
    const snapshot = getPuzzleSnapshot(id);
    expect(snapshot.currentState).toEqual("Opened");
  });

});
