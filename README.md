# MCP State Machine Framework
Control intelligent agents with State Machines and the Model Context Protocol

### Core Components

1. **MCP State Machine** - The foundational implementation that defines:
  - States, transitions, and actions
  - Notification system (ACTION, EXITING, ENTERING, CHANGED, CANCELLED)
  - Guard functionality for state transitions
  - Agent management

2. **MCP Server** - The server implementation that:
  - Manages state machines and agents
  - Processes notifications
  - Handles WebSocket connections
  - Broadcasts state changes to clients

3. **MCP Client** - The client-side implementation that:
  - Connects to the MCP server
  - Registers agents
  - Sends actions
  - Processes state changes
  - Integrates with UI

## Key Features

- **State Machine Architecture**: The system revolves around [finite state machines](https://en.wikipedia.org/wiki/Finite-state_machine) which define some number of states and the valid transitions between them.

- **Notification System**: Uses a notification system for communication between components:
  - ACTION: Triggers state transitions
  - EXITING/ENTERING: Guard functionality for transitions
  - CHANGED: Signals successful state transition
  - CANCELLED: Indicates a rejected transition

- **Guard Functionality**: Supports both entering and exiting guards that can prevent state transitions based on custom logic.

- **WebSocket Communication**: Uses WebSockets for real-time communication between server and clients.

- **Agent-Based Design**: Actions are performed by agents that exist within state machines, similar to the actor model.

## Usage Example

The implementation includes a game state machine example with three states:
- LOBBY: Initial state where players wait
- PLAYING: Active game state
- GAME_OVER: End state after a game concludes

Actions like START_GAME, END_GAME, and RESTART trigger transitions between these states.

## How It Works

1. Clients connect to the server via WebSockets
2. Clients register agents with the server
3. Agents perform actions by sending ACTION notifications
4. The server validates actions against the current state
5. If valid, the server initiates a state transition
6. During transition, EXITING and ENTERING notifications check guards
7. If guards pass, the state transition completes with a CHANGED notification
8. Clients update their UI based on the new state

This implementation provides a flexible foundation that you can extend for various use cases. The TypeScript typing makes it more maintainable and helps catch errors during development.

Would you like me to explain any specific part of the implementation in more detail?

## Screenshots


## MCP Tools

- **`register_agent`**

  - Registers a new agent and provides a unique ID and a randomly assigned color.
  - **Inputs:** None
  - **Returns:** JSON agent with unique `id` and assigned `color`.

## Developer Setup

### Install Dependencies

- `cd /path/to/mcp-state-machine/`
- `npm install`

### Build

- `npm run build`
- Builds the stdio-based MCP server runtime at `/dist/index.js`

### MCP Proxy

- `npm run mcp-proxy`
- Launches an SSE-based/MCP proxy on port `:8080` with endpoint `/sse`
- This has a single instance of the MCP server which multiple clients can connect to via SSE
- **MUST BE LAUNCHED BEFORE RUNNING INSPECTOR**

### Inspector

- `npm run inspector`
- Runs the [Model Context Protocol Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
- The Inspector UI will be available at: http://localhost:8080
- In the Inspector UI:
  - Make sure `Transport Type` is set to `SSE`
  - Make sure `URL` is set to http://localhost:8080/sse
  - Click its **"Connect"** button to connect to the MCP Proxy
    - You should see Green light 🟢and **"Connected"** message.
  - Click its **List Tools** button

### Agent

- `npm run agent`
- Starts a new GooseTeam agent, with its waddling orders given in: `goose-team_instructions.md`
- First agent will assume Project Coordinator Role
- **NOTE:** It's best to connect to the server with the Inspector BEFORE launching the first agent
  - Send a message from "Human" telling it what you'd like the team to accomplish

### Agent Test

- `npm run agent:test`
- Starts a new GooseTeam agent, with its waddling orders given in: `goose-team_wait_test.md`
- This will test the configured model's ability to stay in the loop, checking messages periodically.
- If it ends with an error saying "outgoing message queue empty" then it is not a good tool use model and therefore a poor candidate for use with GooseTeam.
- **NOTE:** Make sure to have the MCP Proxy running first.

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
- **Server Reference:** We follow a simple but modular approach demonstrated in the [GitHub MCP server](../mcp-servers/src/github).
- **Inspiration:** Iterating from Aaron Goldsmith's Gist [here](https://gist.github.com/AaronGoldsmith/114c439ae67e4f4c47cc33e829c82fac).
- Watch Aaron's "[Building a team of AI agents](https://www.youtube.com/watch?v=9HJy4uqMW74)" talk about his initial experiment.

