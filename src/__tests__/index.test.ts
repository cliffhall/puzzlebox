import http from "http";
import app from "../index.ts";
import { AddressInfo } from "net";

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
}

interface ToolsListResult {
  tools: ToolDefinition[];
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolsListJsonResponse extends JsonRpcResponse {
  id: number;
  result: ToolsListResult;
}

// --- Store active SSE connections (Response Streams) ---
interface ActiveSseConnection {
  request: http.ClientRequest;
  response: http.IncomingMessage;
  // Note: listenerAttached is removed as listener management is now internal to waitForSseResponse
}
const activeSseConnections: Map<string, ActiveSseConnection> = new Map();

// --- Helper Function: Establish SSE, get Session ID & Response Stream ---
async function establishSseSession(
  serverAddress: AddressInfo,
): Promise<{ sessionId: string; sseResponseStream: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let clientRequest: http.ClientRequest | null = null;
    let timeoutId: NodeJS.Timeout | null = null;
    let promiseSettled = false;

    const cleanup = (
      err?: Error,
      details?: { sessionId: string; sseResponseStream: http.IncomingMessage },
    ) => {
      if (promiseSettled) return;
      promiseSettled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (err && clientRequest && !clientRequest.destroyed) {
        console.log("SSE_HELPER: Destroying SSE request due to error.");
        clientRequest.destroy(err); // Ensure request is destroyed on error
        reject(err);
      } else if (
        details?.sessionId &&
        details?.sseResponseStream &&
        clientRequest
      ) {
        console.log(
          `SSE_HELPER: Resolving with sessionId ${details.sessionId}. Keeping connection open.`,
        );
        // Store the connection details *without* the listenerAttached flag
        activeSseConnections.set(details.sessionId, {
          request: clientRequest,
          response: details.sseResponseStream,
        });
        resolve(details);
      } else if (err) {
        console.error("SSE_HELPER: Rejecting SSE promise.", err.message);
        reject(err);
      } else {
        // This path might occur if cleanup is called unexpectedly before details are ready
        console.error(
          "SSE_HELPER: Cleanup called in unexpected state, potentially before connection fully established or after destroy.",
        );
        // Reject if no details, might indicate premature closure or setup issue.
        reject(new Error("SSE cleanup called in unexpected state"));
      }
    };

    const options: http.RequestOptions = {
      hostname:
        serverAddress.address === "::" ? "localhost" : serverAddress.address,
      port: serverAddress.port,
      path: "/sse",
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        Connection: "keep-alive",
        "Cache-Control": "no-cache",
      },
    };

