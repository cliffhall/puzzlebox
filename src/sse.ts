import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./puzzlebox.ts";
import express from "express";

// The service app
const app = express();

// Data shared across all server/transport pairs
const transports: Map<string, SSEServerTransport> = new Map<
  string,
  SSEServerTransport
>(); // Transports by sessionId
const subscriptions: Map<string, Set<string>> = new Map<string, Set<string>>(); // Subscriber sessionIds by uri

// Clients connect here first
app.get("/sse", async (req, res) => {
  const { server } = createServer(transports, subscriptions); // Server for every new connection
  const transport = new SSEServerTransport("/message", res); // Create transport
  const sessionId = transport.sessionId; // Get the transport session id
  transports.set(sessionId, transport); // Store transport by session id
  await server.connect(transport); // Start transport
});

// Connected clients post messages here
app.post("/message", async (req, res) => {
  const sessionId = req.query.sessionId as string; // Get the session id
  if (req.query.sessionId && transports.has(sessionId)) {
    // Only handle requests with an established session
    const transport = transports.get(sessionId) as SSEServerTransport; // Get the transport for the session
    await transport.handlePostMessage(req, res); // Handle the posted message
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
