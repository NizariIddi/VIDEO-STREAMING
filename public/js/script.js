const socket = io();
let room;
let roomPassword;
let localStream;
let screenStream;
let peerConnection;
let recorder;
let recordedChunks = [];
let startTime;
let durationInterval;
let isScreenSharing = false;
let enable2FA = false;
let generated2FACode = null;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const screenVideo = document.getElementById("screenVideo");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// ===== NAVIGATION FUNCTIONS =====

function showLandingPage() {
  document.getElementById('landing-page').classList.remove('hidden');
  document.getElementById('room-form').classList.add('hidden');
  document.getElementById('create-room-form').classList.add('hidden');
  document.getElementById('video-chat').classList.add('hidden');
}

function showJoinRoom() {
  document.getElementById('landing-page').classList.add('hidden');
  document.getElementById('room-form').classList.remove('hidden');
  document.getElementById('create-room-form').classList.add('hidden');
  document.getElementById('video-chat').classList.add('hidden');
}

function showCreateRoom() {
  document.getElementById('landing-page').classList.add('hidden');
  document.getElementById('room-form').classList.add('hidden');
  document.getElementById('create-room-form').classList.remove('hidden');
  document.getElementById('video-chat').classList.add('hidden');
}

// ===== CREATE ROOM FUNCTION =====

async function createRoom() {
  const roomName = document.getElementById("create-room-name").value.trim();
  const roomDescription = document.getElementById("create-room-description").value.trim();
  const password = document.getElementById("create-room-password").value;
  const require2FA = document.getElementById("create-enable-2fa").checked;
  const waitingRoom = document.getElementById("enable-waiting-room").checked;
  
  if (!roomName) {
    showNotification('Please enter a room name!');
    return;
  }

  room = roomName;
  if (password) {
    roomPassword = await hashPassword(password);
  }
  enable2FA = require2FA;

  showNotification(`🎉 Room "${roomName}" created successfully!`);
  
  // Display room link
  setTimeout(() => {
    const roomLink = `${window.location.origin}?room=${encodeURIComponent(roomName)}`;
    showNotification(`Share this link: ${roomLink}`);
    proceedToRoom();
  }, 1500);
}

// ===== ENCRYPTION FUNCTIONS (for password hashing only) =====

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ===== 2FA FUNCTIONS =====

function generate2FACode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function moveToNext(current, nextId) {
  if (current.value.length === 1) {
    if (nextId) {
      document.getElementById(nextId).focus();
    } else {
      current.blur();
    }
  }
}

function show2FAModal() {
  generated2FACode = generate2FACode();
  console.log('🔐 2FA Code (for testing):', generated2FACode);
  showNotification(`Your 2FA code is: ${generated2FACode} (check console in production)`);
  document.getElementById('twoFactorModal').classList.add('show');
  document.getElementById('code1').focus();
}

function close2FAModal() {
  document.getElementById('twoFactorModal').classList.remove('show');
  for (let i = 1; i <= 6; i++) {
    document.getElementById(`code${i}`).value = '';
  }
}

function verify2FA() {
  let enteredCode = '';
  for (let i = 1; i <= 6; i++) {
    enteredCode += document.getElementById(`code${i}`).value;
  }

  if (enteredCode === generated2FACode) {
    close2FAModal();
    showNotification('✓ 2FA verification successful!');
    proceedToRoom();
  } else {
    showNotification('❌ Invalid 2FA code. Please try again.');
    for (let i = 1; i <= 6; i++) {
      document.getElementById(`code${i}`).value = '';
    }
    document.getElementById('code1').focus();
  }
}

function resend2FA() {
  generated2FACode = generate2FACode();
  console.log('🔐 New 2FA Code:', generated2FACode);
  showNotification(`New 2FA code sent: ${generated2FACode}`);
}

// ===== PASSWORD FUNCTIONS =====

function showPasswordModal() {
  document.getElementById('passwordModal').classList.add('show');
  document.getElementById('verify-password-input').focus();
}

function closePasswordModal() {
  document.getElementById('passwordModal').classList.remove('show');
  document.getElementById('verify-password-input').value = '';
}

async function verifyPassword() {
  const enteredPassword = document.getElementById('verify-password-input').value;
  const hashedEntered = await hashPassword(enteredPassword);
  
  if (hashedEntered === roomPassword) {
    closePasswordModal();
    showNotification('✓ Password verified!');
    
    if (enable2FA) {
      show2FAModal();
    } else {
      proceedToRoom();
    }
  } else {
    showNotification('❌ Incorrect password. Please try again.');
    document.getElementById('verify-password-input').value = '';
    document.getElementById('verify-password-input').focus();
  }
}

