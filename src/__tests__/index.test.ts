import http from "http";
import app from "../index.ts";
import { AddressInfo } from "net";
import {
  JsonRpcRequest,
  ToolDefinition,
  ToolsListJsonResponse,
  ToolCallJsonResponse,
  ActiveSseConnection,
  establishSseSession,
  sendJsonRpcMessage,
  waitForSseResponse,
} from "../common/client-utils.ts";

const activeSseConnections: Map<string, ActiveSseConnection> = new Map();

describe("Puzzlebox Server", () => {
  let server: http.Server;
  let serverAddress: AddressInfo;

  beforeAll((done) => {
    server = http.createServer(app);
    server.listen(() => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        done(new Error("Server address is not an AddressInfo object"));
        return;
      }
      serverAddress = addr;
      console.log(
        `TEST_LOG: Test server listening on: http://localhost:${serverAddress.port}`,
      );
      done();
    });
    server.on("error", (err) => {
      console.error("TEST_LOG: Test server error:", err);
    });
    // Add handler for server close event for debugging
    server.on("close", () => {
      console.log("TEST_LOG: Test server instance closed.");
    });
  });

  afterEach(async () => {
    console.log(
      `TEST_LOG: Cleaning up ${activeSseConnections.size} active SSE connections after test...`,
    );
    const cleanupPromises: Promise<void>[] = [];

    activeSseConnections.forEach((conn, sessionId) => {
      cleanupPromises.push(
        new Promise<void>((resolve) => {
          if (conn.request && !conn.request.destroyed) {
            console.log(
              `TEST_LOG: Destroying active SSE request for sessionId: ${sessionId}`,
            );
            // Add event listeners for debugging destroy issues
            conn.request.once("error", (err) => {
              // Ignore specific errors often seen during forceful cleanup
              if (
                (err as NodeJS.ErrnoException).code !== "ECONNRESET" &&
                err.message !== "socket hang up" &&
                err.message !== "aborted"
              ) {
                console.warn(
                  `TEST_LOG: Error during SSE request destroy for ${sessionId}:`,
                  err.message,
                );
              }
            });
            conn.request.once("close", () => {
              console.log(
                `TEST_LOG: SSE request socket closed for ${sessionId}.`,
              );
              resolve(); // Resolve once the socket confirms closure
            });
            conn.request.destroy(); // Initiate destroy
          } else {
            console.log(
              `TEST_LOG: SSE request for ${sessionId} already destroyed or null.`,
            );
            resolve(); // Resolve immediately if no request to destroy
          }
          if (conn.response) {
            // It's generally safer to remove all listeners, although waitForSseResponse should have cleaned up its own.
            conn.response.removeAllListeners();
            // Ensure the response stream is consumed and destroyed if not already ended
            if (!conn.response.destroyed) {
              conn.response.destroy();
            }
          }
        }),
      );
    });

    try {
      // Wait for all cleanup operations to complete, with a timeout
      await Promise.all(
        cleanupPromises.map((p) =>
          p.catch((e) => console.error("Error during cleanup promise:", e)),
        ),
      ); // Catch errors in individual cleanup promises
      console.log(
        `TEST_LOG: Finished awaiting cleanup for ${activeSseConnections.size} connections.`,
      );
    } catch (error) {
      console.error(
        "TEST_LOG: Error during Promise.all in afterEach cleanup:",
        error,
      );
    }

    activeSseConnections.clear(); // Clear the map after cleanup attempts
    console.log("TEST_LOG: Active SSE connections map cleared.");
  });

  afterAll((done) => {
    // Ensure map is clear even if afterEach had issues (belt and suspenders)
    activeSseConnections.forEach((conn) => {
      if (conn.request && !conn.request.destroyed) conn.request.destroy();
    });
    activeSseConnections.clear();
    console.log("TEST_LOG: Attempting final server close...");
    if (server && server.listening) {
      server.close((err) => {
        if (err) {
          console.error("TEST_LOG: Error closing test server:", err);
          done(err); // Pass error to Jest
        } else {
          console.log("TEST_LOG: Test server closed successfully.");
          done(); // Signal Jest that async closing is complete
        }
      });
    } else {
      console.log("TEST_LOG: Server already closed or not started.");
      done(); // Nothing to close
    }
  });

  it("GET /sse should establish a session", async () => {
    console.log("TEST_RUN: Starting 'GET /sse should establish a session'");
    const { sessionId, sseResponseStream } = await establishSseSession(
      serverAddress,
      activeSseConnections,
    );
    expect(sessionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(sseResponseStream).toBeDefined();
    expect(activeSseConnections.has(sessionId)).toBe(true);
    console.log(
      `TEST_RUN: Finished 'GET /sse should establish a session' for ${sessionId}`,
    );
  }, 10000); // Timeout for session initialization call

  it("POST /message tools/list should respond with tool list", async () => {
    console.log("TEST_RUN: Starting 'POST /message tools/list'");
    if (!serverAddress) throw new Error("Server address not available");

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
      id: 5,
    }; // Use specific request type

    // Concurrently:
    // 1. Send the POST request and wait for the 202 Ack
    // 2. Wait for the corresponding response on the SSE stream
    const [, sseResult] = await Promise.all([
      sendJsonRpcMessage(serverAddress, sessionId, requestPayload),
      waitForSseResponse<ToolsListJsonResponse>(
        sseResponseStream,
        requestPayload.id,
      ), // Use the specific response type
    ]);
    console.log("MSG_TEST: Both POST acknowledged and SSE response received.");

    // Assertions on the SSE response result
    expect(sseResult).toBeDefined();
    expect(sseResult).toHaveProperty("jsonrpc", "2.0");
    expect(sseResult).toHaveProperty("id", requestPayload.id);
    expect(sseResult).toHaveProperty("result");
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
    console.log("MSG_TEST: Assertions passed for SSE response content.");
    console.log("TEST_RUN: Finished 'POST /message tools/list'");
  }, 15000); // Timeout to accommodate SSE wait + POST ack

  it("POST /message tools/call count_puzzles should respond with puzzle count", async () => {
    console.log("TEST_RUN: Starting 'POST /message count_puzzles'");
    if (!serverAddress) throw new Error("Server address not available");

    console.log("COUNT_TEST: Establishing SSE session...");
    const { sessionId, sseResponseStream } = await establishSseSession(
      serverAddress,
      activeSseConnections,
    );
    console.log(`COUNT_TEST: SSE session established: ${sessionId}`);

    const requestPayload: JsonRpcRequest = {
      method: "tools/call", // Note: MCP uses 'tools/call' generally
      params: { name: "count_puzzles", arguments: {} },
      jsonrpc: "2.0",
      id: 6, // Use a different ID
    };

    console.log(
      "COUNT_TEST: Initiating POST send and SSE wait concurrently...",
    );
    const [, sseResult] = await Promise.all([
      sendJsonRpcMessage(serverAddress, sessionId, requestPayload),
      waitForSseResponse<ToolCallJsonResponse>(
        sseResponseStream,
        requestPayload.id,
      ),
    ]);

    console.log(
      "COUNT_TEST: Both POST acknowledged and SSE response received.",
    );

    expect(sseResult).toBeDefined();
    expect(sseResult.jsonrpc).toBe("2.0");
    expect(sseResult.id).toBe(requestPayload.id);
    expect(sseResult.error).toBeUndefined();
    expect(sseResult.result).toHaveProperty("content");
    expect(Array.isArray(sseResult.result.content)).toBe(true);
    expect(sseResult.result.content.length).toBeGreaterThan(0);
    expect(sseResult.result.content[0].type).toBe("text");

    // Parse the count from the text response
    try {
      const countResult = JSON.parse(sseResult.result.content[0].text);
      expect(countResult).toHaveProperty("count");
      expect(typeof countResult.count).toBe("number");
      console.log(`COUNT_TEST: Received count: ${countResult.count}`);
    } catch (e: unknown) {
      if (e instanceof Error) {
        console.error(e);
      }
      throw new Error(
        `Failed to parse count_puzzles response JSON: ${sseResult.result.content[0].text}`,
      );
    }

    console.log("COUNT_TEST: Assertions passed.");
    console.log("TEST_RUN: Finished 'POST /message count_puzzles'");
  }, 15000); //Timeout to accommodate SSE wait + POST ack
});
