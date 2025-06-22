// src/common/streamableHttp-client-utils.ts

import http from "http";
import { AddressInfo } from "net";
import { JsonRpcRequest, JsonRpcResponse } from "./types.ts"; // Added JsonRpcResponse

// --- Store active connections ---
export interface ActiveStreamableConnection {
  sessionId: string;
  // The request/response for the GET /mcp event stream
  eventStreamRequest: http.ClientRequest;
  eventStreamResponse: http.IncomingMessage;
}

/**
 * Establishes a Streamable HTTP session and opens the event stream.
 * This is a two-step process:
 * 1. POST to /mcp to initialize the session and get a sessionId.
 * 2. GET to /mcp with the sessionId to open the event stream.
 * @param serverAddress The address of the test server.
 * @param activeConnections A map to store the active connection.
 */
export async function establishStreamableSession(
  serverAddress: AddressInfo,
  activeConnections: Map<string, ActiveStreamableConnection>,
): Promise<{ sessionId: string; eventStream: http.IncomingMessage }> {
  // --- Step 1: POST to initialize session ---
  const sessionId = await new Promise<string>((resolve, reject) => {
    const initPayload = JSON.stringify({
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: { sampling: {}, roots: { listChanged: true } },
        clientInfo: { name: "puzzlebox-test", version: "0.1.0" },
      },
      jsonrpc: "2.0",
      id: 0,
    });

    const options: http.RequestOptions = {
      hostname:
        serverAddress.address === "::" ? "localhost" : serverAddress.address,
      port: serverAddress.port,
      path: "/mcp",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(initPayload),
        Accept: "application/json, text/event-stream",
      },
    };

    const req = http.request(options, (res) => {
      if (res.statusCode !== 200) {
        return reject(
          new Error(
            `Session initialization failed with status ${res.statusCode} ${JSON.stringify(res.statusMessage)}`,
          ),
        );
      }
      const newSessionId = res.headers["mcp-session-id"] as string;
      if (!newSessionId) {
        return reject(new Error("Server did not return mcp-session-id header"));
      }
      res.resume();
      resolve(newSessionId);
    });

    req.on("error", reject);
    req.write(initPayload);
    req.end();
  });

  // --- Step 2: GET to establish the event stream ---
  const eventStream = await new Promise<http.IncomingMessage>(
    (resolve, reject) => {
      const options: http.RequestOptions = {
        hostname:
          serverAddress.address === "::" ? "localhost" : serverAddress.address,
        port: serverAddress.port,
        path: "/mcp",
        method: "GET",
        headers: {
          "mcp-session-id": sessionId,
          Accept: "application/json, text/event-stream",
        },
      };

      const req = http.request(options, (res) => {
        if (res.statusCode !== 200) {
          return reject(
            new Error(
              `Event stream connection failed with status ${res.statusCode}`,
            ),
          );
        }
        // Store the active connection
        activeConnections.set(sessionId, {
          sessionId,
          eventStreamRequest: req,
          eventStreamResponse: res,
        });
        resolve(res);
        res.resume(); // FIX: Ensure the response stream is consumed
      });

      req.on("error", reject);
      req.end();
    },
  );

  return { sessionId, eventStream };
}

/**
 * Sends a JSON-RPC message via POST to the /mcp endpoint. This utility is for
 * servers that acknowledge with 200/204 and send the actual response over SSE.
 * @param serverAddress The address of the test server.
 * @param sessionId The active session ID.
 * @param payload The JSON-RPC request payload.
 */
export async function sendStreamableRpcMessage(
  serverAddress: AddressInfo,
  sessionId: string,
  payload: JsonRpcRequest,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const requestBodyString = JSON.stringify(payload);

    const options: http.RequestOptions = {
      hostname:
        serverAddress.address === "::" ? "localhost" : serverAddress.address,
      port: serverAddress.port,
      path: "/mcp",
      method: "POST",
      headers: {
        "mcp-session-id": sessionId,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBodyString),
        Accept: "application/json, text/event-stream",
      },
    };

    const req = http.request(options, (res) => {
      if (res.statusCode === 200 || res.statusCode === 204) {
        res.resume(); // Consume any response data to free up the socket
        resolve();
      } else {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          return reject(
            new Error(
              `POST /mcp failed with status ${res.statusCode}. Body: ${body}`,
            ),
          );
        });
        res.on("error", reject); // Handle errors during body reading
      }
    });

    req.on("error", reject);
    req.write(requestBodyString);
    req.end();
  });
}

/**
 * Utility for servers that return the RPC response directly in the POST body.
 * Sends a JSON-RPC message via POST and expects the JSON-RPC response
 * in the body of the HTTP response.
 */
export async function sendRpcAndGetHttpResponse<T extends JsonRpcResponse>(
  serverAddress: AddressInfo,
  sessionId: string,
  payload: JsonRpcRequest,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const requestBodyString = JSON.stringify(payload);

    const options: http.RequestOptions = {
      hostname:
        serverAddress.address === "::" ? "localhost" : serverAddress.address,
      port: serverAddress.port,
      path: "/mcp",
      method: "POST",
      headers: {
        "mcp-session-id": sessionId,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBodyString),
        Accept: "application/json, text/event-stream",
      },
    };

    const req = http.request(options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("error", reject);
      res.on("end", () => {
        if (res.statusCode !== 200) {
          return reject(
            new Error(
              `POST /mcp failed with status ${res.statusCode}. Body: ${body}`,
            ),
          );
        }
        try {
          // FIX: The server is returning the JSON response wrapped in an SSE message format.
          // We must parse this format to extract the JSON from the 'data:' field.
          const lines = body.trim().split('\n');
          const dataLine = lines.find(line => line.startsWith('data: '));

          if (!dataLine) {
            throw new Error(`Response did not contain an SSE 'data:' field. Body: ${body}`);
          }

          const jsonData = dataLine.substring(6).trim();
          const parsedResponse = JSON.parse(jsonData);
          resolve(parsedResponse as T);
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          reject(
            new Error(
              `Failed to parse SSE/JSON response from POST /mcp. Error: "${error}". Body: ${body}`,
            ),
          );
        }
      });
    });

    req.on("error", reject);
    req.write(requestBodyString);
    req.end();
  });
}

// The waitForSseResponse function from sse-client-utils.ts can be reused directly
// as it only depends on a standard http.IncomingMessage stream.
export { waitForSseResponse } from "./sse-client-utils.ts";
