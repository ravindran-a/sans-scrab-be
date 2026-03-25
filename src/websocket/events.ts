export const SOCKET_EVENTS = {
  // Connection
  CONNECTION: "connection",
  DISCONNECT: "disconnect",

  // Room management
  CREATE_ROOM: "room:create",
  JOIN_ROOM: "room:join",
  LEAVE_ROOM: "room:leave",
  ROOM_CREATED: "room:created",
  ROOM_JOINED: "room:joined",
  ROOM_LEFT: "room:left",
  ROOM_FULL: "room:full",
  ROOM_LIST: "room:list",
  ROOM_UPDATE: "room:update",

  // Matchmaking
  FIND_MATCH: "match:find",
  MATCH_FOUND: "match:found",
  MATCH_CANCEL: "match:cancel",

  // Game events
  GAME_START: "game:start",
  GAME_STATE: "game:state",
  GAME_MOVE: "game:move",
  GAME_MOVE_RESULT: "game:move-result",
  GAME_PASS: "game:pass",
  GAME_EXCHANGE: "game:exchange",
  GAME_OVER: "game:over",
  GAME_ABANDON: "game:abandon",
  GAME_TIMER: "game:timer",

  GAME_RECONNECT: "game:reconnect",

  // Chat
  CHAT_MESSAGE: "chat:message",

  // Rematch
  REMATCH_REQUEST: "game:rematch-request",
  REMATCH_ACCEPT: "game:rematch-accept",
  REMATCH_DECLINED: "game:rematch-declined",

  // Errors
  ERROR: "error",
} as const;
