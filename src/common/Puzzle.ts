import { State, Action, StateName, ActionName } from "./types.js";

import { puzzleSchema } from "./schemas.ts";

export class Puzzle {
  id: string;
  protected states: Map<StateName, State> = new Map<StateName, State>();
  protected initialState: StateName | undefined = undefined;
  protected currentState: StateName | undefined = undefined;

  constructor(id: string, puzzleConfig: object | undefined = undefined) {
    this.id = id;
    if (puzzleConfig) this.initialState = this.initializePuzzle(puzzleConfig);
  }

  /**
   * Initialize the puzzle with a puzzle configuration
   * @param puzzleConfig
   * @returns StateName
   */
  public initializePuzzle(puzzleConfig: object): StateName | undefined {
    const parsedPuzzle = puzzleSchema.safeParse(puzzleConfig);
    if (parsedPuzzle.success) {
      const config = parsedPuzzle.data;
      for (const [name, value] of Object.entries(config.states)) {
        const state = value as State;
        this.addState(state, name === config.initialState);
      }
      return config.initialState;
    } else {
      console.log("error");
    }
  }

  /**
   * Add a new state to the puzzle
   * @param state
   * @param isInitial
   */
  public addState(state: State, isInitial: boolean = false): void {
    const actions = state?.actions;
    state.actions = new Map<ActionName, Action>();
    if(actions) {
      for (const [name, value] of Object.entries(actions)) {
        state.actions.set(name, value);
      }
    }
    this.states.set(state.name, state);

    if (isInitial) this.currentState =  this.initialState = state.name;
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
      state.actions.set(action.name, action);
      success = true;
    }
    return success;
  }

  /**
   * Get the list of actions for a given state
   * @param stateName
   * @returns ActionName[]
   */
  public getActions(stateName: StateName): ActionName[] {
    let result: ActionName[] = [];
    const state = this.states.get(stateName);
    if (state && state.actions) {
      result = Array.from(state.actions.keys());
    }
    return result;
  }

  /**
   * Get a state by name
   * @param stateName
   */
  public getState(stateName: StateName): State | undefined {
    return this.states.get(stateName);
  }

  /**
   * Get the current state
   */
  public getCurrentState(): State | undefined {
    return this.currentState === undefined
      ? this.initialState === undefined
        ? undefined
        : this.states.get(this.initialState)
      : this.states.get(this.currentState);
  }

  /**
   * Perform the state transition associated with the given action name
   * - only works if actionName is valid for currentState
   * - can be canceled by exit guard of current state
   * - can be canceled by enter guard of target state
   * @param actionName
   * @returns boolean
   */
  public async performAction(actionName: ActionName): Promise<boolean> {
    let success = false;
    const currentState = this.getCurrentState();
    if (currentState?.actions?.has(actionName)) {
      // TODO check exit guard of current state with a sampling request to client
      // TODO check enter guard of target state with a sampling request to client
      this.currentState = currentState?.actions?.get(actionName)?.targetState;
      success = true;
    }
    return success;
  }

}
