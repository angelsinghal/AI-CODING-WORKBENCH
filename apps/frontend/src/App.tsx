
import { AppContext } from "./context/AppContext";
import { useSocket } from "./hooks/useSocket";
import "./index.css";
import { useEffect } from "react";
import type { Workspace } from "commons/types";
import { useState } from "react";
import { useContext } from "react";

export function App(){
  const {loading, socket}= useSocket();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

    useEffect(() => {
      if(!loading && socket){
        socket.onmessage = (ev) => {
          const parsedData = JSON.parse(ev.data);
          if(parsedData.data.type === "init"){
            const workspaces: Workspace[] = parsedData.data.workspaces;
            setWorkspaces(workspaces);
          }

          if(parsedData.data.type === "workspace-created"){
            setWorkspaces(workspaces => workspaces.map(w=>{
              if(w.id == null){
                return {
                  ...w,
                  ...parsedData.data.payload
                }
              }
            }) )
        }
      }
    }
    }, [socket]);

    
  if(loading){
    return <div>Loading...</div>
    }


  return(
    <AppContext.Provider value={{workspaces, socket, setWorkspaces}}>
    <div className="flex">
      <div className="flex-1">
        sidebar

        </div>
      <div className="flex-6">
        chat window
      </div>
    </div>
    </AppContext.Provider>
  );
}

function Sidebar(){
  const {socket, workspaces, setWorkspaces} = useContext(AppContext);
  const [path, setPath] = useState("");
  return <div>
    {JSON.stringify(workspaces)}
    <input type="text" placeholder="path" value={path} onChange={(e) => setPath(e.target.value)}/>
    <button onClick={() => {
      setWorkspaces((w: Workspace[]) => [...w, {
        path:path,
        id:null
      }]);
      setPath("");
      if(socket){
        socket.send(JSON.stringify({
          type:"create-workspace",
          payload:{ path}
        }))
      }
    }}>Submit</button>
    </div>
}

export default App;