// ===== UTILITY FUNCTIONS =====

function showNotification(message) {
  const notification = document.getElementById('notification');
  const notificationText = document.getElementById('notification-text');
  notificationText.textContent = message;
  notification.classList.add('show');
  setTimeout(() => {
    notification.classList.remove('show');
  }, 3000);
}

function updateDuration() {
  const now = Date.now();
  const elapsed = Math.floor((now - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const durationEl = document.getElementById('duration');
  if (durationEl) {
    durationEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
}

function switchTab(tab) {
  document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.chat-content').forEach(c => c.classList.remove('active'));
  
  if (tab === 'chat') {
    document.querySelector('.chat-tab:first-child').classList.add('active');
    document.getElementById('chat-tab').classList.add('active');
  } else {
    document.querySelector('.chat-tab:last-child').classList.add('active');
    document.getElementById('files-tab').classList.add('active');
  }
}

// ===== CHAT FUNCTIONS =====

function addChatMessage(sender, message, isSelf = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';
  
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  messageDiv.innerHTML = `
    <div class="message-sender">${sender}</div>
    <div class="message-text">${message}</div>
    <div class="message-time">${time}</div>
  `;
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendMessage() {
  const message = chatInput.value.trim();
  if (!message) return;
  
  socket.emit('chat-message', { room, message, sender: 'You' });
  addChatMessage('You', message, true);
  
  chatInput.value = '';
}

chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

socket.on('chat-message', (data) => {
  addChatMessage(data.sender, data.message, false);
  showNotification('New message received');
});

// ===== FILE HANDLING =====

// Store files with their data
const uploadedFiles = new Map();

function handleFileSelect(event) {
  const files = event.target.files;
  const fileList = document.getElementById('fileList');
  
  Array.from(files).forEach(file => {
    const fileId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const size = (file.size / 1024).toFixed(2);
    
    // Store file data
    const reader = new FileReader();
    reader.onload = function(e) {
      const fileData = {
        id: fileId,
        name: file.name,
        size: size,
        type: file.type,
        data: e.target.result
      };
      
      uploadedFiles.set(fileId, fileData);
      
      // Send file info to other users
      socket.emit('file-shared', { 
        room, 
        fileId: fileId,
        fileName: file.name, 
        fileSize: size,
        fileType: file.type,
        fileData: e.target.result,
        sender: 'You'
      });
    };
    reader.readAsDataURL(file);
    
    const fileDiv = document.createElement('div');
    fileDiv.className = 'file-item';
    fileDiv.dataset.fileId = fileId;
    
    const isImage = file.type.startsWith('image/');
    const isPDF = file.type === 'application/pdf';
    const canPreview = isImage || isPDF;
    
    fileDiv.innerHTML = `
      <div class="file-icon">
        <i class="fas ${isImage ? 'fa-image' : isPDF ? 'fa-file-pdf' : 'fa-file'}"></i>
      </div>
      <div class="file-info">
        <div class="file-name">${file.name}</div>
        <div class="file-size">${size} KB</div>
      </div>
      <div class="file-actions">
        ${canPreview ? `<button class="file-action-btn" onclick="previewFile('${fileId}')" title="Preview"><i class="fas fa-eye"></i></button>` : ''}
        <button class="file-action-btn download" onclick="downloadFileById('${fileId}')" title="Download"><i class="fas fa-download"></i></button>
      </div>
    `;
    
    fileList.appendChild(fileDiv);
  });
  
  showNotification(`${files.length} file(s) uploaded`);
  event.target.value = ''; // Reset input
}

socket.on('file-shared', (data) => {
  const fileList = document.getElementById('fileList');
  const fileDiv = document.createElement('div');
  fileDiv.className = 'file-item';
  fileDiv.dataset.fileId = data.fileId;
  
  // Store received file data
  uploadedFiles.set(data.fileId, {
    id: data.fileId,
    name: data.fileName,
    size: data.fileSize,
    type: data.fileType,
    data: data.fileData
  });
  
  const isImage = data.fileType.startsWith('image/');
  const isPDF = data.fileType === 'application/pdf';
  const canPreview = isImage || isPDF;
  
  fileDiv.innerHTML = `
    <div class="file-icon">
      <i class="fas ${isImage ? 'fa-image' : isPDF ? 'fa-file-pdf' : 'fa-file'}"></i>
    </div>
    <div class="file-info">
      <div class="file-name">${data.fileName}</div>
      <div class="file-size">${data.fileSize} KB • From ${data.sender}</div>
    </div>
    <div class="file-actions">
      ${canPreview ? `<button class="file-action-btn" onclick="previewFile('${data.fileId}')" title="Preview"><i class="fas fa-eye"></i></button>` : ''}
      <button class="file-action-btn download" onclick="downloadFileById('${data.fileId}')" title="Download"><i class="fas fa-download"></i></button>
    </div>
  `;
  
  fileList.appendChild(fileDiv);
  showNotification(`${data.sender} shared: ${data.fileName}`);
});

function downloadFileById(fileId) {
  const fileData = uploadedFiles.get(fileId);
  if (!fileData) {
    showNotification('File not found');
    return;
  }
  
  const a = document.createElement('a');
  a.href = fileData.data;
  a.download = fileData.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showNotification(`Downloading ${fileData.name}`);
}

function previewFile(fileId) {
  const fileData = uploadedFiles.get(fileId);
  if (!fileData) {
    showNotification('File not found');
    return;
  }
  
  // Create preview modal
  const modal = document.createElement('div');
  modal.className = 'modal show';
  modal.style.display = 'flex';
  
  let previewContent = '';
  
  if (fileData.type.startsWith('image/')) {
    previewContent = `<img src="${fileData.data}" style="max-width: 100%; max-height: 70vh; border-radius: 8px;">`;
  } else if (fileData.type === 'application/pdf') {
    previewContent = `<iframe src="${fileData.data}" style="width: 100%; height: 70vh; border: none; border-radius: 8px;"></iframe>`;
  }
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 800px; width: 90%;">
      <div class="modal-header">
        <h3><i class="fas fa-eye"></i> ${fileData.name}</h3>
        <button class="close-modal" onclick="this.closest('.modal').remove()">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div style="text-align: center; margin-top: 1rem;">
        ${previewContent}
      </div>
      <div style="margin-top: 1.5rem; text-align: center;">
        <button onclick="downloadFileById('${fileId}')" style="width: auto; padding: 0.8rem 1.5rem;">
          <i class="fas fa-download"></i> Download File
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// ===== SCREEN SHARING =====

function showScreenShareModal() {
  document.getElementById('screenShareModal').classList.add('show');
}

function closeScreenShareModal() {
  document.getElementById('screenShareModal').classList.remove('show');
}

async function startScreenShare(type) {
  closeScreenShareModal();
  
  try {
    const displayMediaOptions = {
      video: { cursor: "always" },
      audio: false
    };

    screenStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    screenVideo.srcObject = screenStream;
    document.getElementById('screenShareContainer').style.display = 'block';
    document.getElementById('remote-video-container').style.display = 'none';
    isScreenSharing = true;

    if (peerConnection) {
      const videoTrack = screenStream.getVideoTracks()[0];
      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(videoTrack);
      }
    }

    screenStream.getVideoTracks()[0].onended = () => {
      stopScreenShare();
    };

    socket.emit('screen-share-started', room);
    showNotification('Screen sharing started');
    
    document.getElementById('share-screen').classList.add('active');
  } catch (err) {
    console.error('Error sharing screen:', err);
    showNotification('Failed to share screen');
  }
}

function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }
  
  document.getElementById('screenShareContainer').style.display = 'none';
  document.getElementById('remote-video-container').style.display = 'block';
  isScreenSharing = false;

  if (peerConnection && localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
      sender.replaceTrack(videoTrack);
    }
  }

  socket.emit('screen-share-stopped', room);
  showNotification('Screen sharing stopped');
  
  document.getElementById('share-screen').classList.remove('active');
}

socket.on('screen-share-started', () => {
  showNotification('Remote user started screen sharing');
});

socket.on('screen-share-stopped', () => {
  showNotification('Remote user stopped screen sharing');
});

// ===== ROOM JOIN FLOW =====

async function joinRoom() {
  room = document.getElementById("room-input").value.trim();
  const password = document.getElementById("password-input").value;
  enable2FA = document.getElementById("enable-2fa").checked;
  
  if (!room) {
    showNotification('Please enter a room name!');
    return;
  }

  if (password) {
    roomPassword = await hashPassword(password);
    showNotification('🔒 Room password set');
  }

  // Check if password required
  if (roomPassword) {
    showPasswordModal();
  } else if (enable2FA) {
    show2FAModal();
  } else {
    proceedToRoom();
  }
}

function proceedToRoom() {
  document.getElementById("landing-page").classList.add("hidden");
  document.getElementById("room-form").classList.add("hidden");
  document.getElementById("create-room-form").classList.add("hidden");
  document.getElementById("video-chat").classList.remove("hidden");
  document.getElementById("room-name").textContent = room;

  startTime = Date.now();
  durationInterval = setInterval(updateDuration, 1000);

  navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
      localStream = stream;
      localVideo.srcObject = stream;
      socket.emit("join-room", room);
      showNotification('✓ Successfully joined encrypted room!');
    })
    .catch(err => {
      console.error("Failed to get media:", err);
      showNotification('Failed to access camera/microphone');
    });
}

