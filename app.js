const input = document.getElementById("inputText");
const outputBox = document.getElementById("outputBox");
const translateBtn = document.getElementById("translateBtn");
const levelSelect = document.getElementById("levelSelect");
const toneSelect = document.getElementById("toneSelect");
const copyBtn = document.getElementById('copyBtn');
const saveBtn = document.getElementById('saveBtn');
const exportTxtBtn = document.getElementById('exportTxtBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const uploadInput = document.getElementById('uploadInput');
const chooseFileBtn = document.getElementById('chooseFileBtn');
const uploadBtn = document.getElementById('uploadBtn');
const uploadStatus = document.getElementById('uploadStatus');
const historyList = document.getElementById('historyList');
const historyRefresh = document.getElementById('historyRefresh');
const historyStatus = document.getElementById('historyStatus');

const BACKEND_API_KEY = null; // set to string manually in index.html if your server requires it

function fakeTranslate(text, level, tone) {
  if (!text || !text.trim()) {
    return "Please paste a medical text first.";
  }

  let base =
    "This text describes changes in the body that your doctor wants to check more carefully. ";

  if (level === "basic") {
    base += "In simple terms, something is not working perfectly, but it does not always mean something dangerous.";
  } else if (level === "teen") {
    base +=
      "Think of it as your body sending a notification: 'check this system'. It’s a sign to talk to your doctor, not to panic.";
  } else {
    base +=
      "It indicates a deviation from the reference range that needs clinical correlation rather than automatic fear.";
  }

  if (tone === "gentle") {
    base +=
      " You don’t need to jump to worst-case scenarios; the next step is calmly discussing this with a professional.";
  } else if (tone === "direct") {
    base +=
      " You should not ignore it, but the right move is to ask your doctor specific questions instead of googling.";
  } else {
    base +=
      " The language is neutral: focus on the facts and suggested next steps rather than dramatic interpretation.";
  }

  const summary = text.length > 200 ? text.slice(0, 200) + "…" : text;
  return base + "\n\nSummary: " + summary;
}

// New: try backend call, fallback to fakeTranslate
async function translateViaBackend(text, level, tone) {
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, level, tone }),
    });

    if (!res.ok) {
      console.warn('Backend returned error', res.status);
      return null;
    }

    const data = await res.json();
    return data?.result || null;
  } catch (err) {
    console.warn('Error calling backend', err);
    return null;
  }
}

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (typeof BACKEND_API_KEY === 'string' && BACKEND_API_KEY) headers['x-api-key'] = BACKEND_API_KEY;
  return headers;
}

async function copyOutput() {
  if (!outputBox) return;
  const text = outputBox.innerText || '';
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
  } catch (err) {
    console.warn('copy failed', err);
    copyBtn.textContent = 'Copy (failed)';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
  }
}

async function saveOutputToServer(text, result, level, tone) {
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ text, result, level, tone }),
    });
    if (!res.ok) throw new Error('save failed');
    const data = await res.json();
    saveBtn.textContent = 'Saved';
    setTimeout(() => (saveBtn.textContent = 'Save'), 1500);
    return data.id;
  } catch (err) {
    console.warn('save error', err);
    saveBtn.textContent = 'Save (failed)';
    setTimeout(() => (saveBtn.textContent = 'Save'), 1500);
    return null;
  }
}

function downloadUrl(url) {
  window.open(url, '_blank');
}

async function exportLatest(format = 'txt') {
  // If server returned an id on last translation, store it on the output element as data-last-id
  const id = outputBox?.dataset?.lastId;
  if (!id) {
    // fallback: download a client-side txt of current output
    if (format === 'txt') {
      const text = outputBox.innerText || '';
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'medlingua-explanation.txt';
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    // no id and PDF requested — just generate simple client-side PDF
    const text = outputBox.innerText || '';
    const win = window.open('', '_blank');
    win.document.write('<pre>' + text.replace(/</g, '&lt;') + '</pre>');
    return;
  }

  const url = `/api/history/${id}/export?format=${format}`;
  downloadUrl(url);
}

async function chooseFile() {
  uploadInput && uploadInput.click();
}

async function uploadPdf() {
  if (!uploadInput || !uploadInput.files || uploadInput.files.length === 0) {
    uploadStatus.textContent = 'No file chosen';
    return;
  }
  const file = uploadInput.files[0];
  uploadStatus.textContent = 'Parsing…';
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    if (!res.ok) throw new Error('upload failed');
    const data = await res.json();
    uploadStatus.textContent = 'Parsed';
    input.value = data.text || '';
    setTimeout(() => (uploadStatus.textContent = ''), 2000);
  } catch (err) {
    console.warn('upload error', err);
    uploadStatus.textContent = 'Parse failed';
    setTimeout(() => (uploadStatus.textContent = ''), 2000);
  }
}

