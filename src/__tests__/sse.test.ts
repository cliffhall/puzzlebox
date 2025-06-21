import http from "http";
import { AddressInfo } from "net";
import { getTestPuzzleConfig } from "../common/utils.ts";
import {
  JsonRpcRequest,
  ToolDefinition,
  ToolsListJsonResponse,
  ToolCallJsonResponse,
  ActiveSseConnection,
  establishSseSession,
  sendJsonRpcMessage,
  waitForSseResponse,
} from "../common/sse-client-utils.ts";

// --- Global Map for Active Connections ---
const activeSseConnections: Map<string, ActiveSseConnection> = new Map();

describe("Puzzlebox Server", () => {
  let server: http.Server;
  let serverAddress: AddressInfo;

  beforeEach((done) => {
    // 1. Reset Node's module cache to ensure fresh state for puzzle store etc.
    jest.resetModules();
    console.log("TEST_LOG: (BeforeEach) jest.resetModules() called.");

    // 2. Dynamically require the app *after* resetting modules
    const app = require("../sse.ts").default;
    console.log("TEST_LOG: (BeforeEach) App module re-required.");

    // 3. Create a *new* server instance with the fresh app
    server = http.createServer(app);
    console.log("TEST_LOG: (BeforeEach) New HTTP server created.");

    // 4. Start the server and wait for it to listen
    server.listen(() => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        done(new Error("Server address is not an AddressInfo object"));
        return;
      }
      serverAddress = addr;
      console.log(
        `TEST_LOG: (BeforeEach) Test server listening on: http://localhost:${serverAddress.port}`,
      );
      done();
    });

    // 5. Handle server errors during setup
    server.on("error", (err) => {
      console.error("TEST_LOG: (BeforeEach) Test server error:", err);
      done(err); // Signal error to Jest
    });
  });

  afterEach((done) => {
    console.log(
      `TEST_LOG: (AfterEach) Cleaning up ${activeSseConnections.size} active SSE connections...`,
    );
    const cleanupPromises: Promise<void>[] = [];

    // 1. Clean up active SSE connections
    activeSseConnections.forEach((conn, sessionId) => {
      cleanupPromises.push(
        new Promise<void>((resolve) => {
          // Use a try-catch inside the promise to prevent one error from stopping others
          try {
            if (conn.request && !conn.request.destroyed) {
              console.log(
                `TEST_LOG: (AfterEach) Destroying active SSE request for sessionId: ${sessionId}`,
              );
              conn.request.once("error", (err) => {
                // Ignore specific errors often seen during forceful cleanup
                if (
                  (err as NodeJS.ErrnoException).code !== "ECONNRESET" &&
                  err.message !== "socket hang up" &&
                  err.message !== "aborted"
                ) {
                  console.warn(
                    `TEST_LOG: (AfterEach) Error during SSE request destroy for ${sessionId}:`,
                    err.message,
                  );
                }
              });
              conn.request.once("close", () => {
                // console.log(`TEST_LOG: (AfterEach) SSE request socket closed for ${sessionId}.`);
                resolve();
              });
              conn.request.destroy();
            } else {
              resolve(); // Already destroyed or null
            }
            // Ensure response stream is also cleaned up
            if (conn.response && !conn.response.destroyed) {
              conn.response.removeAllListeners();
              conn.response.destroy();
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
        // Log if the Promise.all itself fails, though individual errors are handled above
        console.error(
          "TEST_LOG: (AfterEach) Error during Promise.all for connection cleanup:",
          error,
        );
      })
      .finally(() => {
        // 3. Clear the connections map
        activeSseConnections.clear();
        console.log(
          "TEST_LOG: (AfterEach) Active SSE connections map cleared.",
        );

        // 4. Close the HTTP server instance for this test
        if (server && server.listening) {
          console.log("TEST_LOG: (AfterEach) Closing server...");
          server.close((err) => {
            if (err) {
              console.error(
                "TEST_LOG: (AfterEach) Error closing test server:",
                err,
              );
              done(err); // Signal error to Jest
            } else {
              console.log(
                "TEST_LOG: (AfterEach) Test server closed successfully.",
              );
              done(); // Signal Jest that asynchronous teardown is complete
            }
          });
        } else {
          console.log(
            "TEST_LOG: (AfterEach) Server already closed or not started.",
          );
          done(); // Signal Jest teardown is complete
        }
      });
  });

  it("GET /sse should establish a session", async () => {
    console.log(
      "ESTABLISH_SESSION: Starting 'GET /sse should establish a session'",
    );
    // serverAddress is guaranteed to be set by beforeEach completing successfully
    const { sessionId, sseResponseStream } = await establishSseSession(
      serverAddress,
      activeSseConnections,
    );
    expect(sessionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(sseResponseStream).toBeDefined();
    expect(activeSseConnections.has(sessionId)).toBe(true);
  }, 10000);

  it("POST /message 'tools/list' should respond with tool list", async () => {
    console.log("MSG_TEST: Establishing SSE session...");
    const { sessionId, sseResponseStream } = await establishSseSession(
      serverAddress,
      activeSseConnections,
    );
    console.log(`MSG_TEST: SSE session established: ${sessionId}`);

    const requestPayload: JsonRpcRequest = {
      method: "tools/list",
      params: {},
      jsonrpc: "2.0",
      id: 5, // Use a consistent ID for this specific request type if desired
    };

    console.log("MSG_TEST: Initiating POST send and SSE wait concurrently...");
    const [, sseResult] = await Promise.all([
      sendJsonRpcMessage(serverAddress, sessionId, requestPayload),
      waitForSseResponse<ToolsListJsonResponse>(
        sseResponseStream,
        requestPayload.id,
      ),
    ]);
    console.log("MSG_TEST: Both POST acknowledged and SSE response received.");

    // Assertions
    expect(sseResult).toBeDefined();
    expect(sseResult).toHaveProperty("jsonrpc", "2.0");
    expect(sseResult).toHaveProperty("id", requestPayload.id);
    expect(sseResult.result).toBeDefined(); // Check result exists before accessing nested props
    expect(sseResult.error).toBeUndefined();
    expect(sseResult.result).toHaveProperty("tools");
    expect(Array.isArray(sseResult.result.tools)).toBe(true);
    expect(sseResult.result.tools.length).toBeGreaterThan(0);

    const toolNames = sseResult.result.tools.map((t: ToolDefinition) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "add_puzzle",
        "get_puzzle_snapshot",
        "perform_action_on_puzzle",
        "count_puzzles",
      ]),
    );
  }, 15000);

  it("POST /message 'tools/call' - add_puzzle should add a puzzle and return its ID", async () => {
    // Establish session
    console.log("ADD_TEST: Establishing SSE session...");
    const { sessionId, sseResponseStream } = await establishSseSession(
      serverAddress,
      activeSseConnections,
    );
    console.log(`ADD_TEST: SSE session established: ${sessionId}`);

    // Create request
    const requestPayload: JsonRpcRequest = {
      method: "tools/call",
      params: {
        name: "add_puzzle",
        arguments: { config: getTestPuzzleConfig() }, // Use helper for consistency
      },
      jsonrpc: "2.0",
      id: `add-${Date.now()}`, // Use dynamic ID
    };

    // Send request / wait for response
    console.log("ADD_TEST: Initiating POST send and SSE wait concurrently...");
    const [, sseResult] = await Promise.all([
      sendJsonRpcMessage(serverAddress, sessionId, requestPayload),
      waitForSseResponse<ToolCallJsonResponse>(
        sseResponseStream,
        requestPayload.id,
      ),
    ]);
    console.log("ADD_TEST: Both POST acknowledged and SSE response received.");

    // Assertions
    expect(sseResult).toBeDefined();
    expect(sseResult.jsonrpc).toBe("2.0");
    expect(sseResult.id).toBe(requestPayload.id);
    expect(sseResult.error).toBeUndefined();
    expect(sseResult.result).toBeDefined();
    expect(sseResult.result).toHaveProperty("content");
    expect(Array.isArray(sseResult.result.content)).toBe(true);
    expect(sseResult.result.content.length).toBeGreaterThan(0);
    expect(sseResult.result.content[0].type).toBe("text");

    try {
      const addResult = JSON.parse(sseResult.result.content[0].text);
      expect(addResult).toHaveProperty("success", true);
      expect(addResult).toHaveProperty("puzzleId");
      expect(typeof addResult.puzzleId).toBe("string");
      expect(addResult.puzzleId.length).toBeGreaterThan(0);
      console.log(`ADD_TEST: Received puzzleId: ${addResult.puzzleId}`);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error("ADD_TEST: JSON parsing error:", errorMsg);
      throw new Error( // Fail the test explicitly
        `Failed to parse add_puzzle response JSON: '${sseResult.result.content[0].text}'. Error: ${errorMsg}`,
      );
    }
  }, 15000);

  it("POST /message 'tools/call' - count_puzzles should return correct count after adding puzzles", async () => {
    console.log("COUNT_TEST: Establishing SSE session...");
    const { sessionId, sseResponseStream } = await establishSseSession(
      serverAddress,
      activeSseConnections,
    );
    console.log(`COUNT_TEST: SSE session established: ${sessionId}`);

    // Add three puzzles
    await addPuzzle(serverAddress, sessionId, sseResponseStream);
    await addPuzzle(serverAddress, sessionId, sseResponseStream);
    await addPuzzle(serverAddress, sessionId, sseResponseStream);

    // --- Now count the puzzles ---
    const countRequestId = `count-${Date.now()}`;
    const countRequestPayload: JsonRpcRequest = {
      method: "tools/call",
      params: { name: "count_puzzles", arguments: {} },
      jsonrpc: "2.0",
      id: countRequestId,
    };

    console.log("COUNT_TEST: Counting puzzles...");
    const [, sseResult] = await Promise.all([
      sendJsonRpcMessage(serverAddress, sessionId, countRequestPayload),
      waitForSseResponse<ToolCallJsonResponse>(
        sseResponseStream,
        countRequestId,
      ),
    ]);
    console.log("COUNT_TEST: Count response received.");

    // Assertions for count
    expect(sseResult).toBeDefined();
    expect(sseResult.jsonrpc).toBe("2.0");
    expect(sseResult.id).toBe(countRequestId);
    expect(sseResult.error).toBeUndefined();
    expect(sseResult.result).toBeDefined();
    expect(sseResult.result).toHaveProperty("content");
    expect(Array.isArray(sseResult.result.content)).toBe(true);
    expect(sseResult.result.content.length).toBeGreaterThan(0);
    expect(sseResult.result.content[0].type).toBe("text");

    try {
      const countResult = JSON.parse(sseResult.result.content[0].text);
      expect(countResult).toHaveProperty("count");
      expect(typeof countResult.count).toBe("number");
      expect(countResult.count).toBe(3);
      console.log(`COUNT_TEST: Received count: ${countResult.count}`);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error("COUNT_TEST: JSON parsing error:", errorMsg);
      throw new Error( // Fail the test explicitly
        `Failed to parse count_puzzles response JSON: '${sseResult.result.content[0].text}'. Error: ${errorMsg}`,
      );
    }

    console.log("COUNT_TEST: Assertions passed.");
  }, 15000);

  it("POST /message 'tools/call' - get_puzzle_snapshot should respond with initial state after adding puzzle", async () => {
    console.log("SNAPSHOT_TEST: Establishing SSE session...");
    const { sessionId, sseResponseStream } = await establishSseSession(
      serverAddress,
      activeSseConnections,
    );
    console.log(`SNAPSHOT_TEST: SSE session established: ${sessionId}`);

    // Add a puzzle
    const puzzleId = await addPuzzle(
      serverAddress,
      sessionId,
      sseResponseStream,
    );

    // Get puzzle snapshot
    const sseResult = await getSnapshot(
      serverAddress,
      sessionId,
      sseResponseStream,
      puzzleId,
    );

    // Assertions for snapshot
    try {
      const snapshotResult = JSON.parse(sseResult.result.content[0].text);
      expect(snapshotResult).toHaveProperty("currentState");
      expect(typeof snapshotResult.currentState).toBe("string");
      expect(snapshotResult.currentState).toBe("Closed");
      expect(Array.isArray(snapshotResult.availableActions)).toBe(true);
      expect(snapshotResult.availableActions).toEqual(
        expect.arrayContaining(["Open", "Lock"]),
      );

      console.log(`SNAPSHOT_TEST: Received snapshot: ${snapshotResult}`);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error("SNAPSHOT_TEST: JSON parsing error:", errorMsg);
      throw new Error( // Fail the test explicitly
        `Failed to parse get_puzzle_snapshot response JSON: '${sseResult.result.content[0].text}'. Error: ${errorMsg}`,
      );
    }
  }, 15000);

  it("POST /message 'tools/call' - perform_action_on_puzzle should change puzzle state", async () => {
    console.log("PERFORM_ACTION_TEST: Establishing SSE session...");
    const { sessionId, sseResponseStream } = await establishSseSession(
      serverAddress,
      activeSseConnections,
    );
    console.log(`PERFORM_ACTION_TEST: SSE session established: ${sessionId}`);

    // Add a puzzle
    const puzzleId = await addPuzzle(
      serverAddress,
      sessionId,
      sseResponseStream,
    );

    // Create request
    const actionRequestId = `action-${Date.now()}`;
    const actionRequestPayload: JsonRpcRequest = {
      method: "tools/call",
      params: {
        name: "perform_action_on_puzzle",
        arguments: {
          puzzleId: puzzleId,
          actionName: "Lock",
        },
      },
      jsonrpc: "2.0",
      id: actionRequestId,
    };

    // Send request / wait for response
    console.log("PERFORM_ACTION_TEST: Performing action...");
    const [, sseResult] = await Promise.all([
      sendJsonRpcMessage(serverAddress, sessionId, actionRequestPayload),
      waitForSseResponse<ToolCallJsonResponse>(
        sseResponseStream,
        actionRequestId,
      ),
    ]);
    console.log("PERFORM_ACTION_TEST: Perform Action response received.");
    console.log(
      `PERFORM_ACTION_TEST: Received result: ${JSON.stringify(sseResult)}`,
    );

    // Assertions for response
    expect(sseResult).toBeDefined();
    expect(sseResult.jsonrpc).toBe("2.0");
    expect(sseResult.id).toBe(actionRequestId);
    expect(sseResult.error).toBeUndefined();
    expect(sseResult.result).toBeDefined();
    expect(sseResult.result).toHaveProperty("content");
    expect(Array.isArray(sseResult.result.content)).toBe(true);
    expect(sseResult.result.content.length).toBeGreaterThan(0);
    expect(sseResult.result.content[0].type).toBe("text");

    try {
      const actionResult = JSON.parse(sseResult.result.content[0].text);
      expect(actionResult).toHaveProperty("success");
      expect(actionResult.success).toBe(true);
      console.log(`PERFORM_ACTION_TEST: Received result: ${actionResult}`);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error("PERFORM_ACTION_TEST: JSON parsing error:", errorMsg);
      throw new Error( // Fail the test explicitly
        `Failed to parse perform_action_on_puzzle response JSON: '${sseResult.result.content[0].text}'. Error: ${errorMsg}`,
      );
    }

    // Get puzzle snapshot
    const result = await getSnapshot(
      serverAddress,
      sessionId,
      sseResponseStream,
      puzzleId,
    );

    const snapshotResult = JSON.parse(result.result.content[0].text);
    expect(snapshotResult).toHaveProperty("currentState");
    expect(typeof snapshotResult.currentState).toBe("string");
    expect(snapshotResult.currentState).toBe("Locked");
    expect(Array.isArray(snapshotResult.availableActions)).toBe(true);
    expect(snapshotResult.availableActions).toEqual(
      expect.arrayContaining(["Unlock", "KickIn"]),
    );
  }, 15000);
});

/**
 * Helper to add a puzzle
 * @param serverAddress
 * @param sessionId
 * @param sseResponseStream
 */
async function addPuzzle(
  serverAddress: AddressInfo,
  sessionId: string,
  sseResponseStream: http.IncomingMessage,
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

  console.log("ADD_PUZZLE: Adding a puzzle first...");
  const [, addResult] = await Promise.all([
    sendJsonRpcMessage(serverAddress, sessionId, addPuzzleRequestPayload),
    waitForSseResponse<ToolCallJsonResponse>(
      sseResponseStream,
      addPuzzleRequestId,
    ),
  ]);

  // Basic check that add succeeded before performing action
  expect(addResult?.result?.content?.[0]?.text).toBeDefined();
  const parsedAddResult = JSON.parse(addResult.result.content[0].text);
  expect(parsedAddResult.success).toBe(true);
  console.log(`ADD_PUZZLE Puzzle added with ID: ${parsedAddResult.puzzleId}`);
  return parsedAddResult.puzzleId;
}

/**
 * Helper to get a puzzle snapshot
 * @param serverAddress
 * @param sessionId
 * @param sseResponseStream
 * @param puzzleId
 */
async function getSnapshot(
  serverAddress: AddressInfo,
  sessionId: string,
  sseResponseStream: http.IncomingMessage,
  puzzleId: string,
): Promise<ToolCallJsonResponse> {
  const snapshotRequestId = `snapshot-${Date.now()}`;
  const snapshotRequestPayload: JsonRpcRequest = {
    method: "tools/call",
    params: {
      name: "get_puzzle_snapshot",
      arguments: {
        puzzleId: puzzleId,
      },
    },
    jsonrpc: "2.0",
    id: snapshotRequestId,
  };

  console.log("SNAPSHOT: Getting Snapshot...");
  const [, sseResult] = await Promise.all([
    sendJsonRpcMessage(serverAddress, sessionId, snapshotRequestPayload),
    waitForSseResponse<ToolCallJsonResponse>(
      sseResponseStream,
      snapshotRequestId,
    ),
  ]);
  console.log("SNAPSHOT Snapshot response received.");

  // Assertions for result wrapper
  expect(sseResult).toBeDefined();
  expect(sseResult.jsonrpc).toBe("2.0");
  expect(sseResult.id).toBe(snapshotRequestId);
  expect(sseResult.error).toBeUndefined();
  expect(sseResult.result).toBeDefined();
  expect(sseResult.result).toHaveProperty("content");
  expect(Array.isArray(sseResult.result.content)).toBe(true);
  expect(sseResult.result.content.length).toBeGreaterThan(0);
  expect(sseResult.result.content[0].type).toBe("text");

  return sseResult;
}
