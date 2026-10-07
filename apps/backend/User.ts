import { WebSocket } from "ws";
import {
  AddMessageSchema,
  CreateSessionSchema,
  CreateWorkspaceSchema,
  type IncomingMessageType,
  type OutgoingMessageType,
} from "commons/types";
import { SessionModel, WorkspaceModel } from "db/client";
import mongoose from "mongoose";

export class User {
  private socket: WebSocket;
  public id: string;

  constructor(id: string, socket: WebSocket) {
    this.socket = socket;
    this.id = id;
  }

  async sendMessage(msg: OutgoingMessageType) {
    this.socket.send(JSON.stringify(msg));
  }
  
  async handleIncomingMessage(msg: IncomingMessageType): Promise<OutgoingMessageType> {
    if (msg.type === "create-workspace") {
      const {success, data} = CreateWorkspaceSchema.safeParse(msg.payload);
      if (!success) {
        throw new Error("Incorrect schema");
      }
      const name: string = data.path.split("/").pop()!;
      const workspace = await WorkspaceModel.create({
        path: data.path,
        name
      });

      return {
        type: "workspace-created",
        payload: {
          id: workspace._id.toString(),
          path: data.path,
          name
        }
      };
    }

    if (msg.type === "create-session") {
      const {success, data} = CreateSessionSchema.safeParse(msg.payload);
      if (!success) {
        throw new Error("Incorrect schema");
      }

      const session = await SessionModel.create({
        workspace: new mongoose.Types.ObjectId(data.workspaceId),
        conversation: [],
      });

      return {
        type: "session-created",
        payload: { id: session._id.toString() },
      };
    }

    if (msg.type === "add-message") {
      const {success, data} = AddMessageSchema.safeParse(msg.payload);
      if (!success) {
        throw new Error("Incorrect schema");
      }

      const session = await SessionModel.updateOne(
        { id: data.sessionId },
        {
          conversation: {
            $push: {
              type: "user",
              payload: {
                message: data.message,
              },
            },
          },
        }
      );
      return {
        type: "message-added",
        payload: { id: "1" },
      };
    }

    throw new Error("Unknown message type");
  }
}
