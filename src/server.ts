import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  noArgSchema,
  addPuzzleSchema,
  getPuzzleSnapshotSchema,
  performActionOnPuzzleSchema
} from "./common/schemas.ts";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { addPuzzle, countPuzzles, getPuzzleSnapshot, performAction } from "./tools/puzzles.ts";

export const createServer = () => {
  const mcpServer = new Server(
    {
      name: "puzzlebox",
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
        logging: {},
      },
    },
  );

  // Register MCP request handlers
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
          description: "Get a snapshot of a puzzle (its current state and available actions).",
          inputSchema: zodToJsonSchema(getPuzzleSnapshotSchema),
        },
        {
          name: "perform_action_on_puzzle",
          description: "Perform an action on a puzzle (attempt a state transition).",
          inputSchema: zodToJsonSchema(performActionOnPuzzleSchema),
        },
        {
          name: "count_puzzles",
          description: "Get the count of registered puzzles.",
          inputSchema: zodToJsonSchema(noArgSchema),
        },
      ],
    };
  });

  //
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      switch (request.params.name) {
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
          const args = performActionOnPuzzleSchema.parse(request.params.arguments);
          const result = await performAction(args.puzzleId, args.actionName);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
