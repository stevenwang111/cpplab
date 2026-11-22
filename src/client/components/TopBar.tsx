import { useEffect, useRef, useState } from 'react';
import {
  Bug,
  ChevronDown,
  CircleHelp,
  Cloud,
  CloudUpload,
  Code2,
  History,
  KeyRound,
  Loader2,
  LogOut,
  Play,
  Settings2,
  Square,
  Wand2,
} from 'lucide-react';
import type { DebugState } from '../debug/dapClient';
import type { AuthUser, RunPhase } from '../../shared/types';
import { t, useLocale } from '../i18n';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

interface TopBarProps {
  user: AuthUser;
  projectName: string;
  saveState: SaveState;
  runPhase: RunPhase | null;
  debugState: DebugState;
  canRun: boolean;
  canDebug: boolean;
  onRun: () => void;
  onDebug: () => void;
  onStopDebug: () => void;
  onFormat: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
}

function SaveIndicator({ state }: { state: SaveState }): JSX.Element {
  useLocale();
  if (state === 'saving') {
    return (
      <span className="save-indicator saving">
        <Loader2 size={13} className="spin" /> {t('chrome.topbar.save.saving')}
      </span>
    );
  }
  if (state === 'dirty') {
    return (
      <span className="save-indicator dirty">
        <CloudUpload size={13} /> {t('chrome.topbar.save.unsaved')}
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="save-indicator error">
        <Cloud size={13} /> {t('chrome.topbar.save.failed')}
      </span>
    );
  }
  return (
    <span className="save-indicator">
      <Cloud size={13} /> {t('chrome.topbar.save.saved')}
    </span>
  );
}

export function TopBar(props: TopBarProps): JSX.Element {
  useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const runBusy = props.runPhase === 'queued' || props.runPhase === 'compiling' || props.runPhase === 'running';
  const debugActive =
    props.debugState === 'starting' || props.debugState === 'running' || props.debugState === 'paused';
  const initials = props.user.displayName.slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand" title={t('chrome.topbar.brand')}>
          <span className="brand-mark">
            <Code2 size={18} strokeWidth={2.2} />
          </span>
          <span className="brand-text">
            Cpp<span>Lab</span>
          </span>
        </div>
        <div className="topbar-divider" />
        <div className="project-title">
          <span className="project-name">{props.projectName}</span>
          <SaveIndicator state={props.saveState} />
        </div>
      </div>

      <div className="topbar-center">
        <button
          type="button"
          className={`btn btn-run ${runBusy ? 'is-busy' : ''}`}
          onClick={props.onRun}
          disabled={!props.canRun || runBusy}
          title={t('chrome.topbar.run.title')}
        >
          {runBusy ? <Loader2 size={15} className="spin" /> : <Play size={15} fill="currentColor" />}
          {runBusy
            ? props.runPhase === 'compiling'
              ? t('chrome.topbar.run.compiling')
              : t('chrome.topbar.run.running')
            : t('chrome.topbar.run.idle')}
        </button>
        <button
          type="button"
          className={`btn btn-debug ${debugActive ? 'is-active' : ''}`}
          onClick={debugActive ? props.onStopDebug : props.onDebug}
          disabled={debugActive ? false : !props.canDebug}
          title={debugActive ? t('chrome.topbar.debug.stopTitle') : t('chrome.topbar.debug.startTitle')}
        >
          {debugActive ? <Square size={14} fill="currentColor" /> : <Bug size={15} />}
          {debugActive ? t('chrome.topbar.debug.stop') : t('chrome.topbar.debug.start')}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={props.onFormat}
          disabled={runBusy}
          title={t('chrome.topbar.format.title')}
        >
          <Wand2 size={15} />
          <span className="btn-label">{t('chrome.topbar.format.label')}</span>
        </button>
      </div>

      <div className="topbar-right">
        <button type="button" className="icon-btn" onClick={props.onOpenHistory} title={t('chrome.topbar.history')}>
          <History size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={props.onOpenSettings} title={t('chrome.topbar.settings')}>
          <Settings2 size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={props.onOpenHelp} title={t('chrome.topbar.help')}>
          <CircleHelp size={18} />
        </button>
        <span className="topbar-divider" />
        <div className="user-menu-anchor" ref={menuRef}>
          <button
            type="button"
            className="user-button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
            title={t('auth.user.signedInAs', { name: props.user.displayName })}
          >
            <span className="avatar">{initials}</span>
            <span className="user-button-name">{props.user.displayName}</span>
            <ChevronDown size={13} />
          </button>
          {menuOpen && (
            <div className="user-menu" role="menu" aria-label={t('auth.user.menu')}>
              <div className="user-menu-head">
                <strong>{props.user.displayName}</strong>
                <span>
                  @{props.user.username} · {props.user.role}
                </span>
              </div>
              <button
                type="button"
                role="menuitem"
                className="user-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  props.onChangePassword();
                }}
              >
                <KeyRound size={14} /> {t('auth.user.changePassword')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="user-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  props.onLogout();
                }}
              >
                <LogOut size={14} /> {t('auth.user.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
