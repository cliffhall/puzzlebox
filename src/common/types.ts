// Core Types
export type StateName = string;
export type ActionName = string;
export type GuardPrompt = string;

export interface State {
  name: string;
  enterGuard?: GuardPrompt;
  exitGuard?: GuardPrompt;
  actions?: Map<ActionName, Action>;
}

export interface Action {
  name: ActionName;
  targetState: StateName;
}
