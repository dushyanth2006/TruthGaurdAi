export const makeTitle = (text: string) => {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  return words.slice(0, 7).join(' ') + (words.length > 7 ? '…' : '');
};

export function timeAgo(iso: string | number) {
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const isToday = (ts: number) => new Date(ts).toDateString() === new Date().toDateString();

export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
