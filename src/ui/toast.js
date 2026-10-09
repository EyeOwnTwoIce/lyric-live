/** Avisos flotantes. En iOS evitamos alert() porque en modo PWA se comporta mal. */
const container = () => document.getElementById('toasts');

export function toast(text, kind = 'info', durationMs = 4200) {
  const host = container();
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  el.textContent = text;
  host.appendChild(el);

  const remove = () => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s ease';
    setTimeout(() => el.remove(), 260);
  };
  const timer = setTimeout(remove, durationMs);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
  return remove;
}

export function clearToasts() {
  const host = container();
  if (host) host.textContent = '';
}
