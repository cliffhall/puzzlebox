// src/__tests__/streamableHttp.test.ts

import http from "http";
import { AddressInfo } from "net";
import { getTestPuzzleConfig } from "../common/utils.ts";
import {
  JsonRpcRequest,
  ToolDefinition,
  ToolsListJsonResponse,
  ToolCallJsonResponse,
} from "../common/types.ts";
import {
  ActiveStreamableConnection,
  establishStreamableSession,
  sendRpcAndGetHttpResponse, // FIX: Use the new, correct utility
} from "../common/streamableHttp-client-utils.ts";

// Import the server app and its internal transports map
import { transports as serverTransports } from "../streamableHttp.ts";

// --- Global Map for Active Connections (client-side tracking) ---
const activeConnections: Map<string, ActiveStreamableConnection> = new Map();

describe("Puzzlebox Server (Streamable HTTP)", () => {
  let server: http.Server;
  let serverAddress: AddressInfo;

  beforeEach((done) => {
    jest.resetModules();
    const { app } = require("../streamableHttp.ts");
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

    activeConnections.forEach((conn, sessionId) => {
      cleanupPromises.push(
        new Promise<void>((resolve) => {
          try {
            const transport = serverTransports.get(sessionId);
            if (transport) {
              transport.close().catch((e) => {
                console.warn(
                  `TEST_LOG: (AfterEach) Error closing server-side transport for ${sessionId}:`,
                  e,
                );
              });
            }

            let pendingClientCloses = 0;
            const checkAndResolve = () => {
              if (pendingClientCloses === 0) resolve();
            };

            if (conn.eventStreamRequest && !conn.eventStreamRequest.destroyed) {
              pendingClientCloses++;
              conn.eventStreamRequest.once("close", () => {
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
              conn.eventStreamResponse.removeAllListeners();
              conn.eventStreamResponse.once("close", () => {
                pendingClientCloses--;
                checkAndResolve();
              });
              conn.eventStreamResponse.destroy();
            }

            if (pendingClientCloses === 0) resolve();
          } catch (cleanupError) {
            console.error(
              `TEST_LOG: (AfterEach) Error during connection cleanup for ${sessionId}`,
              cleanupError,
            );
            resolve();
          }
        }),
      );
    });

    Promise.all(cleanupPromises)
      .catch((error) => {
        console.error(
          "TEST_LOG: (AfterEach) Error during Promise.all for connection cleanup:",
          error,
        );
      })
      .finally(() => {
        activeConnections.clear();
        if (server && server.listening) {
          server.close((err) => {
            if (err) done(err);
            else done();
          });
        } else {
          done();
        }
      });
  }, 20000);

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
    // Establish session, but we don't need the eventStream for this test's logic
    const { sessionId } = await establishStreamableSession(
      serverAddress,
      activeConnections,
    );

    const requestPayload: JsonRpcRequest = {
      method: "tools/list",
      params: {},
      jsonrpc: "2.0",
      id: 5,
    };

    // FIX: Call the new utility and await the response directly from the POST.
    const rpcResult = await sendRpcAndGetHttpResponse<ToolsListJsonResponse>(
      serverAddress,
      sessionId,
      requestPayload,
    );

    expect(rpcResult).toBeDefined();
    expect(rpcResult.result).toBeDefined();
    expect(rpcResult.error).toBeUndefined();
    expect(rpcResult.result.tools.length).toBeGreaterThan(0);
    const toolNames = rpcResult.result.tools.map((t: ToolDefinition) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining(["add_puzzle", "count_puzzles"]),
    );
  }, 20000);

  it("POST /mcp 'tools/call' - add_puzzle should add a puzzle and return its ID", async () => {
    const { sessionId } = await establishStreamableSession(
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

    // FIX: Await the response directly from the POST.
    const rpcResult = await sendRpcAndGetHttpResponse<ToolCallJsonResponse>(
      serverAddress,
      sessionId,
      requestPayload,
    );

    expect(rpcResult).toBeDefined();
    expect(rpcResult.error).toBeUndefined();
    const addResult = JSON.parse(rpcResult.result.content[0].text);
    expect(addResult).toHaveProperty("success", true);
    expect(addResult).toHaveProperty("puzzleId");
  }, 20000);

  it("POST /mcp 'tools/call' - count_puzzles should return correct count", async () => {
    const { sessionId } = await establishStreamableSession(
      serverAddress,
      activeConnections,
    );

    // Add three puzzles
    await addPuzzle(serverAddress, sessionId);
    await addPuzzle(serverAddress, sessionId);
    await addPuzzle(serverAddress, sessionId);

    // Count the puzzles
    const countRequestId = `count-${Date.now()}`;
    const countRequestPayload: JsonRpcRequest = {
      method: "tools/call",
      params: { name: "count_puzzles", arguments: {} },
      jsonrpc: "2.0",
      id: countRequestId,
    };

    // FIX: Await the response directly from the POST.
    const rpcResult = await sendRpcAndGetHttpResponse<ToolCallJsonResponse>(
      serverAddress,
      sessionId,
      countRequestPayload,
    );

    const countResult = JSON.parse(rpcResult.result.content[0].text);
    expect(countResult).toHaveProperty("count", 3);
  }, 25000);
});

/**
 * FIX: Updated helper to use the new utility. It no longer needs the eventStream.
 */
async function addPuzzle(
  serverAddress: AddressInfo,
  sessionId: string,
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

  const addResult = await sendRpcAndGetHttpResponse<ToolCallJsonResponse>(
    serverAddress,
    sessionId,
    addPuzzleRequestPayload,
  );

  const parsedAddResult = JSON.parse(addResult.result.content[0].text);
  return parsedAddResult.puzzleId;
}
