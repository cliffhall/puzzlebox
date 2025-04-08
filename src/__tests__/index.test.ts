import http from 'http';
import app from '../index.ts';
import { AddressInfo } from 'net';

describe('GET /sse', () => {
  let server: http.Server;
  let serverAddress: AddressInfo;

  beforeAll((done) => {
    server = http.createServer(app);
    server.listen(() => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        done(new Error("Server address is not an AddressInfo object")); // Pass error to done
        return;
      }
      serverAddress = addr;
      // console.log(`TEST_LOG: Test server listening on: http://localhost:${serverAddress.port}`);
      done();
    });
    server.on('error', (err: Error) => {
      // console.error('TEST_LOG: Test server error:', err);
      // Optional: Fail tests if server has unexpected error during run
      // throw err;
    });
  });

  afterAll((done) => {
    if (server) {
      server.close((err) => {
        if (err) {
          // console.error("TEST_LOG: Error closing test server:", err);
        } else {
          // console.log("TEST_LOG: Test server closed.");
        }
        done(err);
      });
    } else {
      done();
    }
  });


  it('should receive the "endpoint" SSE event using http.request', async () => {
    if (!serverAddress) {
      throw new Error('Server address not available');
    }

    await new Promise<void>((resolve, reject) => {
      let buffer = '';
      let clientRequest: http.ClientRequest | null = null;
      let timeoutId: NodeJS.Timeout | null = null;
      // --- FIX: Add flag to track promise state ---
      let promiseSettled = false;

      const cleanup = (err?: Error) => {
        // --- FIX: Prevent multiple cleanup calls ---
        if (promiseSettled) {
          // console.log("TEST_LOG: Cleanup called but promise already settled.");
          return;
        }
        promiseSettled = true; // Mark as settled immediately
        // --- End Fix ---

        if (timeoutId) clearTimeout(timeoutId);

        // Ensure clientRequest exists and hasn't been destroyed before destroying
        if (clientRequest && !clientRequest.destroyed) {
          // console.log(`TEST_LOG: Destroying request in cleanup ${err ? 'due to error' : 'after success'}.`);
          // Pass the error to destroy ONLY if we are cleaning up due to an error
          clientRequest.destroy(err);
        } else if (clientRequest?.destroyed) {
          // console.log("TEST_LOG: Request already destroyed when cleanup called.");
        } else {
          // console.log("TEST_LOG: Client request reference missing in cleanup.");
        }

        if (err) {
          // console.error("TEST_LOG: Rejecting promise.", err.message);
          reject(err);
        } else {
          // console.log("TEST_LOG: Resolving promise.");
          resolve();
        }
      };

      const options: http.RequestOptions = {
        hostname: serverAddress.address === '::' ? 'localhost' : serverAddress.address,
        port: serverAddress.port,
        path: '/sse',
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Connection': 'keep-alive'
        }
      };

      // console.log(`TEST_LOG: Creating http.request to http://${options.hostname}:${options.port}${options.path}`);

      clientRequest = http.request(options, (res: http.IncomingMessage) => {
        // console.log(`TEST_LOG: Response received. Status: ${res.statusCode}, Headers: ${JSON.stringify(res.headers)}`);

        if (res.statusCode !== 200) {
          cleanup(new Error(`Expected status code 200 but got ${res.statusCode}`));
          res.resume();
          return;
        }
        // Add more header checks if needed

        res.setEncoding('utf8');

        res.on('data', (chunk: string) => {
          if (promiseSettled) return; // Ignore data after cleanup started
          // console.log(`TEST_LOG: <<< RAW DATA CHUNK RECEIVED (${chunk.length} chars) >>>\n${chunk}\n<<< END RAW CHUNK >>>`);
          buffer += chunk;
          // console.log(`TEST_LOG: Current buffer: [${buffer.replace(/\n/g, '\\n')}]`);

          let eventType: string | null = null;
          let eventData: string | null = null;

          let messageEndIndex;
          while (!promiseSettled && (messageEndIndex = buffer.indexOf('\n\n')) !== -1) {
            const message = buffer.substring(0, messageEndIndex);
            buffer = buffer.substring(messageEndIndex + 2);
            // console.log(`TEST_LOG: Processing message: [${message.replace(/\n/g, '\\n')}] Remaining buffer: [${buffer.replace(/\n/g, '\\n')}]`);

            const lines = message.split('\n');
            eventType = null;
            eventData = null;

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.substring(7).trim();
              } else if (line.startsWith('data: ')) {
                eventData = line.substring(6).trim();
              }
            }
            // console.log(`TEST_LOG: Parsed - Event: ${eventType}, Data: ${eventData}`);

            if (eventType === 'endpoint') {
              // console.log('TEST_LOG: Found "endpoint" event!');
              try {
                expect(eventType).toBe('endpoint');
                expect(eventData).toMatch(/^\/message\?sessionId=[a-f0-9-]{36}$/);
                // console.log('TEST_LOG: Assertions passed.');
                cleanup(); // Resolve successfully
                // No return needed here as the promiseSettled flag handles subsequent calls
              } catch (assertionError) {
                // console.error('TEST_LOG: Assertion failed.');
                cleanup(assertionError as Error); // Reject with assertion error
              }
            } //else {
              // console.log('TEST_LOG: Received event other than "endpoint", continuing...');
            // }
          } // end while

          if (!promiseSettled && buffer.length > 0) {
            // console.log(`TEST_LOG: Partial message in buffer, waiting for more data...`);
          }
        }); // End res.on('data')

        res.on('error', (err: Error) => {
          // --- FIX: Ignore errors after promise settled, especially expected abort errors ---
          if (promiseSettled && (err.message === 'aborted' || (err as NodeJS.ErrnoException).code === 'ECONNRESET')) {
            // console.log(`TEST_LOG: Ignoring expected response stream error after request destroyed: ${err.message}`);
            return;
          }
          if (promiseSettled) return; // Ignore other errors too if already settled
          // --- End Fix ---
          // console.error('TEST_LOG: Unexpected response stream error:', err);
          cleanup(err);
        });

        res.on('close', () => {
          // console.log("TEST_LOG: Response stream closed.");
          // Optional: If close happens before success/error, trigger failure.
          // if (!promiseSettled) {
          //    cleanup(new Error("Stream closed unexpectedly before finding event or timeout"));
          // }
        });

        res.on('end', () => {
          // console.log("TEST_LOG: Response stream ended.");
          if (!promiseSettled) {
            cleanup(new Error("Stream ended unexpectedly before finding event"));
          }
        });

      }); // End http.request callback

      clientRequest.on('error', (err: Error) => {
        // --- FIX: Check promiseSettled here too ---
        if (promiseSettled && (err.message === 'socket hang up' || (err as NodeJS.ErrnoException).code === 'ECONNRESET')) {
          // console.log(`TEST_LOG: Ignoring expected request error after request destroyed: ${err.message}`);
          return;
        }
        if (promiseSettled) return;
        // --- End Fix ---
        // console.error('TEST_LOG: Request initiation error:', err);
        cleanup(err);
      });

      // console.log("TEST_LOG: Setting timeout...");
      timeoutId = setTimeout(() => {
        // --- FIX: Check promiseSettled before timing out ---
        if (promiseSettled) return;
        // console.error('TEST_LOG: Timeout! Waiting for "endpoint" SSE event expired.');
        cleanup(new Error('Test timed out waiting for "endpoint" SSE event'));
      }, 7000); // Timeout

      // console.log("TEST_LOG: Ending http.request (sending it)...");
      clientRequest.end(); // Send the request

    }); // End of new Promise
  }, 10000); // Jest timeout
});
