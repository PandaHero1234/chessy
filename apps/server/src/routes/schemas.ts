/** JSON-Schemas für Validierung und die generierte OpenAPI-Spezifikation. */

const color = { type: "string", enum: ["white", "black"] } as const;
const nullable = <T extends object>(s: T) => ({ anyOf: [s, { type: "null" }] });

export const schemas = [
  {
    $id: "Error",
    type: "object",
    properties: { error: { type: "string" }, message: { type: "string" } },
    required: ["error", "message"],
  },
  {
    $id: "Account",
    type: "object",
    properties: {
      id: { type: "string" },
      username: { type: "string" },
      kind: { type: "string", enum: ["guest", "bot", "board"] },
      created_at: { type: "integer", description: "Unix-Zeit in ms" },
    },
    required: ["id", "username", "kind", "created_at"],
  },
  {
    $id: "Player",
    type: "object",
    properties: {
      id: { type: ["string", "null"] },
      username: { type: "string" },
      kind: { type: "string", enum: ["human", "ai", "local"] },
      ai_level: { type: "integer", minimum: 1, maximum: 8 },
      result: { type: "string", description: "chess.com-Ergebniscode: win, checkmated, resigned, timeout, stalemate, agreed, …" },
    },
    required: ["id", "username", "kind"],
  },
  {
    $id: "Clock",
    type: "object",
    properties: {
      white: { type: "integer", description: "Restzeit Weiß in ms" },
      black: { type: "integer", description: "Restzeit Schwarz in ms" },
      increment: { type: "integer", description: "Inkrement in ms" },
      running: { type: "boolean" },
      at: { type: "integer", description: "Serverzeit des Snapshots (ms)" },
      per_move: { type: "integer", description: "Daily: Frist pro Zug (ms)" },
    },
    required: ["white", "black", "increment", "running", "at"],
  },
  {
    $id: "Game",
    type: "object",
    properties: {
      id: { type: "string" },
      url: { type: "string" },
      status: { type: "string", enum: ["waiting", "started", "ended", "aborted"] },
      rated: { type: "boolean" },
      variant: { type: "string" },
      time_control: { type: "string", examples: ["180+2", "1/86400", "-"] },
      time_class: { type: "string", enum: ["bullet", "blitz", "rapid", "classical", "daily", "unlimited"] },
      white: { $ref: "Player#" },
      black: { $ref: "Player#" },
      initial_fen: { type: "string" },
      fen: { type: "string" },
      moves: { type: "string", description: "UCI-Züge, durch Leerzeichen getrennt" },
      san: { type: "array", items: { type: "string" } },
      turn: color,
      clock: nullable({ $ref: "Clock#" }),
      draw_offer: { type: ["string", "null"], enum: ["white", "black", null] },
      takeback_offer: { type: ["string", "null"], enum: ["white", "black", null] },
      result: { type: "string", enum: ["1-0", "0-1", "1/2-1/2", "*"] },
      winner: { type: ["string", "null"], enum: ["white", "black", null] },
      termination: { type: ["string", "null"] },
      source: { type: "string", enum: ["live", "import"] },
      pgn: { type: "string" },
      created_at: { type: "integer" },
      last_move_at: { type: ["integer", "null"] },
    },
    required: ["id", "status", "time_control", "time_class", "white", "black", "fen", "moves", "turn", "result", "pgn"],
  },
  {
    $id: "Seek",
    type: "object",
    properties: {
      id: { type: "string" },
      username: { type: "string" },
      user_id: { type: "string" },
      time_control: { type: "string" },
      time_class: { type: "string" },
      color: { type: "string", enum: ["white", "black", "random"] },
      created_at: { type: "integer" },
    },
    required: ["id", "username", "time_control", "time_class", "color"],
  },
  {
    $id: "Analysis",
    type: "object",
    properties: {
      fen: { type: "string" },
      depth: { type: "integer" },
      bestmove: { type: ["string", "null"] },
      eval: {
        type: "object",
        description: "Aus Sicht von Weiß: {cp} in Centibauern oder {mate} in Zügen",
        properties: { cp: { type: "integer" }, mate: { type: "integer" } },
      },
      pv: { type: "array", items: { type: "string" } },
    },
    required: ["fen", "depth", "bestmove", "eval", "pv"],
  },
];

export const ref = (id: string) => ({ $ref: `${id}#` });
export const errorResponses = {
  400: ref("Error"),
  401: ref("Error"),
  403: ref("Error"),
  404: ref("Error"),
  409: ref("Error"),
};

export const timeControlInput = {
  description: 'Zeitmodus als chess.com-String ("180+2", "1/86400", "-") oder Objekt',
  anyOf: [
    { type: "string" },
    {
      type: "object",
      properties: {
        type: { type: "string", enum: ["realtime", "daily", "unlimited"] },
        initial: { type: "integer", description: "Sekunden" },
        increment: { type: "integer", description: "Sekunden" },
        daysPerMove: { type: "integer" },
      },
      required: ["type"],
    },
  ],
};