async function fetchHistory() {
  try {
    historyStatus.textContent = 'Loading…';
    const res = await fetch('/api/history', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('history fetch failed');
    const data = await res.json();
    renderHistory(data.items || []);
    historyStatus.textContent = '';
  } catch (err) {
    console.warn('history error', err);
    historyStatus.textContent = 'Unavailable';
  }
}

function renderHistory(items) {
  if (!historyList) return;
  historyList.innerHTML = '';
  if (!items.length) {
    historyList.innerHTML = '<div style="color:#9ca3af;font-size:0.9rem">No history yet.</div>';
    return;
  }
  items.forEach((it) => {
    const el = document.createElement('div');
    el.style.padding = '0.5rem';
    el.style.borderRadius = '6px';
    el.style.background = 'rgba(255,255,255,0.03)';
    el.style.border = '1px solid rgba(255,255,255,0.02)';
    el.style.display = 'flex';
    el.style.justifyContent = 'space-between';
    el.style.alignItems = 'center';
    el.innerHTML = `<div style="flex:1;color:#cbd5e1;font-size:0.9rem">${(it.text_snippet||'').replace(/</g,'&lt;')}</div>`;
    const btns = document.createElement('div');
    btns.style.display = 'flex';
    btns.style.gap = '0.4rem';
    const view = document.createElement('button');
    view.className = 'btn btn--ghost';
    view.textContent = 'View';
    view.addEventListener('click', async () => {
      try {
        const r = await fetch(`/api/history/${it.id}`);
        if (!r.ok) throw new Error('fetch failed');
        const d = await r.json();
        setOutput(d.item.result || '');
        outputBox.dataset.lastId = it.id;
      } catch (err) {
        console.warn('view error', err);
      }
    });
    const exp = document.createElement('button');
    exp.className = 'btn';
    exp.textContent = 'Export';
    exp.addEventListener('click', () => downloadUrl(`/api/history/${it.id}/export?format=pdf`));
    btns.appendChild(view);
    btns.appendChild(exp);
    el.appendChild(btns);
    historyList.appendChild(el);
  });
}

function setOutput(text) {
  if (!outputBox) return;
  outputBox.innerHTML = "";
  const el = document.createElement("div");
  el.style.whiteSpace = "pre-wrap";
  el.textContent = text;
  outputBox.appendChild(el);
}

if (translateBtn) {
  translateBtn.addEventListener("click", () => {
    const text = input ? input.value : "";
    const level = levelSelect ? levelSelect.value : "basic";
    const tone = toneSelect ? toneSelect.value : "neutral";

    setOutput("Translating…");

    (async () => {
      const backend = await translateViaBackend(text, level, tone);
      if (backend) {
        setOutput(backend);
        // try to store id from server response
        // backend translator returns result only; translateViaBackend may be extended to return id
        // but translateViaBackend currently returns the string; we can optionally call /api/save separately
        return;
      }

      // fallback to local fake translator
      setTimeout(() => {
        const result = fakeTranslate(text, level, tone);
        setOutput(result);
      }, 450);
    })();
  });
}

// Optional: allow Ctrl/Cmd+Enter to trigger translation
if (input) {
  input.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      translateBtn && translateBtn.click();
    }
  });
}

// Wire new controls
if (copyBtn) copyBtn.addEventListener('click', copyOutput);
if (saveBtn) saveBtn.addEventListener('click', async () => {
  const text = input ? input.value : '';
  const result = outputBox ? outputBox.innerText : '';
  const level = levelSelect ? levelSelect.value : 'basic';
  const tone = toneSelect ? toneSelect.value : 'neutral';
  await saveOutputToServer(text, result, level, tone);
});
if (exportTxtBtn) exportTxtBtn.addEventListener('click', () => exportLatest('txt'));
if (exportPdfBtn) exportPdfBtn.addEventListener('click', () => exportLatest('pdf'));
if (chooseFileBtn) chooseFileBtn.addEventListener('click', chooseFile);
if (uploadBtn) uploadBtn.addEventListener('click', uploadPdf);
if (historyRefresh) historyRefresh.addEventListener('click', fetchHistory);

// Load history on page load (non-blocking)
setTimeout(() => {
  fetchHistory();
}, 800);
