import {
  State,
  Action,
  StateName
} from "../common/types.ts";

import {
  PuzzleSchema
} from "../common/schemas.ts";

export class Puzzle {
  id: string;
  states: Map<StateName, State> = new Map();
  initialState: StateName | undefined = undefined;
  currentState: StateName | undefined = undefined;

  constructor(id: string, puzzleConfig: object | undefined = undefined) {
    this.id = id;
    if (puzzleConfig) this.initialState = this.initializePuzzle(puzzleConfig);
  }

  /**
   * Get a state by name
   * @param state
   */
  public getState(state: string): State | undefined {
    return this.states.get(state);
  }

  /**
   * Get the current state
   */
  public getCurrentState(): State | undefined {
    return (this.currentState === undefined) ? undefined : this.states.get(this.currentState);
  }

  /**
   * Add a new state to the puzzle
   * @param state
   * @param isInitial
   */
  public addState(state: State, isInitial: boolean = false): void {
    this.states.set(state.name, state);
    if (isInitial) this.initialState = state.name;
  }

  /**
   * Add a new action to a state
   * @param stateName
   * @param action
   */
  public addAction(stateName: StateName, action: Action): boolean {
    let success = false;
    const state = this.states.get(stateName);
    if (state) {
      if (!state?.actions) state.actions = new Map();
      state.actions.set(action.actionName, action);
      return success = true
    }
    return success;
  }

  /**
   * Initialize the puzzle with a puzzle configuration
   * @param puzzleConfig
   * @returns StateName
   */
  public initializePuzzle(puzzleConfig: object): StateName | undefined {
    const parsedPuzzle =  PuzzleSchema.safeParse(puzzleConfig);
    if (parsedPuzzle.success) {
      const config = parsedPuzzle.data;
      for (let [name, state] of config.states) {;
        this.addState(state, name === config.initialState);
      }
      return config.initialState;
    }
  }
}
