import http from 'http';
import app from '../index.ts';
import { AddressInfo } from 'net';

// --- Store active SSE connections (Response Streams) ---
interface ActiveSseConnection {
  request: http.ClientRequest;
  response: http.IncomingMessage;
  listenerAttached: boolean; // To avoid duplicate listeners
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
      if (err && clientRequest && !clientRequest.destroyed) { /* ... destroy on error ... */ clientRequest.destroy(err); reject(err); }
      else if (details?.sessionId && details?.sseResponseStream && clientRequest) { /* ... store and resolve ... */
        activeSseConnections.set(details.sessionId, { request: clientRequest, response: details.sseResponseStream, listenerAttached: false });
        resolve(details);
      } else if (err) { /* ... reject on other errors ... */ reject(err); }
      else { /* ... reject on unexpected state ... */ reject(new Error("SSE cleanup called in unexpected state")); }
    };

    const options: http.RequestOptions = { hostname: serverAddress.address === '::' ? 'localhost' : serverAddress.address, port: serverAddress.port, path: '/sse', method: 'GET', headers: { 'Accept': 'text/event-stream', 'Connection': 'keep-alive' } };
    clientRequest = http.request(options, (res: http.IncomingMessage) => {
      if (res.statusCode !== 200) { /* ... error handling ... */ cleanup(new Error(`SSE connection failed with status ${res.statusCode}`)); res.resume(); return; }
      const prematureCloseHandler = () => { !promiseSettled && cleanup(new Error("SSE stream closed prematurely")); }
      res.once('close', prematureCloseHandler); res.once('end', prematureCloseHandler);
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        if (promiseSettled) return;
        buffer += chunk;
        let messageEndIndex;
        while (!promiseSettled && (messageEndIndex = buffer.indexOf('\n\n')) !== -1) {
          const message = buffer.substring(0, messageEndIndex);
          buffer = buffer.substring(messageEndIndex + 2);
          if (!promiseSettled) { // Check again after consuming buffer
            const lines = message.split('\n'); let eventType: string | null = null; let eventData: string | null = null;
            for (const line of lines) { if (line.startsWith('event: ')) eventType = line.substring(7).trim(); else if (line.startsWith('data: ')) eventData = line.substring(6).trim(); }
            if (eventType === 'endpoint' && eventData) {
              const match = eventData.match(/sessionId=([a-f0-9-]{36})$/);
              if (match && match[1]) {
                res.removeListener('close', prematureCloseHandler); res.removeListener('end', prematureCloseHandler);
                cleanup(undefined, { sessionId: match[1], sseResponseStream: res });
              } else { cleanup(new Error(`Could not parse sessionId from endpoint data: ${eventData}`)); }
            }
          }
        }
      });
      res.on('error', (err) => { /* ... error handling ... */ !promiseSettled && cleanup(err); });
    });
    clientRequest.on('error', (err) => { /* ... error handling ... */ !promiseSettled && cleanup(err); });
    timeoutId = setTimeout(() => { cleanup(new Error("Timeout waiting for SSE endpoint event")); }, 5000);
    clientRequest.end();
  });
}
// --- End Helper Function ---


