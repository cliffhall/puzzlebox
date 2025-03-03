import { describe, it, expect, beforeEach } from "@jest/globals";
import { addPuzzle, getPuzzleSnapshot } from "../puzzles.ts";
import PuzzleStore from "../../stores/PuzzleStore.ts";
import { getTestPuzzleConfigString } from "../../common/utils.ts";

/**
 * Test addPuzzle
 */
describe("addPuzzle", () => {
  beforeEach(() => {
    PuzzleStore.clearPuzzles();
  });

  it("should register a new puzzle with a unique ID", () => {
    const testPuzzle:string = getTestPuzzleConfigString();
    const result = addPuzzle(testPuzzle);
    expect(result).toHaveProperty("puzzleId");
    expect(typeof result.puzzleId).toBe("string");
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

});
