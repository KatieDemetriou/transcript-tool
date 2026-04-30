const SPEAKER_COLORS = [
  '#6d28d9', '#0891b2', '#059669', '#d97706',
  '#dc2626', '#7c3aed', '#0284c7', '#c2410c',
];

// State
let currentJobId = null;
let utterances = [];
let speakerColorMap = {};
let pollingTimer = null;

// Elements
const uploadSection      = document.getElementById('upload-section');
const processingSection  = document.getElementById('processing-section');
const resultSection      = document.getElementById('result-section');
const uploadArea         = document.getElementById('upload-area');
const fileInput          = document.getElementById('file-input');
const filePreview        = document.getElementById('file-preview');
const fileNameEl         = document.getElementById('file-name');
const fileSizeEl         = document.getElementById('file-size');
const uploadBtn          = document.getElementById('upload-btn');
const audioPlayer        = document.getElementById('audio-player');
const transcriptContainer = document.getElementById('transcript-container');
const processingTitle    = document.getElementById('processing-title');
const languageBadge      = document.getElementById('language-badge');
const speakerCountBadge  = document.getElementById('speaker-count-badge');
const speakerLegend      = document.getElementById('speaker-legend');
const playerFilename     = document.getElementById('player-filename');

// ── File selection ──────────────────────────────────────────────

uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', e => {
  e.preventDefault();
  uploadArea.classList.add('dragging');
});

uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragging'));

uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) setFile(e.target.files[0]);
});

function setFile(file) {
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  filePreview.classList.remove('hidden');
  uploadBtn.onclick = () => startUpload(file);
}

// ── Upload & polling ────────────────────────────────────────────

async function startUpload(file) {
  showSection('processing');
  setProcessingStep('upload');

  const formData = new FormData();
  formData.append('audio', file);

  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) { showError(data.error); return; }
    currentJobId = data.job_id;
    setProcessingStep('transcribe');
    pollStatus();
  } catch (err) {
    showError('Upload failed: ' + err.message);
  }
}

function pollStatus() {
  pollingTimer = setInterval(async () => {
    try {
      const res = await fetch(`/status/${currentJobId}`);
      const data = await res.json();

      if (data.status === 'completed') {
        clearInterval(pollingTimer);
        showResults(data);
      } else if (data.status === 'error') {
        clearInterval(pollingTimer);
        showError(data.error || 'Transcription failed');
      }
    } catch (err) {
      console.error('Poll error:', err);
    }
  }, 3000);
}

// ── Results ─────────────────────────────────────────────────────

function showResults(data) {
  utterances = data.utterances || [];

  // Assign speaker colors
  const speakers = [...new Set(utterances.map(u => u.speaker))].sort();
  speakerColorMap = {};
  speakers.forEach((s, i) => {
    speakerColorMap[s] = SPEAKER_COLORS[i % SPEAKER_COLORS.length];
  });

  // Language badge
  const langMap = { en: 'English', af: 'Afrikaans', unknown: 'Unknown' };
  const lang = data.language || 'unknown';
  languageBadge.textContent = 'Language: ' + (langMap[lang] || lang.toUpperCase());

  // Speaker count badge
  speakerCountBadge.textContent = `${speakers.length} speaker${speakers.length !== 1 ? 's' : ''}`;

  // Legend
  speakerLegend.innerHTML = speakers.map(s =>
    `<div class="legend-item">
      <div class="legend-dot" style="background:${speakerColorMap[s]}"></div>
      Speaker ${s}
    </div>`
  ).join('');

  // Audio
  audioPlayer.src = `/audio/${currentJobId}`;
  playerFilename.textContent = data.filename || '';

  renderTranscript();
  showSection('result');

  audioPlayer.addEventListener('timeupdate', onTimeUpdate);
}

// ── Transcript rendering ─────────────────────────────────────────

