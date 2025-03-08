import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import {
  noArgSchema,
  addPuzzleSchema,
  getPuzzleSnapshotSchema,
  performActionOnPuzzleSchema,
} from "./common/schemas.ts";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  addPuzzle,
  countPuzzles,
  getPuzzleSnapshot,
  performAction,
  getPuzzleList
} from "./tools/puzzles.ts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {PUZZLE_RESOURCE_PATH, getPuzzleResourceUri} from "./common/utils.js";

export const createServer = () => {

  const server = new Server(
    {
      name: "puzzlebox",
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: { subscribe: true },
        tools: {},
        logging: {},
      },
    },
  );

  let subscriptions: Set<string> = new Set();

  server.setRequestHandler(ListToolsRequestSchema, async () => {
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
          name: "count_puzzles",
          description: "Get the count of registered puzzles.",
          inputSchema: zodToJsonSchema(noArgSchema),
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {

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
          const args = performActionOnPuzzleSchema.parse(
            request.params.arguments,
          );
          const result = await performAction(args.puzzleId, args.actionName);
          if (result.success) {
            const uri = getPuzzleResourceUri(args.puzzleId);
            if (subscriptions.has(uri)) await server.sendResourceUpdated({ uri });
          }
          return {
            content: [
              { type: "text", text: JSON.stringify(result, null, 2) },
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

  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    const PAGE_SIZE = 25;

    const cursor = request.params?.cursor;
    let startIndex = 0;

    if (cursor) {
      const decodedCursor = parseInt(atob(cursor), 10);
      if (!isNaN(decodedCursor)) {
        startIndex = decodedCursor;
      }
    }

    const puzzleCount = countPuzzles()?.count;
    const endIndex = Math.min(startIndex + PAGE_SIZE, puzzleCount);
    const puzzles = getPuzzleList().puzzles;
    let resources = puzzles.slice(startIndex, endIndex);


    let nextCursor: string | undefined;
    if (endIndex < puzzles.length) {
      nextCursor = btoa(endIndex.toString());
    }

    return {
      resources,
      nextCursor,
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [
        {
          uriTemplate: `${PUZZLE_RESOURCE_PATH}{id}`,
          name: "Puzzle Snapshot",
          description: "The current state and available actions for the given puzzle id",
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri.startsWith(PUZZLE_RESOURCE_PATH)) {
      console.log(`Received resource request: ${uri}`);
      const puzzleId = uri.split(PUZZLE_RESOURCE_PATH)[1];
      const result = getPuzzleSnapshot(puzzleId);
      console.log(result);
      return {
        contents: [{
          uri,
          name: `Puzzle ${puzzleId}`,
          mimeType: "application/json",
          text: `Current state: ${result.currentState}, Available actions: ${result?.availableActions?.join(", ")}`,
          json: result
        }],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    const { uri } = request.params;
    subscriptions.add(uri);
    return {};
  });

  server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    const { uri } = request.params;
    subscriptions.delete(uri);
    return {};
  });

  return { server };
};
