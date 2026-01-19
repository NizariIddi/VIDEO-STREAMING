const express = require("express");
const http = require("http");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 1e8 // Increase buffer size to 100MB for large files
});

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("🔌 New client connected:", socket.id);

  socket.on("join-room", (room) => {
    socket.join(room);
    console.log(`✅ ${socket.id} joined room: ${room}`);

    // Notify others in the room that a new user joined
    socket.to(room).emit("user-joined", socket.id);

    // Send confirmation to the user who joined
    socket.emit("room-joined", { room, userId: socket.id });
  });

  socket.on("offer", (data) => {
    console.log(`📤 Offer from ${socket.id} to room ${data.room}`);
    socket.to(data.room).emit("offer", {
      offer: data.offer,
      from: socket.id,
    });
  });

  socket.on("answer", (data) => {
    console.log(`📤 Answer from ${socket.id} to room ${data.room}`);
    socket.to(data.room).emit("answer", {
      answer: data.answer,
      from: socket.id,
    });
  });

  socket.on("candidate", (data) => {
    console.log(`📤 ICE candidate from ${socket.id} to room ${data.room}`);
    socket.to(data.room).emit("candidate", {
      candidate: data.candidate,
      from: socket.id,
    });
  });

  // Chat messages (encrypted client-side)
  socket.on("chat-message", (data) => {
    console.log(`💬 Message from ${socket.id} in room ${data.room}`);
    socket.to(data.room).emit("chat-message", {
      sender: "Remote User", // Change sender to "Remote User" for recipients
      message: data.message,
      encrypted: data.encrypted,
    });
  });

  // File sharing - FIXED: Now forwards complete file data
  socket.on("file-shared", (data) => {
    console.log(`📁 File shared from ${socket.id} in room ${data.room}: ${data.fileName} (${data.fileSize} KB)`);
    socket.to(data.room).emit("file-shared", {
      fileId: data.fileId,
      fileName: data.fileName,
      fileSize: data.fileSize,
      fileType: data.fileType,
      fileData: data.fileData, // IMPORTANT: Forward the actual file data
      sender: data.sender,
    });
  });

  // Screen sharing
  socket.on("screen-share-started", (room) => {
    console.log(`🖥️ Screen share started by ${socket.id} in room ${room}`);
    socket.to(room).emit("screen-share-started");
  });

  socket.on("screen-share-stopped", (room) => {
    console.log(`🖥️ Screen share stopped by ${socket.id} in room ${room}`);
    socket.to(room).emit("screen-share-stopped");
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Secure server running at http://localhost:${PORT}`);
});