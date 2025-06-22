// src/common/__tests__/client-utils.test.ts

import http from "http";
import { AddressInfo } from "net";
import { Readable } from "stream";
import { JsonRpcResponse, ToolsListJsonResponse } from "../types.ts";
import {
  establishSseSession,
  sendJsonRpcMessage,
  waitForSseResponse,
  ActiveSseConnection,
} from "../sse-client-utils.ts";

// Helper to delay execution
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe("SSE Client Utilities", () => {
  let server: http.Server;
  let serverAddress: AddressInfo;
  let activeSseConnections: Map<string, ActiveSseConnection>;
  // To hold onto client connections for manipulation in tests
  let sseResponseSocket: http.ServerResponse | null = null;

  // --- Setup and Teardown ---
  beforeEach((done) => {
    activeSseConnections = new Map();
    server = http.createServer((req, res) => {
      // SSE Endpoint
      if (req.url === "/sse" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "Cache-Control": "no-cache",
        });
        // Store the response socket to send events later
        sseResponseSocket = res;
        // Send the initial endpoint event with a session ID
        const sessionId = "test-session-id-12345";
        res.write(`event: endpoint\n`);
        res.write(`data: /sse?sessionId=${sessionId}\n\n`);
        // Keep the connection open. Don't call res.end().
        req.on("close", () => {
          sseResponseSocket = null;
        });
        return;
      }

      // Message Endpoint
      if (req.url?.startsWith("/message") && req.method === "POST") {
        // Acknowledge the message immediately
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "accepted" }));
        return;
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
    // Clean up all active connections
    activeSseConnections.forEach((conn) => {
      conn.request.destroy();
    });
    activeSseConnections.clear();
    sseResponseSocket = null;
    server.close(() => {
      done();
    });
  });

  // --- Test Cases ---

  describe("establishSseSession", () => {
    it("should establish an SSE session and return a session ID", async () => {
      const { sessionId, sseResponseStream } = await establishSseSession(
        serverAddress,
        activeSseConnections,
      );

      expect(sessionId).toBe("test-session-id-12345");
      expect(sseResponseStream).toBeInstanceOf(http.IncomingMessage);
      expect(activeSseConnections.has(sessionId)).toBe(true);
      expect(activeSseConnections.get(sessionId)?.response).toBe(
        sseResponseStream,
      );
    });

    it("should reject if the server returns a non-200 status", async () => {
      // Stop the real server and start a faulty one
      await new Promise<void>((res) => server.close(() => res()));
      server = http.createServer((req, res) => {
        res.writeHead(500);
        res.end();
      });
      await new Promise<void>((res) =>
        server.listen(serverAddress.port, serverAddress.address, res),
      );

      await expect(
        establishSseSession(serverAddress, activeSseConnections),
      ).rejects.toThrow("SSE connection failed with status 500");
    });

    it("should reject on timeout if no session ID is received", async () => {
      // Stop the real server and start one that never sends the endpoint event
      await new Promise<void>((res) => server.close(() => res()));
      server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        // Never sends the event
      });
      await new Promise<void>((res) =>
        server.listen(serverAddress.port, serverAddress.address, res),
      );

      // Use jest fake timers to avoid waiting the full 5s
      jest.useFakeTimers();
      const promise = establishSseSession(serverAddress, activeSseConnections);
      jest.advanceTimersByTime(5001);
      await expect(promise).rejects.toThrow(
        "Timeout waiting for SSE endpoint event (session ID)",
      );
      jest.useRealTimers();
    });

    it("should reject on a connection error", async () => {
      // This covers the clientRequest.on('error') handler
      await new Promise<void>((res) => server.close(() => res()));

      await expect(
        establishSseSession(serverAddress, activeSseConnections),
      ).rejects.toThrow(/ECONNREFUSED/);
    });

    it("should ignore other SSE events before the endpoint event", async () => {
      // This covers the `else` block in the data handler when an event is not the 'endpoint'
      await new Promise<void>((res) => server.close(() => res()));
      server = http.createServer((req, res) => {
        if (req.url === "/sse") {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          // Send a different event first
          res.write("event: ping\n");
          res.write("data: keepalive\n\n");

          // Then send the real one
          const sessionId = "session-after-ping";
          res.write(`event: endpoint\n`);
          res.write(`data: /sse?sessionId=${sessionId}\n\n`);
        }
      });
      await new Promise<void>((res) =>
        server.listen(serverAddress.port, serverAddress.address, res),
      );

      const { sessionId } = await establishSseSession(
        serverAddress,
        activeSseConnections,
      );
      expect(sessionId).toBe("session-after-ping");
    });

    // NEW! This test covers line 178
    it("should ignore request errors after the session is established", async () => {
      const { sessionId } = await establishSseSession(
        serverAddress,
        activeSseConnections,
      );
      const connection = activeSseConnections.get(sessionId);
      expect(connection).toBeDefined();

      // This error occurs *after* the promise has settled. The code is
      // designed to ignore it, preventing an unhandled rejection.
      connection!.request.emit("error", new Error("late error"));

      // We just need to ensure no crash happens.
      await delay(20);
      expect(activeSseConnections.has(sessionId)).toBe(true);
    });
  });

  describe("sendJsonRpcMessage", () => {
    it("should send a POST request and resolve on 202 status", async () => {
      const payload = { jsonrpc: "2.0" as const, id: 1, method: "test" };
      await expect(
        sendJsonRpcMessage(serverAddress, "test-session", payload),
      ).resolves.toBeUndefined();
    });

    it("should reject if the server returns a non-202 status", async () => {
      await new Promise<void>((res) => server.close(() => res()));
      server = http.createServer((req, res) => {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "bad request" }));
      });
      await new Promise<void>((res) =>
        server.listen(serverAddress.port, serverAddress.address, res),
      );

      const payload = { jsonrpc: "2.0" as const, id: 2, method: "test" };
      await expect(
        sendJsonRpcMessage(serverAddress, "test-session", payload),
      ).rejects.toThrow(
        'POST /message expected status 202 but got 400. Body: {"error":"bad request"}',
      );
    });

    it("should reject on a connection error", async () => {
      // This covers the clientRequest.on('error') handler
      await new Promise<void>((res) => server.close(() => res()));
      const payload = { jsonrpc: "2.0" as const, id: 3, method: "test" };

      await expect(
        sendJsonRpcMessage(serverAddress, "test-session", payload),
      ).rejects.toThrow(/ECONNREFUSED/);
    });

    it("should reject on a response stream error", async () => {
      // This covers the res.on('error') handler for the POST response
      await new Promise<void>((res) => server.close(() => res()));
      server = http.createServer((req, res) => {
        if (req.method === "POST") {
          res.writeHead(202); // Send headers
          res.socket?.destroy(new Error("Socket error during response"));
        }
      });
      await new Promise<void>((res) =>
        server.listen(serverAddress.port, serverAddress.address, res),
      );

      const payload = { jsonrpc: "2.0" as const, id: 4, method: "test" };
      // FIX: The client receives a 'socket hang up' error, not the server-side error message.
      await expect(
        sendJsonRpcMessage(serverAddress, "test-session", payload),
      ).rejects.toThrow("socket hang up");
    });

    // NEW! This test covers lines 226-229
    it("should reject if the response stream errors while reading a non-202 response", async () => {
      await new Promise<void>((res) => server.close(() => res()));
      server = http.createServer((req, res) => {
        if (req.method === "POST") {
          res.writeHead(500); // Send a non-202 status
          // Destroy the socket before the body can be read. This triggers
          // the `res.on('error')` handler in the client.
          res.destroy();
        }
      });
      await new Promise<void>((res) =>
        server.listen(serverAddress.port, serverAddress.address, res),
      );

      const payload = { jsonrpc: "2.0" as const, id: 5, method: "test" };
      // The error is a generic 'socket hang up' because the request is aborted.
      await expect(
        sendJsonRpcMessage(serverAddress, "test-session", payload),
      ).rejects.toThrow("socket hang up");
    });
  });

  describe("waitForSseResponse", () => {
    let mockStream: Readable;

    beforeEach(() => {
      // Create a mock stream that we can push data to
      mockStream = new Readable({ read() {} });
    });

    it("should resolve with the correct parsed response when its ID matches", async () => {
      const expectedId = 123;
      const responsePayload: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: expectedId,
        result: { success: true },
      };

      const promise = waitForSseResponse<JsonRpcResponse>(
        mockStream as http.IncomingMessage,
        expectedId,
      );

      mockStream.push(`event: message\n`);
      mockStream.push(`data: ${JSON.stringify(responsePayload)}\n\n`);

      await expect(promise).resolves.toEqual(responsePayload);
    });

    it("should ignore other messages and wait for the correct one", async () => {
      const expectedId = 456;
      const responsePayload: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: expectedId,
        result: "final answer",
      };
      const ignoredPayload = { jsonrpc: "2.0", id: 999, result: "wrong" };
      const notification = {
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { percent: 50 },
      };

      const promise = waitForSseResponse<JsonRpcResponse>(
        mockStream as http.IncomingMessage,
        expectedId,
      );

      mockStream.push(`data: ${JSON.stringify(ignoredPayload)}\n\n`);
      mockStream.push(`data: ${JSON.stringify(notification)}\n\n`);
      await delay(10);
      mockStream.push(`data: ${JSON.stringify(responsePayload)}\n\n`);

      await expect(promise).resolves.toEqual(responsePayload);
    });

    it("should reject on timeout if the response never arrives", async () => {
      jest.useFakeTimers();
      const promise = waitForSseResponse(
        mockStream as http.IncomingMessage,
        789,
        5000,
      );
      jest.advanceTimersByTime(5001);
      await expect(promise).rejects.toThrow(
        "Timeout waiting for response id 789 on SSE stream",
      );
      jest.useRealTimers();
    });

    it("should reject if the stream closes prematurely", async () => {
      const promise = waitForSseResponse(
        mockStream as http.IncomingMessage,
        101,
      );
      await delay(10);
      mockStream.emit("close");
      await expect(promise).rejects.toThrow(
        "SSE stream closed/ended unexpectedly while waiting for response id 101",
      );
    });

    it("should reject if the stream emits an error", async () => {
      // This covers the errorHandler
      const promise = waitForSseResponse(
        mockStream as http.IncomingMessage,
        102,
      );
      const testError = new Error("Test stream error");
      await delay(10);
      mockStream.emit("error", testError);
      await expect(promise).rejects.toThrow(testError);
    });

    it("should ignore messages with invalid JSON and continue waiting", async () => {
      // This covers the JSON.parse catch block
      const expectedId = 789;
      const responsePayload: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: expectedId,
        result: "finally",
      };

      const promise = waitForSseResponse<JsonRpcResponse>(
        mockStream as http.IncomingMessage,
        expectedId,
      );

      mockStream.push("data: {this is not json}\n\n");
      await delay(10);
      mockStream.push(`data: ${JSON.stringify(responsePayload)}\n\n`);

      await expect(promise).resolves.toEqual(responsePayload);
    });

    it("should ignore SSE messages without a data field", async () => {
      // This covers the `else` block for when sseData is null
      const expectedId = 890;
      const responsePayload: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: expectedId,
        result: "got it",
      };

      const promise = waitForSseResponse<JsonRpcResponse>(
        mockStream as http.IncomingMessage,
        expectedId,
      );

      mockStream.push("event: ping\n\n");
      await delay(10);
      mockStream.push(`data: ${JSON.stringify(responsePayload)}\n\n`);

      await expect(promise).resolves.toEqual(responsePayload);
    });

    // NEW! This test covers line 398
    it("should ignore SSE comments and continue waiting", async () => {
      const expectedId = 999;
      const responsePayload: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: expectedId,
        result: "after comment",
      };

      const promise = waitForSseResponse<JsonRpcResponse>(
        mockStream as http.IncomingMessage,
        expectedId,
      );

      // SSE comments start with a colon. They should be ignored.
      mockStream.push(": this is a server comment\n\n");
      await delay(10);
      mockStream.push(`data: ${JSON.stringify(responsePayload)}\n\n`);

      await expect(promise).resolves.toEqual(responsePayload);
    });
  });

  // --- Integration Test ---
  describe("Full Request-Response Cycle", () => {
    it("should successfully get a response for a request", async () => {
      // 1. Establish SSE connection
      const { sessionId, sseResponseStream } = await establishSseSession(
        serverAddress,
        activeSseConnections,
      );
      expect(sessionId).toBe("test-session-id-12345");

      // 2. Concurrently wait for the response on the SSE stream
      const requestId = 1;
      const waitPromise = waitForSseResponse<ToolsListJsonResponse>(
        sseResponseStream,
        requestId,
        5000,
      );

      // 3. Send the JSON-RPC message via POST
      const requestPayload = {
        jsonrpc: "2.0" as const,
        id: requestId,
        method: "tools/list",
      };
      await sendJsonRpcMessage(serverAddress, sessionId, requestPayload);

      // 4. Simulate the server processing the POST and sending the response
      await delay(50);
      expect(sseResponseSocket).not.toBeNull();
      const responsePayload: ToolsListJsonResponse = {
        jsonrpc: "2.0",
        id: requestId,
        result: {
          tools: [
            {
              name: "calculator",
              description: "A calculator",
              inputSchema: {},
            },
          ],
        },
      };
      sseResponseSocket?.write(`data: ${JSON.stringify(responsePayload)}\n\n`);

      // 5. Await the response and verify it
      const response = await waitPromise;
      expect(response.id).toBe(requestId);
      expect(response.result.tools[0].name).toBe("calculator");
    });
  });
});
