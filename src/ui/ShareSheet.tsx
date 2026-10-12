/** 分享签文: live card preview, Web Share / save image, and copy text. */
import { useEffect, useState } from 'react';
import { COPY } from '@/data/copy';
import { downloadCard, renderShareCard, shareDraw, shareTextFor, siteUrl, teamLink } from '@/lib/share';
import { useStore } from '@/state/store';
import { Drawer } from '@/ui/Drawer';
import { copyToClipboard } from '@/ui/hooks';
import { IconCopy, IconDownload, IconShare } from '@/ui/Icons';

export function ShareSheet() {
  const draw = useStore((s) => s.current);
  const copy = useStore((s) => s.copy);
  const showToast = useStore((s) => s.showToast);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!draw || !copy) return;
    let alive = true;
    let objectUrl: string | null = null;
    setFailed(false);
    renderShareCard({ draw, copy, url: draw.team ? teamLink(draw.team) : siteUrl() })
      .then((b) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(b);
        setBlob(b);
        setUrl(objectUrl);
      })
      .catch((err: unknown) => {
        console.error('[share] card render failed', err);
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [draw, copy]);

  if (!draw || !copy) {
    return (
      <Drawer id="share" title={COPY.share.title}>
        <p className="mt-6 text-center text-paper/70">{COPY.history.empty}</p>
      </Drawer>
    );
  }

  const text = shareTextFor(draw, copy);
  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const onShare = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await shareDraw({ draw, copy, blob: blob ?? undefined });
      if (res === 'downloaded') showToast(COPY.toast.shareDownloaded);
    } catch (err) {
      console.error('[share] failed', err);
      showToast(COPY.toast.shareFailed);
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async (): Promise<void> => {
    const ok = await copyToClipboard(text);
    setCopied(ok);
    showToast(ok ? COPY.actions.copied : COPY.toast.copyFailed);
    if (ok) window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Drawer id="share" title={COPY.share.title} subtitle={`${draw.restaurantName} · ${COPY.share.card}`}>
      <figure className="mx-auto w-full max-w-[300px]">
        <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-gold/40 bg-lacquer shadow-[0_18px_40px_rgb(0_0_0/0.5)]">
          {url ? (
            <img src={url} alt={text} className="h-full w-full object-cover" style={{ animation: 'fade 0.4s ease-out both' }} />
          ) : (
            <div
              className="h-full w-full"
              aria-label={failed ? COPY.toast.shareFailed : '签文图生成中'}
              role="img"
              style={{
                background: 'linear-gradient(100deg, #5a0d14 30%, #8a1a20 50%, #5a0d14 70%)',
                backgroundSize: '200% 100%',
                animation: failed ? undefined : 'shimmer 1.6s linear infinite',
              }}
            />
          )}
        </div>
        <figcaption className="mt-3 rounded-xl bg-black/25 p-3 text-[13px] leading-relaxed text-paper/80">{text}</figcaption>
      </figure>
      <div className="mt-4 flex flex-col gap-2.5">
        <button type="button" className="btn btn-gold h-12" onClick={() => void onShare()} disabled={busy || (!blob && !failed)}>
          {canShareFiles ? <IconShare size={18} /> : <IconDownload size={18} />}
          {canShareFiles ? COPY.actions.share : '保存签文图'}
        </button>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" className="btn btn-ghost" onClick={() => void onCopy()}>
            <IconCopy size={18} />
            {copied ? COPY.actions.copied : COPY.actions.copyText}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => blob && downloadCard(draw, blob)} disabled={!blob}>
            <IconDownload size={18} />
            保存图片
          </button>
        </div>
      </div>
    </Drawer>
  );
}
