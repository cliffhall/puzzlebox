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

  const { server } = createServer(transports, subscriptions); // Server for every new connection
  const transport = new SSEServerTransport("/message", res); // Create transport
  const sessionId = transport.sessionId; // Get the transport session id
  transports.set(sessionId, transport); // Store transport by session id

  // Handle close of connection
  server.onclose = () => {
    console.error("Client Disconnected: ", transport.sessionId);
    transports.delete(transport.sessionId);
  };

  await server.connect(transport);

  // --- *** FORCE A YIELD - IMPORTANT FOR TEST ENVIRONMENT *** ---
  // Give the event loop a chance to process the write operation.
  await new Promise((resolve) => setImmediate(resolve));
  // --- *** END FORCE YIELD *** ---

  console.log(
  `SERVER_LOG: /sse handler finished setup for sessionId: ${sessionId}. Response should remain open.`,
  );
});

// Connected clients post messages here
app.post("/message", async (req, res) => {
  const sessionId = req.query.sessionId as string; // Get the session id
  if (sessionId && transports.has(sessionId)) {
    // Only handle requests with an established session
    const transport = transports.get(sessionId) as SSEServerTransport;
    try {
      await transport.handlePostMessage(req, res);
    } catch (error) {
      console.error(
        `SERVER_LOG: Error handling POST /message for sessionId: ${sessionId}:`,
        error,
      );
      if (!res.headersSent) {
        res.status(500).send("Error handling message");
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  } else {
    console.warn(
      `SERVER_LOG: POST /message received for unknown/missing sessionId: ${sessionId}`,
    );
    res.status(404).send("Session not found");
  }
});

// Conditional listen based on NODE_ENV
let runningServer: http.Server | null = null;
if (process.env.NODE_ENV !== "test") {
  const PORT = process.env.PORT || 3001;
  runningServer = app.listen(PORT, () => {
    // Store server instance
    console.log(`Server is running on port ${PORT}`);
  });
}

// Graceful shutdown when requested
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing server");
  runningServer?.close(() => {
    console.log("Server closed");
  });
});

export default app;
