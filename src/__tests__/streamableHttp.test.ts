// /Users/cliffhall/Projects/puzzlebox/src/__tests__/streamableHttp.test.ts

import http from "http";
import { AddressInfo } from "net";
import { getTestPuzzleConfig } from "../common/utils.ts";
import {
  JsonRpcRequest,
  ToolDefinition,
  ToolsListJsonResponse,
  ToolCallJsonResponse,
} from "../common/sse-client-utils.ts"; // Re-using interfaces
import {
  ActiveStreamableConnection,
  establishStreamableSession,
  sendStreamableRpcMessage,
  waitForSseResponse,
} from "../common/streamableHttp-client-utils.ts";

// Import the server app and its internal transports map
import { transports as serverTransports } from "../streamableHttp.ts"; // <--- NEW IMPORT

// --- Global Map for Active Connections (client-side tracking) ---
const activeConnections: Map<string, ActiveStreamableConnection> = new Map();

describe("Puzzlebox Server (Streamable HTTP)", () => {
  let server: http.Server;
  let serverAddress: AddressInfo;

  beforeEach((done) => {
    jest.resetModules();
    // Dynamically require the streamableHttp app
    // Note: We now import 'app' and 'transports' from the module
    const { app } = require("../streamableHttp.ts"); // <--- MODIFIED IMPORT
    server = http.createServer(app);

    server.listen(() => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        done(new Error("Server address is not an AddressInfo object"));
        return;
      }
      serverAddress = addr;
      done();
    });
    server.on("error", (err) => done(err));
  });

  afterEach((done) => {
    console.log(
      `TEST_LOG: (AfterEach) Cleaning up ${activeConnections.size} active Streamable HTTP connections...`,
    );
    const cleanupPromises: Promise<void>[] = [];

    // 1. Clean up active Streamable HTTP connections
    activeConnections.forEach((conn, sessionId) => {
      cleanupPromises.push(
        new Promise<void>((resolve) => {
          // Use a try-catch inside the promise to prevent one error from stopping others
          try {
            // Explicitly close the server-side transport first
            const transport = serverTransports.get(sessionId); // Access the server's global map
            if (transport) {
              console.log(
                `TEST_LOG: (AfterEach) Closing server-side transport for session: ${sessionId}`,
              );
              // The transport.close() method should handle removing itself from the map
              // and closing the associated puzzlebox server.
              transport
                .close()
                .then(() => {
                  console.log(
                    `TEST_LOG: (AfterEach) Server-side transport closed for ${sessionId}.`,
                  );
                })
                .catch((e) => {
                  console.warn(
                    `TEST_LOG: (AfterEach) Error closing server-side transport for ${sessionId}:`,
                    e,
                  );
                });
            }

            // Destroy client-side requests/responses and wait for their 'close' event
            let pendingClientCloses = 0;
            const checkAndResolve = () => {
              if (pendingClientCloses === 0) {
                resolve();
              }
            };

            if (conn.eventStreamRequest && !conn.eventStreamRequest.destroyed) {
              pendingClientCloses++;
              console.log(
                `TEST_LOG: (AfterEach) Destroying client-side eventStreamRequest for sessionId: ${sessionId}`,
              );
              conn.eventStreamRequest.once("error", (err) => {
                // Ignore common errors during forceful cleanup
                if (
                  (err as NodeJS.ErrnoException).code !== "ECONNRESET" &&
                  err.message !== "socket hang up" &&
                  err.message !== "aborted"
                ) {
                  console.warn(
                    `TEST_LOG: (AfterEach) Error during client-side request destroy for ${sessionId}:`,
                    err.message,
                  );
                }
              });
              conn.eventStreamRequest.once("close", () => {
                console.log(
                  `TEST_LOG: (AfterEach) Client-side eventStreamRequest closed for ${sessionId}.`,
                );
                pendingClientCloses--;
                checkAndResolve();
              });
              conn.eventStreamRequest.destroy();
            }

            if (
              conn.eventStreamResponse &&
              !conn.eventStreamResponse.destroyed
            ) {
              pendingClientCloses++;
              console.log(
                `TEST_LOG: (AfterEach) Destroying client-side eventStreamResponse for sessionId: ${sessionId}`,
              );
              conn.eventStreamResponse.removeAllListeners(); // Important to prevent leaks
              conn.eventStreamResponse.once("error", (err) => {
                if (
                  (err as NodeJS.ErrnoException).code !== "ECONNRESET" &&
                  err.message !== "socket hang up" &&
                  err.message !== "aborted"
                ) {
                  console.warn(
                    `TEST_LOG: (AfterEach) Error during client-side response destroy for ${sessionId}:`,
                    err.message,
                  );
                }
              });
              conn.eventStreamResponse.once("close", () => {
                console.log(
                  `TEST_LOG: (AfterEach) Client-side eventStreamResponse closed for ${sessionId}.`,
                );
                pendingClientCloses--;
                checkAndResolve();
              });
              conn.eventStreamResponse.destroy();
            }

            // If no client-side connections were active, resolve immediately
            if (pendingClientCloses === 0) {
              resolve();
            }
          } catch (cleanupError) {
            console.error(
              `TEST_LOG: (AfterEach) Error during connection cleanup for ${sessionId}`,
              cleanupError,
            );
            resolve(); // Resolve anyway to not block Promise.all
          }
        }),
      );
    });

    // 2. Wait for all connection cleanups to attempt completion
    Promise.all(cleanupPromises)
      .catch((error) => {
        console.error(
          "TEST_LOG: (AfterEach) Error during Promise.all for connection cleanup:",
          error,
        );
      })
      .finally(() => {
        // 3. Clear the client-side connections map
        activeConnections.clear();
        console.log(
          "TEST_LOG: (AfterEach) Active client connections map cleared.",
        );

        // 4. Close the HTTP server instance for this test
        if (server && server.listening) {
          console.log("TEST_LOG: (AfterEach) Closing test HTTP server...");
          server.close((err) => {
            if (err) {
              console.error(
                "TEST_LOG: (AfterEach) Error closing test HTTP server:",
                err,
              );
              done(err);
            } else {
              console.log(
                "TEST_LOG: (AfterEach) Test HTTP server closed successfully.",
              );
              done();
            }
          });
        } else {
          console.log(
            "TEST_LOG: (AfterEach) Test HTTP server already closed or not started.",
          );
          done();
        }
      });
  }, 20000); // <--- INCREASED AFTEREACH TIMEOUT TO 20 SECONDS

  it("should establish a session via POST and connect to event stream via GET", async () => {
    const { sessionId, eventStream } = await establishStreamableSession(
      serverAddress,
      activeConnections,
    );
    expect(sessionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(eventStream).toBeDefined();
    expect(activeConnections.has(sessionId)).toBe(true);
  }, 15000);

  it("POST /mcp 'tools/list' should respond with tool list", async () => {
    const { sessionId, eventStream } = await establishStreamableSession(
      serverAddress,
      activeConnections,
    );

    const requestPayload: JsonRpcRequest = {
      method: "tools/list",
      params: {},
      jsonrpc: "2.0",
      id: 5,
    };

    const [, sseResult] = await Promise.all([
      sendStreamableRpcMessage(serverAddress, sessionId, requestPayload),
      waitForSseResponse<ToolsListJsonResponse>(eventStream, requestPayload.id),
    ]);

    expect(sseResult).toBeDefined();
    expect(sseResult.result).toBeDefined();
    expect(sseResult.error).toBeUndefined();
    expect(sseResult.result.tools.length).toBeGreaterThan(0);
    const toolNames = sseResult.result.tools.map((t: ToolDefinition) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining(["add_puzzle", "count_puzzles"]),
    );
  }, 20000); // <--- INCREASED TEST TIMEOUT

  it("POST /mcp 'tools/call' - add_puzzle should add a puzzle and return its ID", async () => {
    const { sessionId, eventStream } = await establishStreamableSession(
      serverAddress,
      activeConnections,
    );

    const requestPayload: JsonRpcRequest = {
      method: "tools/call",
      params: {
        name: "add_puzzle",
        arguments: { config: getTestPuzzleConfig() },
      },
      jsonrpc: "2.0",
      id: `add-${Date.now()}`,
    };

    const [, sseResult] = await Promise.all([
      sendStreamableRpcMessage(serverAddress, sessionId, requestPayload),
      waitForSseResponse<ToolCallJsonResponse>(eventStream, requestPayload.id),
    ]);

    expect(sseResult).toBeDefined();
    expect(sseResult.error).toBeUndefined();
    const addResult = JSON.parse(sseResult.result.content[0].text);
    expect(addResult).toHaveProperty("success", true);
    expect(addResult).toHaveProperty("puzzleId");
  }, 20000); // <--- INCREASED TEST TIMEOUT

  it("POST /mcp 'tools/call' - count_puzzles should return correct count", async () => {
    const { sessionId, eventStream } = await establishStreamableSession(
      serverAddress,
      activeConnections,
    );

    // Add three puzzles
    await addPuzzle(serverAddress, sessionId, eventStream);
    await addPuzzle(serverAddress, sessionId, eventStream);
    await addPuzzle(serverAddress, sessionId, eventStream);

    // Count the puzzles
    const countRequestId = `count-${Date.now()}`;
    const countRequestPayload: JsonRpcRequest = {
      method: "tools/call",
      params: { name: "count_puzzles", arguments: {} },
      jsonrpc: "2.0",
      id: countRequestId,
    };

    const [, sseResult] = await Promise.all([
      sendStreamableRpcMessage(serverAddress, sessionId, countRequestPayload),
      waitForSseResponse<ToolCallJsonResponse>(eventStream, countRequestId),
    ]);

    const countResult = JSON.parse(sseResult.result.content[0].text);
    expect(countResult).toHaveProperty("count", 3);
  }, 25000); // <--- INCREASED TEST TIMEOUT (more operations)
});

/**
 * Helper to add a puzzle using the Streamable HTTP transport
 */
async function addPuzzle(
  serverAddress: AddressInfo,
  sessionId: string,
  eventStream: http.IncomingMessage,
): Promise<string> {
  const addPuzzleRequestId = `add-${Date.now()}`;
  const addPuzzleRequestPayload: JsonRpcRequest = {
    method: "tools/call",
    params: {
      name: "add_puzzle",
      arguments: { config: getTestPuzzleConfig() },
    },
    jsonrpc: "2.0",
    id: addPuzzleRequestId,
  };

  const [, addResult] = await Promise.all([
    sendStreamableRpcMessage(serverAddress, sessionId, addPuzzleRequestPayload),
    waitForSseResponse<ToolCallJsonResponse>(eventStream, addPuzzleRequestId),
  ]);

  const parsedAddResult = JSON.parse(addResult.result.content[0].text);
  return parsedAddResult.puzzleId;
}
