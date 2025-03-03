import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { createServer } from "./puzzlebox.ts";

const app = express();

const { mcpServer } = createServer();

let transport: SSEServerTransport;

app.get("/sse", async (req, res) => {
  console.log("Received connection");
  transport = new SSEServerTransport("/message", res);
  await mcpServer.connect(transport);

  mcpServer.onclose = async () => {
    await mcpServer.close();
    process.exit(0);
  };
});

app.post("/message", async (req, res) => {
  console.log("Received message", req);

  await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
