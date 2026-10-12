/** 设置: quality, 低晕模式, sound/haptics, anti-repeat, 掷筊, 全组共签, 体感, 天机可泄露. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MotionSensitivity, QualityPref, Settings } from '@/types';
import { COPY, motionStatusLabel } from '@/data/copy';
import { listSignature } from '@/data/restaurants';
import { isTeamActive } from '@/draw/pick';
import { teamLink } from '@/lib/share';
import { useStore } from '@/state/store';
import { canRetryPermission, recalibrateTilt, retryMotionPermission } from '@/sensors/motion';
import { Drawer, Segmented, SwitchRow } from '@/ui/Drawer';
import { copyToClipboard } from '@/ui/hooks';
import { IconLink, IconOdds } from '@/ui/Icons';
import { takeSettingsSection } from '@/ui/intent';

const QUALITY: readonly { value: QualityPref; label: string }[] = (['auto', 'low', 'mid', 'high', 'flat'] as const).map((v) => ({
  value: v,
  label: COPY.settings.qualityOptions[v],
}));

const SENSITIVITY: readonly { value: MotionSensitivity; label: string }[] = (['low', 'mid', 'high'] as const).map((v) => ({
  value: v,
  label: COPY.settings.motionSensitivityOptions[v],
}));

const LOW_MOTION: readonly { value: Settings['lowMotion']; label: string }[] = (['system', 'on', 'off'] as const).map((v) => ({
  value: v,
  label: COPY.settings.lowMotionOptions[v],
}));

export function SettingsDrawer() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const restaurants = useStore((s) => s.restaurants);
  const gate = useStore((s) => s.gate);
  const openDrawer = useStore((s) => s.openDrawer);
  const showToast = useStore((s) => s.showToast);
  const [phrase, setPhrase] = useState(settings.teamPhrase);
  const teamRef = useRef<HTMLElement>(null);
  const phraseRef = useRef<HTMLInputElement>(null);
  const sig = useMemo(() => listSignature(restaurants), [restaurants]);
  const canRetry = useMemo(() => canRetryPermission(), []);
  const teamActive = isTeamActive(settings);
  const status = settings.motionStatus !== 'unknown' ? settings.motionStatus : gate.status;

  useEffect(() => {
    if (takeSettingsSection() === 'team') {
      requestAnimationFrame(() => {
        teamRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        phraseRef.current?.focus({ preventScroll: true });
      });
    }
  }, []);

  useEffect(() => setPhrase(settings.teamPhrase), [settings.teamPhrase]);

  const commitPhrase = (): void => {
    const p = phrase.trim().slice(0, 40);
    if (p !== settings.teamPhrase) update({ teamPhrase: p });
  };

  const setTeam = (on: boolean): void => {
    commitPhrase();
    update({ teamMode: on });
    showToast(on ? COPY.toast.teamOn : COPY.toast.teamOff);
    if (on && !phrase.trim()) phraseRef.current?.focus();
  };

  const copyLink = async (): Promise<void> => {
    commitPhrase();
    const p = phrase.trim();
    if (!p) {
      phraseRef.current?.focus();
      return;
    }
    const ok = await copyToClipboard(teamLink(p));
    showToast(ok ? COPY.toast.linkCopied : COPY.toast.copyFailed);
  };

  const reauthorize = (): void => {
    // Synchronous inside the click so iOS shows the permission sheet.
    void retryMotionPermission().catch((err: unknown) => console.error('[settings] motion re-auth failed', err));
  };

  return (
    <Drawer id="settings" title={COPY.settings.title}>
      <h3 className="section-title !mt-1">{COPY.settings.quality}</h3>
      <Segmented label={COPY.settings.quality} value={settings.quality} options={QUALITY} onChange={(v) => update({ quality: v })} />

      <h3 className="section-title">{COPY.settings.lowMotion}</h3>
      <Segmented
        label={COPY.settings.lowMotion}
        value={settings.lowMotion}
        options={LOW_MOTION}
        onChange={(v) => update({ lowMotion: v })}
      />

      <div className="row-card mt-5 divide-y divide-gold/10 px-4">
        <SwitchRow label={COPY.settings.sound} checked={settings.sound} onChange={(v) => update({ sound: v })} />
        <SwitchRow label={COPY.settings.haptics} checked={settings.haptics} onChange={(v) => update({ haptics: v })} />
        <SwitchRow
          label={COPY.settings.antiRepeat}
          hint={COPY.history.antiRepeatHint}
          checked={settings.antiRepeat}
          onChange={(v) => update({ antiRepeat: v })}
        />
        <SwitchRow label={COPY.settings.jiaobei} checked={settings.ritualJiaobei} onChange={(v) => update({ ritualJiaobei: v })} />
      </div>

      <section ref={teamRef} aria-labelledby="team-title" className="scroll-mt-4">
        <h3 id="team-title" className="section-title">
          {COPY.settings.team}
        </h3>
        <div className="row-card px-4 pb-4">
          <SwitchRow label={COPY.settings.team} hint={COPY.settings.teamHint} checked={settings.teamMode} onChange={setTeam} />
          <label htmlFor="team-phrase" className="mb-1.5 mt-1 block text-[13px] text-paper/70">
            {COPY.settings.teamPhrase}
          </label>
          <input
            id="team-phrase"
            ref={phraseRef}
            className="field"
            value={phrase}
            maxLength={40}
            placeholder={COPY.settings.teamPhrasePlaceholder}
            autoComplete="off"
            enterKeyHint="done"
            onChange={(e) => setPhrase(e.target.value)}
            onBlur={commitPhrase}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitPhrase();
              }
            }}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[12px] tracking-wider text-paper/60">
              {COPY.settings.teamFingerprint(sig)}
              {teamActive ? ' · 已生效' : ''}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyLink()} disabled={!phrase.trim()}>
              <IconLink size={16} />
              {COPY.settings.teamCopy}
            </button>
          </div>
        </div>
      </section>

      <h3 className="section-title">{COPY.settings.motion}</h3>
      <div className="row-card flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[15px]">{motionStatusLabel(status)}</div>
          <div className="mt-0.5 text-[12px] text-paper/55">
            {gate.inputMode === 'motion' ? '摇手机即可求签' : '拖动签筒或长按按钮求签'}
          </div>
        </div>
        {canRetry && status !== 'granted' ? (
          <button type="button" className="btn btn-cinnabar btn-sm" onClick={reauthorize}>
            {COPY.settings.motionRetry}
          </button>
        ) : null}
        {gate.inputMode === 'motion' ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (recalibrateTilt()) showToast(COPY.toast.recalibrated);
            }}
          >
            {COPY.settings.motionRecalibrate}
          </button>
        ) : null}
      </div>
      {gate.inputMode === 'motion' ? (
        <div className="mt-3">
          <Segmented
            label={COPY.settings.motionSensitivity}
            value={settings.motionSensitivity}
            options={SENSITIVITY}
            onChange={(v) => update({ motionSensitivity: v })}
          />
          <p className="mt-1.5 text-[12px] text-paper/55">{COPY.settings.motionSensitivityHint}</p>
        </div>
      ) : null}

      <button type="button" className="btn btn-gold mt-6 w-full" onClick={() => openDrawer('odds')} aria-haspopup="dialog">
        <IconOdds size={18} />
        {COPY.settings.odds}
      </button>

      <p className="mt-6 text-center text-[11px] tracking-wider text-paper/35">
        {COPY.app.temple} · {COPY.app.credit} · {__BUILD_ID__}
      </p>
    </Drawer>
  );
}
