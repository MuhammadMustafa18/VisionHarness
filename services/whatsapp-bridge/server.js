const express = require("express");
const cors = require("cors");
const pino = require("pino");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = 3005;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const AUTH_DIR = path.join(__dirname, "auth_info_baileys");
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let sock = null;
let currentQrDataUrl = null;
let isConnected = false;
let userPhone = null;
let userName = null;
let connecting = false;

async function startSock() {
  if (connecting) return;
  connecting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    sock = makeWASocket({
      version,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      auth: state,
      browser: ["VisionOps CCTV", "Chrome", "1.0.0"],
      syncFullHistory: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          currentQrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
          console.log("[Baileys] New QR generated");
        } catch (err) {
          console.error("QR render error:", err);
        }
      }

      if (connection === "close") {
        connecting = false;
        isConnected = false;
        currentQrDataUrl = null;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[Baileys] Connection closed (code: ${statusCode}). Reconnect? ${shouldReconnect}`);

        if (statusCode === DisconnectReason.loggedOut) {
          console.log("[Baileys] Logged out. Clearing credentials...");
          clearAuthDir();
          setTimeout(startSock, 2000);
        } else if (shouldReconnect) {
          setTimeout(startSock, 3000);
        }
      } else if (connection === "open") {
        connecting = false;
        isConnected = true;
        currentQrDataUrl = null;
        userPhone = sock.user?.id ? sock.user.id.split(":")[0].split("@")[0] : null;
        userName = sock.user?.name || "User";
        console.log(`[Baileys] Connected successfully as ${userName} (${userPhone})`);
      }
    });
  } catch (err) {
    connecting = false;
    console.error("[Baileys] Socket init error:", err);
  }
}

function clearAuthDir() {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      const files = fs.readdirSync(AUTH_DIR);
      for (const f of files) {
        fs.unlinkSync(path.join(AUTH_DIR, f));
      }
    }
  } catch (err) {
    console.error("[Baileys] Error clearing auth:", err);
  }
}

// REST Endpoints for VisionOps

// 1. Status & QR
app.get("/api/whatsapp/status", (req, res) => {
  res.json({
    connected: isConnected,
    phone: userPhone,
    name: userName,
    qr: currentQrDataUrl
  });
});

// 2. Disconnect / Logout
app.post("/api/whatsapp/logout", async (req, res) => {
  try {
    if (sock) {
      await sock.logout().catch(() => {});
      sock.end();
      sock = null;
    }
    clearAuthDir();
    isConnected = false;
    userPhone = null;
    userName = null;
    currentQrDataUrl = null;
    setTimeout(startSock, 1500);
    res.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Send Alert (Text + Optional Snapshot Image)
app.post("/api/whatsapp/send-alert", async (req, res) => {
  if (!isConnected || !sock) {
    return res.status(503).json({ error: "WhatsApp bridge is not connected" });
  }

  try {
    let { recipient, text, image_path, image_url } = req.body;

    // Default to "Message Yourself" if no recipient provided
    let targetJid;
    if (!recipient || recipient === "me" || recipient === "self") {
      targetJid = `${userPhone}@s.whatsapp.net`;
    } else if (recipient.includes("@")) {
      targetJid = recipient;
    } else {
      targetJid = `${recipient.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
    }

    const messageContent = {};

    // Check if image snapshot should be sent
    if (image_path && fs.existsSync(image_path)) {
      messageContent.image = fs.readFileSync(image_path);
      messageContent.caption = text || "🚨 VisionOps CCTV Alert";
    } else if (image_url && image_url.startsWith("data:image")) {
      const base64Data = image_url.replace(/^data:image\/\w+;base64,/, "");
      messageContent.image = Buffer.from(base64Data, "base64");
      messageContent.caption = text || "🚨 VisionOps CCTV Alert";
    } else {
      messageContent.text = text || "🚨 VisionOps CCTV Alert";
    }

    const result = await sock.sendMessage(targetJid, messageContent);
    res.json({ success: true, messageId: result.key.id, target: targetJid });
  } catch (err) {
    console.error("[Baileys] Error sending alert:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[VisionOps] WhatsApp Bridge listening on http://localhost:${PORT}`);
  startSock();
});
