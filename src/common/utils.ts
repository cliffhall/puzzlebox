export function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 15)}`;
}

const configObj = {
  initialState: "Closed",
  states: {
    Closed: {
      name: "Closed",
      actions: {
        Open: { name: "Open", targetState: "Opened" },
        Lock: { name: "Lock", targetState: "Locked" },
      },
      exitGuard: "Closed/guard/exit",
    },
    Opened: {
      name: "Opened",
      actions: {
        "Close:": { name: "Close", targetState: "Closed" },
      },
      enterGuard: "Closed/guard/enter",
    },
    Locked: {
      name: "Locked",
      actions: {
        Unlock: { name: "Unlock", targetState: "Closed" },
        KickIn: { name: "KickIn", targetState: "KickedIn" },
      },
    },
    KickedIn: {
      name: "KickedIn",
    },
  },
};

export function getTestPuzzleConfigString(): string {
  return JSON.stringify(configObj);
}

export function getTestPuzzleConfigObject(): object {
  return configObj;
}
