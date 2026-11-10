// Species catalog: anatomy, swimming style, and behavior preferences.
//
// Geometry is in body-length units along t, which runs from the snout (t = 0) to the tip of
// the tail. top/bot are the dorsal and ventral outlines, width is the half thickness, n the
// cross-section superellipse exponent (below 2 gives the lens section of compressed reef
// fish). Fins are membranes whose height and backward sweep vary across their span s.
// Pectoral and pelvic fins are fans of rays from a hinge; angles are degrees from the
// backward axis, positive towards the back of the fish.
//
// The id selects the colour pattern in js/wgsl/fish.js.

export const STATES = ['CRUISING', 'EXPLORING', 'HOVERING', 'TURNING', 'AVOIDING', 'SCHOOLING', 'SEEKING_SHELTER', 'RESTING'];

export const SPECIES = {
  clownfish: {
    id: 0, name: 'Clownfish', size: [0.38, 0.46],
    geo: {
      top: [[0, 0.0], [0.03, 0.05], [0.1, 0.105], [0.2, 0.15], [0.35, 0.175], [0.5, 0.17], [0.65, 0.13], [0.75, 0.09], [0.8, 0.075]],
      bot: [[0, -0.005], [0.03, -0.04], [0.1, -0.085], [0.2, -0.125], [0.35, -0.15], [0.5, -0.14], [0.65, -0.1], [0.75, -0.075], [0.8, -0.065]],
      width: [[0, 0.0], [0.04, 0.045], [0.12, 0.08], [0.3, 0.095], [0.5, 0.085], [0.7, 0.05], [0.8, 0.03]],
      n: 2.2, tPed: 0.8,
      caudal: { type: 'rounded', len: 0.21, span: 0.13 },
      dorsal: [
        { from: 0.3, to: 0.52, h: [[0, 0.03], [0.3, 0.075], [0.7, 0.07], [1, 0.045]], sweep: [[0, 0.03], [1, 0.03]] },
        { from: 0.52, to: 0.77, h: [[0, 0.05], [0.4, 0.11], [0.8, 0.1], [1, 0.03]], sweep: [[0, 0.03], [1, 0.07]] },
      ],
      anal: [{ from: 0.55, to: 0.77, h: [[0, 0.04], [0.4, 0.1], [0.8, 0.09], [1, 0.03]], sweep: [[0, 0.04], [1, 0.07]] }],
      pectoral: { t: 0.27, y: -0.04, len: 0.16, base: 0.05, a0: -40, a1: 20, shape: [[0, 0.75], [0.5, 1], [1, 0.8]], tilt: 25 },
      pelvic: { t: 0.33, y: -0.13, len: 0.11, base: 0.02, a0: -75, a1: -40, shape: [[0, 1], [1, 0.7]], tilt: 15 },
      eye: { t: 0.11, y: 0.04, r: 0.032 },
    },
    anim: { style: 0, tailFreq: 2.6, tailAmp: 0.11, waveK: 0.9, pecFreq: 3.2, pecAmp: 0.65, finUndulate: 0 },
    behavior: {
      speed: 0.32, maxSpeed: 0.95, accel: 1.4, turnRate: 1.9, zone: [0.6, 3.6],
      states: { HOVERING: 0.35, CRUISING: 0.3, RESTING: 0.2, SEEKING_SHELTER: 0.15 },
      durations: [3, 9], territory: 'anemone', territoryRadius: 0.75, wander: 0.35, reefAffinity: 0.6,
    },
  },

  blueTang: {
    id: 1, name: 'Blue tang', size: [0.7, 0.85],
    geo: {
      top: [[0, 0.0], [0.03, 0.06], [0.1, 0.14], [0.2, 0.22], [0.33, 0.26], [0.5, 0.25], [0.65, 0.19], [0.75, 0.11], [0.8, 0.065]],
      bot: [[0, -0.01], [0.03, -0.04], [0.1, -0.1], [0.2, -0.17], [0.38, -0.22], [0.55, -0.2], [0.68, -0.13], [0.77, -0.07], [0.8, -0.055]],
      width: [[0, 0.0], [0.04, 0.035], [0.15, 0.065], [0.35, 0.07], [0.6, 0.05], [0.8, 0.018]],
      n: 1.7, tPed: 0.8,
      caudal: { type: 'emarginate', len: 0.2, span: 0.2 },
      dorsal: [{ from: 0.2, to: 0.78, h: [[0, 0.04], [0.2, 0.06], [0.7, 0.07], [1, 0.03]], sweep: [[0, 0.02], [1, 0.06]] }],
      anal: [{ from: 0.4, to: 0.78, h: [[0, 0.04], [0.3, 0.06], [0.8, 0.06], [1, 0.02]], sweep: [[0, 0.02], [1, 0.06]] }],
      pectoral: { t: 0.26, y: -0.01, len: 0.2, base: 0.05, a0: -25, a1: 25, shape: [[0, 0.7], [0.6, 1], [1, 0.85]], tilt: 20 },
      pelvic: { t: 0.3, y: -0.17, len: 0.09, base: 0.02, a0: -75, a1: -45, shape: [[0, 1], [1, 0.7]], tilt: 12 },
      eye: { t: 0.12, y: 0.06, r: 0.04 },
    },
    anim: { style: 1, tailFreq: 1.7, tailAmp: 0.075, waveK: 0.85, pecFreq: 1.9, pecAmp: 0.55, finUndulate: 0 },
    behavior: {
      speed: 0.5, maxSpeed: 1.35, accel: 1.0, turnRate: 1.4, zone: [1.8, 5.8],
      states: { CRUISING: 0.45, EXPLORING: 0.3, HOVERING: 0.1, SEEKING_SHELTER: 0.15 },
      durations: [5, 14], territory: null, wander: 0.4, reefAffinity: 0.25,
    },
  },

  yellowTang: {
    id: 2, name: 'Yellow tang', size: [0.56, 0.68],
    geo: {
      top: [[0, 0.01], [0.04, 0.05], [0.1, 0.12], [0.2, 0.22], [0.35, 0.27], [0.5, 0.25], [0.65, 0.17], [0.76, 0.09], [0.81, 0.06]],
      bot: [[0, -0.005], [0.04, -0.03], [0.1, -0.09], [0.2, -0.19], [0.38, -0.25], [0.55, -0.22], [0.68, -0.14], [0.77, -0.07], [0.81, -0.05]],
      width: [[0, 0.0], [0.05, 0.03], [0.2, 0.06], [0.4, 0.062], [0.65, 0.045], [0.81, 0.016]],
      n: 1.6, tPed: 0.81,
      caudal: { type: 'truncate', len: 0.18, span: 0.17 },
      dorsal: [{ from: 0.18, to: 0.8, h: [[0, 0.05], [0.25, 0.13], [0.6, 0.14], [0.9, 0.08], [1, 0.02]], sweep: [[0, 0.03], [1, 0.07]] }],
      anal: [{ from: 0.38, to: 0.8, h: [[0, 0.06], [0.3, 0.13], [0.7, 0.12], [1, 0.02]], sweep: [[0, 0.03], [1, 0.07]] }],
      pectoral: { t: 0.27, y: -0.01, len: 0.15, base: 0.045, a0: -25, a1: 25, shape: [[0, 0.7], [0.6, 1], [1, 0.8]], tilt: 20 },
      pelvic: { t: 0.32, y: -0.2, len: 0.08, base: 0.02, a0: -75, a1: -45, shape: [[0, 1], [1, 0.7]], tilt: 12 },
      eye: { t: 0.13, y: 0.075, r: 0.036 },
    },
    anim: { style: 1, tailFreq: 1.6, tailAmp: 0.07, waveK: 0.85, pecFreq: 1.8, pecAmp: 0.5, finUndulate: 0 },
    behavior: {
      speed: 0.44, maxSpeed: 1.2, accel: 0.9, turnRate: 1.3, zone: [1.2, 5.0],
      states: { CRUISING: 0.45, EXPLORING: 0.2, RESTING: 0.2, HOVERING: 0.15 },
      durations: [5, 13], territory: null, wander: 0.35, reefAffinity: 0.5,
    },
  },

  emperorAngelfish: {
    id: 3, name: 'Emperor angelfish', size: [0.85, 1.0],
    geo: {
      top: [[0, 0.0], [0.04, 0.06], [0.12, 0.15], [0.25, 0.23], [0.42, 0.26], [0.6, 0.23], [0.74, 0.15], [0.81, 0.09], [0.84, 0.07]],
      bot: [[0, -0.01], [0.04, -0.05], [0.12, -0.12], [0.25, -0.19], [0.45, -0.23], [0.62, -0.2], [0.75, -0.12], [0.82, -0.07], [0.84, -0.06]],
      width: [[0, 0.0], [0.05, 0.04], [0.2, 0.07], [0.45, 0.065], [0.7, 0.045], [0.84, 0.02]],
      n: 1.7, tPed: 0.84,
      caudal: { type: 'rounded', len: 0.17, span: 0.13 },
      dorsal: [{ from: 0.22, to: 0.84, h: [[0, 0.03], [0.4, 0.08], [0.8, 0.12], [1, 0.04]], sweep: [[0, 0.02], [0.7, 0.06], [1, 0.12]] }],
      anal: [{ from: 0.42, to: 0.84, h: [[0, 0.04], [0.5, 0.09], [0.85, 0.1], [1, 0.03]], sweep: [[0, 0.02], [1, 0.1]] }],
      pectoral: { t: 0.28, y: -0.02, len: 0.15, base: 0.045, a0: -25, a1: 25, shape: [[0, 0.7], [0.6, 1], [1, 0.8]], tilt: 18 },
      pelvic: { t: 0.3, y: -0.19, len: 0.12, base: 0.02, a0: -75, a1: -45, shape: [[0, 1], [1, 0.6]], tilt: 12 },
      eye: { t: 0.12, y: 0.05, r: 0.034 },
    },
    anim: { style: 1, tailFreq: 1.0, tailAmp: 0.06, waveK: 0.8, pecFreq: 1.2, pecAmp: 0.45, finUndulate: 0 },
    behavior: {
      speed: 0.32, maxSpeed: 0.9, accel: 0.6, turnRate: 0.9, zone: [1.2, 4.8],
      states: { CRUISING: 0.4, EXPLORING: 0.2, HOVERING: 0.2, SEEKING_SHELTER: 0.2 },
      durations: [6, 16], territory: null, wander: 0.3, reefAffinity: 0.5,
    },
  },

  butterflyfish: {
    id: 4, name: 'Threadfin butterflyfish', size: [0.5, 0.6],
    geo: {
      top: [[0, 0.0], [0.05, 0.035], [0.12, 0.1], [0.25, 0.2], [0.42, 0.25], [0.6, 0.22], [0.74, 0.13], [0.81, 0.07], [0.84, 0.06]],
      bot: [[0, -0.005], [0.05, -0.025], [0.12, -0.07], [0.25, -0.15], [0.45, -0.21], [0.62, -0.18], [0.75, -0.1], [0.82, -0.06], [0.84, -0.05]],
      width: [[0, 0.0], [0.06, 0.025], [0.2, 0.055], [0.45, 0.055], [0.7, 0.04], [0.84, 0.015]],
      n: 1.6, tPed: 0.84,
      caudal: { type: 'truncate', len: 0.16, span: 0.14 },
      dorsal: [{ from: 0.25, to: 0.82, h: [[0, 0.05], [0.4, 0.09], [0.78, 0.1], [0.88, 0.12], [1, 0.03]], sweep: [[0, 0.02], [0.78, 0.05], [0.88, 0.2], [1, 0.07]] }],
      anal: [{ from: 0.45, to: 0.82, h: [[0, 0.05], [0.5, 0.08], [1, 0.03]], sweep: [[0, 0.02], [1, 0.06]] }],
      pectoral: { t: 0.29, y: -0.03, len: 0.13, base: 0.04, a0: -25, a1: 25, shape: [[0, 0.7], [0.6, 1], [1, 0.8]], tilt: 18 },
      pelvic: { t: 0.32, y: -0.17, len: 0.09, base: 0.02, a0: -75, a1: -45, shape: [[0, 1], [1, 0.6]], tilt: 12 },
      eye: { t: 0.14, y: 0.04, r: 0.03 },
    },
    anim: { style: 1, tailFreq: 1.6, tailAmp: 0.07, waveK: 0.85, pecFreq: 2.1, pecAmp: 0.55, finUndulate: 0 },
    behavior: {
      speed: 0.36, maxSpeed: 1.0, accel: 1.0, turnRate: 1.7, zone: [0.8, 4.0],
      states: { CRUISING: 0.35, RESTING: 0.3, EXPLORING: 0.2, HOVERING: 0.15 },
      durations: [4, 11], territory: null, wander: 0.45, reefAffinity: 0.75,
    },
  },

  royalGramma: {
    id: 5, name: 'Royal gramma', size: [0.26, 0.32],
    geo: {
      top: [[0, 0.0], [0.03, 0.04], [0.1, 0.08], [0.25, 0.115], [0.45, 0.12], [0.65, 0.095], [0.78, 0.065], [0.82, 0.055]],
      bot: [[0, -0.01], [0.03, -0.035], [0.1, -0.07], [0.25, -0.1], [0.45, -0.105], [0.65, -0.08], [0.78, -0.055], [0.82, -0.05]],
      width: [[0, 0.0], [0.04, 0.035], [0.15, 0.06], [0.4, 0.06], [0.7, 0.04], [0.82, 0.022]],
      n: 2.0, tPed: 0.82,
      caudal: { type: 'emarginate', len: 0.18, span: 0.12 },
      dorsal: [{ from: 0.22, to: 0.8, h: [[0, 0.04], [0.4, 0.06], [0.85, 0.09], [1, 0.03]], sweep: [[0, 0.02], [1, 0.06]] }],
      anal: [{ from: 0.5, to: 0.8, h: [[0, 0.05], [0.6, 0.1], [1, 0.03]], sweep: [[0, 0.03], [1, 0.07]] }],
      pectoral: { t: 0.25, y: -0.02, len: 0.13, base: 0.035, a0: -30, a1: 20, shape: [[0, 0.75], [0.5, 1], [1, 0.8]], tilt: 22 },
      pelvic: { t: 0.27, y: -0.1, len: 0.15, base: 0.015, a0: -70, a1: -45, shape: [[0, 1], [1, 0.5]], tilt: 12 },
      eye: { t: 0.1, y: 0.035, r: 0.034 },
    },
    anim: { style: 0, tailFreq: 2.7, tailAmp: 0.1, waveK: 0.9, pecFreq: 3.0, pecAmp: 0.6, finUndulate: 0 },
    behavior: {
      speed: 0.28, maxSpeed: 1.1, accel: 1.8, turnRate: 2.0, zone: [0.4, 3.4],
      states: { HOVERING: 0.45, CRUISING: 0.25, SEEKING_SHELTER: 0.2, RESTING: 0.1 },
      durations: [1.5, 5], territory: 'ledge', territoryRadius: 0.7, wander: 0.4, reefAffinity: 0.9,
    },
  },

  moorishIdol: {
    id: 6, name: 'Moorish idol', size: [0.62, 0.72],
    geo: {
      top: [[0, 0.0], [0.06, 0.03], [0.12, 0.06], [0.2, 0.16], [0.3, 0.27], [0.45, 0.3], [0.6, 0.24], [0.73, 0.12], [0.8, 0.06], [0.84, 0.05]],
      bot: [[0, -0.005], [0.06, -0.02], [0.12, -0.05], [0.2, -0.14], [0.33, -0.25], [0.5, -0.28], [0.65, -0.18], [0.76, -0.08], [0.84, -0.045]],
      width: [[0, 0.0], [0.06, 0.02], [0.15, 0.04], [0.4, 0.055], [0.7, 0.035], [0.84, 0.014]],
      n: 1.6, tPed: 0.84,
      caudal: { type: 'forked', len: 0.17, span: 0.15 },
      dorsal: [{ from: 0.3, to: 0.78, h: [[0, 0.62], [0.06, 0.6], [0.2, 0.25], [0.5, 0.1], [1, 0.03]], sweep: [[0, 0.38], [0.06, 0.55], [0.2, 0.25], [0.6, 0.1], [1, 0.05]] }],
      anal: [{ from: 0.45, to: 0.78, h: [[0, 0.22], [0.2, 0.18], [0.6, 0.07], [1, 0.03]], sweep: [[0, 0.18], [0.3, 0.12], [1, 0.05]] }],
      pectoral: { t: 0.3, y: -0.03, len: 0.12, base: 0.04, a0: -25, a1: 25, shape: [[0, 0.7], [0.6, 1], [1, 0.8]], tilt: 18 },
      pelvic: { t: 0.33, y: -0.24, len: 0.08, base: 0.02, a0: -75, a1: -45, shape: [[0, 1], [1, 0.6]], tilt: 12 },
      eye: { t: 0.17, y: 0.06, r: 0.028 },
    },
    anim: { style: 1, tailFreq: 1.1, tailAmp: 0.06, waveK: 0.8, pecFreq: 1.3, pecAmp: 0.5, finUndulate: 0 },
    behavior: {
      speed: 0.38, maxSpeed: 1.0, accel: 0.7, turnRate: 1.0, zone: [2.0, 5.5],
      states: { CRUISING: 0.5, EXPLORING: 0.25, HOVERING: 0.15, RESTING: 0.1 },
      durations: [6, 15], territory: null, wander: 0.3, reefAffinity: 0.3,
    },
  },

  lionfish: {
    id: 7, name: 'Lionfish', size: [0.85, 1.0],
    geo: {
      top: [[0, 0.0], [0.03, 0.05], [0.1, 0.1], [0.2, 0.14], [0.35, 0.16], [0.55, 0.13], [0.72, 0.075], [0.82, 0.055]],
      bot: [[0, -0.03], [0.03, -0.06], [0.1, -0.095], [0.2, -0.12], [0.35, -0.13], [0.55, -0.1], [0.72, -0.06], [0.82, -0.045]],
      width: [[0, 0.0], [0.04, 0.05], [0.15, 0.085], [0.35, 0.08], [0.6, 0.055], [0.82, 0.025]],
      n: 2.0, tPed: 0.82,
      caudal: { type: 'rounded', len: 0.18, span: 0.12 },
      dorsal: [
        { from: 0.18, to: 0.55, h: [[0, 0.3], [0.2, 0.42], [0.5, 0.38], [0.8, 0.25], [1, 0.12]], sweep: [[0, 0.08], [1, 0.1]], spines: 13 },
        { from: 0.57, to: 0.8, h: [[0, 0.09], [0.5, 0.12], [1, 0.04]], sweep: [[0, 0.03], [1, 0.06]] },
      ],
      anal: [{ from: 0.58, to: 0.8, h: [[0, 0.08], [0.5, 0.11], [1, 0.03]], sweep: [[0, 0.04], [1, 0.07]] }],
      pectoral: { t: 0.24, y: -0.04, len: 0.5, base: 0.06, a0: -80, a1: 55, shape: [[0, 0.7], [0.3, 1], [0.7, 1], [1, 0.75]], tilt: 55, rays: 16 },
      pelvic: { t: 0.28, y: -0.12, len: 0.25, base: 0.02, a0: -85, a1: -45, shape: [[0, 1], [1, 0.7]], tilt: 25 },
      eye: { t: 0.1, y: 0.06, r: 0.03 },
    },
    anim: { style: 3, tailFreq: 0.6, tailAmp: 0.03, waveK: 0.8, pecFreq: 0.45, pecAmp: 0.22, finUndulate: 0 },
    behavior: {
      speed: 0.14, maxSpeed: 0.42, accel: 0.35, turnRate: 0.6, zone: [0.9, 3.6],
      states: { HOVERING: 0.55, CRUISING: 0.3, RESTING: 0.15 },
      durations: [8, 22], territory: 'reef', territoryRadius: 2.5, wander: 0.2, reefAffinity: 0.8,
    },
  },

  damselfish: {
    id: 8, name: 'Blue damselfish', size: [0.24, 0.3],
    geo: {
      top: [[0, 0.0], [0.03, 0.05], [0.1, 0.1], [0.25, 0.15], [0.45, 0.155], [0.65, 0.115], [0.76, 0.075], [0.8, 0.065]],
      bot: [[0, -0.01], [0.03, -0.04], [0.1, -0.08], [0.25, -0.125], [0.45, -0.13], [0.65, -0.09], [0.76, -0.06], [0.8, -0.055]],
      width: [[0, 0.0], [0.04, 0.04], [0.15, 0.065], [0.4, 0.06], [0.7, 0.035], [0.8, 0.02]],
      n: 1.9, tPed: 0.8,
      caudal: { type: 'forked', len: 0.22, span: 0.17 },
      dorsal: [{ from: 0.25, to: 0.78, h: [[0, 0.04], [0.5, 0.06], [0.85, 0.08], [1, 0.03]], sweep: [[0, 0.02], [1, 0.06]] }],
      anal: [{ from: 0.52, to: 0.78, h: [[0, 0.04], [0.6, 0.08], [1, 0.03]], sweep: [[0, 0.03], [1, 0.07]] }],
      pectoral: { t: 0.26, y: -0.02, len: 0.14, base: 0.035, a0: -30, a1: 20, shape: [[0, 0.75], [0.5, 1], [1, 0.8]], tilt: 22 },
      pelvic: { t: 0.29, y: -0.12, len: 0.1, base: 0.015, a0: -75, a1: -45, shape: [[0, 1], [1, 0.6]], tilt: 12 },
      eye: { t: 0.1, y: 0.04, r: 0.036 },
    },
    anim: { style: 0, tailFreq: 3.0, tailAmp: 0.11, waveK: 0.9, pecFreq: 3.4, pecAmp: 0.6, finUndulate: 0 },
    behavior: {
      speed: 0.45, maxSpeed: 1.3, accel: 1.6, turnRate: 2.0, zone: [1.2, 4.2],
      states: { SCHOOLING: 0.6, CRUISING: 0.2, SEEKING_SHELTER: 0.1, HOVERING: 0.1 },
      durations: [4, 10], school: true, territory: null, wander: 0.5, reefAffinity: 0.5,
    },
  },

  anthias: {
    id: 9, name: 'Lyretail anthias', size: [0.34, 0.42],
    geo: {
      top: [[0, 0.0], [0.03, 0.045], [0.1, 0.09], [0.25, 0.13], [0.45, 0.135], [0.63, 0.1], [0.74, 0.065], [0.78, 0.055]],
      bot: [[0, -0.01], [0.03, -0.035], [0.1, -0.075], [0.25, -0.11], [0.45, -0.115], [0.63, -0.08], [0.74, -0.05], [0.78, -0.045]],
      width: [[0, 0.0], [0.04, 0.035], [0.15, 0.055], [0.4, 0.055], [0.7, 0.03], [0.78, 0.018]],
      n: 1.9, tPed: 0.78,
      caudal: { type: 'lyre', len: 0.28, span: 0.17 },
      dorsal: [{ from: 0.24, to: 0.76, h: [[0, 0.05], [0.07, 0.13], [0.14, 0.06], [0.6, 0.07], [0.9, 0.08], [1, 0.02]], sweep: [[0, 0.02], [0.07, 0.05], [0.14, 0.02], [1, 0.06]] }],
      anal: [{ from: 0.5, to: 0.76, h: [[0, 0.05], [0.6, 0.09], [1, 0.03]], sweep: [[0, 0.03], [1, 0.07]] }],
      pectoral: { t: 0.25, y: -0.02, len: 0.15, base: 0.035, a0: -25, a1: 20, shape: [[0, 0.7], [0.6, 1], [1, 0.8]], tilt: 20 },
      pelvic: { t: 0.28, y: -0.11, len: 0.12, base: 0.015, a0: -75, a1: -45, shape: [[0, 1], [1, 0.6]], tilt: 12 },
      eye: { t: 0.09, y: 0.035, r: 0.034 },
    },
    anim: { style: 0, tailFreq: 2.6, tailAmp: 0.1, waveK: 0.9, pecFreq: 3.0, pecAmp: 0.55, finUndulate: 0 },
    behavior: {
      speed: 0.55, maxSpeed: 1.5, accel: 1.6, turnRate: 2.1, zone: [2.6, 6.0],
      states: { SCHOOLING: 0.55, CRUISING: 0.25, EXPLORING: 0.2 },
      durations: [5, 12], school: true, territory: null, wander: 0.5, reefAffinity: 0.15,
    },
  },

  triggerfish: {
    id: 10, name: 'Picasso triggerfish', size: [0.64, 0.76],
    geo: {
      top: [[0, 0.02], [0.04, 0.06], [0.12, 0.12], [0.25, 0.2], [0.38, 0.24], [0.5, 0.22], [0.62, 0.17], [0.74, 0.1], [0.8, 0.07], [0.82, 0.065]],
      bot: [[0, -0.01], [0.04, -0.04], [0.12, -0.09], [0.25, -0.16], [0.4, -0.21], [0.52, -0.2], [0.64, -0.15], [0.76, -0.08], [0.82, -0.06]],
      width: [[0, 0.0], [0.05, 0.045], [0.2, 0.08], [0.4, 0.085], [0.65, 0.06], [0.82, 0.03]],
      n: 1.9, tPed: 0.82,
      caudal: { type: 'truncate', len: 0.17, span: 0.13 },
      dorsal: [
        { from: 0.31, to: 0.37, h: [[0, 0.09], [1, 0.03]], sweep: [[0, 0.02], [1, 0.02]] },
        { from: 0.52, to: 0.8, h: [[0, 0.11], [0.3, 0.12], [1, 0.04]], sweep: [[0, 0.03], [1, 0.06]] },
      ],
      anal: [{ from: 0.52, to: 0.8, h: [[0, 0.1], [0.3, 0.11], [1, 0.04]], sweep: [[0, 0.03], [1, 0.06]] }],
      pectoral: { t: 0.34, y: 0.0, len: 0.08, base: 0.035, a0: -20, a1: 30, shape: [[0, 0.8], [0.5, 1], [1, 0.8]], tilt: 15 },
      eye: { t: 0.27, y: 0.1, r: 0.03 },
    },
    anim: { style: 2, tailFreq: 0.8, tailAmp: 0.03, waveK: 0.8, pecFreq: 2.2, pecAmp: 0.5, finUndulate: 0.06 },
    behavior: {
      speed: 0.4, maxSpeed: 1.1, accel: 0.9, turnRate: 1.4, zone: [0.7, 5.0],
      states: { EXPLORING: 0.4, CRUISING: 0.3, HOVERING: 0.15, RESTING: 0.15 },
      durations: [5, 13], territory: null, wander: 0.45, reefAffinity: 0.45,
    },
  },

  morayEel: {
    id: 11, name: 'Honeycomb moray', size: [2.5, 2.7],
    geo: {
      top: [[0, 0.002], [0.01, 0.012], [0.03, 0.025], [0.07, 0.038], [0.12, 0.045], [0.5, 0.044], [0.8, 0.035], [0.95, 0.018], [1.0, 0.002]],
      bot: [[0, -0.002], [0.01, -0.01], [0.03, -0.02], [0.07, -0.032], [0.12, -0.04], [0.5, -0.04], [0.8, -0.032], [0.95, -0.016], [1.0, -0.002]],
      width: [[0, 0.002], [0.02, 0.014], [0.06, 0.03], [0.12, 0.036], [0.5, 0.036], [0.8, 0.028], [0.95, 0.012], [1.0, 0.001]],
      n: 2.1, tPed: 1.0, rings: 150,
      caudal: null,
      dorsal: [{ from: 0.1, to: 0.995, h: [[0, 0.004], [0.1, 0.014], [0.9, 0.012], [1, 0.004]], sweep: [[0, 0], [1, 0]] }],
      anal: [{ from: 0.45, to: 0.995, h: [[0, 0.005], [0.1, 0.012], [1, 0.004]], sweep: [[0, 0], [1, 0]] }],
      eye: { t: 0.035, y: 0.018, r: 0.0075 },
      jaw: { t: 0.075, y: -0.003 },
    },
    anim: { style: 4, tailFreq: 0.7, tailAmp: 0.05, waveK: 2.2, pecFreq: 0, pecAmp: 0, finUndulate: 0.01 },
    behavior: {
      speed: 0.05, maxSpeed: 0.2, accel: 0.2, turnRate: 0.5, zone: [0.5, 2.0],
      states: { RESTING: 0.45, HOVERING: 0.3, EXPLORING: 0.15, SEEKING_SHELTER: 0.1 },
      durations: [6, 18], territory: 'cave', wander: 0.1, reefAffinity: 1,
    },
  },
};

export const SPECIES_KEYS = Object.keys(SPECIES);
