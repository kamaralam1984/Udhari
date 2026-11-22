import { createServer } from "http";
import next from "next";
import { WebSocketServer } from "ws";
import { handleTwilioStreamConnection } from "./src/server/twilioStreamHandler";
import { startScheduledJobs } from "./src/server/followUpScheduler";

const TWILIO_STREAM_PATH = "/ws/twilio-stream";

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const nextUpgradeHandler = app.getUpgradeHandler();
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws) => handleTwilioStreamConnection(ws));

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (pathname === TWILIO_STREAM_PATH) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      return;
    }
    // Everything else (Next's own dev-mode HMR socket, etc.) goes to Next.
    nextUpgradeHandler(req, socket, head);
  });

  server.listen(port, () => {
    console.log(`> Server listening at http://localhost:${port} as ${dev ? "development" : process.env.NODE_ENV}`);
    console.log(`> Twilio Media Streams WS endpoint: ${TWILIO_STREAM_PATH}`);
  });

  startScheduledJobs();
});