    console.log("SSE_HELPER: Creating http.request for SSE connection...");
    clientRequest = http.request(options, (res: http.IncomingMessage) => {
      console.log(`SSE_HELPER: Response received. Status: ${res.statusCode}`);
      if (res.statusCode !== 200) {
        cleanup(
          new Error(`SSE connection failed with status ${res.statusCode}`),
          undefined,
        );
        res.resume();
        return;
      }

      // Handler specifically for premature closure *during setup*
      const prematureCloseHandler = () => {
        if (!promiseSettled)
          cleanup(
            new Error("SSE stream closed prematurely during setup"),
            undefined,
          );
      };
      res.once("close", prematureCloseHandler);
      res.once("end", prematureCloseHandler); // Should not happen for SSE, but good practice
      res.setEncoding("utf8");

      res.on("data", (chunk: string) => {
        if (promiseSettled) return; // Ignore data after session ID is found
        console.log(
          `SSE_HELPER: Received chunk during setup: ${chunk.replace(/\n/g, "\\n")}`,
        );
        buffer += chunk;
        let messageEndIndex;
        // Process all complete messages in the buffer
        while (
          !promiseSettled &&
          (messageEndIndex = buffer.indexOf("\n\n")) !== -1
        ) {
          const message = buffer.substring(0, messageEndIndex);
          buffer = buffer.substring(messageEndIndex + 2); // Consume message and delimiter
          if (!promiseSettled) {
            // Double check within the loop
            const lines = message.split("\n");
            let eventType: string | null = null;
            let eventData: string | null = null;
            for (const line of lines) {
              if (line.startsWith("event: "))
                eventType = line.substring(7).trim();
              else if (line.startsWith("data: "))
                eventData = line.substring(6).trim();
            }

            // Look for the specific setup message
            if (eventType === "endpoint" && eventData) {
              const match = eventData.match(/sessionId=([a-f0-9-]{36})$/);
              if (match && match[1]) {
                console.log(`SSE_HELPER: Extracted sessionId: ${match[1]}`);
                // Successfully established, remove premature close handlers
                res.removeListener("close", prematureCloseHandler);
                res.removeListener("end", prematureCloseHandler);
                cleanup(undefined, {
                  sessionId: match[1],
                  sseResponseStream: res,
                });
              } else {
                cleanup(
                  new Error(
                    `Could not parse sessionId from endpoint data: ${eventData}`,
                  ),
                  undefined,
                );
              }
            } else {
              // Log other messages received during setup phase if necessary
              // console.log(`SSE_HELPER: Ignoring message during setup: event=${eventType}`);
            }
          }
        }
      });

      // General error handler for the response stream (after setup)
      res.on("error", (err) => {
        // Ignore specific errors if the promise is already settled and the request was deliberately destroyed
        if (
          promiseSettled &&
          clientRequest?.destroyed &&
          (err.message === "aborted" ||
            (err as NodeJS.ErrnoException).code === "ECONNRESET")
        ) {
          console.log(
            "SSE_HELPER: Ignoring expected error on destroyed connection (aborted/reset).",
          );
          return;
        }
        // If not settled, it's an error during setup or an unexpected error later
        console.error("SSE_HELPER: Error on SSE response stream:", err);
        if (!promiseSettled) {
          cleanup(err, undefined);
        }
        // If promise settled, this is an error after setup, potentially needs handling elsewhere if response is being actively listened to.
        // However, establishSseSession only cares about setup.
      });
    });

    // General error handler for the client request itself
    clientRequest.on("error", (err) => {
      // Ignore specific errors if the promise is already settled and the request was deliberately destroyed
      if (
        promiseSettled &&
        clientRequest?.destroyed &&
        (err.message === "socket hang up" ||
          (err as NodeJS.ErrnoException).code === "ECONNRESET")
      ) {
        console.log(
          "SSE_HELPER: Ignoring expected error on destroyed request (hang up/reset).",
        );
        return;
      }
      console.error("SSE_HELPER: Error on SSE client request:", err);
      if (!promiseSettled) {
        cleanup(err, undefined);
      }
    });

    // Timeout for the initial session ID exchange
    timeoutId = setTimeout(() => {
      if (!promiseSettled) {
        // Check again in case timeout fires late
        cleanup(
          new Error("Timeout waiting for SSE endpoint event (session ID)"),
          undefined,
        );
      }
    }, 5000); // 5 second timeout for initial connection

    console.log("SSE_HELPER: Ending http.request (sending initial GET)...");
    clientRequest.end(); // Send the GET request
  });
}

