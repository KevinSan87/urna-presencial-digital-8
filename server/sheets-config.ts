/**
 * Configuração central da planilha compartilhada por todas as instalações.
 * Edite apenas este arquivo antes de distribuir o ZIP.
 *
 * O valor pode ser preenchido com a URL pública de um Google Apps Script
 * implantado como Web App. Enquanto estiver vazio, os votos continuam sendo
 * registrados no banco local/provisionado e o admin mostra "Não configurado".
 */
export const CENTRAL_SHEETS_CONFIG = {
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbw8ko-bNB3YLWVE-iHNeMmNGtunfTVaq4fcgQrHVR15hlSonZNG3c9VwF8IpqfFsPlzfw/exec",
  spreadsheetId: "",
  sheetName: "Votos",
} as const;
