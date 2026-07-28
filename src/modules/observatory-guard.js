const STORAGE_KEY = 'tls:observatory-expansion:v1';

const sanitizeText = (value) => String(value ?? '').replace(/[<>]/g, '');

try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed?.vault && typeof parsed.vault.notes === 'string') {
      const safe = sanitizeText(parsed.vault.notes);
      if (safe !== parsed.vault.notes) {
        parsed.vault.notes = safe;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      }
    }
  }
} catch {
  // Corrupt or inaccessible local state is ignored by the main expansion loader.
}

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement) || target.id !== 'vault-notes') return;
  const safe = sanitizeText(target.value);
  if (safe !== target.value) target.value = safe;
}, true);
