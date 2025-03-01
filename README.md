# puzzlebox
An [MCP server](https://github.com/modelcontextprotocol/specification/tree/main) that hosts dynamically configurable [finite state machines](https://en.wikipedia.org/wiki/Finite-state_machine).

### Core Components

1. **Puzzle** - The foundational FSM implementation that defines:
  - States, transitions, and actions
  - Guard functionality for state transitions

2. **MCP Server** - The server implementation that:
  - Manages puzzles
  - Processes notifications
  - Broadcasts state changes to clients

## Usage Example

The implementation includes a game state machine example with three states:
- LOBBY: Initial state where players wait
- PLAYING: Active game state
- GAME_OVER: End state after a game concludes

Actions START_GAME, END_GAME, and RESTART trigger transitions between these states.

```json
{
  "initialState": "LOBBY",
  "states": {
    "LOBBY": {
      "name": "LOBBY",
      "actions": {
        "START_GAME": { "name": "START_GAME", "targetState": "PLAYING" }
      }
    },
    "PLAYING":  {
      "name": "PLAYING",
      "actions": {
        "END_GAME:": { "name": "END_GAME", "targetState": "GAME_OVER" }
      }
    },
    "GAME_OVER": {
      "name": "GAME_OVER",
      "actions": {
        "RESTART": { "name": "RESTART", "targetState": "PLAYING" }
      }
    }
  }
}

```
## How It Works

1. Clients connect to the server via WebSockets
2. Clients register puzzles with the server
3. Agents perform actions by sending ACTION notifications
4. The server validates actions against the current state
5. If valid, the server initiates a state transition
6. During transition, EXITING and ENTERING notifications check guards
7. If guards pass, the state transition completes with a CHANGED notification
8. Clients update their UI based on the new state

This implementation provides a flexible foundation that you can extend for various use cases. The TypeScript typing makes it more maintainable and helps catch errors during development.

Would you like me to explain any specific part of the implementation in more detail?

## MCP Tools

- **`add_puzzle`**

  - Adds a new puzzle and provides a unique ID
  - **Inputs:** None
  - **Returns:** JSON object with unique `puzzleId` 

## Developer Setup

### Install Dependencies

- `cd /path/to/mcp-state-machine/`
- `npm install`

### Build

- `npm run build`
- Builds the stdio-based MCP server runtime at `/dist/index.js`

### Start

- `npm run start`
- Launches an SSE-based/MCP server on port `:3001` with endpoint `/sse`
- This has a single instance of the MCP server which multiple clients can connect to via SSE
- **MUST BE LAUNCHED BEFORE RUNNING INSPECTOR**

### Inspector

- `npm run inspector`
- Runs the [Model Context Protocol Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
- The Inspector UI will be available at: http://localhost:5173
- In the Inspector UI:
  - Make sure `Transport Type` is set to `SSE`
  - Make sure `URL` is set to http://localhost:3001/sse
  - Click its **"Connect"** button to connect to the MCP Proxy
    - You should see Green light 🟢and **"Connected"** message.
  - Click its **List Tools** button

### Format

- `npm run format`
- Runs `prettier` on the code, adjusting formatting

### Typecheck

- `npm run typecheck`
- Runs `tsc` with args to check and report type issues

### Lint

- `npm run lint`
- Runs `eslint` to non-destructively check for and report syntax problems

### LintFix

- `npm run lint:fix`
- Runs `eslint` to check for and fix syntax problems

### Test

- `npm run test`
- Run the unit tests


## Links

- **MCP Specification:** The complete Model Context Protocol specifications can be found [here](https://github.com/modelcontextprotocol/specification/tree/main).

