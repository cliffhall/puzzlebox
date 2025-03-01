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
