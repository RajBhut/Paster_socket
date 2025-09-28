const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const rooms = new Map();

app.use(express.json());
app.use(express.static("public"));
app.get("/", (req, res) => {
  res.json({
    message: "Collaborative Notes Backend is running",
    activeRooms: rooms.size,
    totalConnections: io.engine.clientsCount,
  });
});

app.get("/api/room/:roomId", (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);

  if (!room) {
    return res.json({ exists: false });
  }

  res.json({
    exists: true,
    userCount: room.users.length,
    createdAt: room.createdAt,
  });
});

io.on("connection", (socket) => {
  console.log(`✅ User connected: ${socket.id}`);

  socket.on("join_room", (roomId) => {
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        users: [],
        content:
          '// Welcome to Real-time Collaborative Notes!\n// Start typing to share your code in real-time\n\nconsole.log("Hello, collaborative world!");',
        chatHistory: [],
        createdAt: new Date(),
      });
    }

    const room = rooms.get(roomId);

    if (!room.users.includes(socket.id)) {
      room.users.push(socket.id);
    }

    console.log(
      `📝 User ${socket.id} joined room ${roomId} (${room.users.length} users)`
    );

    socket.emit("room_joined", {
      roomId,
      users: room.users,
      content: room.content,
      chatHistory: room.chatHistory,
    });

    socket.to(roomId).emit("user_joined", {
      socketId: socket.id,
      users: room.users,
    });

    if (room.content) {
      socket.emit("note_update", {
        content: room.content,
        sender: "system",
      });
    }
  });

  // Note change handler
  socket.on("note_change", ({ roomId, content }) => {
    const room = rooms.get(roomId);
    if (!room || !room.users.includes(socket.id)) {
      return;
    }

    // Update room content
    room.content = content;

    console.log(`📝 Note updated in room ${roomId} by ${socket.id}`);

    // Broadcast to other users in the room
    socket.to(roomId).emit("note_update", {
      content,
      sender: socket.id,
    });
  });

  // Chat message handler
  socket.on("chat_message", ({ roomId, message }) => {
    const room = rooms.get(roomId);
    if (!room || !room.users.includes(socket.id)) {
      return;
    }

    // Add message to room history
    room.chatHistory.push(message);

    // Keep only last 100 messages
    if (room.chatHistory.length > 100) {
      room.chatHistory = room.chatHistory.slice(-100);
    }

    console.log(`💬 Chat message in room ${roomId} from ${socket.id}`);

    // Broadcast message to all users in the room (including sender)
    io.to(roomId).emit("chat_message", message);
  });

  // Leave room handler
  socket.on("leave_room", (roomId) => {
    socket.leave(roomId);

    const room = rooms.get(roomId);
    if (room) {
      // Remove user from room
      room.users = room.users.filter((id) => id !== socket.id);

      console.log(
        `👋 User ${socket.id} left room ${roomId} (${room.users.length} users remaining)`
      );

      // Notify other users
      socket.to(roomId).emit("user_left", {
        socketId: socket.id,
        users: room.users,
      });

      // Clean up empty rooms
      if (room.users.length === 0) {
        console.log(`🗑️ Cleaning up empty room ${roomId}`);
        rooms.delete(roomId);
      }
    }
  });

  // Handle user disconnect
  socket.on("disconnect", () => {
    console.log(`❌ User disconnected: ${socket.id}`);

    // Remove user from all rooms
    for (const [roomId, room] of rooms.entries()) {
      if (room.users.includes(socket.id)) {
        room.users = room.users.filter((id) => id !== socket.id);

        // Notify other users in the room
        socket.to(roomId).emit("user_left", {
          socketId: socket.id,
          users: room.users,
        });

        console.log(`👋 Removed ${socket.id} from room ${roomId}`);

        // Clean up empty rooms
        if (room.users.length === 0) {
          console.log(`🗑️ Cleaning up empty room ${roomId}`);
          rooms.delete(roomId);
        }
      }
    }
  });

  // Typing indicator (optional feature)
  socket.on("typing_start", ({ roomId }) => {
    socket
      .to(roomId)
      .emit("user_typing", { socketId: socket.id, typing: true });
  });

  socket.on("typing_stop", ({ roomId }) => {
    socket
      .to(roomId)
      .emit("user_typing", { socketId: socket.id, typing: false });
  });
});

// Cleanup interval for old rooms (optional)
setInterval(() => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  for (const [roomId, room] of rooms.entries()) {
    if (room.users.length === 0 && room.createdAt < oneHourAgo) {
      console.log(`🗑️ Cleaning up old empty room ${roomId}`);
      rooms.delete(roomId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    activeRooms: rooms.size,
    totalConnections: io.engine.clientsCount,
    timestamp: new Date().toISOString(),
  });
});

// Get all rooms (for admin/debugging)
app.get("/api/rooms", (req, res) => {
  const roomList = Array.from(rooms.entries()).map(([id, room]) => ({
    id,
    userCount: room.users.length,
    createdAt: room.createdAt,
    hasContent: room.content.length > 0,
    messageCount: room.chatHistory.length,
  }));

  res.json(roomList);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.io enabled with CORS`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🔄 SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("👋 Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("🔄 SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("👋 Server closed");
    process.exit(0);
  });
});
