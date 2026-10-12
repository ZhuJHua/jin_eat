/** 名单 editor: add, rename, remove, reorder, weight 0–3, 今日不开, 恢复默认. */
import { useRef, useState } from 'react';
import type { Restaurant } from '@/types';
import { CFG } from '@/config';
import { COPY } from '@/data/copy';
import { taglineFor } from '@/data/restaurants';
import { announce } from '@/lib/announce';
import { toChineseNumeral, todayKey } from '@/lib/date';
import { useStore } from '@/state/store';
import { Drawer } from '@/ui/Drawer';
import { IconCheck, IconClose, IconDown, IconEdit, IconPlus, IconTrash, IconUp } from '@/ui/Icons';

function errorText(reason: string | undefined): string {
  return (reason && COPY.list.errors[reason]) || COPY.list.errors.empty!;
}

export function ListDrawer() {
  const restaurants = useStore((s) => s.restaurants);
  const addRestaurant = useStore((s) => s.addRestaurant);
  const resetRestaurants = useStore((s) => s.resetRestaurants);
  const showToast = useStore((s) => s.showToast);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const full = restaurants.length >= CFG.limits.maxRestaurants;

  const onAdd = (e: React.FormEvent): void => {
    e.preventDefault();
    const res = addRestaurant(name);
    if (res.ok) {
      announce(`已添加：${name.trim()}`);
      setName('');
      setError(null);
    } else {
      setError(errorText(res.reason));
    }
    inputRef.current?.focus();
  };

  return (
    <Drawer id="list" title={COPY.list.title} subtitle={COPY.list.subtitle(restaurants.length)}>
      <form onSubmit={onAdd} className="flex gap-2" noValidate>
        <label className="sr-only" htmlFor="add-restaurant">
          {COPY.list.placeholder}
        </label>
        <input
          id="add-restaurant"
          ref={inputRef}
          className="field"
          value={name}
          maxLength={24}
          placeholder={full ? COPY.list.errors.max : COPY.list.placeholder}
          disabled={full}
          enterKeyHint="done"
          autoComplete="off"
          aria-invalid={!!error}
          aria-describedby="add-restaurant-err"
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
        />
        <button type="submit" className="btn btn-gold flex-none" disabled={full || !name.trim()}>
          <IconPlus size={18} />
          {COPY.list.add}
        </button>
      </form>
      <p id="add-restaurant-err" role="alert" className="mt-1.5 min-h-[18px] text-[13px] text-[#ff9a8a]">
        {error ?? ''}
      </p>

      <ol className="mt-2 flex flex-col gap-2.5">
        {restaurants.map((r, i) => (
          <Row key={r.id} r={r} index={i} count={restaurants.length} />
        ))}
      </ol>

      <div className="mt-6">
        {confirmReset ? (
          <div className="row-card flex flex-col gap-3 p-4" role="group" aria-label={COPY.list.reset}>
            <p className="text-[14px] text-paper/85">{COPY.list.resetConfirm}</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-cinnabar flex-1"
                onClick={() => {
                  resetRestaurants();
                  setConfirmReset(false);
                  showToast(COPY.toast.listReset);
                }}
              >
                {COPY.list.reset}
              </button>
              <button type="button" className="btn btn-ghost flex-1" onClick={() => setConfirmReset(false)} autoFocus>
                {COPY.actions.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost w-full" onClick={() => setConfirmReset(true)}>
            {COPY.list.reset}
          </button>
        )}
      </div>
    </Drawer>
  );
}

function Row({ r, index, count }: { r: Restaurant; index: number; count: number }) {
  const rename = useStore((s) => s.renameRestaurant);
  const remove = useStore((s) => s.removeRestaurant);
  const move = useStore((s) => s.moveRestaurant);
  const setWeight = useStore((s) => s.setRestaurantWeight);
  const toggleClosed = useStore((s) => s.toggleClosedToday);
  const showToast = useStore((s) => s.showToast);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(r.name);
  const [err, setErr] = useState<string | null>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const closed = r.closedOn === todayKey();
  const atMin = count <= CFG.limits.minRestaurants;
  const fill = `${(r.weight / 3) * 100}%`;

  const commit = (): void => {
    const res = rename(r.id, draft);
    if (res.ok) {
      setEditing(false);
      setErr(null);
      requestAnimationFrame(() => editBtn.current?.focus());
    } else {
      setErr(errorText(res.reason));
    }
  };
  const cancel = (): void => {
    setEditing(false);
    setDraft(r.name);
    setErr(null);
    requestAnimationFrame(() => editBtn.current?.focus());
  };

  return (
    <li className={`row-card p-3 transition-opacity ${closed || r.weight === 0 ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-2">
        <span
          className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-cinnabar/80 font-brush text-[15px] text-gold-soft shadow-inner"
          aria-hidden="true"
        >
          {toChineseNumeral(index + 1)}
        </span>
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              commit();
            }}
          >
            <label className="sr-only" htmlFor={`rename-${r.id}`}>
              {COPY.list.rename}
            </label>
            <input
              id={`rename-${r.id}`}
              className="field !min-h-10"
              value={draft}
              autoFocus
              maxLength={24}
              aria-invalid={!!err}
              onChange={(e) => {
                setDraft(e.target.value);
                setErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  e.preventDefault();
                  cancel();
                }
              }}
            />
            <button type="submit" className="icon-btn flex-none" aria-label="保存">
              <IconCheck size={18} />
            </button>
            <button type="button" className="icon-btn flex-none" aria-label={COPY.actions.cancel} onClick={cancel}>
              <IconClose size={18} />
            </button>
          </form>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="truncate font-brush text-[21px] leading-tight text-gold-soft">{r.name}</div>
            <div className="truncate text-[12px] tracking-wide text-paper/55">{taglineFor(r)}</div>
          </div>
        )}
        {!editing ? (
          <div className="flex flex-none items-center">
            <button
              type="button"
              className="icon-btn !h-10 !w-10"
              aria-label={`${COPY.list.moveUp}：${r.name}`}
              disabled={index === 0}
              onClick={() => move(r.id, -1)}
            >
              <IconUp size={18} />
            </button>
            <button
              type="button"
              className="icon-btn !h-10 !w-10"
              aria-label={`${COPY.list.moveDown}：${r.name}`}
              disabled={index === count - 1}
              onClick={() => move(r.id, 1)}
            >
              <IconDown size={18} />
            </button>
            <button
              ref={editBtn}
              type="button"
              className="icon-btn !h-10 !w-10"
              aria-label={`${COPY.list.rename}：${r.name}`}
              onClick={() => {
                setDraft(r.name);
                setEditing(true);
              }}
            >
              <IconEdit size={18} />
            </button>
            <button
              type="button"
              className="icon-btn !h-10 !w-10 !text-[#ff8f86]"
              aria-label={`${COPY.list.remove}：${r.name}`}
              aria-disabled={atMin}
              onClick={() => {
                const res = remove(r.id);
                if (!res.ok) showToast(COPY.toast.noMinRemove);
                else announce(`已删除：${r.name}`);
              }}
            >
              <IconTrash size={18} />
            </button>
          </div>
        ) : null}
      </div>
      {err ? (
        <p role="alert" className="mt-1 pl-11 text-[13px] text-[#ff9a8a]">
          {err}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-3 pl-11">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-paper/70">
          <span className="flex-none">{COPY.list.weight}</span>
          <input
            type="range"
            className="range"
            min={0}
            max={3}
            step={0.5}
            value={r.weight}
            style={{ '--fill': fill } as React.CSSProperties}
            aria-valuetext={COPY.list.weightValue(r.weight)}
            aria-label={`${COPY.list.weight}：${r.name}`}
            onChange={(e) => setWeight(r.id, Number(e.target.value))}
          />
          <span className="w-12 flex-none text-right tabular-nums text-gold-soft" aria-hidden="true">
            {COPY.list.weightValue(r.weight)}
          </span>
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={closed}
          aria-label={`${COPY.list.closedToday}：${r.name}`}
          onClick={() => toggleClosed(r.id)}
          className={`chip !px-2.5 !py-1 flex-none border text-[12px] transition-colors ${
            closed ? 'border-[#ff8f86]/60 bg-cinnabar/40 text-paper' : 'border-gold/25 text-paper/65 hover:border-gold/50'
          }`}
        >
          {COPY.list.closedToday}
        </button>
      </div>
    </li>
  );
}
