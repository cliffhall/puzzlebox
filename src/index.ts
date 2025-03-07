import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./puzzlebox.ts";
import express from "express";

// Express app for
const app = express();
app.use(express.json());

const { server } = createServer();
let transport: SSEServerTransport;

app.get("/sse", async (req, res) => {
  console.log("Received connection");
  transport = new SSEServerTransport("/message", res);
  await server.connect(transport);

});

app.post("/message", async (req, res) => {
  console.log("Received message");
  await transport.handlePostMessage(req, res, req.body);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