function renderTranscript() {
  transcriptContainer.innerHTML = '';

  utterances.forEach((utt, idx) => {
    const color = speakerColorMap[utt.speaker] || '#6d28d9';

    const div = document.createElement('div');
    div.className = 'utterance';
    div.dataset.index = idx;
    div.dataset.start = utt.start;
    div.dataset.end = utt.end;

    div.innerHTML = `
      <div class="utt-meta">
        <span class="spk-chip" style="background:${color}">Speaker ${utt.speaker}</span>
        <span class="utt-time">${formatTime(utt.start)}</span>
      </div>
      <div class="utt-text" id="utt-text-${idx}">${buildWordSpans(utt.words, utt.text)}</div>
    `;

    div.addEventListener('click', () => {
      audioPlayer.currentTime = utt.start;
      audioPlayer.play();
    });

    transcriptContainer.appendChild(div);
  });
}

function buildWordSpans(words, fallback) {
  if (!words || words.length === 0) return escapeHtml(fallback);
  return words
    .map(w => `<span class="word" data-s="${w.start}" data-e="${w.end}">${escapeHtml(w.text)}</span> `)
    .join('');
}

// ── Sync transcript with audio ───────────────────────────────────

let lastActiveIdx = -1;

function onTimeUpdate() {
  const t = audioPlayer.currentTime;

  // Find current utterance
  let activeIdx = -1;
  for (let i = 0; i < utterances.length; i++) {
    if (t >= utterances[i].start && t < utterances[i].end) {
      activeIdx = i;
      break;
    }
  }

  if (activeIdx !== lastActiveIdx) {
    // Remove previous active
    if (lastActiveIdx >= 0) {
      const prev = transcriptContainer.querySelector(`.utterance[data-index="${lastActiveIdx}"]`);
      if (prev) prev.classList.remove('active');
    }
    lastActiveIdx = activeIdx;

    if (activeIdx >= 0) {
      const el = transcriptContainer.querySelector(`.utterance[data-index="${activeIdx}"]`);
      if (el) {
        el.classList.add('active');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  // Word-level highlight
  document.querySelectorAll('.word.highlight').forEach(w => w.classList.remove('highlight'));
  if (activeIdx >= 0) {
    const textEl = document.getElementById(`utt-text-${activeIdx}`);
    if (textEl) {
      textEl.querySelectorAll('.word').forEach(w => {
        const s = parseFloat(w.dataset.s);
        const e = parseFloat(w.dataset.e);
        if (t >= s && t < e) w.classList.add('highlight');
      });
    }
  }
}

// ── Download transcript ──────────────────────────────────────────

document.getElementById('download-btn').addEventListener('click', () => {
  if (!utterances.length) return;

  const lines = utterances.map(u =>
    `[${formatTime(u.start)}] Speaker ${u.speaker}: ${u.text}`
  );
  const blob = new Blob([lines.join('\n\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'transcript.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── New transcription ────────────────────────────────────────────

document.getElementById('new-btn').addEventListener('click', resetAll);

function resetAll() {
  clearInterval(pollingTimer);
  audioPlayer.removeEventListener('timeupdate', onTimeUpdate);
  audioPlayer.src = '';
  currentJobId = null;
  utterances = [];
  speakerColorMap = {};
  lastActiveIdx = -1;
  fileInput.value = '';
  filePreview.classList.add('hidden');
  transcriptContainer.innerHTML = '';
  speakerLegend.innerHTML = '';
  showSection('upload');
}

// ── Section switching ────────────────────────────────────────────

function showSection(name) {
  uploadSection.classList.toggle('hidden', name !== 'upload');
  processingSection.classList.toggle('hidden', name !== 'processing');
  resultSection.classList.toggle('hidden', name !== 'result');
}

function setProcessingStep(step) {
  const stepUpload     = document.getElementById('step-upload');
  const stepTranscribe = document.getElementById('step-transcribe');
  const stepDone       = document.getElementById('step-done');

  if (step === 'upload') {
    processingTitle.textContent = 'Uploading audio...';
    stepUpload.classList.add('active');
    stepTranscribe.classList.remove('active');
    stepDone.classList.remove('active');
  } else if (step === 'transcribe') {
    processingTitle.textContent = 'Transcribing...';
    stepUpload.classList.add('active');
    stepTranscribe.classList.add('active');
    stepDone.classList.remove('active');
  }
}

function showError(msg) {
  resetAll();
  showSection('upload');
  alert('Error: ' + msg);
}

// ── Helpers ──────────────────────────────────────────────────────

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
