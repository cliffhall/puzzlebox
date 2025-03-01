export function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 15)}`;
}

export function getTestPuzzleConfig(): string {
  return JSON.stringify({
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
  });
}
