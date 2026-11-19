import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { timeAgo } from '../lib/format';
import type { NewsItem } from '../lib/types';
import { DemoBadge, itemV, listV, Skeleton, Thumb } from './ui';

const catClass = (c: string) =>
  /Climate|Science|Sports/.test(c) ? 'cat-green' : /Politics|Health/.test(c) ? 'cat-amber' : 'cat-info';

/** Same three columns for every row: rank 24px · image 70px · content. */
const ROW = 'grid grid-cols-[24px_70px_minmax(0,1fr)] items-start gap-x-2 py-4';

interface Props { news: NewsItem[] | null; demo: boolean; onRefresh: () => void }

export default function NewsPanel({ news, demo, onRefresh }: Props) {
  return (
    <div className="panel flex min-h-0 w-full flex-col p-6">
      {/* Header: title · Demo badge · refresh, all on one centred row */}
      <div className="flex shrink-0 items-center justify-between gap-2.5">
        <h3 className="min-w-0 flex-1 truncate font-display text-lg leading-8 tracking-tight">Top 5 World News</h3>
        {demo && news && <DemoBadge />}
        <motion.button
          whileTap={{ rotate: 180 }}
          transition={{ duration: 0.25 }}
          onClick={onRefresh}
          title="Refresh news"
          aria-label="Refresh news"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-line/[0.06] hover:text-fg"
        >
          <RefreshCw className="h-4 w-4" />
        </motion.button>
      </div>

      {/* Scrolls internally only if the viewport is too short */}
      <div className="mt-2 min-h-0 overflow-y-auto">
        {!news ? (
          <div className="divide-y divide-line/[0.06]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={ROW}>
                <Skeleton className="mt-1 h-4 w-4" />
                <Skeleton className="h-14 w-[70px]" />
                <div className="space-y-2 pt-1"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div>
              </div>
            ))}
          </div>
        ) : (
          <motion.ol variants={listV} initial="hidden" animate="show" className="divide-y divide-line/[0.06]">
            {news.slice(0, 5).map((n, i) => (
              <motion.li key={n.url + i} variants={itemV}>
                <a href={n.url} target="_blank" rel="noopener noreferrer" className={`group ${ROW}`}>
                  <span className="pt-0.5 text-center font-display text-lg leading-6 text-faint">{i + 1}</span>
                  <Thumb src={n.image} className="h-14 w-[70px]" />
                  <div className="min-w-0">
                    <p className="line-clamp-3 text-[13px] font-medium leading-5 text-fg group-hover:underline group-hover:decoration-line/20 group-hover:underline-offset-2">{n.title}</p>
                    {/* Metadata row: source · time · category on one line. Only the source name
                        shrinks (ellipsis), so nothing overlaps or wraps. */}
                    <div className="meta-row mt-2 flex items-center gap-2 text-[11px] leading-4 text-faint">
                      <span className="min-w-0 truncate" title={n.source}>{n.source}</span>
                      <span className="shrink-0" aria-hidden="true">·</span>
                      <span className="shrink-0 whitespace-nowrap">{timeAgo(n.publishedAt)}</span>
                      <span className={`cat ml-auto ${catClass(n.category)}`}>{n.category}</span>
                    </div>
                  </div>
                </a>
              </motion.li>
            ))}
          </motion.ol>
        )}
      </div>
    </div>
  );
}
