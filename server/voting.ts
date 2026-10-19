import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Express, Request, Response } from "express";
import mysql, { type Pool } from "mysql2/promise";
import type {
  AdminOverview,
  PublicVotingData,
  ResultRow,
  VoteRecord,
  VotingConfig,
  VotingGroup,
  VotingStatus,
} from "@shared/voting";
import { CENTRAL_SHEETS_CONFIG } from "./sheets-config";

interface VotingState {
  config: VotingConfig;
  groups: VotingGroup[];
  votes: VoteRecord[];
}

interface RemoteVote {
  groupId: string;
  groupName: string;
  createdAt: string | null;
  voteId?: string;
}

interface RemoteState {
  config?: Partial<Pick<VotingConfig, "name" | "logo" | "status">>;
  groups?: VotingGroup[];
  votes?: RemoteVote[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "voting-state.json");
const COOKIE_NAME = "voting-admin";
const LOCAL_COOKIE_NAME = "voting-admin-local";
const DEVICE_ACCESS_COOKIE = "voting-device-access";
const DEVICE_ACCESS_PASSWORD = process.env.VOTING_DEVICE_PASSWORD || "EmiliaPaiva00";
const sessions = new Set<string>();
const deviceAccessTokens = new Set<string>();

const defaultConfig: VotingConfig = {
  name: "Sistema de Votação",
  logo: null,
  status: "open",
  sheetsUrl: CENTRAL_SHEETS_CONFIG.appsScriptUrl,
  sheetsId: CENTRAL_SHEETS_CONFIG.spreadsheetId,
  sheetsTab: CENTRAL_SHEETS_CONFIG.sheetName,
  sheetsBaseline: 0,
};

const defaultGroups: VotingGroup[] = [
  { id: "001", name: "Grupo Alpha", logo: null, description: "Uma escolha para começar.", active: true, createdAt: new Date().toISOString() },
  { id: "002", name: "Grupo Beta", logo: null, description: "Vote na sua preferência.", active: true, createdAt: new Date().toISOString() },
  { id: "003", name: "Grupo Gamma", logo: null, description: "Sua participação importa.", active: true, createdAt: new Date().toISOString() },
  { id: "004", name: "Grupo Delta", logo: null, description: "Escolha com tranquilidade.", active: true, createdAt: new Date().toISOString() },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readFileState(): VotingState | null {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as VotingState;
    if (!parsed.config || !Array.isArray(parsed.groups) || !Array.isArray(parsed.votes)) return null;
    return parsed;
  } catch (error) {
    console.warn("[Voting] Não foi possível ler o estado local:", error);
    return null;
  }
}

function writeFileState(state: VotingState) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

function parseCookie(req: Request, name: string) {
  const raw = req.headers.cookie ?? "";
  const entry = raw.split(";").map(item => item.trim()).find(item => item.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

function adminCookie(res: Response, token: string, maxAge = 1000 * 60 * 60 * 12) {
  const seconds = Math.floor(maxAge / 1000);
  const previewCookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${seconds}`;
  const localCookie = `${LOCAL_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
  res.setHeader("Set-Cookie", [previewCookie, localCookie]);
}

function clearAdminCookie(res: Response) {
  res.setHeader("Set-Cookie", [
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`,
    `${LOCAL_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  ]);
}

function isAdmin(req: Request) {
  const token = parseCookie(req, COOKIE_NAME) || parseCookie(req, LOCAL_COOKIE_NAME);
  return Boolean(token && sessions.has(token));
}

function requireAdmin(req: Request, res: Response): boolean {
  if (isAdmin(req)) return true;
  res.status(401).json({ error: "Não autorizado." });
  return false;
}

function setDeviceAccessCookie(res: Response, token: string) {
  res.setHeader("Set-Cookie", `${DEVICE_ACCESS_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
}

function hasDeviceAccess(req: Request) {
  const token = parseCookie(req, DEVICE_ACCESS_COOKIE);
  return Boolean(token && deviceAccessTokens.has(token));
}

function normalizeConfig(input: Partial<VotingConfig>, current: VotingConfig): VotingConfig {
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : "Sistema de Votação";
  const status: VotingStatus = input.status === "closed" ? "closed" : input.status === "open" ? "open" : current.status;
  const sheetsUrl = typeof input.sheetsUrl === "string" ? input.sheetsUrl.trim() : current.sheetsUrl;
  return {
    ...current,
    name,
    logo: typeof input.logo === "string" && input.logo.trim() ? input.logo : input.logo === null ? null : current.logo,
    status,
    sheetsUrl,
    sheetsId: typeof input.sheetsId === "string" ? input.sheetsId.trim() : current.sheetsId,
    sheetsTab: typeof input.sheetsTab === "string" && input.sheetsTab.trim() ? input.sheetsTab.trim() : current.sheetsTab,
    sheetsBaseline: sheetsUrl ? (sheetsUrl !== current.sheetsUrl ? 0 : current.sheetsBaseline) : 0,
    updatedAt: new Date().toISOString(),
  };
}

class VotingStore {
  state: VotingState = { config: clone(defaultConfig), groups: clone(defaultGroups), votes: [] };
  private pool: Pool | null = null;
  private readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = this.initialize();
  }

  async ready() {
    await this.readyPromise;
  }

  private async initialize() {
    const fileState = readFileState();
    if (fileState) this.state = { ...fileState, config: { ...defaultConfig, ...fileState.config } };

    const dsn = process.env.DATABASE_URL || process.env.DRIZZLE_DATABASE_URL;
    if (!dsn) {
      if (!fileState) writeFileState(this.state);
      return;
    }

    try {
      this.pool = mysql.createPool(dsn);
      await this.pool.query(`CREATE TABLE IF NOT EXISTS voting_config (id INT PRIMARY KEY, name VARCHAR(255) NOT NULL, logo TEXT NULL, status VARCHAR(16) NOT NULL, sheets_url TEXT NOT NULL, sheets_id VARCHAR(255) NOT NULL, sheets_tab VARCHAR(255) NOT NULL, sheets_baseline INT NOT NULL DEFAULT 0, updated_at DATETIME NOT NULL)`);
      await this.pool.query(`CREATE TABLE IF NOT EXISTS voting_groups (id VARCHAR(32) PRIMARY KEY, name VARCHAR(255) NOT NULL, logo TEXT NULL, description TEXT NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME NOT NULL)`);
      await this.pool.query(`CREATE TABLE IF NOT EXISTS voting_votes (id VARCHAR(64) PRIMARY KEY, group_id VARCHAR(32) NOT NULL, created_at DATETIME NOT NULL, request_id VARCHAR(64) NULL UNIQUE, synced TINYINT(1) NOT NULL DEFAULT 1, INDEX voting_votes_group_idx (group_id), INDEX voting_votes_created_idx (created_at))`);
      await this.pool.query("ALTER TABLE voting_config ADD COLUMN sheets_baseline INT NOT NULL DEFAULT 0").catch(() => undefined);
      await this.pool.query("ALTER TABLE voting_votes ADD COLUMN request_id VARCHAR(64) NULL").catch(() => undefined);
      await this.pool.query("ALTER TABLE voting_votes ADD COLUMN synced TINYINT(1) NOT NULL DEFAULT 1").catch(() => undefined);
      await this.pool.query("CREATE UNIQUE INDEX voting_votes_request_idx ON voting_votes (request_id)").catch(() => undefined);

      const [configRows] = await this.pool.query("SELECT name, logo, status, sheets_url AS sheetsUrl, sheets_id AS sheetsId, sheets_tab AS sheetsTab, sheets_baseline AS sheetsBaseline, updated_at AS updatedAt FROM voting_config WHERE id = 1 LIMIT 1");
      const [groupRows] = await this.pool.query("SELECT id, name, logo, description, active, created_at AS createdAt FROM voting_groups ORDER BY id");
      const [voteRows] = await this.pool.query("SELECT id, group_id AS groupId, created_at AS createdAt, request_id AS requestId, synced FROM voting_votes ORDER BY created_at");
      const dbConfig = (configRows as Array<Record<string, unknown>>)[0];
      const dbGroups = groupRows as Array<Record<string, unknown>>;
      const dbVotes = voteRows as Array<Record<string, unknown>>;
      if (dbConfig) {
        this.state.config = {
          name: String(dbConfig.name),
          logo: dbConfig.logo ? String(dbConfig.logo) : null,
          status: dbConfig.status === "closed" ? "closed" : "open",
          sheetsUrl: String(dbConfig.sheetsUrl ?? ""),
          sheetsId: String(dbConfig.sheetsId ?? ""),
          sheetsTab: String(dbConfig.sheetsTab ?? "Votos"),
          sheetsBaseline: Number(dbConfig.sheetsBaseline ?? 0),
          updatedAt: dbConfig.updatedAt ? new Date(String(dbConfig.updatedAt)).toISOString() : undefined,
        };
        this.state.groups = dbGroups.map(row => ({
          id: String(row.id), name: String(row.name), logo: row.logo ? String(row.logo) : null,
          description: String(row.description ?? ""), active: Boolean(row.active),
          createdAt: new Date(String(row.createdAt)).toISOString(),
        }));
        this.state.votes = dbVotes.map(row => ({ id: String(row.id), groupId: String(row.groupId), createdAt: new Date(String(row.createdAt)).toISOString(), requestId: row.requestId ? String(row.requestId) : undefined, synced: row.synced !== 0 }));
      } else {
        await this.persist();
      }
      writeFileState(this.state);
    } catch (error) {
      console.warn("[Voting] Banco indisponível; usando persistência local:", error);
      this.pool = null;
      writeFileState(this.state);
    }
  }

  async persist() {
    writeFileState(this.state);
    if (!this.pool) return;
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("INSERT INTO voting_config (id, name, logo, status, sheets_url, sheets_id, sheets_tab, sheets_baseline, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE name=VALUES(name), logo=VALUES(logo), status=VALUES(status), sheets_url=VALUES(sheets_url), sheets_id=VALUES(sheets_id), sheets_tab=VALUES(sheets_tab), sheets_baseline=VALUES(sheets_baseline), updated_at=NOW()", [this.state.config.name, this.state.config.logo, this.state.config.status, this.state.config.sheetsUrl, this.state.config.sheetsId, this.state.config.sheetsTab, this.state.config.sheetsBaseline]);
      await connection.query("DELETE FROM voting_groups");
      for (const group of this.state.groups) {
        await connection.query("INSERT INTO voting_groups (id, name, logo, description, active, created_at) VALUES (?, ?, ?, ?, ?, ?)", [group.id, group.name, group.logo, group.description, group.active ? 1 : 0, new Date(group.createdAt)]);
      }
      await connection.query("DELETE FROM voting_votes");
      for (const vote of this.state.votes) {
        await connection.query("INSERT INTO voting_votes (id, group_id, created_at, request_id, synced) VALUES (?, ?, ?, ?, ?)", [vote.id, vote.groupId, new Date(vote.createdAt), vote.requestId ?? null, vote.synced === false ? 0 : 1]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      console.warn("[Voting] Falha ao persistir no banco; arquivo local mantido:", error);
    } finally {
      connection.release();
    }
  }

  resultRows(): ResultRow[] {
    const counts = new Map<string, number>();
    for (const vote of this.state.votes) counts.set(vote.groupId, (counts.get(vote.groupId) ?? 0) + 1);
    const total = this.state.votes.length;
    return this.state.groups.map(group => ({
      groupId: group.id,
      name: group.name,
      logo: group.logo,
      votes: counts.get(group.id) ?? 0,
      percentage: total ? Number((((counts.get(group.id) ?? 0) / total) * 100).toFixed(1)) : 0,
      active: group.active,
    }));
  }

  publicData(): PublicVotingData {
    return { config: clone(this.state.config), groups: clone(this.state.groups.filter(group => group.active)) };
  }

  async syncFromSheets() {
    const remote = await fetchRemoteState(this.state.config);
    if (!remote) return false;
    if (remote.config) this.state.config = normalizeConfig({ name: remote.config.name, status: remote.config.status }, this.state.config);
    if (Array.isArray(remote.groups)) {
      this.state.groups = remote.groups.map(group => ({
        ...group,
        logo: this.state.groups.find(current => current.id === group.id)?.logo ?? null,
      }));
    }
    return true;
  }

  async flushOfflineVotes() {
    let changed = false;
    for (const vote of this.state.votes.filter(item => item.synced === false)) {
      const group = this.state.groups.find(item => item.id === vote.groupId);
      if (!group) continue;
      const result = await sendToSheets(this.state.config, group, vote.createdAt, vote.id);
      if (result.sent) {
        vote.synced = true;
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  async overview(): Promise<AdminOverview> {
    const rows = this.state.votes.map(vote => ({
      groupId: vote.groupId,
      groupName: this.state.groups.find(group => group.id === vote.groupId)?.name ?? "",
      createdAt: vote.createdAt,
    }));
    const counts = new Map<string, number>();
    for (const vote of rows) counts.set(vote.groupId, (counts.get(vote.groupId) ?? 0) + 1);
    const totalVotes = rows.length;
    const results = this.state.groups.map(group => ({
      groupId: group.id,
      name: group.name,
      logo: group.logo,
      votes: counts.get(group.id) ?? 0,
      percentage: totalVotes ? Number((((counts.get(group.id) ?? 0) / totalVotes) * 100).toFixed(1)) : 0,
      active: group.active,
    }));
    const lastVote = rows.at(-1);
    return { ...clone(this.state), totalVotes, results, lastVoteAt: lastVote?.createdAt ?? null };
  }
}

const store = new VotingStore();

async function sendToSheets(config: VotingConfig, group: VotingGroup, createdAt: string, voteId?: string) {
  if (!config.sheetsUrl) return { sent: false, reason: "Não configurado" };
  try {
    const date = new Date(createdAt);
    const response = await fetch(config.sheetsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: date.toLocaleDateString("pt-BR"),
        time: date.toLocaleTimeString("pt-BR"),
        groupId: group.id,
        groupName: group.name,
        voteId,
        sheetId: config.sheetsId,
        sheetName: config.sheetsTab,
      }),
    });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean };
    const sent = response.ok && payload.ok !== false;
    return { sent, reason: sent ? "Enviado" : payload.ok === false ? "O Apps Script recusou o voto." : `Resposta ${response.status}` };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "Falha de conexão" };
  }
}

async function replaceVotesOnSheets(config: VotingConfig, votes: VoteRecord[], groups: VotingGroup[]) {
  if (!config.sheetsUrl) return { sent: false, reason: "Não configurado" };
  try {
    const response = await fetch(config.sheetsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "replaceVotes",
        sheetId: config.sheetsId,
        sheetName: config.sheetsTab,
        votes: votes.map(vote => {
          const group = groups.find(item => item.id === vote.groupId);
          const date = new Date(vote.createdAt);
          return {
            date: date.toLocaleDateString("pt-BR"),
            time: date.toLocaleTimeString("pt-BR"),
            groupId: vote.groupId,
            groupName: group?.name ?? "",
            createdAt: vote.createdAt,
            voteId: vote.id,
          };
        }),
      }),
    });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; count?: number };
    const sent = response.ok && payload.ok === true;
    return { sent, count: payload.count ?? 0, reason: sent ? "Planilha reconciliada" : payload.error ?? `Resposta ${response.status}` };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "Falha de conexão" };
  }
}

async function fetchRemoteVotes(config: VotingConfig): Promise<RemoteVote[] | null> {
  if (!config.sheetsUrl) return null;
  try {
    const url = new URL(config.sheetsUrl);
    url.searchParams.set("action", "votes");
    if (config.sheetsTab) url.searchParams.set("sheet", config.sheetsTab);
    const response = await fetch(url, { method: "GET", redirect: "follow" });
    if (!response.ok) return null;
    const payload = await response.json() as { ok?: boolean; votes?: Array<Record<string, unknown>> };
    if (payload.ok === false) return null;
    if (!Array.isArray(payload.votes)) return null;
    return payload.votes.map(row => ({
      groupId: String(row.groupId ?? row["ID do grupo"] ?? ""),
      groupName: String(row.groupName ?? row["Nome do grupo"] ?? ""),
      createdAt: row.createdAt ? String(row.createdAt) : null,
      voteId: String(row.voteId ?? row["voteId"] ?? ""),
    })).filter(row => row.groupId);
  } catch {
    return null;
  }
}

async function fetchRemoteState(config: VotingConfig): Promise<RemoteState | null> {
  if (!config.sheetsUrl) return null;
  try {
    const url = new URL(config.sheetsUrl);
    url.searchParams.set("action", "state");
    if (config.sheetsId) url.searchParams.set("sheetId", config.sheetsId);
    const response = await fetch(url, { method: "GET", redirect: "follow" });
    if (!response.ok) return null;
    const payload = await response.json() as RemoteState & { ok?: boolean };
    if (payload.ok === false) return null;
    if (!payload.config || !Array.isArray(payload.groups)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function pushRemoteState(config: VotingConfig, groups: VotingGroup[]) {
  if (!config.sheetsUrl) return { sent: false, reason: "Não configurado" };
  try {
    const response = await fetch(config.sheetsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "state",
        sheetId: config.sheetsId,
        config: { name: config.name, status: config.status },
        groups: groups.map(({ logo: _logo, ...group }) => group),
      }),
    });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
    const sent = response.ok && payload.ok !== false;
    return { sent, reason: sent ? "Sincronizado" : payload.error ?? `Resposta ${response.status}` };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "Falha de conexão" };
  }
}

export function registerVotingRoutes(app: Express) {
  app.get("/api/voting/access", (req, res) => {
    res.json({ unlocked: hasDeviceAccess(req) });
  });

  app.post("/api/voting/unlock", (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (password !== DEVICE_ACCESS_PASSWORD) return res.status(401).json({ error: "Senha incorreta." });
    const token = crypto.randomBytes(32).toString("hex");
    deviceAccessTokens.add(token);
    setDeviceAccessCookie(res, token);
    res.json({ unlocked: true });
  });

  app.get("/api/voting/public", async (req, res) => {
    if (!hasDeviceAccess(req)) return res.status(403).json({ error: "Este computador ainda não foi liberado para votar." });
    await store.ready();
    res.json(store.publicData());
  });

  app.post("/api/voting/vote", async (req, res) => {
    if (!hasDeviceAccess(req)) return res.status(403).json({ error: "Este computador ainda não foi liberado para votar." });
    await store.ready();
    if (store.state.config.status !== "open") return res.status(409).json({ error: "A votação está encerrada." });
    const groupId = typeof req.body?.groupId === "string" ? req.body.groupId : "";
    const group = store.state.groups.find(item => item.id === groupId && item.active);
    if (!group) return res.status(400).json({ error: "Grupo inválido ou inativo." });
    const requestId = typeof req.body?.requestId === "string" ? req.body.requestId.trim() : "";
    const existing = requestId ? store.state.votes.find(vote => vote.requestId === requestId) : undefined;
    if (existing) return res.status(200).json({ success: true, duplicate: true, voteId: existing.id, sheets: { sent: true, reason: "Voto já registrado." } });
    const vote: VoteRecord = { id: crypto.randomUUID(), groupId: group.id, createdAt: new Date().toISOString(), requestId: requestId || undefined, synced: false };
    store.state.votes.push(vote);
    await store.persist();
    res.status(201).json({ success: true, voteId: vote.id, sheets: { sent: false, reason: "Salvo localmente. Sincronize pelo painel administrativo." } });
  });

  app.get("/api/admin/session", async (req, res) => {
    await store.ready();
    res.json({ authenticated: isAdmin(req) });
  });

  app.post("/api/admin/login", async (req, res) => {
    await store.ready();
    const username = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (username !== "Emilia" || password !== "Emilia@123") return res.status(401).json({ error: "Usuário ou senha incorretos." });
    const token = crypto.randomBytes(24).toString("hex");
    sessions.add(token);
    adminCookie(res, token);
    res.json({ success: true });
  });

  app.post("/api/admin/logout", async (req, res) => {
    const token = parseCookie(req, COOKIE_NAME);
    if (token) sessions.delete(token);
    clearAdminCookie(res);
    res.json({ success: true });
  });

  app.post("/api/admin/sync-sheets", async (req, res) => {
    await store.ready();
    if (!requireAdmin(req, res)) return;
    const remoteVotes = await fetchRemoteVotes(store.state.config);
    if (!remoteVotes) return res.status(502).json({ error: "Não foi possível ler a planilha. Nenhum voto foi enviado." });
    const localKeys = store.state.votes.map(vote => `${vote.groupId}|${vote.createdAt}`).sort();
    const remoteKeys = remoteVotes.map(vote => `${vote.groupId}|${vote.createdAt ?? ""}`).sort();
    if (localKeys.length === remoteKeys.length && localKeys.every((key, index) => key === remoteKeys[index])) {
      for (const vote of store.state.votes) vote.synced = true;
      await store.persist();
      return res.json({ success: true, reconciled: false, added: 0, removed: 0, total: localKeys.length, pending: 0 });
    }
    const result = await replaceVotesOnSheets(store.state.config, store.state.votes, store.state.groups);
    if (!result.sent) return res.status(502).json({ error: result.reason, pending: store.state.votes.filter(vote => vote.synced === false).length });
    for (const vote of store.state.votes) vote.synced = true;
    await store.persist();
    res.json({ success: true, reconciled: true, added: Math.max(0, localKeys.length - remoteKeys.length), removed: Math.max(0, remoteKeys.length - localKeys.length), total: result.count ?? localKeys.length, pending: 0 });
  });

  app.post("/api/admin/images", async (req, res) => {
    await store.ready();
    if (!requireAdmin(req, res)) return;
    const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return res.status(400).json({ error: "Envie uma imagem PNG, JPEG, WEBP ou GIF válida." });
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) return res.status(413).json({ error: "A imagem deve ter no máximo 8 MB." });
    const extension = match[1].toLowerCase().replace("jpeg", "jpg").replace("image/", "");
    const filename = `${crypto.randomUUID()}.${extension}`;
    const uploadDir = path.join(DATA_DIR, "uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, filename), bytes);
    res.status(201).json({ url: `/uploads/${filename}` });
  });

  app.get("/api/admin/overview", async (req, res) => {
    await store.ready();
    if (!requireAdmin(req, res)) return;
    res.json(await store.overview());
  });

  app.put("/api/admin/config", async (req, res) => {
    await store.ready();
    if (!requireAdmin(req, res)) return;
    store.state.config = normalizeConfig(req.body ?? {}, store.state.config);
    await store.persist();
    const central = await pushRemoteState(store.state.config, store.state.groups);
    res.json({ ...(await store.overview()), central });
  });

  app.post("/api/admin/groups", async (req, res) => {
    await store.ready();
    if (!requireAdmin(req, res)) return;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "Informe o nome do grupo." });
    const ids = store.state.groups.map(group => Number(group.id)).filter(Number.isFinite);
    const nextId = String(Math.max(0, ...ids) + 1).padStart(3, "0");
    const group: VotingGroup = {
      id: nextId,
      name,
      logo: typeof req.body.logo === "string" && req.body.logo ? req.body.logo : null,
      description: typeof req.body.description === "string" ? req.body.description.trim() : "",
      active: req.body.active !== false,
      createdAt: new Date().toISOString(),
    };
    store.state.groups.push(group);
    await store.persist();
    const central = await pushRemoteState(store.state.config, store.state.groups);
    res.status(201).json({ group, central });
  });

  app.put("/api/admin/groups/:id", async (req, res) => {
    await store.ready();
    if (!requireAdmin(req, res)) return;
    const group = store.state.groups.find(item => item.id === req.params.id);
    if (!group) return res.status(404).json({ error: "Grupo não encontrado." });
    if (typeof req.body?.name === "string" && req.body.name.trim()) group.name = req.body.name.trim();
    if (typeof req.body?.description === "string") group.description = req.body.description.trim();
    if (typeof req.body?.logo === "string") group.logo = req.body.logo || null;
    if (typeof req.body?.active === "boolean") group.active = req.body.active;
    await store.persist();
    const central = await pushRemoteState(store.state.config, store.state.groups);
    res.json({ group, central });
  });

  app.delete("/api/admin/groups/:id", async (req, res) => {
    await store.ready();
    if (!requireAdmin(req, res)) return;
    const index = store.state.groups.findIndex(item => item.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: "Grupo não encontrado." });
    store.state.groups.splice(index, 1);
    await store.persist();
    const central = await pushRemoteState(store.state.config, store.state.groups);
    res.json({ success: true, central });
  });

  app.post("/api/admin/control", async (req, res) => {
    await store.ready();
    if (!requireAdmin(req, res)) return;
    store.state.config.status = req.body?.status === "closed" ? "closed" : "open";
    store.state.config.updatedAt = new Date().toISOString();
    await store.persist();
    const central = await pushRemoteState(store.state.config, store.state.groups);
    res.json({ status: store.state.config.status, central });
  });

  app.post("/api/admin/reset", async (req, res) => {
    await store.ready();
    if (!requireAdmin(req, res)) return;
    const remoteVotes = await fetchRemoteVotes(store.state.config);
    if (remoteVotes) store.state.config.sheetsBaseline = remoteVotes.length;
    store.state.votes = [];
    await store.persist();
    res.json({ success: true });
  });

  app.post("/api/admin/test-sheets", async (req, res) => {
    await store.ready();
    if (!requireAdmin(req, res)) return;
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : store.state.config.sheetsUrl;
    if (!url) return res.status(400).json({ connected: false, message: "Informe a URL do Google Apps Script." });
    try {
      const response = await fetch(url, { method: "GET", redirect: "follow" });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean };
      const connected = response.ok && payload.ok !== false;
      res.json({ connected, message: connected ? "Conexão respondendo." : payload.ok === false ? "O Apps Script respondeu com erro." : `Resposta HTTP ${response.status}.` });
    } catch (error) {
      res.json({ connected: false, message: error instanceof Error ? error.message : "Não foi possível conectar." });
    }
  });
}
