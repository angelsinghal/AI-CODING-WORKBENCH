import {WebSocketServer} from "ws";
import mongoose from "mongoose";
import {WorkspaceModel} from "db/client";
import {CreateWorkspaceSchema} from "commons/types";
import {UserManager} from "./UserManager";

mongoose.connect(process.env.DB_URL!)
.then(() => {
    console.log("Connected to MongoDB");
    const server = new WebSocketServer({ port: 3000 });

server.on("connection", (ws) => {
    UserManager.getInstance().addUser(ws);
   ws.on("message", (msg) => {
       try{
        const parsedMessage=JSON.parse(msg.toString());
       } catch(e){
        console.error(`user sent non json format input`);
        console.log(msg.toString());
       }
    })

})
})
.catch(e => { 
console.log(e)
});

