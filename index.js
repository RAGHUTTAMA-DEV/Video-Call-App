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
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

// Store active rooms and users
const rooms = new Map();
const userRooms = new Map(); // Track which room each user is in

app.use(cors({
    origin: "*",
    credentials: true
}));
app.use(express.static('public')); 
app.use(express.json());

app.get("/", (req, res) => {
    res.send(`
        <h1>🎥 WebRTC Video Call Server</h1>
        <p>Server is running on port ${PORT}</p>
        <p>Connected clients: ${io.engine.clientsCount}</p>
        <p>Active rooms: ${rooms.size}</p>
        <p>Status: <span style="color: green;">Online</span></p>
        <hr>
        <h3>API Endpoints:</h3>
        <ul>
            <li>GET / - This status page</li>
            <li>WebSocket connection for signaling</li>
        </ul>
    `);
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        connectedClients: io.engine.clientsCount,
        activeRooms: rooms.size,
        timestamp: new Date().toISOString()
    });
});

// Room management functions
function addUserToRoom(roomId, userId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
        console.log(`📁 Created new room: ${roomId}`);
    }
    
    rooms.get(roomId).add(userId);
    userRooms.set(userId, roomId);
    
    console.log(`👤 User ${userId.slice(0, 8)} added to room ${roomId}. Room size: ${rooms.get(roomId).size}`);
    return Array.from(rooms.get(roomId));
}

function removeUserFromRoom(roomId, userId) {
    if (rooms.has(roomId)) {
        rooms.get(roomId).delete(userId);
        userRooms.delete(userId);
        
        if (rooms.get(roomId).size === 0) {
            rooms.delete(roomId);
            console.log(`🗑️ Room ${roomId} deleted (empty)`);
        } else {
            console.log(`👋 User ${userId.slice(0, 8)} removed from room ${roomId}. Room size: ${rooms.get(roomId).size}`);
        }
        return true;
    }
    return false;
}

function getUsersInRoom(roomId) {
    return rooms.has(roomId) ? Array.from(rooms.get(roomId)) : [];
}

function removeUserFromAllRooms(userId) {
    const currentRoom = userRooms.get(userId);
    if (currentRoom) {
        removeUserFromRoom(currentRoom, userId);
        return currentRoom;
    }
    return null;
}

