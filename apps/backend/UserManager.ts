
import {WebSocket} from "ws"
import {User} from "./User";
import {v4 as uuidv4} from "uuid";
import { WorkspaceModel, SessionModel} from "db/client";
import {type Message, type Session, type Workspace } from "commons/types";

export class UserManager {
    private users: User[];
    private static instance: UserManager;
    private constructor(){
        this.users=[];
    }
    static getInstance(): UserManager{
        if(UserManager.instance){
            return UserManager.instance;
        }
        UserManager.instance = new UserManager();
        return UserManager.instance;
    }

    async addUser(ws: WebSocket){
        const id=uuidv4();
        const user = new User(id, ws);
        this.users.push(user);
        const workspaces= await WorkspaceModel.find();
        const sessions = await SessionModel.find();
        const response: Workspace[] = [];

            workspaces.forEach((w) => {
                    const finalSessions: Session[] = [];
        
                                     sessions.forEach((s) => {
                                         if(String(s.workspace) === w._id.toString()){
                        finalSessions.push({id:s._id.toString(),
                                                messages: s.conversation as unknown as Message[],
                     })
                   }})
                    
                    response.push({
                        id: w._id.toString(),
                        name: w.name,
                        path: w.path,
                        sessions:finalSessions
                    })
           
        })

        ws.send(JSON.stringify({
            type:"init",
            workspaces: response
        }))

        ws.on("message", async (msg) => {
            try{
                const parsedMessage=JSON.parse(msg.toString());
                const responsePayload = await user.handleIncomingMessage(parsedMessage);

                user.sendMessage(responsePayload);
            } catch(e){
                console.log(msg.toString());
            }
        });

        ws.on("close", () => {
            this.users = this.users.filter(x => x.id!== id);
        });
    }
}