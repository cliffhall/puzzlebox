import { z } from "zod";

export const noArgSchema = z.object({});

export const ActionSchema = z.object({
  actionName: z.string(),
  targetState: z.string(),
});

export const StateSchema = z.object({
  name: z.string(),
  actions: z.map(z.string(), ActionSchema).optional(),
  enterGuard: z.string().optional(),
  exitGuard: z.string().optional()
});

export const PuzzleSchema = z.object({
  id: z.string().optional(),
  initialState: z.string(),
  states: z.map(z.string(), StateSchema),
});


/*
// Example usage:
const example = {
  id: "puzzle-123",
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
