import PuzzleStore from "../stores/PuzzleStore.ts";
import { puzzleSchema } from "../common/schemas.ts";

interface RegisterPuzzleResponse {
  puzzleId: string | undefined;
}
interface ListPuzzlesResponse {
  puzzles: string | undefined;
}

interface CountPuzzlesResponse {
  count: number;
}

/**
 * Add a puzzle to the puzzle box
 */
export function addPuzzle(puzzleConfig: string): RegisterPuzzleResponse {
  let response: RegisterPuzzleResponse = { puzzleId: undefined };
  const config = puzzleSchema.safeParse(JSON.parse(puzzleConfig));
  if (config.success) {
      response.puzzleId = PuzzleStore.addPuzzle(config.data).id
  } else {
    console.log(config.error)
  }
  return response;
}

/**
 * List puzzles to the puzzle box
 */
export function countPuzzles(): CountPuzzlesResponse {
  return {
    count: PuzzleStore.countPuzzles()
  };
}


/*

// Example usage:
const example = {
  "initialState": "Closed",
  "states": {
    "Closed": {
      "name": "Closed",
      "actions": {
        "Open": { "name": "Open", "targetState": "Opened" },
        "Lock": { "name": "Lock", "targetState": "Locked" }
      },
      "exitGuard": "leavingClosedState"
    },
   "Opened":  {
      "name": "Opened",
      "actions": {
        "Close:": { "name": "Close", "targetState": "Closed" }
      },
      "enterGuard": "enteringClosedState"
    },
    "Locked": {
      "name": "Locked",
      "actions": {
        "Unlock": { "name": "Unlock", "targetState": "Closed" },
        "KickIn": { "name": "KickIn", "targetState": "KickedIn" }
      }
    },
    "KickedIn": {
      "name": "KickedIn"
    }
  }
}

const result = PuzzleSchema.safeParse(example);
console.log(result.success ? "Valid!" : result.error);
*/


