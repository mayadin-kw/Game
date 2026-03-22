import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import {
  getDatabase,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBpcJHADMt7FWqGo-PRae2oa_916qD6KAI",
  authDomain: "ques-87f74.firebaseapp.com",
  databaseURL: "https://ques-87f74-default-rtdb.firebaseio.com",
  projectId: "ques-87f74",
  storageBucket: "ques-87f74.firebasestorage.app",
  messagingSenderId: "110924910325",
  appId: "1:110924910325:web:e92f80606985124c77ffbc",
  measurementId: "G-B7MMDCHE3V",
};

const PLAYER_LIMIT = 4;
const DEFAULT_COLORS = [
  "#ff6b6b",
  "#4cc9f0",
  "#ffd166",
  "#22c55e",
  "#a855f7",
  "#fb7185",
  "#f97316",
  "#2dd4bf",
  "#60a5fa",
  "#f59e0b",
  "#10b981",
  "#ec4899",
];

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

export function buildRoomUrl(roomCode) {
  const url = new URL("https://sli0tin.github.io/Game/");
  url.searchParams.set("room", roomCode);
  return url.toString();
}

export async function createRoom(roomCode, hostClientId, initialGameState) {
  const roomData = {
    meta: {
      hostClientId,
      createdAt: Date.now(),
      status: "lobby",
    },
    sharedState: {
      game: initialGameState,
      revision: 1,
      updatedBy: hostClientId,
      updatedAt: Date.now(),
    },
    participants: {},
    chat: {},
  };

  await set(ref(database, `rooms/${roomCode}`), roomData);
}

export function subscribeToRoom(roomCode, callback) {
  return onValue(ref(database, `rooms/${roomCode}`), (snapshot) => {
    callback(snapshot.val() || null);
  });
}

export async function writeSharedGameState(roomCode, payload) {
  await update(ref(database, `rooms/${roomCode}`), {
    sharedState: payload,
    "meta/status": payload.game?.phase || "board",
  });
}

export async function upsertParticipant(roomCode, participant) {
  const participantsRef = ref(database, `rooms/${roomCode}/participants`);
  const result = await runTransaction(participantsRef, (current) => {
    const next = current || {};
    const currentPlayers = Object.values(next).filter(
      (item) => item && item.id !== participant.id && item.role === "player"
    );
    const usedColors = new Set(
      currentPlayers.map((item) => normalizeColor(item.color)).filter(Boolean)
    );
    let finalRole = participant.role === "player" ? "player" : "spectator";
    let finalColor = normalizeColor(participant.color);

    if (finalRole === "player" && currentPlayers.length >= PLAYER_LIMIT) {
      finalRole = "spectator";
    }

    if (finalRole === "player") {
      if (!finalColor || usedColors.has(finalColor)) {
        finalColor = suggestUnusedColor(usedColors);
      }
    } else {
      finalColor = "";
    }

    next[participant.id] = {
      ...(next[participant.id] || {}),
      ...participant,
      role: finalRole,
      color: finalColor,
      joinedAt: next[participant.id]?.joinedAt || Date.now(),
      updatedAt: Date.now(),
      online: true,
    };

    return next;
  });

  const snapshotValue = result.snapshot.val() || {};
  const finalParticipant = snapshotValue[participant.id];
  if (!finalParticipant) {
    throw new Error("تعذر تثبيت بيانات المشارك داخل الغرفة.");
  }

  const participantRef = ref(database, `rooms/${roomCode}/participants/${participant.id}`);
  await onDisconnect(participantRef).remove();
  return finalParticipant;
}

export async function leaveRoom(roomCode, participantId) {
  if (!roomCode || !participantId) {
    return;
  }

  await remove(ref(database, `rooms/${roomCode}/participants/${participantId}`));
}

export async function sendRoomMessage(roomCode, message) {
  const messagesRef = ref(database, `rooms/${roomCode}/chat`);
  await push(messagesRef, {
    ...message,
    createdAt: Date.now(),
  });
}

function normalizeColor(color) {
  const value = String(color || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) {
    return value;
  }

  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }

  return "";
}

function suggestUnusedColor(usedColors) {
  return (
    DEFAULT_COLORS.find((color) => !usedColors.has(normalizeColor(color))) ||
    DEFAULT_COLORS[usedColors.size % DEFAULT_COLORS.length]
  );
}
