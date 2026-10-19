/**
 * Urna Presencial Digital — fonte central do sistema.
 *
 * 1. Abra a planilha modelo no Google Sheets.
 * 2. Extensões > Apps Script e substitua o conteúdo por este arquivo.
 * 3. Implante como Aplicativo da Web, executando como você e com acesso
 *    para qualquer pessoa com o link.
 * 4. Cole a URL /exec no painel administrativo em Google Sheets.
 *
 * As abas Configuração e Grupos controlam todos os notebooks:
 * identidade, logo, status, nomes, descrições, imagens e grupos ativos.
 * A aba Votos recebe os registros de voto.
 */
const SPREADSHEET_ID = "";
const DEFAULT_VOTES_SHEET = "Votos";
const CONFIG_SHEET = "Configuração";
const GROUPS_SHEET = "Grupos";

function spreadsheet_(id) {
  return id || SPREADSHEET_ID
    ? SpreadsheetApp.openById(id || SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name, id) {
  const book = spreadsheet_(id);
  let sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  return sheet;
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function ensureVotesHeader_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Data", "Horário", "ID do grupo", "Nome do grupo", "createdAt", "voteId"]);
  } else if (sheet.getLastColumn() < 6) {
    sheet.getRange(1, 6).setValue("voteId");
  }
}

function readConfig_() {
  const sheet = sheet_(CONFIG_SHEET);
  const values = sheet.getDataRange().getValues();
  const result = {};
  values.slice(1).forEach(function(row) {
    const key = String(row[0] || "").trim();
    if (key) result[key] = row[1] === undefined ? "" : row[1];
  });
  return {
    name: String(result.name || result.NOME || "Sistema de Votação"),
    status: String(result.status || result.STATUS || "open").toLowerCase() === "closed" ? "closed" : "open"
  };
}

function writeConfig_(config) {
  const sheet = sheet_(CONFIG_SHEET);
  sheet.clear();
  sheet.getRange(1, 1, 1, 2).setValues([["Campo", "Valor"]]);
  sheet.getRange(2, 1, 2, 2).setValues([
    ["name", config.name || "Sistema de Votação"],
    ["status", config.status === "closed" ? "closed" : "open"]
  ]);
  sheet.getRange(1, 1, 1, 2).setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 2);
}

function readGroups_() {
  const sheet = sheet_(GROUPS_SHEET);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(function(value) { return String(value || "").toLowerCase(); });
  const imageIndex = headers.indexOf("imagem/url") >= 0 ? headers.indexOf("imagem/url") : 3;
  const activeIndex = headers.indexOf("ativo") >= 0 ? headers.indexOf("ativo") : 4;
  const createdIndex = headers.indexOf("createdat") >= 0 ? headers.indexOf("createdat") : 5;
  return values.slice(1).filter(function(row) { return row[0] || row[1]; }).map(function(row) {
    return {
      id: String(row[0] || ""),
      name: String(row[1] || ""),
      description: String(row[2] || ""),
      logo: row[imageIndex] && String(row[imageIndex]).toUpperCase() !== "SIM" && String(row[imageIndex]).toUpperCase() !== "NÃO" && String(row[imageIndex]).toUpperCase() !== "NAO" ? String(row[imageIndex]) : null,
      active: String(row[activeIndex] === undefined ? "SIM" : row[activeIndex]).toUpperCase() !== "NÃO" && String(row[activeIndex] === undefined ? "SIM" : row[activeIndex]).toUpperCase() !== "NAO" && row[activeIndex] !== false,
      createdAt: row[createdIndex] ? String(row[createdIndex]) : new Date().toISOString()
    };
  }).filter(function(group) { return group.id && group.name; });
}

function writeGroups_(groups) {
  const sheet = sheet_(GROUPS_SHEET);
  sheet.clear();
  sheet.getRange(1, 1, 1, 6).setValues([["ID do grupo", "Nome do grupo", "Descrição", "Imagem/URL", "Ativo", "createdAt"]]);
  const rows = (groups || []).map(function(group) {
    return [group.id || "", group.name || "", group.description || "", group.logo || "", group.active === false ? "NÃO" : "SIM", group.createdAt || new Date().toISOString()];
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  sheet.getRange(1, 1, 1, 6).setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 6);
}

function readVotes_(sheetName, sheetId) {
  const sheet = sheet_(sheetName || DEFAULT_VOTES_SHEET, sheetId);
  ensureVotesHeader_(sheet);
  const values = sheet.getDataRange().getValues();
  return values.slice(1).filter(function(row) { return row[0] || row[2] || row[3] || row[4] || row[5]; }).map(function(row) {
    return {
      date: String(row[0] || ""),
      time: String(row[1] || ""),
      groupId: String(row[2] || ""),
      groupName: String(row[3] || ""),
      createdAt: row[4] ? String(row[4]) : null,
      voteId: row[5] ? String(row[5]) : ""
    };
  });
}

function voteRow_(vote) {
  const createdAt = String(vote.createdAt || vote.created_at || new Date().toISOString());
  const parsed = new Date(createdAt);
  const date = String(vote.date || (isNaN(parsed.getTime()) ? "" : Utilities.formatDate(parsed, Session.getScriptTimeZone(), "dd/MM/yyyy")));
  const time = String(vote.time || (isNaN(parsed.getTime()) ? "" : Utilities.formatDate(parsed, Session.getScriptTimeZone(), "HH:mm:ss")));
  const groupId = String(vote.groupId || vote.group_id || vote["ID do grupo"] || "");
  const groupName = String(vote.groupName || vote.group_name || vote.name || vote["Nome do grupo"] || "");
  const voteId = String(vote.voteId || vote.vote_id || "");
  return [date, time, groupId, groupName, createdAt, voteId];
}

function replaceVotes_(sheetName, sheetId, votes) {
  const sheet = sheet_(sheetName || DEFAULT_VOTES_SHEET, sheetId);
  ensureVotesHeader_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 6).clearContent();
  const rows = (votes || []).map(voteRow_);
  if (rows.length) sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  return rows.length;
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || "state";
    if (action === "votes") return json_({ ok: true, votes: readVotes_(params.sheet, params.sheetId) });
    return json_({ ok: true, config: readConfig_(), groups: readGroups_(), votes: readVotes_(params.sheet, params.sheetId) });
  } catch (error) {
    return json_({ ok: false, error: String(error), groups: [], votes: [] });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = body.action || "vote";
    if (action === "state") {
      writeConfig_(body.config || {});
      writeGroups_(body.groups || []);
      return json_({ ok: true, synced: true });
    }
    if (action === "replaceVotes") {
      const count = replaceVotes_(body.sheetName || DEFAULT_VOTES_SHEET, body.sheetId, body.votes || []);
      return json_({ ok: true, replaced: true, count: count });
    }
    const sheet = sheet_(body.sheetName || DEFAULT_VOTES_SHEET, body.sheetId);
    ensureVotesHeader_(sheet);
    const ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 6, sheet.getLastRow() - 1, 1).getValues().flat().map(String) : [];
    if (body.voteId && ids.indexOf(String(body.voteId)) >= 0) return json_({ ok: true, recorded: false, duplicate: true });
    sheet.appendRow(voteRow_(body));
    return json_({ ok: true, recorded: true });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  }
}
