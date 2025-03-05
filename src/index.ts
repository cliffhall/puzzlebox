import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./puzzlebox.ts";
import express from "express";
const app = express();
app.use(express.json());

const transportsBySessionId = new Map<string, SSEServerTransport>();
const subscribers = new Map<string, Set<SSEServerTransport>>();
const { mcpServer } = createServer(subscribers, transportsBySessionId);

app.get("/sse", async (req, res) => {
  console.log("------Received SSE connection-------");
  console.log("Headers:", req.headers);
  console.log("Query:", req.query);
  console.log("Body:", req.body);

  // Create the SSE transport
  const transport = new SSEServerTransport("/message", res);

  // Connect to MCP server
  await mcpServer.connect(transport);

  // Optionally send a welcome message (no sessionId needed if client provides it)
  await transport.send({
    jsonrpc: "2.0",
    method: "ready",
    params: {},
  });

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const sessionId = transport?._sessionId
  transportsBySessionId.set(sessionId, transport);

  console.log("sessionId:", sessionId);
  // Cleanup on disconnect
  res.on("close", () => {
    transportsBySessionId.delete(sessionId);
    for (const [puzzleId, transports] of subscribers.entries()) {
      transports.delete(transport);
      if (transports.size === 0) {
        subscribers.delete(puzzleId);
      }
    }
  });
});

app.post("/message", (async (req, res) => {
  console.log("-------Received POST /message-------");
  console.log("Headers:", req.headers);
  console.log("Query:", req.query);
  console.log("Body:", req.body);

  // Get the session id
  const sessionId = req.query.sessionId as string;
  if (!sessionId) {
    return res.status(400).json({ error: "Missing sessionId in query" });
  }

  // Get the transport and send the message
  let transport = transportsBySessionId.get(sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res, req.body);
  } else {
    return res.status(400).json({ error: "No transport available for session" });
  }

}) as express.RequestHandler);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
