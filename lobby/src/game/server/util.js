// ─── Small stateless helpers ──────────────────────────────────────────────────
export const rnd = (n) => Math.floor(Math.random() * n) + 1; // ลูกเต๋า d-n (1..n)

export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function makeUid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
