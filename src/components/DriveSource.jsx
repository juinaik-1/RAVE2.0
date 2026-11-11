import { useCallback, useState } from 'react';
import { AlertCircle, CheckCircle2, Cloud, FileVideo, RefreshCw } from 'lucide-react';
import { useDrivePicker } from '../hooks/useDrivePicker';
import { Badge, Button } from './ui';

export default function DriveSource({ onLoadStream, onSelectSource, onConvert, autoLoad = true }) {
  const [selected, setSelected] = useState(null);
  const handlePicked = useCallback((result) => {
    setSelected(result);
    onSelectSource?.(result);
    if (result.playable && autoLoad) onLoadStream?.(result);
  }, [autoLoad, onLoadStream, onSelectSource]);
  const { openPicker, connectDrive, busy, error, status, clearError } = useDrivePicker(handlePicked);

  return (
    <section className="rounded-lg border border-zinc-200/80 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Cloud className="h-4 w-4 shrink-0 text-zinc-500" />
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Google Drive</h2>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={connectDrive} disabled={busy}>
            Connect Drive
          </Button>
          <Button size="sm" onClick={openPicker} disabled={busy}>
            {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FileVideo className="h-3.5 w-3.5" />}
            Pick a video
          </Button>
        </div>
      </div>
      {status ? <p role="status" className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{status}</p> : null}
      {selected ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-200/80 pt-3 text-xs dark:border-zinc-800">
          {selected.playable ? (
            <Badge tone="success" dot><CheckCircle2 className="h-3 w-3" /> Streams directly — no conversion</Badge>
          ) : (
            <Badge tone="warning" dot><AlertCircle className="h-3 w-3" /> Conversion needed</Badge>
          )}
          <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">{selected.name}</span>
          {!selected.playable && onConvert ? (
            <Button size="sm" variant="secondary" onClick={() => onConvert(selected)}>
              Convert
            </Button>
          ) : null}
          {selected.reason ? <p className="basis-full text-zinc-500">{selected.reason}</p> : null}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="mt-3 flex items-start justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs leading-5 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss error" onClick={clearError} className="shrink-0">×</button>
        </div>
      ) : null}
    </section>
  );
}
