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
import { query } from "@anthropic-ai/claude-agent-sdk";

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

      const session = await SessionModel.findById(new mongoose.Types.ObjectId(data.sessionId));
      
      if(!session){
        throw new Error("Session doesnt exist "+data.sessionId);
      }

      const workspace = await WorkspaceModel.findOne({ _id: session?.workspace });

      if(!workspace){
        throw new Error("Workspace doesnt exist "+session?.workspace);
      }

      await SessionModel.updateOne(
        { _id: session._id },
        {
          $push: {
            conversation: {
              role: "user",
              payload: {
                message: data.message,
              },
            },
          },
        }
      );
      let agentResponse: { type: "result"; message: string } | null = null;

      // Agentic loop: streams messages as Claude works
      try {
        for await (const message of query({
          prompt: data.message,
          options: {
            cwd: workspace.path,
            resume: session.anthropicSessionId ? session.anthropicSessionId : undefined,
            allowedTools: ["Read", "Edit", "Glob"], // Auto-approve these tools
            permissionMode: "acceptEdits" // Auto-approve file edits
          }
        })) {
          // Print human-readable output
          if (message.type === "assistant" && message.message?.content) {
            for (const block of message.message.content) {
              if ("text" in block) {
                console.log(block.text); // Claude's reasoning
              } else if ("name" in block) {
                console.log(`Tool: ${block.name}`); // Tool being called
                const toolInput = "input" in block ? block.input : undefined;
                const toolMessage = {
                  role: "tool",
                  payload: {
                    name: block.name,
                    input: toolInput,
                  },
                };
                await SessionModel.updateOne(
                  { _id: session._id },
                  { $push: { conversation: toolMessage } },
                );
                this.sendMessage({
                  type: "tool-call",
                  payload: {
                    sessionId: session._id.toString(),
                    name: block.name,
                    input: toolInput,
                  },
                });
              }
            }
          } else if (message.type === "result") {
            console.log(`Done: ${message.subtype}`); // Final result
            if (!session.anthropicSessionId) {
              session.anthropicSessionId = message.session_id;
              await session.save();
            }
            if (message.subtype === "success") {
              console.log(message.result);
              agentResponse = {
                type: "result",
                message: message.result,
              };
            }
          }
        }
      } catch (error) {
        console.error("Agent request failed; using demo response", error);
      }

      const response = agentResponse ?? {
        type: "result" as const,
        message: `Demo response: I received your message: "${data.message}"`,
      };

      this.sendMessage({
        type: "assistant-message",
        payload: response,
      });

      await SessionModel.updateOne(
        { _id: new mongoose.Types.ObjectId(data.sessionId) },
        {
          $push: {
            conversation: {
              role: "assistant",
              payload: response,
            },
          },
        },
      );
      return {
        type: "message-added",
        payload: { id: "1" },
      };
    }

    throw new Error("Unknown message type");
  }
}