describe('Puzzlebox API', () => {
  let server: http.Server;
  let serverAddress: AddressInfo;

  beforeAll((done) => { /* ... same setup ... */
    server = http.createServer(app);
    server.listen(() => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { done(new Error("Server address is not an AddressInfo object")); return; }
      serverAddress = addr;
      // console.log(`TEST_LOG: Test server listening on: http://localhost:${serverAddress.port}`);
      done();
    });
    server.on('error', (err) => { console.error('TEST_LOG: Test server error:', err); });
  });

  afterEach(() => { /* ... same cleanup ... */
    // console.log(`TEST_LOG: Cleaning up ${activeSseConnections.size} active SSE connections...`);
    activeSseConnections.forEach((conn, sessionId) => {
      if (conn.request && !conn.request.destroyed) {
        // console.log(`TEST_LOG: Destroying active SSE request for sessionId: ${sessionId}`);
        conn.request.destroy();
      }
      if (conn.response) { conn.response.removeAllListeners(); }
    });
    activeSseConnections.clear();
  });

  afterAll((done) => { /* ... same teardown ... */
    activeSseConnections.forEach((conn) => { if (conn.request && !conn.request.destroyed) conn.request.destroy(); });
    activeSseConnections.clear();
    if (server) { server.close((err) => { /* ... */ done(err); }); }
    else { done(); }
  });

  // --- GET /sse test ---
  it('GET /sse should establish a session', async () => {
    const { sessionId, sseResponseStream } = await establishSseSession(serverAddress);
    expect(sessionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(sseResponseStream).toBeDefined();
    expect(activeSseConnections.has(sessionId)).toBe(true);
  }, 10000);

  // --- POST /message test ---
  it('POST /message should trigger response on SSE stream for tools/list', async () => {
    if (!serverAddress) throw new Error('Server address not available'); // Uses serverAddress

    // console.log("MSG_TEST: Establishing SSE session...");
    const { sessionId, sseResponseStream } = await establishSseSession(serverAddress); // Uses establishSseSession, serverAddress
    // console.log(`MSG_TEST: SSE session established: ${sessionId}`);
    const sseConn = activeSseConnections.get(sessionId); // Uses activeSseConnections
    if (!sseConn) throw new Error("SSE connection details not found in map");

    const requestPayload = { method: "tools/list", params: {}, jsonrpc: "2.0", id: 5 }; // Use a unique ID
    const requestBodyString = JSON.stringify(requestPayload);

    // Promise to wait for the correct response on the SSE stream
    const sseResponsePromise = new Promise<any>((resolveSse, rejectSse) => {
      let sseBuffer = '';
      const sseTimeout = setTimeout(() => rejectSse(new Error("Timeout waiting for tools/list response on SSE stream")), 7000);

      const dataHandler = (chunk: string) => {
        // // console.log(`MSG_TEST: SSE Stream received chunk: ${chunk.replace(/\n/g, '\\n')}`); // Reduce noise
        sseBuffer += chunk;
        let messageEndIndex;
        while ((messageEndIndex = sseBuffer.indexOf('\n\n')) !== -1) {
          const message = sseBuffer.substring(0, messageEndIndex);
          sseBuffer = sseBuffer.substring(messageEndIndex + 2);
          // // console.log(`MSG_TEST: Processing SSE message block:\n${message}`); // Reduce noise

          const lines = message.split('\n'); let sseEventType: string | null = null; let sseData: string | null = null;
          for (const line of lines) { if (line.startsWith('event: ')) { sseEventType = line.substring(7).trim(); } else if (line.startsWith('data: ')) { sseData = line.substring(6).trim(); } }
          // // console.log(`MSG_TEST: Parsed SSE - Event: ${sseEventType}, Data: ${sseData ? sseData.substring(0, 50) + '...' : 'null'}`); // Reduce noise

          if (sseData) {
            try {
              const parsed = JSON.parse(sseData);
              if (parsed.jsonrpc === "2.0" && parsed.id === requestPayload.id) {
                // console.log("MSG_TEST: Found matching JSON-RPC response in SSE data.");
                clearTimeout(sseTimeout);
                sseResponseStream.removeListener('data', dataHandler); sseResponseStream.removeListener('error', errorHandler); sseResponseStream.removeListener('close', closeHandler);
                resolveSse(parsed);
                return;
              } else if (parsed.jsonrpc === "2.0" && parsed.method?.startsWith('notifications/')) { /* Ignore notifications */ }
              else { /* Ignore other JSON */ }
            } catch (e) { console.error("MSG_TEST: Failed to parse JSON from SSE data field:", sseData, e); }
          }
        } // end while
      }; // end dataHandler

      const errorHandler = (err: Error) => { /* ... same error handler ... */ console.error("MSG_TEST: Error on SSE stream while waiting for response:", err); clearTimeout(sseTimeout); rejectSse(err); };
      const closeHandler = () => { /* ... same close handler ... */ console.error("MSG_TEST: SSE stream closed while waiting for response"); clearTimeout(sseTimeout); rejectSse(new Error("SSE stream closed unexpectedly while waiting for response")); };

      // console.log("MSG_TEST: Attaching listener to SSE stream...");
      sseResponseStream.on('data', dataHandler); sseResponseStream.once('error', errorHandler); sseResponseStream.once('close', closeHandler);
      sseConn.listenerAttached = true;
    }); // end sseResponsePromise

    const postAckPromise = new Promise<void>((resolvePost, rejectPost) => {
      const options: http.RequestOptions = {
        hostname: serverAddress.address === '::' ? 'localhost' : serverAddress.address,
        port: serverAddress.port, path: `/message?sessionId=${sessionId}`, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(requestBodyString) }
      };
      let postTimeout = setTimeout(() => rejectPost(new Error("Timeout waiting for POST /message acknowledgement")), 5000);

      // console.log(`MSG_TEST: Creating http.request POST to http://${options.hostname}:${options.port}${options.path}`);
      const clientRequest = http.request(options, (res) => {
        clearTimeout(postTimeout);
        // console.log(`MSG_TEST: POST Response received. Status: ${res.statusCode}`);
        if (res.statusCode === 202) {
          // console.log("MSG_TEST: Received expected 202 Accepted for POST.");
          res.resume();
          resolvePost();
        } else {
          rejectPost(new Error(`POST /message expected status 202 but got ${res.statusCode}`));
          res.resume();
        }
      });
      clientRequest.on('error', (err) => { clearTimeout(postTimeout); rejectPost(err); });
      // console.log("MSG_TEST: Writing POST request body...");
      clientRequest.write(requestBodyString);
      clientRequest.end();
    }); // end postAckPromise

    // Wait for both the POST acknowledgement AND the response on the SSE stream
    // console.log("MSG_TEST: Waiting for POST acknowledgement and SSE response...");
    const [, sseResult] = await Promise.all([postAckPromise, sseResponsePromise]); // Uses postAckPromise
    // console.log("MSG_TEST: Both POST acknowledged and SSE response received.");

    // Assertions on the SSE response result
    expect(sseResult).toHaveProperty('jsonrpc', '2.0');
    expect(sseResult).toHaveProperty('id', requestPayload.id);
    expect(sseResult).toHaveProperty('result');
    expect(sseResult.result).toHaveProperty('tools');
    expect(Array.isArray(sseResult.result.tools)).toBe(true);
    expect(sseResult.result.tools.length).toBeGreaterThan(0);
    const toolNames = sseResult.result.tools.map((t: any) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining([
      "add_puzzle", "get_puzzle_snapshot", "perform_action_on_puzzle", "count_puzzles"
    ]));
    // console.log("MSG_TEST: Assertions passed for SSE response content.");

  }, 15000); // Jest timeout

});
