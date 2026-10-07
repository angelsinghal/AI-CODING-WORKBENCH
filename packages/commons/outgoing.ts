import z from "zod";

export const WorkspaceCreatedSchema = z.object({
    id: z.string(),
    name: z.string(),
    path: z.string()
})

export type WorkspaceCreatedSchemaType = z.infer<typeof WorkspaceCreatedSchema>;

export const SessionCreatedType = z.object({
    id: z.string()
})

export type SessionCreatedType = z.infer<typeof SessionCreatedType>

export const MessageAddedType =z.object({
    id: z.string()
})

export type MessageAddedType = z.infer<typeof MessageAddedType>;

export type OutgoingMessageType ={
    type:"workspace-created",
    payload: WorkspaceCreatedSchemaType
} | {
    type:"session-created",
    payload: SessionCreatedType
} | {
    type:"message-added",
    payload: MessageAddedType
} | {
    type:"init",
    workspaces: Workspace[]
}

export type ConnectionResponse = {
    workspace:Workspace[]
}

export type Workspace = {
    id:string,
    sessions:Session[],
    name:string
    path:string
}

export type Session = {
    id:string,
    messages:Message[]
}

export type Message={
    id: string,
    role : "user",
    payload:{
        message:string
    }
} | {
    role : "assistant",
    payload: any
}

