import express from 'express'
import { Server } from 'http'
import http from 'http'

const app=express();
const server=new Server(app);

const io=new Server(server,{
    cors:{
        origin:"*",
        
    }
})

io.on('connection',(socket)=>{
    socket.on('join-room',(roomId)=>{
        socket.join(roomId)
        socket.to(roomId).emit('user-connected',socket.id)
    })
    socket.on('offer',(offer)=>{
        socket.broadcast.emit('offer',offer)
    })
    socket.on('answer',(answer)=>{
        socket.broadcast.emit('answer',answer)
    })
    socket.on('ice-candidate',(candidate)=>{
        socket.broadcast.emit('ice-candidate',candidate)
    })
})

server.listen(5000,()=>{
    console.log("server is running on port 5000")
})
