import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import { logger } from "./logger";

const eventRooms = new Map<string, Set<WebSocket>>();

export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const code = url.searchParams.get("code");

    if (!code) {
      ws.close(1008, "Missing event code");
      return;
    }

    if (!eventRooms.has(code)) {
      eventRooms.set(code, new Set());
    }
    eventRooms.get(code)!.add(ws);
    logger.info({ code }, "WebSocket client connected");

    ws.on("close", () => {
      const room = eventRooms.get(code);
      if (room) {
        room.delete(ws);
        if (room.size === 0) {
          eventRooms.delete(code);
        }
      }
      logger.info({ code }, "WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err, code }, "WebSocket error");
    });
  });

  logger.info("WebSocket server initialized at /ws");
}

export function broadcast(code: string, message: object): void {
  const room = eventRooms.get(code);
  if (!room) return;

  const payload = JSON.stringify(message);
  for (const client of room) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
