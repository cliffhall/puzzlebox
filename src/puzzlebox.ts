import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  SetLevelRequestSchema,
  LoggingLevelSchema,
  LoggingLevel,
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
  getPuzzleList,
} from "./tools/puzzles.ts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { PUZZLE_RESOURCE_PATH, getPuzzleResourceUri } from "./common/utils.ts";

export const createServer = (
  transports: Map<string, Transport>,
  subscriptions: Map<string, Set<string>>,
) => {
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

  let logLevel: LoggingLevel = "debug";
  const loggingLevels = LoggingLevelSchema.options;
  function messageIsIgnored(
    levelA: LoggingLevel,
    levelB: LoggingLevel,
  ): boolean {
    const indexA = loggingLevels.indexOf(levelA);
    const indexB = loggingLevels.indexOf(levelB);
    return indexA < indexB;
  }

  async function logMessage(level: LoggingLevel, message: string) {
    if (!messageIsIgnored(level, logLevel)) {
      await server.sendLoggingMessage({
        level,
        data: message,
      });
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await logMessage("info", "Received List Tools request");
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
    await logMessage(
      "info",
      `Received Call Tool request: ${request.params.name}`,
    );
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
            await logMessage("debug", `Puzzle state changed: ${args.puzzleId}`);
            const uri = getPuzzleResourceUri(args.puzzleId);
            if (subscriptions.has(uri)) {
              const subscribers = subscriptions.get(uri) as Set<string>; // Update subscribers of state change
              for (const subscriber of subscribers) {
                if (transports.has(subscriber)) {
                  // Transport may have disconnected
                  const transport = transports.get(subscriber) as Transport;
                  await transport.send({
                    jsonrpc: "2.0",
                    method: "notifications/resources/updated",
                    params: { uri },
                  });
                } else {
                  subscribers.delete(subscriber); // subscriber has disconnected
                  await logMessage(
                    "info",
                    `Disconnected subscriber removed: ${subscriber}`,
                  );
                }
              }
            }
          }
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
          await logMessage("error", `Unknown tool: ${request.params.name}`);
          return {};
      }
    } catch (error) {
      await logMessage(
        "error",
        `Error processing request: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return {};
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    await logMessage("info", `Received List Resources request`);
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
    await logMessage("info", `Received List Resource Templates request`);
    return {
      resourceTemplates: [
        {
          uriTemplate: `${PUZZLE_RESOURCE_PATH}{id}`,
          name: "Puzzle Snapshot",
          description:
            "The current state and available actions for the given puzzle id",
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    await logMessage("info", `Received Read Resource request: ${uri}`);
    if (uri.startsWith(PUZZLE_RESOURCE_PATH)) {
      console.log(`Received resource request: ${uri}`);
      const puzzleId = uri.split(PUZZLE_RESOURCE_PATH)[1];
      const result = getPuzzleSnapshot(puzzleId);
      return {
        contents: [
          {
            uri,
            name: `Puzzle ${puzzleId}`,
            mimeType: "application/json",
            text: `Current state: ${result.currentState}, Available actions: ${result?.availableActions?.join(", ")}`,
            json: result,
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    const { uri } = request.params;
    await logMessage("info", `Received Subscribe Resource request: ${uri}`);
    const sessionId = server?.transport?.sessionId as string;
    const subscribers = subscriptions.has(uri)
      ? (subscriptions.get(uri) as Set<string>)
      : new Set<string>();
    subscribers.add(sessionId);
    subscriptions.set(uri, subscribers);
    return {};
  });

  server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    const { uri } = request.params;
    await logMessage("info", `Received Unsubscribe Resource request: ${uri}`);
    if (subscriptions.has(uri)) {
      const sessionId = server?.transport?.sessionId as string;
      const subscribers = subscriptions.get(uri) as Set<string>;
      if (subscribers.has(sessionId)) subscribers.delete(sessionId);
    }
    return {};
  });

  server.setRequestHandler(SetLevelRequestSchema, async (request) => {
    const { level } = request.params;
    logLevel = level;
    await logMessage("info", `Received Set Log Level request: ${logLevel}`);
    return {};
  });

  return { server };
};
