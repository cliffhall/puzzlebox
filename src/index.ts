import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./puzzlebox.ts";
import express from "express";

// Express app for
const app = express();
app.use(express.json());

const { server } = createServer();
let transport: SSEServerTransport;

app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/message", res);
  console.log("Client connected", transport?.['_sessionId']);
  await server.connect(transport);
  server.onclose = async () => {
    console.log("Client Disconnected", transport?.['_sessionId']);
  };
});

app.post("/message", async (req, res) => {
  console.log("Client Message", transport?.['_sessionId']);
  await transport.handlePostMessage(req, res, req.body);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
