import PuzzleStore from "../stores/PuzzleStore.ts";
import { Puzzle } from "../../common/puzzle.ts";

interface RegisterPuzzleResponse {
  puzzle: Puzzle;
}

/**
 * Add a puzzle to the puzzle box
 */
export function addPuzzle(puzzleConfig: object): RegisterPuzzleResponse {
  return {
    puzzle: PuzzleStore.addPuzzle(puzzleConfig)
  };
}


/*
// Example usage:
const example = {
  initial: "Closed",
  states: {
    "Closed: {
      name: "Closed",
      actions: {
        "Open: { action: "Open", targetState: "Opened" },
        "Lock": { action: "Lock", targetState: "Locked" },
      },
      exitingGuard: "leavingClosedState",
    },
   "Opened:  {
      name: "Opened",
      actions: {"Close:" { action: "Close", targetState: "Closed" }},
      enteringGuard: "enteringClosedState"
    },
    "Locked: {
      name: "Locked",
      actions: {
        "Unlock": { action: "Unlock", targetState: "Closed" },
        "KickIn": { action: "KickIn", targetState: "KickedIn" },
      },
    },
    ""Closed: : {
      name: "KickedIn",
    },
  }
};

const result = PuzzleSchema.safeParse(example);
console.log(result.success ? "Valid!" : result.error);
*/