// ===== WEBRTC FUNCTIONS =====

function createPeer() {
  peerConnection = new RTCPeerConnection(config);

  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("candidate", { candidate: event.candidate, room: room });
    }
  };

  peerConnection.ontrack = event => {
    console.log('Remote track received:', event.streams[0]);
    remoteVideo.srcObject = event.streams[0];
    showNotification('🔒 Secure connection established!');
  };

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  console.log('Peer connection created');
}

socket.on("user-joined", (userId) => {
  console.log('User joined room:', userId);
  showNotification('Another user joined the room');
  
  if (!peerConnection) {
    createPeer();
    peerConnection.createOffer()
      .then(offer => {
        console.log('Created offer:', offer);
        return peerConnection.setLocalDescription(offer);
      })
      .then(() => {
        socket.emit("offer", { offer: peerConnection.localDescription, room: room });
      })
      .catch(err => console.error("Offer error:", err));
  }
});

socket.on("offer", (data) => {
  console.log('Received offer:', data);
  
  if (!peerConnection) {
    createPeer();
  }
  
  peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer))
    .then(() => {
      console.log('Remote description set, creating answer');
      return peerConnection.createAnswer();
    })
    .then(answer => {
      console.log('Created answer:', answer);
      return peerConnection.setLocalDescription(answer);
    })
    .then(() => {
      socket.emit("answer", { answer: peerConnection.localDescription, room: room });
    })
    .catch(err => console.error("Answer error:", err));
});

