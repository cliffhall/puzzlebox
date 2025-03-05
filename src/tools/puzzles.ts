import PuzzleStore from "../stores/PuzzleStore.ts";
import { puzzleSchema } from "../common/schemas.ts";
import { ActionName, StateName } from "../common/types.ts";
import { PUZZLE_RESOURCE_PATH } from "../common/utils.ts";

interface AddPuzzleResponse {
  success: boolean;
  error?: string;
  puzzleId?: string;
}

interface CountPuzzlesResponse {
  count: number;
}

interface GetPuzzleListEntry {
    uri: string,
    name: string,
    mimeType: string
}

interface GetPuzzleListResponse {
  puzzles: GetPuzzleListEntry[];
}

interface GetPuzzleSnapshotResponse {
  currentState: StateName | undefined;
  availableActions: ActionName[] | undefined;
}

interface PerformActionOnPuzzlesResponse {
  success: boolean;
}

/**
 * Add a puzzle to the puzzle box
 */
export function addPuzzle(puzzleConfig: string): AddPuzzleResponse {
  let response: AddPuzzleResponse = { success: false };
  let parsed;
  try {
    parsed = JSON.parse(puzzleConfig);
    const config = puzzleSchema.safeParse(parsed);
    if (config.success) {
      response.success = true;
      response.puzzleId = PuzzleStore.addPuzzle(config.data).id;
    }
  } catch (error) {
    response.success = false;
    response.error =
      error instanceof Error ? error.message : "Unknown error occurred";
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
    const cs = puzzle?.getCurrentState();
    if (cs && cs.name) {
      currentState = cs.name;
      availableActions = puzzle.getActions(currentState);
    }
  }

  return {
    currentState,
    availableActions,
  };
}

/**
 * List puzzles to the puzzle box
 */
export function countPuzzles(): CountPuzzlesResponse {
  return {
    count: PuzzleStore.countPuzzles(),
  };
}

export function getPuzzleList(): GetPuzzleListResponse {
  return {
    puzzles: PuzzleStore.getPuzzleList().map((puzzleId) => {
      return {
        uri: `${PUZZLE_RESOURCE_PATH}${puzzleId}`,
        name: puzzleId,
        mimeType: "text/plain",
      }
    })
  }
}

/**
 * Perform an action on a puzzle
 * @param puzzleId
 * @param actionName
 */
export async function performAction(
  puzzleId: string,
  actionName: ActionName,
): Promise<PerformActionOnPuzzlesResponse> {
  let success = false;
  const snapshot = getPuzzleSnapshot(puzzleId);
  if (snapshot && snapshot.availableActions?.includes(actionName)) {
    const puzzle = PuzzleStore.getPuzzle(puzzleId);
    if (puzzle) {
      success = await puzzle?.performAction(actionName);
      if (success) success = PuzzleStore.updatePuzzle(puzzle);
    }
  }

  return { success };
}