// --- Helper Function: Send JSON-RPC message via POST and wait for 202 Ack ---
async function sendJsonRpcMessage(
  serverAddress: AddressInfo,
  sessionId: string,
  payload: JsonRpcRequest,
  timeoutMs: number = 5000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const requestBodyString = JSON.stringify(payload);
    let clientRequest: http.ClientRequest | null = null;
    let timeoutId: NodeJS.Timeout | null = null;
    let promiseSettled = false;

    const cleanup = (err?: Error) => {
      if (promiseSettled) return;
      promiseSettled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (err) {
        if (clientRequest && !clientRequest.destroyed) {
          clientRequest.destroy(err);
        }
        console.error(
          `POST_HELPER: Rejecting POST promise for session ${sessionId}, id ${payload.id}:`,
          err.message,
        );
        reject(err);
      } else {
        console.log(
          `POST_HELPER: Resolving POST promise for session ${sessionId}, id ${payload.id}.`,
        );
        resolve(); // Resolve successfully (got 202)
      }
    };

    const options: http.RequestOptions = {
      hostname:
        serverAddress.address === "::" ? "localhost" : serverAddress.address,
      port: serverAddress.port,
      path: `/message?sessionId=${sessionId}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json", // Important for server to know we expect JSON ack potentially (though we only check status code here)
        "Content-Length": Buffer.byteLength(requestBodyString),
      },
    };

    console.log(
      `POST_HELPER: Creating POST request to ${options.hostname}:${options.port}${options.path} for id ${payload.id}`,
    );
    clientRequest = http.request(options, (res) => {
      console.log(
        `POST_HELPER: Received response for id ${payload.id}. Status: ${res.statusCode}`,
      );
      // We expect 202 Accepted for message processing acknowledgement
      if (res.statusCode === 202) {
        res.resume(); // Consume response data to free resources
        cleanup(); // Success
      } else {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (responseBody += chunk));
        res.on("end", () => {
          cleanup(
            new Error(
              `POST /message expected status 202 but got ${res.statusCode}. Body: ${responseBody}`,
            ),
          );
        });
        res.on("error", (err) => cleanup(err)); // Handle error on response stream itself
      }
    });

    // Handle errors on the request itself (e.g., connection refused)
    clientRequest.on("error", (err) => {
      if (
        promiseSettled &&
        clientRequest?.destroyed &&
        (err.message === "socket hang up" ||
          (err as NodeJS.ErrnoException).code === "ECONNRESET")
      )
        return; // Ignore expected errors post-cleanup
      cleanup(err);
    });

    // Set timeout for the POST request
    timeoutId = setTimeout(() => {
      cleanup(
        new Error(
          `Timeout waiting for POST /message acknowledgement for id ${payload.id}`,
        ),
      );
    }, timeoutMs);

    console.log(
      `POST_HELPER: Writing POST body for id ${payload.id}: ${requestBodyString}`,
    );
    clientRequest.write(requestBodyString);
    clientRequest.end(); // Send the request
  });
}

// --- Helper Function: Wait for a specific JSON-RPC response on the SSE stream ---
async function waitForSseResponse<T extends JsonRpcResponse>(
  sseResponseStream: http.IncomingMessage,
  expectedId: number | string,
  timeoutMs: number = 7000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let sseBuffer = "";
    let timeoutId: NodeJS.Timeout | null = null;
    let promiseSettled = false;

    const cleanup = (err?: Error, result?: T) => {
      if (promiseSettled) return;
      promiseSettled = true;
      if (timeoutId) clearTimeout(timeoutId);
      // Crucially, remove listeners to prevent leaks or interference
      sseResponseStream.removeListener("data", dataHandler);
      sseResponseStream.removeListener("error", errorHandler);
      sseResponseStream.removeListener("close", closeHandler);
      sseResponseStream.removeListener("end", closeHandler); // Also listen for end

      if (result) {
        console.log(`SSE_WAIT: Resolving SSE wait for id ${expectedId}.`);
        resolve(result);
      } else if (err) {
        console.error(
          `SSE_WAIT: Rejecting SSE wait for id ${expectedId}:`,
          err.message,
        );
        reject(err);
      } else {
        // Should not happen if called correctly
        reject(
          new Error(
            `SSE_WAIT: Cleanup called in unexpected state for id ${expectedId}`,
          ),
        );
      }
    };

    const dataHandler = (chunk: string) => {
      if (promiseSettled) return;
      console.log(
        `SSE_WAIT: Stream for id ${expectedId} received chunk: ${chunk.replace(/\n/g, "\\n")}`,
      );
      sseBuffer += chunk;
      let messageEndIndex;
      // Process all complete messages in the buffer
      while (
        !promiseSettled &&
        (messageEndIndex = sseBuffer.indexOf("\n\n")) !== -1
      ) {
        const message = sseBuffer.substring(0, messageEndIndex);
        sseBuffer = sseBuffer.substring(messageEndIndex + 2); // Consume message + delimiter

        console.log(
          `SSE_WAIT: Processing SSE message block for id ${expectedId}:\n${message}`,
        );
        const lines = message.split("\n");
        let sseData: string | null = null;
        let sseEvent: string | null = null;
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            sseData = line.substring(6).trim();
          } else if (line.startsWith("event: ")) {
            sseEvent = line.substring(7).trim();
          }
        }
        console.log(
          `SSE_WAIT: Parsed SSE for id ${expectedId} - Event: ${sseEvent}, Data: ${sseData ? sseData.substring(0, 80) + (sseData.length > 80 ? "..." : "") : "null"}`,
        );

        if (sseData) {
          try {
            const parsed: JsonRpcResponse = JSON.parse(sseData);
            // Check if it's the response we are waiting for
            if (
              typeof parsed === "object" &&
              parsed !== null &&
              parsed.jsonrpc === "2.0" &&
              "id" in parsed &&
              parsed.id === expectedId
            ) {
              console.log(
                `SSE_WAIT: Found matching JSON-RPC response (id: ${expectedId}).`,
              );
              cleanup(undefined, parsed as T); // Resolve with the found response
              return; // Stop processing further messages in this chunk
            } else if (
              typeof parsed === "object" &&
              parsed !== null &&
              "method" in parsed &&
              typeof parsed.method === "string" &&
              parsed.method.startsWith("notifications/")
            ) {
              console.log(
                `SSE_WAIT: Ignoring notification message: ${parsed.method}`,
              );
            } else {
              console.log(
                `SSE_WAIT: Ignoring SSE JSON data with different id/structure (Looking for: ${expectedId}, Got: ${parsed?.id})`,
              );
            }
          } catch (e) {
            // Log JSON parsing errors but continue waiting for other messages
            console.error(
              `SSE_WAIT: Failed to parse JSON from SSE data field for id ${expectedId}:`,
              sseData,
              e,
            );
          }
        } else {
          // Log message blocks without data if necessary
          // console.log(`SSE_WAIT: SSE message block for id ${expectedId} did not contain a 'data:' field.`);
        }
      } // End while loop processing buffer
    };

    const errorHandler = (err: Error) => {
      if (promiseSettled) return;
      console.error(
        `SSE_WAIT: Error on SSE stream while waiting for response id ${expectedId}:`,
        err,
      );
      cleanup(err);
    };

    const closeHandler = () => {
      if (promiseSettled) return;
      console.error(
        `SSE_WAIT: SSE stream closed/ended unexpectedly while waiting for response id ${expectedId}`,
      );
      cleanup(
        new Error(
          `SSE stream closed/ended unexpectedly while waiting for response id ${expectedId}`,
        ),
      );
    };

    // Attach listeners
    console.log(
      `SSE_WAIT: Attaching listeners to SSE stream, waiting for response id ${expectedId}...`,
    );
    sseResponseStream.on("data", dataHandler);
    sseResponseStream.once("error", errorHandler);
    sseResponseStream.once("close", closeHandler);
    sseResponseStream.once("end", closeHandler); // Also handle 'end' which signifies closure

    // Set timeout for waiting for the specific response
    timeoutId = setTimeout(() => {
      cleanup(
        new Error(
          `Timeout waiting for response id ${expectedId} on SSE stream`,
        ),
      );
    }, timeoutMs);
  });
}

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
    const { sessionId, sseResponseStream } =
      await establishSseSession(serverAddress);
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
    const { sessionId, sseResponseStream } =
      await establishSseSession(serverAddress);
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
    expect(sseResult.error).toBeUndefined(); // Expect no error property for a successful result
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
    const { sessionId, sseResponseStream } =
      await establishSseSession(serverAddress);
    console.log(`COUNT_TEST: SSE session established: ${sessionId}`);

    const requestPayload: JsonRpcRequest = {
      method: "tools/call", // Note: MCP uses 'tools/call' generally
      params: { name: "count_puzzles", arguments: {} }, // Adjust params based on MCP spec for tools/call
      jsonrpc: "2.0",
      id: 6, // Use a different ID
    };

    // Assuming the response structure for tools/call might be slightly different
    interface ToolCallResult {
      content: { type: string; text: string }[];
    }
    interface ToolCallJsonResponse extends JsonRpcResponse {
      id: number;
      result: ToolCallResult;
    }

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
