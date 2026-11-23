/**
 * Sidra CRM — frontend configuration.
 * 1. Copy this file to  config.js  (same folder).
 * 2. Paste your Google Apps Script Web App URL (ends with /exec) below.
 *
 * This URL is not a secret: every request is still authenticated with the
 * user's session token and checked for permissions on the server.
 */
window.SIDRA_CONFIG = {
  API_URL: 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE', // e.g. https://script.google.com/macros/s/AKfycb.../exec
  POLL_SECONDS: 60,   // how often the app checks for new notifications / due callbacks
  PAGE_SIZE: 25,      // default rows per table page
  UPLOAD_CHUNK: 150   // rows per bulk-upload request (keeps each call well under the Apps Script time limit)
};
