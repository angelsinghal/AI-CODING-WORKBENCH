import { useEffect, useState } from "react";

export function useSocket() {
   const [ws, setWs] = useState<WebSocket | null>(null);
   const [loading , setLoading] = useState(true);

   useEffect(() => {
        const ws = new WebSocket("ws://localhost:3000");
            setWs(ws);
            setLoading(false);
        }, [])

   return {
    socket: ws,
    loading
   }
}