import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import express, { Request, Response } from "express";
import { createServer } from "./puzzlebox.ts";
import { randomUUID } from "node:crypto";

console.log("Starting Streamable HTTP server...");

const app = express();

// Data shared across all server/transport pairs
const transports = new Map<string, StreamableHTTPServerTransport>();
const subscriptions = new Map<string, Set<string>>();

app.post("/mcp", async (req: Request, res: Response) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      // This is a subsequent message for an existing session.
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    } else if (!sessionId) {
      // This is a new session initialization.
      const { server } = createServer(transports, subscriptions);
      const eventStore = new InMemoryEventStore();

      // Declare transport here so it's in scope for the callback.
      let transport: StreamableHTTPServerTransport;

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore,
        onsessioninitialized: (newSessionId: string) => {
          console.log(`Session initialized with ID: ${newSessionId}`);
          transports.set(newSessionId, transport);
        },
      });

      // Set up onclose handler to clean up transport when closed
      server.onclose = async () => {
        const sid = transport.sessionId;
        if (sid && transports.has(sid)) {
          console.log(
            `Server closed for session ${sid}, removing associated transport from transports map`,
          );
          transports.delete(sid);
        }
      };

      // Connect the server to the transport.
      await server.connect(transport);

      // --- *** FORCE A YIELD - IMPORTANT FOR TEST ENVIRONMENT *** ---
      // Give the event loop a chance to process the operation.
      await new Promise((resolve) => setImmediate(resolve));

      // Now, handle the initialization request.
      // This will trigger onsessioninitialized and send the response to the client.
      await transport.handleRequest(req, res);
    } else {
      // Invalid request: has a session ID, but it's not in our map.
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found" },
        id: null,
      });
    }
  } catch (error) {
    console.log("Error handling MCP POST request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Handle GET requests for SSE streams (using built-in support from StreamableHTTP)
app.get("/mcp", async (req: Request, res: Response) => {
  console.error("Received MCP GET request");
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: req?.body?.id,
    });
    return;
  }

  // Check for Last-Event-ID header for resumability
  const lastEventId = req.headers["last-event-id"] as string | undefined;
  if (lastEventId) {
    console.error(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
  } else {
    console.error(`Establishing new SSE stream for session ${sessionId}`);
  }

  const transport = transports.get(sessionId);
  await transport!.handleRequest(req, res);
});

// Handle DELETE requests for session termination (according to MCP spec)
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: req?.body?.id,
    });
    return;
  }

  console.error(
    `Received session termination request for session ${sessionId}`,
  );

  try {
    const transport = transports.get(sessionId);
    await transport!.handleRequest(req, res);
  } catch (error) {
    console.error("Error handling session termination:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Error handling session termination",
        },
        id: req?.body?.id,
      });
      return;
    }
  }
});

// Conditional listen for running standalone
if (process.env.NODE_ENV !== "test") {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`MCP Streamable HTTP Server listening on port ${PORT}`);
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down server...");
  for (const transport of transports.values()) {
    await transport.close();
  }
  console.log("Server shutdown complete.");
  process.exit(0);
});

export { app, transports };
