import {createContext} from "react";
import type { Workspace } from "commons/types";

export const AppContext = createContext<{
    workspaces: Workspace[],
    socket: WebSocket | null,
    setWorkspaces: any
}>({
   workspaces:[],
   socket:null,
   setWorkspaces:null
})
