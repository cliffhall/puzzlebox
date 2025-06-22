# puzzlebox
![puzzlebox](images/puzzlebox.png)

## Coordinating agents with state machines 

An [MCP server](https://github.com/modelcontextprotocol/specification/tree/main) that hosts  [finite state machines](https://en.wikipedia.org/wiki/Finite-state_machine) as dynamic resources that clients can subscribe to and be updated when their state changes.

## Feature Roadmap and Status
<details>
<summary>A work in progress. Much is done, a few bits remain to be done.</summary>

* [x] Unit tests for tool code
* [x] Integration tests for MCP server (both SSE and StreamableHttp)
* [x] SSE transport
* [x] StreamableHttp transport
* [x] Multiple simultaneous client connections (both transports)
* [x] Create puzzles (state machines) as dynamic resources
* [x] Subscribe to puzzles
* [x] Receive update notifications when puzzles change
* [x] Get puzzle snapshot (current state and available actions)
* [x] Change puzzle state by performing action on puzzle
* [ ] Resource creation by puzzle state (used by agents and guard prompts)
* [ ] Transition guard prompt creation (uses resources by state)
* [ ] Transition guard via sampling
* [ ] Command line REPL
* [ ] Demo via REPL
</details>

## What problem does puzzlebox address?

<details>
<summary>Collaboration and coordination are related but different problems. Collaboration is good for non-trivial yet relatively simple tasks. To tackle long horizon efforts, puzzlebox solves for coordination.</summary>

### Teams need coordination
Marshalling multiple agents toward a big goal is tougher than just breaking down a request into tasks, assigning them to available agents and [enabling collaboration](https://github.com/cliffhall/GooseTeam) between them. 

Just as a few agents can collaborate to complete a small project, several teams of process-aware agents need to operate within distinct project phases to tackle long horizon efforts.

Consider enterprise-level software development processes:

* A large software project typically moves through a multistep, occasionally backtracking path from inception to design to building to testing to documentation to marketing to production. 

* Different teams are focused on different aspects over time, informed by what's gone before and with an eye toward an ever-changing goal that is refined according to lessons learned. 

* Even within a phase, teams may cycle through their own phases, like Agile sprints. A certain amount of work is scoped for the sprint, the team works on their parts, and at the end of the sprint they decide what to tackle next. It accepts that each sprint could change the course of future development. These cycles can also be represented as puzzles.

With puzzlebox, members of agentic teams can be made process-aware, but the process itself is not subject to hallucination.

### Scenario: Teams passing the torch

Three agents are working. The current state of their shared puzzle is "Specification". 
* Agent 1 is specifying the domain language.
* Agent 2 is defining project scope.
* Agent 3 is producing the specification document.
* The agents collaborate to reach the final specification document.
* Once the spec is done, Agent 3 initiates a transition to "Design" state.
  * First, the spec is checked by an exit guard (i.e., LLM sampling) for completeness. 
    * If problems are found, the state transition is canceled and the team continues.
    * If acceptable, the state changes to "Design". 
      * The "Specification" agents are monitoring the puzzle and should clock out now. 
        * Their long (and expensive) contexts have been distilled into the specification.
        * The "Design" team picks from here, with the spec as a resource and their contexts fresh and role-specific.

</details>

## What is a puzzle?

<details>

<summary>A puzzle is a finite state machine. It's just easier to say, write, and think about.</summary>

### A stateful thing you can act upon
Imagine the Rubik's Cube puzzle. It has 43 quintillion states, and to transition between them, you act upon it by rotating the intersecting planes of the mechanism.

### Properties of a puzzle
- A finite number of discrete states, e.g., "Series Concept and Tone", "World Building", "Arc Plotting", "Episode Planning", "Plotline Blending", "Episode Outline", "Script Writing" etc.
- Each state may have any number of actions (including 0) that initiate transition to another state.
- There is an initial state.
- There is a current state that may differ after actions have been performed on the puzzle.
- Transitions can be canceled by state exit and enter guards, e.g., Consult LLM via client sampling request.

### A Simple Example
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
        "END_GAME": { "name": "END_GAME", "targetState": "GAME_OVER" }
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

</details>

## What is puzzlebox?

<details>

<summary>Most MCP servers have a one-to-one relationship with the client. Puzzlebox is different.</summary>

### Many clients sharing dynamic resources
Puzzlebox is an **MCP Server** implementation that:
  - Supports multiple client connections that can create and monitor shared, dynamic resources. 
  - Manages puzzle instances
  - Exposes tools for: 
    - Adding puzzles
    - Getting a snapshot of the state and available actions for a given puzzle in the box
    - Performing actions on a given puzzle in the box that trigger state transitions
  - Exposes registered puzzles as resources
    - Clients can use the `Puzzle Snapshot` resource template to fetch the resource by ID
    - Resource URI is `puzzlebox:/puzzle/{puzzleId}`
    - Clients can subscribe/unsubscribe to individual resource URIs

### How It Works
1. Clients connect to a puzzlebox SSE server.
2. Clients register puzzles with the server.
3. Clients can subscribe to a given puzzle to receive updates when its state changes.
4. Clients perform actions on puzzles that may change their state and available actions.
5. The puzzlebox server ensures that any attempted action is valid for the current state of the given puzzle.
6. If an action is valid, a transition to the target state is initiated.
7. During transition, optional exit and enter guards may send sampling requests to the client, the results of which could lead to cancellation of the transition (think acceptance testing by stakeholders)
8. If guards pass, the state transition completes.
9. When a client receives a resource updated notification, they can either read the resource or use the `get_puzzle_snapshot` tool to get the current state and available actions.
10. Clients update their UI based on the new state.

</details>

## MCP Tools
<details>
<summary>These functions are exposed to the agents for managing puzzles.</summary>

### ⚙️ **`add_puzzle`**
#### Add a new instance of a puzzle (finite state machine).
- **Inputs:** None
- **Returns:** JSON object with boolean `success` and `puzzleId`

### ⚙️ **`get_puzzle_snapshot`**
#### Get a snapshot of a puzzle (its current state and available actions).
- **Inputs:** `puzzleId`
- **Returns:** JSON object with `currentState` and `availableActions` array
- **Note:** MCP clients that don't support resource subscriptions can poll this tool to watch for state changes.

### ⚙️ **`perform_action_on_puzzle`**
#### Perform an action on a puzzle (attempt a state transition).
- **Inputs:** `puzzleId` and `actionName`
- **Returns:** JSON object with `currentState` and `availableActions` array

### ⚙️ **`count_puzzles`**
#### Get the count of registered puzzles
- **Inputs:** None
- **Returns:** JSON object with current `count` of registered puzzles

</details>

## Local Setup
<details>
<summary>
Running locally requires <a href="https://nodejs.org/en/download" target="_blank">Node and npm be installed</a>. Then follow these steps...
</summary>

### Install Dependencies

- `cd /path/to/puzzlebox/`
- `npm install`

### Build

- `npm run build`
- Builds the MCP server runtime at `/dist/index.js`

### Start

- `npm run start`
- Launches an SSE-based/MCP server on port `:3001` with endpoint `/sse`
- **MUST BE LAUNCHED BEFORE RUNNING INSPECTOR**

### Inspector

- `npm run inspector`
- Runs the [Model Context Protocol Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
- The Inspector UI will be available at: http://localhost:5173
- In the Inspector UI:
  - Make sure `Transport Type` is set to `SSE`
  - Make sure `URL` is set to http://localhost:3001/sse
  - Click its **"Connect"** button to connect to the puzzlebox server.
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

</details>

## Screenshots
<details><summary>These screenshots show the various MCP tools and resources implemented by the sever.</summary>

Testing of the server was done with the official reference client - [the MCP Inspector](https://github.com/modelcontextprotocol/inspector). 

### 0 - List Tools
![0. list_tools](images/00_list_tools.png)

### 1 - Add Puzzle
![1. add_puzzle](images/1_add_puzzle.png)

### 2 - Get Puzzle Snapshot (Initial State)
![2. get_puzzle_snapshot](images/2_get_puzzle_snapshot.png)

### 3 - Perform Action On Puzzle
![3. perform_action_on_puzzle](images/3_perform_action_on_puzzle.png)

### 4 - Get Puzzle Snapshot (New State)
![4. get_puzzle_snapshot](images/4_get_puzzle_snapshot.png)

### 5 - Perform Action On Puzzle
![5. perform_action_on_puzzle](images/5_perform_action_on_puzzle.png)

### 6 - Get Puzzle Snapshot (Another New State)
![6. get_puzzle_snapshot](images/6_get_puzzle_snapshot.png)

### 7 - List Resources
![7. list resources](images/07_list_resources.png)

### 8 - Resource Template
![8. resource_template](images/08_resource_template.png)

### 9 - Unsubscribed Resource
![9. unsubscribed resource](images/09_unsubscribed_resource.png)

### 10 - Subscribed Resource
![10. unsubscribed resource](images/10_subscribed_resource.png)

### 11 - Resource Updated Notification
![11. subscribed resource updated](images/11_resource_updated.png)

</details>
