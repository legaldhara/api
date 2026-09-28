import { Server } from "socket.io";

let socketServer: Server | undefined;

export const setIo = (server: Server): void => {
  socketServer = server;
};

export const getIo = (): Server => {
  if (!socketServer) throw new Error("Socket.IO has not been initialized");
  return socketServer;
};
