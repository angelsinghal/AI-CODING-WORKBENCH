import { WebSocket } from "ws";
import {
  AddMessageSchema,
  CreateSessionSchema,
  CreateWorkspaceSchema,
  ToolApprovalResponseSchema,
  type IncomingMessageType,
  type OutgoingMessageType,
} from "commons/types";
import { SessionModel, WorkspaceModel } from "db/client";
import mongoose from "mongoose";
import { query } from "@anthropic-ai/claude-agent-sdk";

export class User {
  private socket: WebSocket;
  private pendingToolApprovals = new Map<string, {
    sessionId: string;
    resolve: (approved: boolean) => void;
  }>();
  public id: string;

  constructor(id: string, socket: WebSocket) {
    this.socket = socket;
    this.id = id;
    this.socket.on("close", () => {
      for (const [requestId, pending] of this.pendingToolApprovals) {
        void SessionModel.updateOne(
          { _id: new mongoose.Types.ObjectId(pending.sessionId), "conversation.payload.requestId": requestId },
          { $set: { "conversation.$.payload.approvalStatus": "denied" } },
        ).then(
          () => pending.resolve(false),
          () => pending.resolve(false),
        );
      }
    });
  }

  async sendMessage(msg: OutgoingMessageType) {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }
  
  async handleIncomingMessage(msg: IncomingMessageType): Promise<OutgoingMessageType> {
    if (msg.type === "tool-approval-response") {
      const { success, data } = ToolApprovalResponseSchema.safeParse(msg.payload);
      if (!success) {
        throw new Error("Incorrect tool approval response");
      }

      const pending = this.pendingToolApprovals.get(data.requestId);
      if (!pending) {
        return {
          type: "tool-approval-result",
          payload: { requestId: data.requestId, approved: false },
        };
      }

      try {
        await SessionModel.updateOne(
          { _id: new mongoose.Types.ObjectId(pending.sessionId), "conversation.payload.requestId": data.requestId },
          {
            $set: {
              "conversation.$.payload.approvalStatus": data.approved ? "approved" : "denied",
            },
          },
        );
      } catch (error) {
        pending.resolve(false);
        throw error;
      }
      pending.resolve(data.approved);

      return {
        type: "tool-approval-result",
        payload: { requestId: data.requestId, approved: data.approved },
      };
    }

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
            allowedTools: ["Read", "Glob"],
            permissionMode: "default",
            canUseTool: async (toolName, input, options) => {
              if (toolName === "Read" || toolName === "Glob") {
                return { behavior: "allow", updatedInput: input };
              }
              if (toolName !== "Edit") {
                return { behavior: "deny", message: `The ${toolName} tool is not enabled.` };
              }

              const approvalRequest = {
                requestId: options.requestId,
                toolUseId: options.toolUseID,
                sessionId: session._id.toString(),
                toolName,
                input,
                title: options.title ?? `Approve ${toolName}`,
                description: options.description,
              };
              const toolMessage = {
                role: "tool",
                payload: {
                  requestId: approvalRequest.requestId,
                  toolUseId: approvalRequest.toolUseId,
                  name: toolName,
                  input,
                  approvalStatus: "pending",
                  title: approvalRequest.title,
                  description: approvalRequest.description,
                },
              };
              await SessionModel.updateOne(
                { _id: session._id },
                { $push: { conversation: toolMessage } },
              );

              const approved = await new Promise<boolean>((resolve) => {
                let settled = false;
                const finish = (decision: boolean) => {
                  if (settled) return;
                  settled = true;
                  options.signal.removeEventListener("abort", abort);
                  this.pendingToolApprovals.delete(approvalRequest.requestId);
                  resolve(decision);
                };
                const abort = () => finish(false);

                this.pendingToolApprovals.set(approvalRequest.requestId, {
                  sessionId: approvalRequest.sessionId,
                  resolve: finish,
                });
                options.signal.addEventListener("abort", abort, { once: true });
                if (options.signal.aborted || this.socket.readyState !== WebSocket.OPEN) {
                  finish(false);
                  return;
                }

                this.sendMessage({ type: "approval-request", payload: approvalRequest });
              });

              return approved
                ? { behavior: "allow", updatedInput: input }
                : { behavior: "deny", message: "The edit was denied by the user." };
            },
          }
        })) {
          // Print human-readable output
          if (message.type === "assistant" && message.message?.content) {
            for (const block of message.message.content) {
              if ("text" in block) {
                console.log(block.text); // Claude's reasoning
              } else if ("name" in block) {
                console.log(`Tool: ${block.name}`); // Tool being called
                if (block.name === "Edit") continue;
                const toolInput = "input" in block ? block.input : undefined;
                const toolUseId = "id" in block ? String(block.id) : undefined;
                const toolMessage = {
                  role: "tool",
                  payload: {
                    name: block.name,
                    input: toolInput,
                    toolUseId,
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
                    toolUseId,
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
