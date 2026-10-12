/** Shared app-wide types. Every module imports from here; keep this file dependency-free. */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export interface Pose {
  p: Vec3;
  q: Quat;
}

export type Phase = 'boot' | 'gate' | 'idle' | 'armed' | 'drawing' | 'reveal' | 'jiaobei' | 'resetting';
export type Drawer = 'list' | 'history' | 'settings' | 'odds' | 'share';
export type InputMode = 'motion' | 'pointer';
export type SensorStatus = 'unknown' | 'insecure' | 'unsupported' | 'granted' | 'denied' | 'silent' | 'not-required';
export type QualityTier = 0 | 1 | 2;
export type QualityPref = 'auto' | 'low' | 'mid' | 'high' | 'flat';
export type ShakeSource = 'motion' | 'pointer' | 'key' | 'button-hold' | 'quick' | 'reduced';
export type LevelId = 'shangshang' | 'shang' | 'zhongji' | 'xiaoji' | 'xiaxia';
export type JiaobeiOutcome = 'sheng' | 'xiao' | 'yin';
export type CameraShot = 'idle' | 'shake' | 'follow' | 'present' | 'toss' | 'jiaobei' | 'locked';

export interface Restaurant {
  id: string;
  name: string;
  /** 0–3 in steps of 0.5, default 1. */
  weight: number;
  /** YYYY-MM-DD of the day it was marked 「今日不开」, or null. Only counts when equal to today. */
  closedOn: string | null;
}

export interface DrawResult {
  /** uuid (see lib/rng `uuid`, works in insecure contexts too). */
  id: string;
  /** Local YYYY-MM-DD the draw was made. */
  date: string;
  /** Epoch ms. */
  ts: number;
  restaurantId: string;
  restaurantName: string;
  /** Index into the restaurant list (and the stick index in the tube). */
  index: number;
  /** index + 1; display with toChineseNumeral. */
  stickNo: number;
  level: LevelId;
  /** 锦少请客签 (1/50). */
  treat: boolean;
  /** Whether the decoy-stick tease plays. */
  tease: boolean;
  /** Decoy stick index when tease, otherwise null. */
  decoyIndex: number | null;
  /** Team phrase when drawn in 全组共签 mode, otherwise null. */
  team: string | null;
  /** Restaurant id → probability in percent (0–100) at draw time. */
  weightsPct: Record<string, number>;
}

/** Fortune text. Generated 100% locally: `source` is always 'local'. */
export interface FortuneCopy {
  /** Four 7-character lines. */
  poem: [string, string, string, string];
  /** 解曰, ≤ 30 characters. */
  jie: string;
  /** 宜, ≤ 8 characters. */
  yi: string;
  /** 忌, ≤ 10 characters. */
  ji: string;
  source: 'local';
}

export interface HistoryEntry {
  draw: DrawResult;
  copy: FortuneCopy;
  /** 就它了 / 圣筊 / three 笑筊. */
  confirmed: boolean;
  /** 一票否决 used on this draw. */
  vetoed: boolean;
  /** Every 掷筊 outcome for this draw, in order. */
  jiaobei: JiaobeiOutcome[];
}

/** 体感灵敏度: how much the phone's own motion moves the 签筒 / camera (never the shake meter). */
export type MotionSensitivity = 'low' | 'mid' | 'high';

export interface Settings {
  sound: boolean;
  haptics: boolean;
  /** 避开最近吃过的 (default on). */
  antiRepeat: boolean;
  /** 掷筊仪式 (default on). */
  ritualJiaobei: boolean;
  /** 低晕模式. */
  lowMotion: 'system' | 'on' | 'off';
  /** 体感灵敏度 (default 'mid'). */
  motionSensitivity: MotionSensitivity;
  quality: QualityPref;
  /** 全组共签. */
  teamMode: boolean;
  teamPhrase: string;
  /** Last known motion permission status (only used to skip the gate on Android). */
  motionStatus: SensorStatus;
}

export interface DayState {
  date: string;
  /** HistoryEntry draw id confirmed for today (就它了). */
  lockedDrawId: string | null;
  /** 一票否决 already used today. */
  vetoUsed: boolean;
  /** Team draws made today (offsets the team RNG stream). */
  teamDrawCount: number;
  /** Restaurant ids excluded for today (阴筊 / veto). */
  excluded: string[];
  /** Consecutive 笑筊 on the current draw. */
  xiaoStreak: number;
}

export interface Toast {
  id: number;
  text: string;
  /** Epoch ms (Date.now() base) after which the toast is hidden. */
  until: number;
}