socket.on("answer", (data) => {
  console.log('Received answer:', data);
  peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
    .then(() => {
      console.log('Remote answer set successfully');
    })
    .catch(err => console.error("Set remote answer error:", err));
});

socket.on("candidate", (data) => {
  console.log('Received ICE candidate:', data);
  if (peerConnection && data.candidate) {
    peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
      .then(() => {
        console.log('ICE candidate added successfully');
      })
      .catch(err => console.error("ICE candidate error:", err));
  }
});

socket.on("room-joined", (data) => {
  console.log('Joined room:', data);
  document.getElementById('connection-status').textContent = 'Connected';
});

// ===== CONTROLS =====

document.getElementById("toggle-mic").onclick = function() {
  if (!localStream) return;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !track.enabled;
    this.classList.toggle('active', !track.enabled);
    this.querySelector('i').className = track.enabled ? 'fas fa-microphone' : 'fas fa-microphone-slash';
    showNotification(track.enabled ? 'Microphone on' : 'Microphone muted');
  });
};

document.getElementById("toggle-camera").onclick = function() {
  if (!localStream) return;
  localStream.getVideoTracks().forEach(track => {
    track.enabled = !track.enabled;
    this.classList.toggle('active', !track.enabled);
    this.querySelector('i').className = track.enabled ? 'fas fa-video' : 'fas fa-video-slash';
    showNotification(track.enabled ? 'Camera on' : 'Camera off');
  });
};

document.getElementById("share-screen").onclick = function() {
  if (isScreenSharing) {
    stopScreenShare();
  } else {
    showScreenShareModal();
  }
};

document.getElementById("leave-room").onclick = () => {
  if (peerConnection) peerConnection.close();
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  if (screenStream) screenStream.getTracks().forEach(track => track.stop());
  if (durationInterval) clearInterval(durationInterval);
  socket.disconnect();
  showNotification('Left the room');
  setTimeout(() => {
    window.location.reload();
  }, 1000);
};

document.getElementById("start-record").onclick = function() {
  if (!localStream) return;
  recorder = new MediaRecorder(localStream);
  recordedChunks = [];

  recorder.ondataavailable = e => recordedChunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recording-${Date.now()}.webm`;
    a.click();
    showNotification('Recording saved!');
    document.getElementById('start-record').style.display = 'flex';
    document.getElementById('stop-record').style.display = 'none';
  };

  recorder.start();
  showNotification('Recording started');
  this.style.display = 'none';
  document.getElementById('stop-record').style.display = 'flex';
};

document.getElementById("stop-record").onclick = () => {
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }
};

// Check for room parameter in URL
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  
  if (roomParam) {
    document.getElementById('room-input').value = roomParam;
    showJoinRoom();
    showNotification('Room link detected! Enter password to join.');
  }
});