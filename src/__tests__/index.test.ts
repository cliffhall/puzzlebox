// --- START OF FILE src/__tests__/index.test.ts ---

import http from 'http';
// Removed 'net' import as it was unused
import app from '../index.ts';
import { AddressInfo } from 'net'; // Keep AddressInfo import

// --- Type Definitions ---
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object; // Or a more specific JSON Schema type if available/needed
}

interface ToolsListResult {
  tools: ToolDefinition[];
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// More specific type for the tools/list response promise
interface ToolsListJsonResponse extends JsonRpcResponse {
  id: number; // Match our request id type
  result: ToolsListResult;
}

// --- Store active SSE connections (Response Streams) ---
interface ActiveSseConnection {
  request: http.ClientRequest;
  response: http.IncomingMessage;
  listenerAttached: boolean;
}
const activeSseConnections: Map<string, ActiveSseConnection> = new Map();

// --- Helper Function: Establish SSE, get Session ID & Response Stream ---
async function establishSseSession(serverAddress: AddressInfo): Promise<{ sessionId: string; sseResponseStream: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let clientRequest: http.ClientRequest | null = null;
    let timeoutId: NodeJS.Timeout | null = null;
    let promiseSettled = false;

    const cleanup = (err?: Error, details?: { sessionId: string; sseResponseStream: http.IncomingMessage }) => {
      if (promiseSettled) return;
      promiseSettled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (err && clientRequest && !clientRequest.destroyed) {
        console.log("SSE_HELPER: Destroying SSE request due to error.");
        clientRequest.destroy(err);
        reject(err);
      } else if (details?.sessionId && details?.sseResponseStream && clientRequest) {
        console.log(`SSE_HELPER: Resolving with sessionId ${details.sessionId}. Keeping connection open.`);
        activeSseConnections.set(details.sessionId, { request: clientRequest, response: details.sseResponseStream, listenerAttached: false });
        resolve(details);
      } else if (err) {
        console.error("SSE_HELPER: Rejecting SSE promise.", err.message);
        reject(err);
      } else {
        reject(new Error("SSE cleanup called in unexpected state"));
      }
    };

    const options: http.RequestOptions = { hostname: serverAddress.address === '::' ? 'localhost' : serverAddress.address, port: serverAddress.port, path: '/sse', method: 'GET', headers: { 'Accept': 'text/event-stream', 'Connection': 'keep-alive' } };

    console.log("SSE_HELPER: Creating http.request for SSE connection...");
    clientRequest = http.request(options, (res: http.IncomingMessage) => {
      console.log(`SSE_HELPER: Response received. Status: ${res.statusCode}`);
      if (res.statusCode !== 200) { cleanup(new Error(`SSE connection failed with status ${res.statusCode}`)); res.resume(); return; }

      const prematureCloseHandler = () => { if (!promiseSettled) cleanup(new Error("SSE stream closed prematurely")); }
      res.once('close', prematureCloseHandler); res.once('end', prematureCloseHandler);
      res.setEncoding('utf8');

      res.on('data', (chunk: string) => {
        if (promiseSettled) return;
        // console.log(`SSE_HELPER: Received chunk: ${chunk.replace(/\n/g, '\\n')}`);
        buffer += chunk;
        let messageEndIndex;
        while (!promiseSettled && (messageEndIndex = buffer.indexOf('\n\n')) !== -1) {
          const message = buffer.substring(0, messageEndIndex);
          buffer = buffer.substring(messageEndIndex + 2);
          if (!promiseSettled) {
            const lines = message.split('\n'); let eventType: string | null = null; let eventData: string | null = null;
            for (const line of lines) { if (line.startsWith('event: ')) eventType = line.substring(7).trim(); else if (line.startsWith('data: ')) eventData = line.substring(6).trim(); }
            if (eventType === 'endpoint' && eventData) {
              const match = eventData.match(/sessionId=([a-f0-9-]{36})$/);
              if (match && match[1]) {
                // console.log(`SSE_HELPER: Extracted sessionId: ${match[1]}`);
                res.removeListener('close', prematureCloseHandler); res.removeListener('end', prematureCloseHandler);
                cleanup(undefined, { sessionId: match[1], sseResponseStream: res });
              } else { cleanup(new Error(`Could not parse sessionId from endpoint data: ${eventData}`)); }
            } else {
              // console.log(`SSE_HELPER: Ignoring message during setup: event=${eventType}`);
            }
          }
        }
      });

      // Fix: Use if statement for no-unused-expressions
      res.on('error', (err) => {
        if (promiseSettled && clientRequest?.destroyed && (err.message === 'aborted' || (err as NodeJS.ErrnoException).code === 'ECONNRESET')) return;
        if (!promiseSettled) {
          cleanup(err);
        }
      });
    });

    // Fix: Use if statement for no-unused-expressions
    clientRequest.on('error', (err) => {
      if (promiseSettled && clientRequest?.destroyed && (err.message === 'socket hang up' || (err as NodeJS.ErrnoException).code === 'ECONNRESET')) return;
      if (!promiseSettled) {
        cleanup(err);
      }
    });

    timeoutId = setTimeout(() => { cleanup(new Error("Timeout waiting for SSE endpoint event")); }, 5000);
    console.log("SSE_HELPER: Ending http.request (sending)...");
    clientRequest.end();
  });
}
// --- End Helper Function ---


