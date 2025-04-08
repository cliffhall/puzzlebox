// index.ts
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createServer } from "./puzzlebox.ts";
import express from "express";
import http from "http";

// The service app
const app = express();

// Data shared across all server/transport pairs
const transports: Map<string, Transport> = new Map<string, Transport>(); // Transports by sessionId
const subscriptions: Map<string, Set<string>> = new Map<string, Set<string>>(); // Subscriber sessionIds by uri

// Clients connect here first
app.get("/sse", async (req, res) => {
  // console.log('SERVER_LOG: /sse handler started'); // Added Log
  const { server } = createServer(transports, subscriptions); // Server for every new connection
  const transport = new SSEServerTransport("/message", res); // Create transport
  const sessionId = transport.sessionId; // Get the transport session id
  // console.log(`SERVER_LOG: Created transport with sessionId: ${sessionId}`); // Added Log
  transports.set(sessionId, transport); // Store transport by session id

  // Keep track if close handler was called to prevent double logging/errors
  let closed = false;
  res.on("close", () => {
    if (closed) return;
    closed = true;
    // console.log(`SERVER_LOG: Connection closed for sessionId: ${sessionId}`); // Added Log
    transports.delete(sessionId);
    // TODO: Consider removing session from subscriptions here too
  });

  try {
    // console.log(`SERVER_LOG: Attempting server.connect for sessionId: ${sessionId}`); // Added Log
    // SDK's server.connect likely calls transport.start() which writes the event
    await server.connect(transport);
    // console.log(`SERVER_LOG: server.connect seemingly successful for sessionId: ${sessionId}`); // Added Log

    // --- *** FORCE A YIELD - IMPORTANT FOR TEST ENVIRONMENTS *** ---
    // Give the event loop a chance to process the write operation.
    await new Promise(resolve => setImmediate(resolve));
    // console.log(`SERVER_LOG: Yielded event loop after connect for sessionId: ${sessionId}`); // Added Log
    // --- *** END FORCE YIELD *** ---

  } catch (error) {
    console.error(`SERVER_LOG: Error during server.connect/yield for sessionId: ${sessionId}:`, error); // Added Log
    if (!closed) { // Only act if not already closed
      transports.delete(sessionId); // Clean up transport
      if (!res.headersSent) {
        console.error(`SERVER_LOG: Sending 500 due to connect error.`); // Added Log
        res.status(500).send('Internal Server Error during connection setup');
      } else if (!res.writableEnded) {
        console.error(`SERVER_LOG: Ending response due to connect error after headers sent.`); // Added Log
        res.end(); // End the response if possible
      }
    }
  }
  // For SSE, we DON'T end the response here. It stays open.
  // console.log(`SERVER_LOG: /sse handler finished setup for sessionId: ${sessionId}. Response should remain open.`); // Added Log
});

// Connected clients post messages here
app.post("/message", async (req, res) => {
  console.log(`SERVER_LOG: POST /message received for sessionId: ${req.query.sessionId}`); // Added Log
  const sessionId = req.query.sessionId as string; // Get the session id
  if (sessionId && transports.has(sessionId)) {
    // Only handle requests with an established session
    const transport = transports.get(sessionId) as SSEServerTransport; // Get the transport for the session
    try {
      await transport.handlePostMessage(req, res); // Handle the posted message
      console.log(`SERVER_LOG: Handled POST /message for sessionId: ${sessionId}`); // Added Log
    } catch (error) {
      console.error(`SERVER_LOG: Error handling POST /message for sessionId: ${sessionId}:`, error); // Added Log
      if (!res.headersSent) {
        res.status(500).send('Error handling message');
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  } else {
    console.warn(`SERVER_LOG: POST /message received for unknown/missing sessionId: ${sessionId}`); // Added Log
    res.status(404).send('Session not found');
  }
});

// Conditional listen based on NODE_ENV
let runningServer: http.Server | null = null;
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3001;
  runningServer = app.listen(PORT, () => { // Store server instance
    console.log(`Server is running on port ${PORT}`);
  });
}

// Graceful shutdown if needed (optional but good practice)
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  runningServer?.close(() => {
    console.log('HTTP server closed');
  });
});


export default app;
