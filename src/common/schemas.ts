import { z } from "zod";

export const noArgSchema = z.object({});

export const actionSchema = z.object({
  name: z.string(),
  targetState: z.string(),
});

export const stateSchema = z.object({
  name: z.string(),
  actions: z.record(z.string(), actionSchema).optional(),
  enterGuard: z.string().optional(),
  exitGuard: z.string().optional(),
});

export const puzzleSchema = z.object({
  id: z.string().optional(),
  initialState: z.string(),
  states: z.record(z.string(), stateSchema),
});

export const addPuzzleSchema = z.object({
  config: z.string(),
});

export const subscribeToPuzzleSchema = z.object({
  puzzleId: z.string(),
  sessionId: z.string(),
});

export const getPuzzleSnapshotSchema = z.object({
  puzzleId: z.string(),
});

export const performActionOnPuzzleSchema = z.object({
  puzzleId: z.string(),
  actionName: z.string(),
});

/*
export const invokeTransitionGuard = z.object({
  prompt: z.string().describe("The prompt to send to the LLM"),
  maxTokens: z
    .number()
    .default(100)
    .describe("Maximum number of tokens to generate"),
});

export const PuzzleStateChangedNotificationSchema = z.object({
  method: z.literal("notifications/puzzle/state_changed"),
  puzzleId: z.string(),
  newState: z.string(),
});
*/