describe('Puzzlebox API', () => {
  let server: http.Server;
  let serverAddress: AddressInfo;

  beforeAll((done) => {
    server = http.createServer(app);
    server.listen(() => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { done(new Error("Server address is not an AddressInfo object")); return; }
      serverAddress = addr;
      console.log(`TEST_LOG: Test server listening on: http://localhost:${serverAddress.port}`);
      done();
    });
    server.on('error', (err) => { console.error('TEST_LOG: Test server error:', err); });
  });

  afterEach(() => {
    console.log(`TEST_LOG: Cleaning up ${activeSseConnections.size} active SSE connections...`);
    activeSseConnections.forEach((conn, _sessionId) => {
      if (conn.request && !conn.request.destroyed) {
        console.log(`TEST_LOG: Destroying active SSE request for sessionId: ${_sessionId}`);
        conn.request.destroy();
      }
      if (conn.response) {
        conn.response.removeAllListeners();
      }
    });
    activeSseConnections.clear();
  });

  afterAll((done) => {
    activeSseConnections.forEach((conn) => { if (conn.request && !conn.request.destroyed) conn.request.destroy(); });
    activeSseConnections.clear();
    if (server) { server.close((err) => { if (err) console.error("TEST_LOG: Error closing test server:", err); else done(err); }); }
    else { done(); }
  });

  it('GET /sse should establish a session', async () => {
    const { sessionId, sseResponseStream } = await establishSseSession(serverAddress);
    expect(sessionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(sseResponseStream).toBeDefined();
    expect(activeSseConnections.has(sessionId)).toBe(true);
  }, 10000);

  it('POST /message should trigger response on SSE stream for tools/list', async () => {
    if (!serverAddress) throw new Error('Server address not available');

    console.log("MSG_TEST: Establishing SSE session...");
    const { sessionId, sseResponseStream } = await establishSseSession(serverAddress);
    console.log(`MSG_TEST: SSE session established: ${sessionId}`);
    const sseConn = activeSseConnections.get(sessionId);
    if (!sseConn) throw new Error("SSE connection details not found in map");

    const requestPayload = { method: "tools/list", params: {}, jsonrpc: "2.0", id: 5 };
    const requestBodyString = JSON.stringify(requestPayload);

    // Fix: Use specific type for no-explicit-any
    const sseResponsePromise = new Promise<ToolsListJsonResponse>((resolveSse, rejectSse) => {
      let sseBuffer = '';
      const sseTimeout = setTimeout(() => rejectSse(new Error("Timeout waiting for tools/list response on SSE stream")), 7000);

      const dataHandler = (chunk: string) => {
        // console.log(`MSG_TEST: SSE Stream received chunk: ${chunk.replace(/\n/g, '\\n')}`);
        sseBuffer += chunk;
        let messageEndIndex;
        while ((messageEndIndex = sseBuffer.indexOf('\n\n')) !== -1) {
          const message = sseBuffer.substring(0, messageEndIndex);
          sseBuffer = sseBuffer.substring(messageEndIndex + 2);
          // console.log(`MSG_TEST: Processing SSE message block:\n${message}`);

          const lines = message.split('\n');
          // Fix: Removed unused variable sseEventType
          let sseData: string | null = null;

          for (const line of lines) {
            // Only parse data
            if (line.startsWith('data: ')) {
              sseData = line.substring(6).trim();
            }
          }
          // console.log(`MSG_TEST: Parsed SSE - Data: ${sseData ? sseData.substring(0, 50) + '...' : 'null'}`);

          if (sseData) {
            try {
              const parsed: JsonRpcResponse = JSON.parse(sseData); // Use base type first
              if (typeof parsed === 'object' && parsed !== null && parsed.jsonrpc === "2.0" && parsed.id === requestPayload.id) {
                console.log("MSG_TEST: Found matching JSON-RPC response in SSE data.");
                clearTimeout(sseTimeout);
                sseResponseStream.removeListener('data', dataHandler);
                sseResponseStream.removeListener('error', errorHandler);
                sseResponseStream.removeListener('close', closeHandler);
                // Cast or validate before resolving if needed, but basic check is done
                resolveSse(parsed as ToolsListJsonResponse);
                return;
              } else if (typeof parsed === 'object' && parsed !== null && 'method' in parsed && typeof parsed.method === 'string' && parsed.method.startsWith('notifications/')) {
                // console.log(`MSG_TEST: Ignoring SSE notification message: ${parsed.method}`);
              } else {
                // console.log(`MSG_TEST: Ignoring SSE JSON data with different id/structure (id: ${parsed?.id})`);
              }
            } catch (e) {
              console.error("MSG_TEST: Failed to parse JSON from SSE data field:", sseData, e);
            }
          } else {
            // console.log(`MSG_TEST: SSE message block did not contain a 'data:' field.`);
          }
        } // end while
      }; // end dataHandler

      const errorHandler = (err: Error) => { console.error("MSG_TEST: Error on SSE stream while waiting for response:", err); clearTimeout(sseTimeout); rejectSse(err); };
      const closeHandler = () => { console.error("MSG_TEST: SSE stream closed while waiting for response"); clearTimeout(sseTimeout); rejectSse(new Error("SSE stream closed unexpectedly while waiting for response")); }

      console.log("MSG_TEST: Attaching listener to SSE stream...");
      sseResponseStream.on('data', dataHandler);
      sseResponseStream.once('error', errorHandler);
      sseResponseStream.once('close', closeHandler);
      if (sseConn) sseConn.listenerAttached = true; // Check sseConn exists
    }); // end sseResponsePromise

    // Promise for the POST request itself
    const postAckPromise = new Promise<void>((resolvePost, rejectPost) => {
      const options: http.RequestOptions = {
        hostname: serverAddress.address === '::' ? 'localhost' : serverAddress.address,
        port: serverAddress.port, path: `/message?sessionId=${sessionId}`, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(requestBodyString) }
      };
      let postTimeout = setTimeout(() => rejectPost(new Error("Timeout waiting for POST /message acknowledgement")), 5000);

      console.log(`MSG_TEST: Creating http.request POST to http://${options.hostname}:${options.port}${options.path}`);
      const clientRequest = http.request(options, (res) => {
        clearTimeout(postTimeout);
        console.log(`MSG_TEST: POST Response received. Status: ${res.statusCode}`);
        if (res.statusCode === 202) {
          console.log("MSG_TEST: Received expected 202 Accepted for POST.");
          res.resume();
          resolvePost();
        } else {
          rejectPost(new Error(`POST /message expected status 202 but got ${res.statusCode}`));
          res.resume();
        }
      });
      clientRequest.on('error', (err) => { clearTimeout(postTimeout); rejectPost(err); });
      console.log("MSG_TEST: Writing POST request body...");
      clientRequest.write(requestBodyString);
      clientRequest.end();
    }); // end postAckPromise

    // Wait for both the POST acknowledgement AND the response on the SSE stream
    console.log("MSG_TEST: Waiting for POST acknowledgement and SSE response...");
    const [, sseResult] = await Promise.all([postAckPromise, sseResponsePromise]);
    console.log("MSG_TEST: Both POST acknowledged and SSE response received.");

    // Assertions on the SSE response result
    expect(sseResult).toHaveProperty('jsonrpc', '2.0');
    expect(sseResult).toHaveProperty('id', requestPayload.id);
    expect(sseResult).toHaveProperty('result');
    expect(sseResult.result).toHaveProperty('tools');
    expect(Array.isArray(sseResult.result.tools)).toBe(true);
    expect(sseResult.result.tools.length).toBeGreaterThan(0);
    // Fix: Use specific type in map callback for no-explicit-any
    const toolNames = sseResult.result.tools.map((t: ToolDefinition) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining([
      "add_puzzle", "get_puzzle_snapshot", "perform_action_on_puzzle", "count_puzzles"
    ]));
    console.log("MSG_TEST: Assertions passed for SSE response content.");

  }, 15000); // Jest timeout

});
// --- END OF FILE src/__tests__/index.test.ts ---
