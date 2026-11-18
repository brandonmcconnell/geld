import { DurableObject, env } from "cloudflare:workers";
import type { LiveRooms } from "../types";

/**
 * One instance per room. Sockets are accepted through the hibernation API, so
 * an idle room costs nothing while its clients stay connected.
 */
export class LiveRoomObject extends DurableObject {
	constructor(ctx: DurableObjectState, objectEnv: Cloudflare.Env) {
		super(ctx, objectEnv);
		// Answered by the runtime, so a keep-alive never wakes the room.
		this.ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair("ping", "pong"),
		);
	}

	override fetch(request: Request): Response {
		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
			return new Response("Expected a WebSocket upgrade", { status: 426 });
		}
		const { 0: client, 1: server } = new WebSocketPair();
		this.ctx.acceptWebSocket(server);
		return new Response(null, { status: 101, webSocket: client });
	}

	broadcast(message: string): number {
		let delivered = 0;
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(message);
				delivered += 1;
			} catch {
				// The peer is gone; the runtime drops the socket.
			}
		}
		return delivered;
	}

	override webSocketClose(socket: WebSocket, code: number) {
		// 1005 and 1006 are reserved: echoing them back throws.
		socket.close(code === 1005 || code === 1006 ? 1000 : code);
	}
}

export function liveRooms(): LiveRooms {
	const stub = (room: string) =>
		env.LIVE_ROOM.get(env.LIVE_ROOM.idFromName(room));
	return {
		connect: (room, request) => stub(room).fetch(request),
		async broadcast(room, message) {
			await stub(room).broadcast(message);
		},
	};
}
