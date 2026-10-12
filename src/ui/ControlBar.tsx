/** Secondary actions: 名单 · 签簿 · 共签 · 设置 · 音效. */
import type { ReactNode } from 'react';
import { COPY } from '@/data/copy';
import { isTeamActive } from '@/draw/pick';
import { useStore } from '@/state/store';
import { setSettingsSection } from '@/ui/intent';
import { IconHistory, IconList, IconSettings, IconSound, IconTeam } from '@/ui/Icons';

function Ctrl(props: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
  on?: boolean;
  ariaLabel?: string;
  shortcut?: string;
}) {
  const { label, onClick, children, pressed, on, ariaLabel, shortcut } = props;
  return (
    <button
      type="button"
      className="ctrl-btn"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      aria-keyshortcuts={shortcut}
      data-on={on}
      aria-haspopup={pressed === undefined ? 'dialog' : undefined}
    >
      {children}
      <span aria-hidden={ariaLabel ? true : undefined}>{label}</span>
    </button>
  );
}

export function ControlBar(props: { className?: string }) {
  const openDrawer = useStore((s) => s.openDrawer);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const team = isTeamActive(settings);

  return (
    <nav aria-label="功能" className={`lacquer-soft flex items-center gap-0.5 rounded-[20px] px-1.5 py-1 ${props.className ?? ''}`}>
      <Ctrl label={COPY.control.list} onClick={() => openDrawer('list')} shortcut="E">
        <IconList />
      </Ctrl>
      <Ctrl label={COPY.control.history} onClick={() => openDrawer('history')} shortcut="H">
        <IconHistory />
      </Ctrl>
      <Ctrl
        label={COPY.control.team}
        on={team}
        onClick={() => {
          setSettingsSection('team');
          openDrawer('settings');
        }}
        ariaLabel={team ? `${COPY.control.team}（已开启：${settings.teamPhrase}）` : COPY.control.team}
      >
        <IconTeam />
      </Ctrl>
      <Ctrl label={COPY.control.settings} onClick={() => openDrawer('settings')} shortcut="Q">
        <IconSettings />
      </Ctrl>
      <Ctrl label={COPY.control.sound} pressed={settings.sound} shortcut="M" onClick={() => updateSettings({ sound: !settings.sound })}>
        <IconSound on={settings.sound} />
      </Ctrl>
    </nav>
  );
}
