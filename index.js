import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const rooms = new Map();

app.use(cors());
app.use(express.static('public')); 

app.get("/", (req, res) => {
    res.send(`
        <h1>WebRTC Video Call Server</h1>
        <p>Server is running on port 5000</p>
        <p>Connected clients: ${io.engine.clientsCount}</p>
        <p>Active rooms: ${rooms.size}</p>
    `);
});

function addUserToRoom(roomId, userId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(userId);
    console.log(`User ${userId} added to room ${roomId}. Room size: ${rooms.get(roomId).size}`);
}

function removeUserFromRoom(roomId, userId) {
    if (rooms.has(roomId)) {
        rooms.get(roomId).delete(userId);
        if (rooms.get(roomId).size === 0) {
            rooms.delete(roomId);
            console.log(`Room ${roomId} deleted (empty)`);
        } else {
            console.log(`User ${userId} removed from room ${roomId}. Room size: ${rooms.get(roomId).size}`);
        }
        return true;
    }
    return false;
}

function getUsersInRoom(roomId) {
    return rooms.has(roomId) ? Array.from(rooms.get(roomId)) : [];
}

function removeUserFromAllRooms(userId) {
    for (const [roomId, users] of rooms.entries()) {
        if (users.has(userId)) {
            removeUserFromRoom(roomId, userId);
            return roomId;
        }
    }
    return null;
}

io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    socket.on("join-room", (roomId) => {
        try {
            const previousRoom = removeUserFromAllRooms(socket.id);
            if (previousRoom) {
                socket.leave(previousRoom);
                socket.to(previousRoom).emit('user-left', { userId: socket.id });
                console.log(`User ${socket.id} left previous room: ${previousRoom}`);
            }
            
            socket.join(roomId);
            addUserToRoom(roomId, socket.id);
            socket.currentRoom = roomId;
            
            // Get all users in the room
            const usersInRoom = getUsersInRoom(roomId);
            
            // Notify the new user about all existing users
            socket.emit('room-joined', { 
                room: roomId,
                users: usersInRoom.filter(id => id !== socket.id)
            });
            
            // Notify all existing users about the new user
            socket.to(roomId).emit('user-joined', { 
                userId: socket.id,
                room: roomId
            });
            
            console.log(`User ${socket.id} joined room ${roomId}. Total users: ${usersInRoom.length}`);
            
        } catch (error) {
            console.error(`Error joining room: ${error.message}`);
            socket.emit('error', { message: 'Failed to join room' });
        }
    });
    
    socket.on("leave-room", (roomId) => {
        try {
            socket.leave(roomId);
            removeUserFromRoom(roomId, socket.id);
            socket.to(roomId).emit('user-left', { userId: socket.id });
            socket.currentRoom = null;
            console.log(`User ${socket.id} left room ${roomId}`);
        } catch (error) {
            console.error(`Error leaving room: ${error.message}`);
        }
    });
    
    socket.on("offer", (data) => {
        try {
            const { offer, room, target } = data;
            console.log(`Relaying offer from ${socket.id} to ${target} in room ${room}`);
            
            socket.to(target).emit('offer', {
                offer: offer,
                from: socket.id,
                room: room
            });
        } catch (error) {
            console.error(`Error handling offer: ${error.message}`);
            socket.emit('error', { message: 'Failed to send offer' });
        }
    });
    
    socket.on("answer", (data) => {
        try {
            const { answer, room, target } = data;
            console.log(`Relaying answer from ${socket.id} to ${target} in room ${room}`);
            
            socket.to(target).emit('answer', {
                answer: answer,
                from: socket.id,
                room: room
            });
        } catch (error) {
            console.error(`Error handling answer: ${error.message}`);
            socket.emit('error', { message: 'Failed to send answer' });
        }
    });
    
    socket.on("ice-candidate", (data) => {
        try {
            const { candidate, room, target } = data;
            console.log(`Relaying ICE candidate from ${socket.id} to ${target} in room ${room}`);
            
            socket.to(target).emit('ice-candidate', {
                candidate: candidate,
                from: socket.id,
                room: room
            });
        } catch (error) {
            console.error(`Error handling ICE candidate: ${error.message}`);
        }
    });
    
    socket.on("disconnect", (reason) => {
        console.log(`User disconnected: ${socket.id}, reason: ${reason}`);
        
        const roomId = removeUserFromAllRooms(socket.id);
        if (roomId) {
            socket.to(roomId).emit('user-left', { userId: socket.id });
            console.log(`Notified room ${roomId} that user ${socket.id} left`);
        }
    });
    
    socket.on("error", (error) => {
        console.error(`Socket error from ${socket.id}:`, error);
    });
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 WebRTC server running on port ${PORT}`);
    console.log(`📱 Access the app at: http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});