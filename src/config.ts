/** Single source of tunables. */
export const CFG = {
  sensors: {
    gravityAlpha: 0.8,
    deadzone: 3.5,
    fillDivisor: 10,
    decayPerSec: 0.25,
    clackPeak: 11,
    clackRefractoryMs: 70,
    stillMag: 4,
    stillMagPointer: 2,
    stillMs: 250,
    forceDrawAfterFullMs: 2500,
    armSustainMs: 150,
    abandonMs: 4000,
    noEventTimeoutMs: 1000,
    signCalibMs: 300,
    tiltAlpha: 0.15,
    tiltClampDeg: 35,
    /**
     * 体感手感 (visual feel) — conditions what the phone signals do to the 签筒 / camera / lanterns.
     * Meter, arming, clacks and the 前倾 boost read the raw |lin| / `forward` and are NOT affected.
     *
     *  - Intent gate (motion.ts): `rt.input.motion.lin` = screen-frame lin × gate gain 0..1 × driveGain.
     *    env = √LP(|lin|², envTau); adaptive noise floor (fast down, slow up, frozen while open);
     *    open when env > on = clamp(onMin + floorK·floor, onMin, onMax); close when env < offRatio·on
     *    for holdMs; gain = smoothstep over [off, on + kneeSpan], attack/release smoothed.
     *  - Tilt (orientation.ts): `rt.input.motion.tilt` = tiltGain · radialSoftDeadzone(lean − neutral),
     *    neutral = first-order LP of the lean (τ tiltRecenterSec ⇒ held postures fade out, no overshoot),
     *    soft deadzone r − D·tanh(r/D) (≈ r³/3D² below D).
     *  - Presets are picked by Settings.motionSensitivity (体感灵敏度 低/中/高), read live per event.
     */
    feel: {
      envTau: 0.07,
      floorInit: 0.6,
      floorFallTau: 0.5,
      floorRiseTau: 2,
      floorK: 0.6,
      offRatio: 0.6,
      holdMs: 250,
      attackTau: 0.05,
      releaseTau: 0.25,
      presets: {
        low: { onMin: 4, onMax: 6, kneeSpan: 1.2, driveGain: 0.85, tiltRecenterSec: 0.6, tiltDeadzoneDeg: 5, tiltGain: 0.6 },
        mid: { onMin: 3, onMax: 5, kneeSpan: 0.8, driveGain: 1, tiltRecenterSec: 0.8, tiltDeadzoneDeg: 3.5, tiltGain: 1 },
        high: { onMin: 2.4, onMax: 4.2, kneeSpan: 0.6, driveGain: 1.15, tiltRecenterSec: 1.2, tiltDeadzoneDeg: 2.5, tiltGain: 1 },
      },
    },
    forwardRange: [15, 50],
    tiltBoost: 1.3,
    pointerAccelScale: 0.25,
    holdFillSec: 1.4,
    quickDrawSec: 1.2,
  },
  tube: {
    k: 180,
    c: 22,
    maxOffset: [0.18, 0.1, 0.06],
    maxTiltDeg: 25,
    deviceTiltDeg: 15,
    /** Safety clamps on the kinematic physics tube (the driver's own limits keep it well below). */
    maxVel: 8,
    maxAngVel: 8,
    /** Max rate of the tube's lean (rad/s), applied in TubeDriver: keeps the walls from sweeping
     * through the thin sticks faster than the simulation can resolve. */
    maxTiltRate: 5,
    /** Height (tube-local) the lean pivots about under the hard inputs (pointer grab, phone shake):
     * a hand holding the 签筒. Hard rocking about the base pumps the sticks up and out of the tube
     * (the walls slam their upper halves while the floor kicks them). */
    leanPivotY: 0.4,
    motionGain: 0.02,
    autoAmp: 0.05,
    /** Tube geometry facts shared with the draw timeline (three/tube/tubeGeometry TUBE_DIMS must agree). */
    rimY: 0.85,
    innerR: 0.27,
    floorY: 0.06,
    /** Physics wall: apothem of the N-gon of wall slabs. Kept inside the painted inner wall's
     * narrowest point (r 0.2604 at the waist) so sticks resting on it never sink into the paint. */
    physInnerR: 0.255,
    physWalls: 24,
  },
  stick: {
    size: [0.045, 1.05, 0.012],
    colliderHalf: [0.03, 0.525, 0.012],
    density: 400,
    linDamp: 0.4,
    angDamp: 0.6,
    friction: 0.6,
    restitution: 0.15,
    forceThreshold: 2,
  },
  timeline: {
    tilt: 0.4,
    tiltDeg: 30,
    tease: 0.6,
    teaseFrac: 0.35,
    creep: 0.6,
    creepDist: 0.35,
    hold: 0.35,
    pop: 0.15,
    arc: 1.0,
    apexTimeScale: 0.3,
    arcFlips: 1.5,
    handoffHeight: 0.15,
    landMax: 1.5,
    present: 0.9,
    presentLift: 0.25,
    reset: 0.7,
    caPulse: 0.6,
    reduced: { tilt: 0.3, tiltDeg: 12, slide: 0.5, present: 0.5 },
  },
  poses: {
    landing: { p: [0.12, 0.012, 0.62], yawDeg: -12 },
    present: { p: [0.12, 0.72, 0.7], pitchDeg: 8 },
  },
  camera: {
    fovDesktop: [35, 28],
    fovMobile: [45, 40],
  },
  odds: {
    level: { shangshang: 0.15, shang: 0.35, zhongji: 0.3, xiaoji: 0.18, xiaxia: 0.02 },
    treat: 1 / 50,
    tease: 0.3,
    jiaobei: { sheng: 0.5, xiao: 0.25, yin: 0.25 },
  },
  antiRepeat: { last: 0.3, recent: 0.6, recentDays: 3, coldBonus: 1.4, coldDays: 7 },
  limits: {
    minRestaurants: 4,
    maxRestaurants: 16,
    nameMax: 8,
    historyMax: 60,
    historyDays: 14,
    jieMax: 30,
    yiMax: 8,
    jiMax: 10,
    xiaoForceAccept: 3,
  },
  haptics: {
    clack: 8,
    clackGapMs: 45,
    meterFull: 15,
    eject: [20, 40, 60],
    land: [30, 40, 80],
    bell: [10, 30, 10, 30, 80],
    sheng: [50, 50, 50, 50, 200],
  },
  loop: { idleFps: 30, idleFpsTier0: 24, revealFullRateMs: 1500, maxDt: 0.05 },
  /** Safety nets in controller.tick in case the 3D Director (or Fallback2D) never reports back. */
  watchdog: { drawingMs: 9000, resettingMs: 2500, jiaobeiMs: 4000 },
  toastMs: 2600,
} as const;
