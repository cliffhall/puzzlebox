import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import {
  noArgSchema,
  addPuzzleSchema,
  subscribeToPuzzleSchema,
  getPuzzleSnapshotSchema,
  performActionOnPuzzleSchema,
} from "./common/schemas.ts";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  addPuzzle,
  countPuzzles,
  getPuzzleSnapshot,
  performAction,
} from "./tools/puzzles.ts";

import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

export const createServer = (
  subscribers: Map<string, Set<SSEServerTransport>>,
  transportsBySessionId: Map<string, SSEServerTransport>,
) => {
  const mcpServer = new Server(
    {
      name: "puzzlebox",
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {
          "puzzlebox:/puzzle/{id}": {
            description: "A puzzle with the given ID",
          },
        },
        tools: {},
        logging: {},
      },
    },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "add_puzzle",
          description: "Add a new instance of a puzzle (finite state machine).",
          inputSchema: zodToJsonSchema(addPuzzleSchema),
        },
        {
          name: "get_puzzle_snapshot",
          description:
            "Get a snapshot of a puzzle (its current state and available actions).",
          inputSchema: zodToJsonSchema(getPuzzleSnapshotSchema),
        },
        {
          name: "perform_action_on_puzzle",
          description:
            "Perform an action on a puzzle (attempt a state transition).",
          inputSchema: zodToJsonSchema(performActionOnPuzzleSchema),
        },
        {
          name: "subscribe_to_puzzle",
          description: "Subscribe to state changes of a puzzle.",
          inputSchema: zodToJsonSchema(subscribeToPuzzleSchema),
        },
        {
          name: "count_puzzles",
          description: "Get the count of registered puzzles.",
          inputSchema: zodToJsonSchema(noArgSchema),
        },
      ],
    };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {

    try {
      switch (request.params.name) {
        case "subscribe_to_puzzle": {
          const args = subscribeToPuzzleSchema.parse(request.params.arguments);
          const puzzleId = args.puzzleId;
          const sessionId = args.sessionId;
          const transport = transportsBySessionId.get(sessionId);
          if (!transport) {
            throw new Error("No transport found for sessionId");
          }
          if (!subscribers.has(puzzleId)) {
            subscribers.set(puzzleId, new Set());
          }
          subscribers.get(puzzleId)!.add(transport);
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true }, null, 2) }],
          };
        }
        case "add_puzzle": {
          const args = addPuzzleSchema.parse(request.params.arguments);
          const result = addPuzzle(args.config);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }
        case "get_puzzle_snapshot": {
          const args = getPuzzleSnapshotSchema.parse(request.params.arguments);
          const result = getPuzzleSnapshot(args.puzzleId);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }
        case "perform_action_on_puzzle": {
          const args = performActionOnPuzzleSchema.parse(
            request.params.arguments,
          );
          const success = await performAction(args.puzzleId, args.actionName);
          if (success) {
            const snapshot = getPuzzleSnapshot(args.puzzleId);
            const newState = snapshot.currentState;
            const subscribedTransports =
              subscribers.get(args.puzzleId) || new Set();
            for (const subTransport of subscribedTransports) {
              subTransport.send({
                jsonrpc: "2.0",
                method: "notifications/puzzle/state_changed",
                params: { puzzleId: args.puzzleId, newState },
              });
            }
          }
          return {
            content: [
              { type: "text", text: JSON.stringify({ success }, null, 2) },
            ],
          };
        }
        case "count_puzzles": {
          const result = countPuzzles();
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }
        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    } catch (error) {
      throw new Error(
        `Error processing request: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  });

  return { mcpServer };
};
