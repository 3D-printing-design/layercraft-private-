const fetch    = require('node-fetch');
const FormData = require('form-data');
const supabase = require('./db');

const OCTOPRINT_URL = () => process.env.OCTOPRINT_URL || 'http://192.168.1.50';
const OCTOPRINT_KEY = () => process.env.OCTOPRINT_API_KEY;

function headers(extra = {}) {
  return { 'X-Api-Key': OCTOPRINT_KEY(), ...extra };
}

// ── Test connection ───────────────────────────────────────────
async function testConnection() {
  const res = await fetch(`${OCTOPRINT_URL()}/api/version`, {
    headers: headers(),
    timeout: 5000,
  });
  if (!res.ok) throw new Error(`OctoPrint responded with ${res.status}`);
  return res.json();
}

// ── Get printer status ────────────────────────────────────────
async function getPrinterStatus() {
  const [printerRes, jobRes] = await Promise.all([
    fetch(`${OCTOPRINT_URL()}/api/printer`, { headers: headers() }),
    fetch(`${OCTOPRINT_URL()}/api/job`,     { headers: headers() }),
  ]);

  const printer = await printerRes.json();
  const job     = await jobRes.json();

  return {
    state:         printer.state?.text || 'Unknown',
    flags:         printer.state?.flags || {},
    tempNozzle:    printer.temperature?.tool0?.actual || 0,
    tempNozzleTarget: printer.temperature?.tool0?.target || 0,
    tempBed:       printer.temperature?.bed?.actual || 0,
    tempBedTarget: printer.temperature?.bed?.target || 0,
    file:          job.job?.file?.name || null,
    progress:      job.progress?.completion ? Math.round(job.progress.completion) : 0,
    printTime:     job.progress?.printTime || 0,
    printTimeLeft: job.progress?.printTimeLeft || null,
    estimatedTotal: job.job?.estimatedPrintTime || null,
  };
}

// ── Send file to printer ──────────────────────────────────────
// Downloads file from Supabase Storage then uploads to OctoPrint
async function sendFileToPrinter(orderId, printFilename) {
  console.log(`[PRINTER] Sending ${printFilename} to OctoPrint for order ${orderId}`);

  // Update status to uploading
  await supabase
    .from('orders')
    .update({ print_status: 'uploading', updated_at: new Date().toISOString() })
    .eq('id', orderId);

  // Download the G-code file from Supabase Storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from(process.env.STORAGE_BUCKET_PRINTFILES || 'print-files')
    .download(`print-files/${printFilename}`);

  if (downloadError) throw new Error(`Could not download print file: ${downloadError.message}`);

  // Convert to Buffer
  const arrayBuffer = await fileData.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Upload to OctoPrint with print:true to start immediately
  const formData = new FormData();
  formData.append('file', buffer, { filename: printFilename });
  formData.append('print', 'true');     // start printing after upload
  formData.append('select', 'true');    // select the file

  const uploadRes = await fetch(`${OCTOPRINT_URL()}/api/files/local`, {
    method:  'POST',
    headers: headers(formData.getHeaders()),
    body:    formData,
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`OctoPrint upload failed (${uploadRes.status}): ${text}`);
  }

  // Update status to printing
  await supabase
    .from('orders')
    .update({ print_status: 'printing', updated_at: new Date().toISOString() })
    .eq('id', orderId);

  console.log(`[PRINTER] ${printFilename} uploaded and printing started`);
  return true;
}

// ── Printer controls ──────────────────────────────────────────
async function pausePrint() {
  const res = await fetch(`${OCTOPRINT_URL()}/api/job`, {
    method:  'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ command: 'pause', action: 'pause' }),
  });
  if (!res.ok) throw new Error(`Pause failed: ${res.status}`);
}

async function resumePrint() {
  const res = await fetch(`${OCTOPRINT_URL()}/api/job`, {
    method:  'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ command: 'pause', action: 'resume' }),
  });
  if (!res.ok) throw new Error(`Resume failed: ${res.status}`);
}

async function cancelPrint() {
  const res = await fetch(`${OCTOPRINT_URL()}/api/job`, {
    method:  'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ command: 'cancel' }),
  });
  if (!res.ok) throw new Error(`Cancel failed: ${res.status}`);
}

module.exports = { testConnection, getPrinterStatus, sendFileToPrinter, pausePrint, resumePrint, cancelPrint };
