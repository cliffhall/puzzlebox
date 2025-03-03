import PuzzleStore from "../stores/PuzzleStore.ts";
import { puzzleSchema } from "../common/schemas.ts";
import { ActionName, StateName } from "../common/types.js";

interface AddPuzzleResponse {
  puzzleId: string | undefined;
}

interface CountPuzzlesResponse {
  count: number;
}

interface GetPuzzleSnapshotResponse {
  currentState: StateName | undefined;
  availableActions: ActionName[] | undefined;
}

/**
 * Add a puzzle to the puzzle box
 */
export function addPuzzle(puzzleConfig: string): AddPuzzleResponse {
  let response: AddPuzzleResponse = { puzzleId: undefined };
  const config = puzzleSchema.safeParse(JSON.parse(puzzleConfig));
  if (config.success) {
    response.puzzleId = PuzzleStore.addPuzzle(config.data).id;
  } else {
    console.log(config.error);
  }
  return response;
}

/**
 * Get a snapshot of a puzzle by ID
 * Snapshot contains:
 * - currentState - name of the current state
 * - availableActions - an array of available actions for the current state
 * @param puzzleId
 */
export function getPuzzleSnapshot(puzzleId: string): GetPuzzleSnapshotResponse {

  let currentState, availableActions;
  const puzzle = PuzzleStore.getPuzzle(puzzleId);
  if (!!puzzle && !!puzzle?.getCurrentState()) {
    const cs= puzzle?.getCurrentState();
    if (cs && cs.name) {
        currentState = cs.name;
        availableActions = puzzle.getActions(currentState);
      }
  }

  return  {
    currentState,
    availableActions
  }
}

/**
 * List puzzles to the puzzle box
 */
export function countPuzzles(): CountPuzzlesResponse {
  return {
    count: PuzzleStore.countPuzzles(),
  };
}