// Socket.IO connection handling
io.on("connection", (socket) => {
    console.log(`🔗 User connected: ${socket.id.slice(0, 8)}`);
    
    // Send connection confirmation
    socket.emit('connection-confirmed', { 
        socketId: socket.id,
        serverTime: new Date().toISOString()
    });
    
    socket.on("join-room", (roomId) => {
        try {
            if (!roomId || typeof roomId !== 'string') {
                socket.emit('error', { message: 'Invalid room ID' });
                return;
            }
            
            console.log(`🚪 User ${socket.id.slice(0, 8)} attempting to join room: ${roomId}`);
            
            // Leave any previous room
            const previousRoom = removeUserFromAllRooms(socket.id);
            if (previousRoom) {
                socket.leave(previousRoom);
                socket.to(previousRoom).emit('user-left', { 
                    userId: socket.id,
                    room: previousRoom
                });
                console.log(`🚪 User ${socket.id.slice(0, 8)} left previous room: ${previousRoom}`);
            }
            
            // Join the new room
            socket.join(roomId);
            const usersInRoom = addUserToRoom(roomId, socket.id);
            socket.currentRoom = roomId;
            
            // Get other users (excluding the current user)
            const otherUsers = usersInRoom.filter(id => id !== socket.id);
            
            // Send room-joined event with list of existing users
            socket.emit('room-joined', { 
                room: roomId,
                users: otherUsers,
                totalUsers: usersInRoom.length
            });
            
            // Notify existing users about the new user
            socket.to(roomId).emit('user-joined', { 
                userId: socket.id,
                room: roomId,
                totalUsers: usersInRoom.length
            });
            
            console.log(`✅ User ${socket.id.slice(0, 8)} successfully joined room ${roomId}. Total users: ${usersInRoom.length}`);
            
        } catch (error) {
            console.error(`❌ Error joining room: ${error.message}`);
            socket.emit('error', { message: 'Failed to join room', details: error.message });
        }
    });
    
    socket.on("leave-room", (roomId) => {
        try {
            console.log(`🚪 User ${socket.id.slice(0, 8)} leaving room: ${roomId}`);
            
            socket.leave(roomId);
            const wasRemoved = removeUserFromRoom(roomId, socket.id);
            
            if (wasRemoved) {
                // Notify other users
                socket.to(roomId).emit('user-left', { 
                    userId: socket.id,
                    room: roomId
                });
            }
            
            socket.currentRoom = null;
            console.log(`👋 User ${socket.id.slice(0, 8)} left room ${roomId}`);
            
        } catch (error) {
            console.error(`❌ Error leaving room: ${error.message}`);
        }
    });
    
    // WebRTC signaling events
    socket.on("offer", (data) => {
        try {
            const { offer, room, target } = data;
            
            if (!offer || !room || !target) {
                socket.emit('error', { message: 'Invalid offer data' });
                return;
            }
            
            console.log(`📤 Relaying offer from ${socket.id.slice(0, 8)} to ${target.slice(0, 8)} in room ${room}`);
            
            // Send offer to specific target
            io.to(target).emit('offer', {
                offer: offer,
                from: socket.id,
                room: room
            });
            
        } catch (error) {
            console.error(`❌ Error handling offer: ${error.message}`);
            socket.emit('error', { message: 'Failed to send offer', details: error.message });
        }
    });
    
    socket.on("answer", (data) => {
        try {
            const { answer, room, target } = data;
            
            if (!answer || !room || !target) {
                socket.emit('error', { message: 'Invalid answer data' });
                return;
            }
            
            console.log(`📥 Relaying answer from ${socket.id.slice(0, 8)} to ${target.slice(0, 8)} in room ${room}`);
            
            // Send answer to specific target
            io.to(target).emit('answer', {
                answer: answer,
                from: socket.id,
                room: room
            });
            
        } catch (error) {
            console.error(`❌ Error handling answer: ${error.message}`);
            socket.emit('error', { message: 'Failed to send answer', details: error.message });
        }
    });
    
    socket.on("ice-candidate", (data) => {
        try {
            const { candidate, room, target } = data;
            
            if (!candidate || !target) {
                return; // ICE candidates can be null (end-of-candidates)
            }
            
            console.log(`🧊 Relaying ICE candidate from ${socket.id.slice(0, 8)} to ${target.slice(0, 8)}`);
            
            // Send ICE candidate to specific target
            io.to(target).emit('ice-candidate', {
                candidate: candidate,
                from: socket.id,
                room: room
            });
            
        } catch (error) {
            console.error(`❌ Error handling ICE candidate: ${error.message}`);
        }
    });
    
    // Handle disconnect
    socket.on("disconnect", (reason) => {
        console.log(`🔌 User disconnected: ${socket.id.slice(0, 8)}, reason: ${reason}`);
        
        const roomId = removeUserFromAllRooms(socket.id);
        if (roomId) {
            // Notify room members that user left
            socket.to(roomId).emit('user-left', { 
                userId: socket.id,
                room: roomId
            });
            console.log(`📢 Notified room ${roomId} that user ${socket.id.slice(0, 8)} left`);
        }
    });
    
    // Handle socket errors
    socket.on("error", (error) => {
        console.error(`🚨 Socket error from ${socket.id.slice(0, 8)}:`, error);
    });
    
    // Ping/pong for connection health
    socket.on("ping", () => {
        socket.emit("pong", { timestamp: Date.now() });
    });
});

// Global error handlers
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown handlers
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    
    // Notify all connected clients
    io.emit('server-shutdown', { message: 'Server is shutting down' });
    
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully');
    
    // Notify all connected clients
    io.emit('server-shutdown', { message: 'Server is shutting down' });
    
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 WebRTC Video Call Server is running!`);
    console.log(`📱 Port: ${PORT}`);
    console.log(`🌐 Local: http://localhost:${PORT}`);
    console.log(`⚡ Socket.IO transport: websocket, polling`);
    console.log(`🔧 CORS: enabled for all origins`);
    console.log(`📊 Status page: http://localhost:${PORT}`);
});

// Periodic cleanup of empty rooms (every 5 minutes)
setInterval(() => {
    let cleanedRooms = 0;
    for (const [roomId, users] of rooms.entries()) {
        if (users.size === 0) {
            rooms.delete(roomId);
            cleanedRooms++;
        }
    }
    if (cleanedRooms > 0) {
        console.log(`🧹 Cleaned up ${cleanedRooms} empty rooms`);
    }
}, 5 * 60 * 1000);