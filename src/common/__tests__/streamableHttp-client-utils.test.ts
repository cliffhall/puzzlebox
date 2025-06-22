import http from "http";
import { AddressInfo } from "net";

import {
  establishStreamableSession,
  sendStreamableRpcMessage,
  ActiveStreamableConnection,
} from "../streamableHttp-client-utils.ts";
import { waitForSseResponse } from "../sse-client-utils.ts"; // Re-using this utility
import {
  JsonRpcRequest,
  JsonRpcResponse,
  ToolsListJsonResponse,
} from "../types.ts";

// Helper to delay execution
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms)); // FIX: Added delay helper

describe("Streamable HTTP Client Utilities", () => {
  let server: http.Server;
  let serverAddress: AddressInfo;
  let activeConnections: Map<string, ActiveStreamableConnection>;
  // To hold onto server-side response streams for sending SSE events
  let sseResponseSocket: http.ServerResponse | null = null;

  // --- Setup and Teardown ---
  beforeEach((done) => {
    activeConnections = new Map();
    server = http.createServer((req, res) => {
      // Simulate the /mcp endpoint behavior
      if (req.url === "/mcp") {
        if (req.method === "POST") {
          // --- Session Initialization POST or RPC Call POST ---
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            const contentType = req.headers["content-type"];
            const accept = req.headers["accept"];

            // Basic header validation (as per client-utils)
            if (
              !contentType?.startsWith("application/json") ||
              !accept?.includes("application/json")
            ) {
              res.writeHead(406, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error:
                    "Not Acceptable: Invalid Content-Type or Accept header",
                }),
              );
              return;
            }

            const sessionId = req.headers["mcp-session-id"] as string;
            if (!sessionId) {
              // --- Session Initialization POST ---
              const newSessionId = `test-session-${Date.now()}`;
              res.writeHead(200, {
                "Content-Type": "application/json",
                "mcp-session-id": newSessionId,
              });
              res.end(JSON.stringify({ status: "session initialized" }));
            } else {
              // --- RPC Call POST ---
              // For RPC calls, we typically send 204 No Content or 200 OK
              // and the actual JSON-RPC response goes over the SSE stream.
              // We'll simulate sending the response via SSE if a socket is available.
              try {
                const parsedBody: JsonRpcRequest = JSON.parse(body);
                if (sseResponseSocket && !sseResponseSocket.writableEnded) {
                  const rpcResponse: JsonRpcResponse = {
                    jsonrpc: "2.0",
                    id: parsedBody.id,
                    result: {
                      // Simulate a successful response
                      content: [
                        {
                          type: "text",
                          text: JSON.stringify({ success: true }),
                        },
                      ],
                    },
                  };
                  if (parsedBody.method === "tools/list") {
                    (
                      rpcResponse.result as ToolsListJsonResponse["result"]
                    ).tools = [
                      {
                        name: "add_puzzle",
                        description: "Add a puzzle",
                        inputSchema: {},
                      },
                      {
                        name: "count_puzzles",
                        description: "Count puzzles",
                        inputSchema: {},
                      },
                    ];
                  }
                  sseResponseSocket.write(
                    `data: ${JSON.stringify(rpcResponse)}\n\n`,
                  );
                }
                res.writeHead(204); // 204 No Content is common for acknowledged RPC POSTs
                res.end();
              } catch (error) {
                console.error("Mock server: Error parsing JSON body:", error);
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid JSON body" }));
              }
            }
          });
          return;
        } else if (req.method === "GET") {
          // --- Event Stream GET ---
          const sessionId = req.headers["mcp-session-id"] as string;
          if (!sessionId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ error: "Bad Request: Missing session ID" }),
            );
            return;
          }

          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            Connection: "keep-alive",
            "Cache-Control": "no-cache",
          });
          sseResponseSocket = res; // Store this for sending SSE events later
          req.on("close", () => {
            sseResponseSocket = null;
          });

          // Write an initial SSE comment to flush the headers and "open" the stream.
          res.write(": stream opened\n\n");

          // Keep the connection open. Don't call res.end().
          return;
        } else if (req.method === "DELETE") {
          // --- Session Termination DELETE ---
          res.writeHead(200);
          res.end();
          return;
        }
      }

      // Default handler for unexpected requests
      res.writeHead(404);
      res.end("Not Found");
    });

    server.listen(0, "127.0.0.1", () => {
      serverAddress = server.address() as AddressInfo;
      done();
    });
  });

  afterEach((done) => {
    activeConnections.forEach((conn) => {
      if (conn.eventStreamRequest && !conn.eventStreamRequest.destroyed) {
        conn.eventStreamRequest.destroy();
      }
    });
    activeConnections.clear();
    sseResponseSocket = null;
    server.close(() => {
      done();
    });
  });

  // --- Test Cases ---

  describe("establishStreamableSession", () => {
    it("should establish a session via POST and connect to event stream via GET", async () => {
      const { sessionId, eventStream } = await establishStreamableSession(
        serverAddress,
        activeConnections,
      );

      expect(sessionId).toMatch(/^test-session-\d+$/);
      expect(eventStream).toBeInstanceOf(http.IncomingMessage);
      expect(activeConnections.has(sessionId)).toBe(true);
      expect(activeConnections.get(sessionId)?.eventStreamResponse).toBe(
        eventStream,
      );
    });

    it("should reject if POST returns a non-200 status", async () => {
      const originalHandler = server.listeners("request")[0];
      server.removeAllListeners("request");
      server.on("request", (req, res) => {
        if (req.url === "/mcp" && req.method === "POST") {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal Server Error" }));
        } else {
          (originalHandler as http.RequestListener)(req, res);
        }
      });

      await expect(
        establishStreamableSession(serverAddress, activeConnections),
      ).rejects.toThrow(/Session initialization failed with status 500/);

      server.removeAllListeners("request");
      server.on("request", originalHandler as http.RequestListener);
    });

    it("should reject if POST doesn't return mcp-session-id header", async () => {
      const originalHandler = server.listeners("request")[0];
      server.removeAllListeners("request");
      server.on("request", (req, res) => {
        if (req.url === "/mcp" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
        } else {
          (originalHandler as http.RequestListener)(req, res);
        }
      });

      await expect(
        establishStreamableSession(serverAddress, activeConnections),
      ).rejects.toThrow("Server did not return mcp-session-id header");

      server.removeAllListeners("request");
      server.on("request", originalHandler as http.RequestListener);
    });

    it("should reject if GET returns a non-200 status", async () => {
      const originalHandler = server.listeners("request")[0];
      server.removeAllListeners("request");
      let postHandled = false;
      server.on("request", (req, res) => {
        if (req.url === "/mcp" && req.method === "POST" && !postHandled) {
          postHandled = true;
          res.writeHead(200, {
            "Content-Type": "application/json",
            "mcp-session-id": "temp-session-id",
          });
          res.end(JSON.stringify({ status: "session initialized" }));
        } else if (req.url === "/mcp" && req.method === "GET") {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
        } else {
          (originalHandler as http.RequestListener)(req, res);
        }
      });

      await expect(
        establishStreamableSession(serverAddress, activeConnections),
      ).rejects.toThrow(/Event stream connection failed with status 401/);

      server.removeAllListeners("request");
      server.on("request", originalHandler as http.RequestListener);
    });

    it("should reject on connection error during POST", async () => {
      await new Promise<void>((res) => server.close(() => res()));
      await expect(
        establishStreamableSession(serverAddress, activeConnections),
      ).rejects.toThrow(/ECONNREFUSED/);
    });

    it("should reject on connection error during GET", async () => {
      const originalHandler = server.listeners("request")[0];
      server.removeAllListeners("request");

      // This listener handles both POST and GET for this specific test
      server.on("request", (req, res) => {
        if (req.url === "/mcp" && req.method === "POST") {
          // Respond to POST normally
          res.writeHead(200, {
            "Content-Type": "application/json",
            "mcp-session-id": "temp-session-id",
          });
          res.end(JSON.stringify({ status: "session initialized" }));
        } else if (req.url === "/mcp" && req.method === "GET") {
          // When the GET request comes in, immediately destroy its socket
          // to simulate a connection failure. This is more reliable than server.close().
          req.socket.destroy();
        }
      });

      // The error will be 'socket hang up' because the server actively closes the connection
      await expect(
        establishStreamableSession(serverAddress, activeConnections),
      ).rejects.toThrow(/socket hang up/);

      // Restore the original handler for subsequent tests
      server.removeAllListeners("request");
      server.on("request", originalHandler as http.RequestListener);
    });
  });

  describe("sendStreamableRpcMessage", () => {
    let testSessionId: string;

    beforeEach(async () => {
      const { sessionId } = await establishStreamableSession(
        serverAddress,
        activeConnections,
      );
      testSessionId = sessionId;
    });

    it("should send a POST request and resolve on 204 status", async () => {
      const payload: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "test/method",
      };
      await expect(
        sendStreamableRpcMessage(serverAddress, testSessionId, payload),
      ).resolves.toBeUndefined();
    });

    it("should send a POST request and resolve on 200 status", async () => {
      const originalHandler = server.listeners("request")[0];
      server.removeAllListeners("request");
      server.on("request", (req, res) => {
        if (
          req.url === "/mcp" &&
          req.method === "POST" &&
          req.headers["mcp-session-id"] === testSessionId
        ) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "accepted" }));
        } else {
          (originalHandler as http.RequestListener)(req, res);
        }
      });

      const payload: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 2,
        method: "test/method",
      };
      await expect(
        sendStreamableRpcMessage(serverAddress, testSessionId, payload),
      ).resolves.toBeUndefined();

      server.removeAllListeners("request");
      server.on("request", originalHandler as http.RequestListener);
    });

    it("should reject if the server returns a non-200/204 status", async () => {
      const originalHandler = server.listeners("request")[0];
      server.removeAllListeners("request");
      server.on("request", (req, res) => {
        if (
          req.url === "/mcp" &&
          req.method === "POST" &&
          req.headers["mcp-session-id"] === testSessionId
        ) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "bad request" }));
        } else {
          (originalHandler as http.RequestListener)(req, res);
        }
      });

      const payload: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 3,
        method: "test/method",
      };
      await expect(
        sendStreamableRpcMessage(serverAddress, testSessionId, payload),
      ).rejects.toThrow(
        /POST \/mcp failed with status 400\. Body: {"error":"bad request"}/,
      );

      server.removeAllListeners("request");
      server.on("request", originalHandler as http.RequestListener);
    });

    it("should reject on a connection error", async () => {
      // Ensure any client connections from beforeEach are destroyed before closing the server
      activeConnections.forEach((conn) => {
        if (conn.eventStreamRequest && !conn.eventStreamRequest.destroyed) {
          conn.eventStreamRequest.destroy();
        }
      });
      activeConnections.clear(); // Clear the map as connections are now destroyed

      await new Promise<void>((res) => server.close(() => res())); // Close server
      await delay(50); // FIX: Add a small delay to allow the port to fully release

      const payload: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 4,
        method: "test/method",
      };
      await expect(
        sendStreamableRpcMessage(serverAddress, testSessionId, payload),
      ).rejects.toThrow(/ECONNREFUSED/);

      await new Promise<void>((res) =>
        server.listen(serverAddress.port, serverAddress.address, res),
      );
    });
  });

  // --- Integration Test: Client-side RPC with SSE Response ---
  describe("Full Streamable HTTP Request-Response Cycle", () => {
    it("should successfully send an RPC and receive response via SSE", async () => {
      const { sessionId, eventStream } = await establishStreamableSession(
        serverAddress,
        activeConnections,
      );
      expect(sessionId).toMatch(/^test-session-\d+$/);

      const requestId = 100;
      const waitPromise = waitForSseResponse<ToolsListJsonResponse>(
        eventStream,
        requestId,
        5000,
      );

      const requestPayload: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/list",
      };
      await sendStreamableRpcMessage(serverAddress, sessionId, requestPayload);

      expect(sseResponseSocket).not.toBeNull();

      const response = await waitPromise;
      expect(response.id).toBe(requestId);
      expect(response.result).toBeDefined();
      expect(
        (response.result as ToolsListJsonResponse["result"]).tools,
      ).toEqual(
        expect.arrayContaining([
          {
            name: "add_puzzle",
            description: "Add a puzzle",
            inputSchema: {},
          },
          {
            name: "count_puzzles",
            description: "Count puzzles",
            inputSchema: {},
          },
        ]),
      );
    });
  });
});
