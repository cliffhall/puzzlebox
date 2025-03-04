import { describe, it, expect } from "@jest/globals";
import { getTestPuzzleConfigObject } from "../utils.ts";
import { Puzzle } from "../Puzzle.ts";

/**
 * Test Puzzle Entity
 */
describe("Puzzle", () => {
  it("should construct a puzzle with id alone", () => {
    const PUZZLE_ID = "puzzle-123";
    const puzzle = new Puzzle(PUZZLE_ID);
    expect(puzzle).toBeDefined();
    expect(puzzle.id).toEqual(PUZZLE_ID);
  });

  it("should construct a puzzle with id and config", () => {
    const PUZZLE_ID = "puzzle-123";
    const PUZZLE_CONFIG = getTestPuzzleConfigObject();
    const puzzle = new Puzzle(PUZZLE_ID, PUZZLE_CONFIG);
    expect(puzzle).toBeDefined();
    expect(puzzle.id).toEqual(PUZZLE_ID);
  });

  it("should return the initial state as current after construction", () => {
    const PUZZLE_ID = "puzzle-123";
    const PUZZLE_CONFIG = getTestPuzzleConfigObject();
    const STATE_NAME = "Closed";
    const puzzle = new Puzzle(PUZZLE_ID, PUZZLE_CONFIG);
    const state = puzzle.getCurrentState();
    expect(state).toBeDefined();
    expect(state?.name).toEqual(STATE_NAME);
    expect(state?.actions).toBeDefined();
    expect(state?.actions?.size).toBe(2);
  });

  it("should get a state by name", () => {
    const PUZZLE_ID = "puzzle-123";
    const PUZZLE_CONFIG = getTestPuzzleConfigObject();
    const STATE_NAME = "Opened";
    const puzzle = new Puzzle(PUZZLE_ID, PUZZLE_CONFIG);
    const state = puzzle.getState(STATE_NAME);
    expect(state).toBeDefined();
    expect(state?.name).toEqual(STATE_NAME);
    expect(state?.actions).toBeDefined();
    expect(state?.actions?.size).toBe(1);
  });

  it("should add an action to a state", () => {
    const PUZZLE_ID = "puzzle-123";
    const PUZZLE_CONFIG = getTestPuzzleConfigObject();
    const STATE_NAME = "Closed";
    const ACTION = { name: "Knock", targetState: "Closed" };
    const puzzle = new Puzzle(PUZZLE_ID, PUZZLE_CONFIG);
    const state = puzzle.getState(STATE_NAME);
    puzzle.addAction(STATE_NAME, ACTION);
    expect(state?.actions?.size).toBe(3);
  });

  it("should get the list of valid action names for a state", () => {
    const PUZZLE_ID = "puzzle-123";
    const PUZZLE_CONFIG = getTestPuzzleConfigObject();
    const STATE_NAME = "Closed";
    const puzzle = new Puzzle(PUZZLE_ID, PUZZLE_CONFIG);
    const actions = puzzle.getActions(STATE_NAME);
    expect(actions?.length).toEqual(2);
    expect(actions).toEqual(["Open", "Lock"]);
  });

  it("should change state when performing a valid action", async () => {
    const PUZZLE_ID = "puzzle-123";
    const PUZZLE_CONFIG = getTestPuzzleConfigObject();
    const ACTION_NAME = "Open";
    const TARGET_STATE = "Opened";
    const puzzle = new Puzzle(PUZZLE_ID, PUZZLE_CONFIG);
    const success = await puzzle.performAction(ACTION_NAME);
    expect(success).toBe(true);
    expect(puzzle.getCurrentState()?.name).toEqual(TARGET_STATE);
  });
});
