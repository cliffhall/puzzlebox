import http from "http";
import { AddressInfo } from "net";
import { JsonRpcRequest, JsonRpcResponse } from "./types.ts";

// --- Store active SSE connections (Response Streams) ---
export interface ActiveSseConnection {
  request: http.ClientRequest;
  response: http.IncomingMessage;
}

/**
 * Establish SSE session, get Session ID & Response Stream
 * @param serverAddress
 * @param activeSseConnections
 */
export async function establishSseSession(
  serverAddress: AddressInfo,
  activeSseConnections: Map<string, ActiveSseConnection>,
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
        /* istanbul ignore next */
        // This path might occur if cleanup is called unexpectedly before details are ready
        console.error(
          "SSE_HELPER: Cleanup called in unexpected state, potentially before connection fully established or after destroy.",
        );
        /* istanbul ignore next */
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
              // FIX #1: Made the regex more flexible to accept various session ID formats, not just 36-char UUIDs.
              const match = eventData.match(/sessionId=([a-zA-Z0-9-]+)$/);
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

/**
 * Send JSON-RPC message via POST and wait for 202 Ack
 * @param serverAddress
 * @param sessionId
 * @param payload
 * @param timeoutMs
 */
export async function sendJsonRpcMessage(
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
        resolve();
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

/**
 * Wait for a specific JSON-RPC response on the SSE stream
 * @param sseResponseStream
 * @param expectedId
 * @param timeoutMs
 */
export async function waitForSseResponse<T extends JsonRpcResponse>(
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
      sseResponseStream.removeListener("data", dataHandler);
      sseResponseStream.removeListener("error", errorHandler);
      sseResponseStream.removeListener("close", closeHandler);
      sseResponseStream.removeListener("end", closeHandler);

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

    const dataHandler = (chunk: Buffer | string) => {
      if (promiseSettled) return;
      const chunkStr = chunk.toString();
      console.log(
        `SSE_WAIT: Stream for id ${expectedId} received chunk: ${chunkStr.replace(/\n/g, "\\n")}`,
      );
      sseBuffer += chunkStr;
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
    sseResponseStream.once("end", closeHandler);

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
