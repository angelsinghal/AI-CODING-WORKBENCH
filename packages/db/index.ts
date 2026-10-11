import mongoose from "mongoose";

const Workspace = new mongoose.Schema({
    path: { type: String, required: true },
    name: { type: String, required: true },
})

const Session = new mongoose.Schema({
    role: { type: String, enum: ["user", "assistant"] }, 
    conversation: [Object],
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace" },
    anthropicSessionId: { type: String }
})

export const WorkspaceModel = mongoose.model("Workspace", Workspace);
export const SessionModel = mongoose.model("Session", Session);

