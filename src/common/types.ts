// Core Types
export type StateName = string;
export type ActionName = string;
export type GuardPrompt = string;

export interface State {
  name: string;
  enterGuard?: GuardPrompt;
  extiGuard?: GuardPrompt;
  actions?: Map<ActionName, Action>
}

export interface Action {
  actionName: ActionName;
  targetState: StateName;
}
