// Autonomous fish behavior. Each fish is an independent FishEntity driven by a
// probabilistic finite-state machine and weighted steering:
//   steering = seekTarget + obstacleAvoidance + fishSeparation + territoryPreference
//            + currentInfluence + wandering (+ alignment + cohesion for schools)
// Heading turns toward the steering intent at a limited angular rate, so a fish never
// flips direction in a frame; it slows, banks and bends through the turn instead.
// Neighbour queries use a spatial hash rebuilt every step. All vectors are preallocated.
import { V3, Rng, clamp, lerp, TAU } from './math.js';
import { SPECIES } from './species.js';
import { FISH_BOUNDS, ISO } from './reef.js';

const STATE_SPEED = {
  CRUISING: 1.0, EXPLORING: 1.2, HOVERING: 0.12, TURNING: 0.55, AVOIDING: 0.85, SCHOOLING: 1.0, SEEKING_SHELTER: 0.9, RESTING: 0.22,
};
const UP = new V3(0, 1, 0);

export class FishEntity {
  constructor(id, key, rng) {
    const def = SPECIES[key];
    const b = def.behavior;
    this.id = id;
    this.species = key;
    this.def = def;
    this.position = new V3();
    this.velocity = new V3();
    this.acceleration = new V3();
    this.heading = new V3(rng.sign(), 0, (rng.next() - 0.5) * 0.6).normalize();
    this.targetPosition = new V3();
    const indiv = 0.85 + rng.next() * 0.3;
    this.bodyLength = def.size[0] + rng.next() * (def.size[1] - def.size[0]);
    this.preferredDepth = lerp(b.zone[0], b.zone[1], 0.25 + rng.next() * 0.5);
    this.preferredSpeed = b.speed * indiv;
    this.maximumSpeed = b.maxSpeed * (0.9 + rng.next() * 0.2);
    this.turnRate = b.turnRate * (0.8 + rng.next() * 0.4);
    this.personalSpace = this.bodyLength * (0.9 + rng.next() * 0.4);
    this.behaviorState = 'CRUISING';
    this.animationPhase = rng.next() * TAU;
    this.tailFrequency = def.anim.tailFreq * (0.88 + rng.next() * 0.24);
    this.finAmplitude = def.anim.pecAmp * (0.85 + rng.next() * 0.3);
    this.homeTerritory = undefined;
    this.schoolId = undefined;
    this.lastBehaviorChange = 0;
    // internal state
    this.speed = this.preferredSpeed * 0.5;
    this.up = new V3(0, 1, 0);
    this.roll = 0;
    this.bend = 0;
    this.yawRate = 0;
    this.pecPhase = rng.next() * TAU;
    this.dorsalPhase = rng.next() * TAU;
    this.tailAmp = 0;
    this.pecAmp = 0;
    this.stateUntil = 0;
    this.prevState = 'CRUISING';
    this.durationScale = 0.75 + rng.next() * 0.5;
    this.aggression = 0.7 + rng.next() * 0.6; // how sharply it commits to direction changes
    this.territoryScale = 0.8 + rng.next() * 0.5;
    this.wanderSeed = [rng.next() * 100, rng.next() * 100, rng.next() * 100];
    this.wanderFreq = [0.07 + rng.next() * 0.08, 0.05 + rng.next() * 0.06, 0.06 + rng.next() * 0.08];
    this.variant = rng.next();
    this.envLight = 1;
    this.stuck = 0;
    this.bestDist = 1e9;
    this.radius = this.bodyLength * 0.2;
    this.clearance = this.bodyLength * (def.id === 7 ? 0.32 : 0.18) + 0.03;
    this.gape = 0;
    this.extension = 0;
    this.headYaw = 0;
  }
}

export class Aquarium {
  constructor(reef, cfg, seed, visible) {
    this.reef = reef;
    this.cfg = cfg;
    this.rng = new Rng(seed);
    this.visible = visible;
    this.fish = [];
    this.schools = new Map();
    this.time = 0;
    this.current = new V3();
    // spatial hash over the swimming volume
    this.cell = 1.0;
    this.gx = Math.ceil((FISH_BOUNDS.xMax - FISH_BOUNDS.xMin) / this.cell) + 2;
    this.gy = Math.ceil((FISH_BOUNDS.yMax + 1) / this.cell) + 2;
    this.gz = Math.ceil((FISH_BOUNDS.zMax - FISH_BOUNDS.zMin) / this.cell) + 2;
    this.cellStart = new Int32Array(this.gx * this.gy * this.gz + 1);
    this.cellOf = new Int32Array(256);
    this.sorted = new Int32Array(256);
    // scratch vectors
    this.t = Array.from({ length: 12 }, () => new V3());
    this.g = { x: 0, y: 0, z: 0 };
  }

  spawn(distribution) {
    const rng = this.rng;
    let id = 0;
    for (const [key, n] of Object.entries(distribution)) {
      if (!SPECIES[key]) continue;
      let school = null;
      if (SPECIES[key].behavior.school) {
        school = { id: key + '-school', members: [], target: new V3(), until: 0, center: new V3() };
        this.schools.set(school.id, school);
      }
      for (let k = 0; k < n; k++) {
        const f = new FishEntity(`${key}-${k}`, key, rng);
        f.index = id++;
        if (school) { f.schoolId = school.id; school.members.push(f); }
        this.assignHome(f, k);
        this.placeInitially(f, school, k);
        this.fish.push(f);
      }
      if (school) this.pickSchoolTarget(school);
    }
    if (this.fish.length > this.cellOf.length) {
      this.cellOf = new Int32Array(this.fish.length);
      this.sorted = new Int32Array(this.fish.length);
    }
    for (const f of this.fish) this.chooseState(f, true);
  }

  assignHome(f, k) {
    const b = f.def.behavior, reef = this.reef;
    if (b.territory === 'anemone' && reef.corals.anemones.length) {
      const a = reef.corals.anemones[0];
      f.homeTerritory = new V3(a.pos[0], a.pos[1] + 0.12, a.pos[2]);
    } else if (b.territory === 'ledge' && reef.ledges.length) {
      // spread the grammas over different ledges in view
      for (let tries = 0; tries < 200; tries++) {
        const p = reef.ledges[this.rng.int(reef.ledges.length)];
        if (!this.visible(p[0], p[1], p[2], 0.85) && tries < 150) continue;
        if (this.fish.some((o) => o.homeTerritory && o.species === f.species && o.homeTerritory.distTo({ x: p[0], y: p[1], z: p[2] }) < 1.8) && tries < 180) continue;
        f.homeTerritory = new V3(p[0], p[1], p[2]);
        break;
      }
    } else if (b.territory === 'reef') {
      const p = reef.shelter.length ? reef.shelter[this.rng.int(reef.shelter.length)] : [0, 2, -2];
      f.homeTerritory = new V3(clamp(p[0], -4, 4), clamp(p[1] + 0.6, 1.2, 3.2), clamp(p[2] + 0.3, -3.8, -1.2));
    } else if (b.territory === 'cave') {
      f.homeTerritory = new V3(...reef.moray.mouth);
    }
    if (f.homeTerritory && (b.territory === 'ledge' || b.territory === 'reef')) this.clearPoint(f, f.homeTerritory);
    void k;
  }

  placeInitially(f, school, k) {
    if (f.species === 'morayEel') {
      f.position.set(...this.reef.moray.mouth);
      f.heading.set(...this.reef.moray.dirOut);
      return;
    }
    const p = this.t[0];
    for (let tries = 0; tries < 400; tries++) {
      if (f.homeTerritory && tries < 300) {
        const r = (f.def.behavior.territoryRadius || 1) * f.territoryScale;
        p.set(f.homeTerritory.x + (this.rng.next() - 0.5) * r * 1.6, f.homeTerritory.y + (this.rng.next() - 0.2) * r, f.homeTerritory.z + (this.rng.next() - 0.5) * r);
      } else if (school && school.members.length > 1 && tries < 300) {
        const lead = school.members[0].position;
        p.set(lead.x + (this.rng.next() - 0.5) * 1.6, lead.y + (this.rng.next() - 0.5) * 0.8, lead.z + (this.rng.next() - 0.5) * 1.2);
      } else {
        this.randomPointInZone(f, p, 0, 99, 0.9);
      }
      if (!this.isFree(p, f.clearance + 0.1)) continue;
      if (this.fish.some((o) => o.position.distTo(p) < (o.radius + f.radius) * 2.2)) continue;
      break;
    }
    f.position.copy(p);
    f.targetPosition.copy(p);
    void k;
  }

  isFree(p, clearance) {
    const B = FISH_BOUNDS;
    if (p.x < B.xMin || p.x > B.xMax || p.z < B.zMin || p.z > B.zMax || p.y > B.yMax) return false;
    if (p.y < this.reef.sandHeight(p.x, p.z) + clearance + 0.1) return false;
    const o = this.reef.obstacle;
    if (o.sample(p.x, p.y, p.z) > ISO * 0.35) return false;
    const c = clearance;
    if (o.sample(p.x + c, p.y, p.z) > ISO * 0.6 || o.sample(p.x - c, p.y, p.z) > ISO * 0.6) return false;
    if (o.sample(p.x, p.y + c, p.z) > ISO * 0.6 || o.sample(p.x, p.y - c, p.z) > ISO * 0.6) return false;
    if (o.sample(p.x, p.y, p.z + c) > ISO * 0.6 || o.sample(p.x, p.y, p.z - c) > ISO * 0.6) return false;
    return true;
  }

  // Random free point in the species' preferred band, at a distance between dMin and dMax
  // from the fish, usually somewhere on screen.
  randomPointInZone(f, out, dMin, dMax, visibleBias = 0.8) {
    const b = f.def.behavior, B = FISH_BOUNDS, rng = this.rng;
    const wantVisible = rng.next() < visibleBias;
    // most new goals lie roughly ahead; fish rarely reverse course for no reason
    const ahead = rng.next() < 0.75;
    for (let tries = 0; tries < 60; tries++) {
      out.set(lerp(B.xMin + 0.5, B.xMax - 0.5, rng.next()),
        lerp(b.zone[0], b.zone[1], Math.pow(rng.next(), 0.9)),
        lerp(B.zMin + 0.3, B.zMax - 0.15, rng.next()));
      // bias heights toward the fish's own preferred depth
      out.y = lerp(out.y, f.preferredDepth, 0.3);
      const d = out.distTo(f.position);
      if (tries < 45 && (d < dMin || d > dMax)) continue;
      if (ahead && tries < 30 && d > 1e-3 &&
        ((out.x - f.position.x) * f.heading.x + (out.y - f.position.y) * f.heading.y + (out.z - f.position.z) * f.heading.z) / d < -0.1) continue;
      if (wantVisible && tries < 40 && !this.visible(out.x, out.y, out.z, 0.82)) continue;
      if (!this.isFree(out, f.clearance + 0.15)) continue;
      return out;
    }
    return out.copy(f.position);
  }

  // Move a goal out of the avoidance margin around rock, so seeking it and steering
  // clear of the reef do not fight each other.
  clearPoint(f, out) {
    const o = this.reef.obstacle, g = this.g;
    for (let k = 0; k < 12; k++) {
      const val = o.sample(out.x, out.y, out.z);
      o.gradient(out.x, out.y, out.z, g);
      const gl = Math.hypot(g.x, g.y, g.z);
      if (gl < 1e-4 || val <= ISO - gl * (f.clearance + 0.3)) break;
      out.x -= (g.x / gl) * 0.05; out.y -= (g.y / gl) * 0.05; out.z -= (g.z / gl) * 0.05;
    }
    return out;
  }

  pickNear(list, f, out, maxD = 4, offsetY = 0) {
    if (!list.length) return this.randomPointInZone(f, out, 0, maxD);
    for (let tries = 0; tries < 40; tries++) {
      const p = list[this.rng.int(list.length)];
      out.set(p[0], p[1] + offsetY, p[2]);
      if (out.distTo(f.position) > maxD && tries < 30) continue;
      if (!this.visible(out.x, out.y, out.z, 0.9) && tries < 20) continue;
      this.clearPoint(f, out);
      if (!this.isFree(out, f.clearance * 0.7)) continue;
      return out;
    }
    return this.randomPointInZone(f, out, 0, maxD);
  }

  pickSchoolTarget(s) {
    const lead = s.members[0];
    if (!lead) return;
    const c = s.center;
    this.randomPointInZone(lead, s.target, 2.5, 9, 0.85);
    s.until = this.time + 7 + this.rng.next() * 9;
    void c;
  }

  // ---- state machine ------------------------------------------------------------------------
  setState(f, state) {
    if (f.behaviorState !== 'TURNING' && f.behaviorState !== 'AVOIDING') f.prevState = f.behaviorState;
    f.behaviorState = state;
    f.lastBehaviorChange = this.time;
    f.stuck = 0;
    f.bestDist = 1e9;
  }

  chooseState(f, initial = false) {
    const b = f.def.behavior;
    const weights = { ...b.states };
    if (!this.cfg.fish.schoolingEnabled) delete weights.SCHOOLING;
    // persistence: a fish slightly prefers to keep doing what it was doing
    if (!initial && weights[f.behaviorState]) weights[f.behaviorState] *= 1.25;
    const next = this.rng.weighted(weights);
    this.setState(f, next);
    const [d0, d1] = b.durations;
    f.stateUntil = this.time + lerp(d0, d1, this.rng.next()) * f.durationScale;
    this.chooseTarget(f);
  }

  chooseTarget(f) {
    const reef = this.reef, out = f.targetPosition, b = f.def.behavior;
    switch (f.behaviorState) {
      case 'CRUISING':
        if (f.homeTerritory) this.nearHome(f, out, 1.0);
        else this.randomPointInZone(f, out, 1.5, 5.5);
        break;
      case 'EXPLORING':
        if (f.homeTerritory && b.territory !== 'reef') this.nearHome(f, out, 1.5);
        else this.randomPointInZone(f, out, 4, 99, 0.7);
        break;
      case 'HOVERING':
        out.copy(f.position).addScaled(f.heading, 0.15);
        if (f.homeTerritory && f.position.distTo(f.homeTerritory) > (b.territoryRadius || 1) * 1.5) this.nearHome(f, out, 0.6);
        break;
      case 'RESTING': {
        if (f.homeTerritory) { this.nearHome(f, out, 0.4); break; }
        const inst = reef.corals.instances;
        for (let tries = 0; tries < 30; tries++) {
          const c = inst[this.rng.int(inst.length)];
          if (c.name === 'stone' || c.name === 'shell' || c.name === 'anemone') continue;
          const H = reef.corals.variants[c.name][c.variant].height * c.scale;
          out.set(c.pos[0] + c.b.u[0] * (H + 0.25), c.pos[1] + c.b.u[1] * (H + 0.25) + 0.1, c.pos[2] + c.b.u[2] * (H + 0.25) + 0.15);
          if (out.distTo(f.position) < 5 && this.isFree(out, f.clearance) && (tries > 20 || this.visible(out.x, out.y, out.z, 0.9))) break;
        }
        break;
      }
      case 'SEEKING_SHELTER':
        if (b.territory === 'anemone' && f.homeTerritory) { out.copy(f.homeTerritory); out.y += 0.02; }
        else if (b.territory === 'ledge') this.pickNear(reef.ledges, f, out, 1.5);
        else this.pickNear(reef.shelter, f, out, 4);
        break;
      case 'SCHOOLING': {
        const s = this.schools.get(f.schoolId);
        if (s) out.copy(s.target); else this.randomPointInZone(f, out, 2, 6);
        break;
      }
      default:
        this.randomPointInZone(f, out, 1.5, 5);
    }
  }

  nearHome(f, out, k) {
    const r = (f.def.behavior.territoryRadius || 1) * f.territoryScale * k;
    const h = f.homeTerritory;
    for (let tries = 0; tries < 30; tries++) {
      out.set(h.x + (this.rng.next() - 0.5) * 2 * r, h.y + (this.rng.next() - 0.35) * r, h.z + (this.rng.next() - 0.5) * 2 * r * 0.7);
      if (f.def.behavior.territory !== 'anemone') this.clearPoint(f, out);
      if (this.isFree(out, f.clearance * 0.8)) return out;
    }
    return out.copy(h);
  }

  // ---- spatial hash ---------------------------------------------------------------------------
  rebuildHash() {
    const B = FISH_BOUNDS, c = this.cell, gx = this.gx, gy = this.gy, gz = this.gz;
    const start = this.cellStart;
    start.fill(0);
    const n = this.fish.length;
    for (let i = 0; i < n; i++) {
      const p = this.fish[i].position;
      const ix = clamp(Math.floor((p.x - B.xMin) / c) + 1, 0, gx - 1);
      const iy = clamp(Math.floor(p.y / c) + 1, 0, gy - 1);
      const iz = clamp(Math.floor((p.z - B.zMin) / c) + 1, 0, gz - 1);
      const cell = (iz * gy + iy) * gx + ix;
      this.cellOf[i] = cell;
      start[cell + 1]++;
    }
    for (let i = 1; i < start.length; i++) start[i] += start[i - 1];
    const fill = this._fill || (this._fill = new Int32Array(start.length));
    fill.set(start);
    for (let i = 0; i < n; i++) this.sorted[fill[this.cellOf[i]]++] = i;
  }

  forNeighbors(f, radius, cb) {
    const B = FISH_BOUNDS, c = this.cell, gx = this.gx, gy = this.gy, gz = this.gz, p = f.position;
    const r = Math.ceil(radius / c);
    const ix = clamp(Math.floor((p.x - B.xMin) / c) + 1, 0, gx - 1);
    const iy = clamp(Math.floor(p.y / c) + 1, 0, gy - 1);
    const iz = clamp(Math.floor((p.z - B.zMin) / c) + 1, 0, gz - 1);
    const r2 = radius * radius;
    for (let z = Math.max(0, iz - r); z <= Math.min(gz - 1, iz + r); z++) {
      for (let y = Math.max(0, iy - r); y <= Math.min(gy - 1, iy + r); y++) {
        for (let x = Math.max(0, ix - r); x <= Math.min(gx - 1, ix + r); x++) {
          const cell = (z * gy + y) * gx + x;
          for (let s = this.cellStart[cell]; s < this.cellStart[cell + 1]; s++) {
            const o = this.fish[this.sorted[s]];
            if (o === f) continue;
            const d2 = o.position.distSq(p);
            if (d2 < r2) cb(o, d2);
          }
        }
      }
    }
  }

  // ---- simulation step ------------------------------------------------------------------------
  update(dt, time, current) {
    this.time = time;
    this.current.copy(current);
    this.rebuildHash();
    for (const s of this.schools.values()) {
      s.center.set(0, 0, 0);
      let n = 0;
      for (const m of s.members) if (m.behaviorState === 'SCHOOLING') { s.center.add(m.position); n++; }
      if (n) s.center.scale(1 / n);
      if (time > s.until || (n && s.center.distTo(s.target) < 1.0)) {
        this.pickSchoolTarget(s);
        for (const m of s.members) if (m.behaviorState === 'SCHOOLING') m.targetPosition.copy(s.target);
      }
    }
    for (const f of this.fish) {
      if (f.species === 'morayEel') this.updateMoray(f, dt);
      else this.steer(f, dt);
    }
    this.resolveOverlaps();
    for (const f of this.fish) this.animate(f, dt);
  }

  steer(f, dt) {
    const cfg = this.cfg, b = f.def.behavior, reef = this.reef;
    const [F, tmp, seek, avoid, sep, terr, wander, school, probe] = this.t;
    const g = this.g;
    const speedMul = cfg.fish.speedMultiplier;

    // state transitions
    if (this.time >= f.stateUntil && f.behaviorState !== 'TURNING' && f.behaviorState !== 'AVOIDING') this.chooseState(f);
    const toT = tmp.subOf(f.targetPosition, f.position);
    const dist = toT.len();
    if (dist < f.bestDist - 0.05) { f.bestDist = dist; f.stuck = 0; } else f.stuck += dt;
    const arrive = Math.max(0.25, f.bodyLength * 0.8);
    if (dist < arrive || f.stuck > 6) {
      if (f.behaviorState === 'CRUISING' || f.behaviorState === 'EXPLORING' || f.stuck > 6) {
        if (f.stuck > 6 && this.rng.next() < 0.5) this.chooseState(f);
        else { this.chooseTarget(f); f.bestDist = 1e9; f.stuck = 0; }
      } else if (f.behaviorState === 'SEEKING_SHELTER' && this.rng.next() < dt * 0.5) {
        this.setState(f, f.def.behavior.territory === 'anemone' ? 'RESTING' : 'HOVERING');
        f.stateUntil = this.time + 3 + this.rng.next() * 5;
        f.targetPosition.copy(f.position);
      }
    }
    toT.subOf(f.targetPosition, f.position);
    const dirDot = dist > 1e-4 ? toT.dot(f.heading) / dist : 1;
    if (f.behaviorState !== 'TURNING' && f.behaviorState !== 'HOVERING' && f.behaviorState !== 'RESTING' && dirDot < -0.35 && dist > 1.0) {
      this.setState(f, 'TURNING');
      f.stateUntil = this.time + 6;
    } else if (f.behaviorState === 'TURNING' && (dirDot > 0.6 || this.time > f.stateUntil)) {
      f.behaviorState = f.prevState;
      f.stateUntil = Math.max(f.stateUntil, this.time + 2);
    }

    // seek
    let desiredSpeed = f.preferredSpeed * STATE_SPEED[f.behaviorState] * speedMul;
    if (f.behaviorState === 'EXPLORING') desiredSpeed = Math.min(desiredSpeed, f.maximumSpeed * speedMul);
    const slow = (f.behaviorState === 'HOVERING' || f.behaviorState === 'RESTING') ? 0.6 : 1.4;
    desiredSpeed *= clamp(dist / slow, 0.12, 1);
    seek.copy(toT).normalize().scale(desiredSpeed).sub(f.velocity).scale(1.0);

    // obstacle avoidance: probes along the heading and the current position
    avoid.set(0, 0, 0);
    let avoidMag = 0;
    if (cfg.fish.collisionAvoidanceEnabled) {
      const look = 0.35 + f.speed * 1.6 + f.bodyLength * 0.6;
      for (let k = 0; k < 3; k++) {
        const s = k === 0 ? 0 : k === 1 ? look * 0.5 : look;
        probe.copy(f.position).addScaled(f.heading, s);
        const val = reef.obstacle.sample(probe.x, probe.y, probe.z);
        reef.obstacle.gradient(probe.x, probe.y, probe.z, g);
        const gl = Math.hypot(g.x, g.y, g.z);
        const margin = ISO - gl * (f.clearance + 0.25);
        if (val > margin && gl > 1e-4) {
          const w = clamp((val - margin) / Math.max(0.05, ISO - margin + 0.05), 0, 2) * (k === 0 ? 1.6 : 1.0);
          avoid.x -= (g.x / gl) * w; avoid.y -= (g.y / gl) * w; avoid.z -= (g.z / gl) * w;
          // slide along the surface instead of stopping dead
          const into = -(f.heading.x * g.x + f.heading.y * g.y + f.heading.z * g.z) / gl;
          if (into < 0) avoid.addScaled(f.heading, into * w * 0.6);
          avoidMag += w;
        }
      }
      // anemones are obstacles for everyone but the clownfish living in them
      if (b.territory !== 'anemone') {
        for (const a of reef.corals.anemones) {
          probe.set(f.position.x - a.pos[0], f.position.y - a.pos[1], f.position.z - a.pos[2]);
          const dd = probe.len(), R = a.radius + 0.25 + f.clearance;
          if (dd < R) { avoid.addScaled(probe.normalize(), (R - dd) / R * 2); avoidMag += (R - dd) / R; }
        }
      }
      // tank bounds and sand, looking ahead
      const B = FISH_BOUNDS;
      probe.copy(f.position).addScaled(f.heading, look);
      const m = 0.6;
      if (probe.x < B.xMin + m) avoid.x += (B.xMin + m - probe.x) * 1.5;
      if (probe.x > B.xMax - m) avoid.x -= (probe.x - B.xMax + m) * 1.5;
      if (probe.z < B.zMin + m * 0.6) avoid.z += (B.zMin + m * 0.6 - probe.z) * 2.5;
      if (probe.z > B.zMax - m * 0.5) avoid.z -= (probe.z - B.zMax + m * 0.5) * 2.5;
      if (probe.y > B.yMax - m) avoid.y -= (probe.y - B.yMax + m) * 1.5;
      const sandY = reef.sandHeight(probe.x, probe.z) + f.clearance + 0.25;
      if (probe.y < sandY) { avoid.y += (sandY - probe.y) * 2.5; avoidMag += (sandY - probe.y); }
    }
    const headingInto = avoidMag > 0 && f.heading.dot(avoid) < -0.15 * avoid.len();
    if (avoidMag > 0.8 && headingInto && f.behaviorState !== 'AVOIDING' && f.behaviorState !== 'TURNING') {
      this.setState(f, 'AVOIDING');
      f.stateUntil = this.time + 0.8 + this.rng.next() * 0.8;
    } else if (f.behaviorState === 'AVOIDING' && this.time > f.stateUntil && (avoidMag < 0.3 || !headingInto)) {
      f.behaviorState = f.prevState;
      f.stateUntil = Math.max(f.stateUntil, this.time + 1.5);
      this.chooseTarget(f);
    }

    // separation and schooling
    sep.set(0, 0, 0);
    school.set(0, 0, 0);
    const schooling = f.behaviorState === 'SCHOOLING' && cfg.fish.schoolingEnabled;
    let nAlign = 0;
    const align = this.t[9].set(0, 0, 0), coh = this.t[10].set(0, 0, 0);
    const self = f;
    const range = Math.max(self.personalSpace * 1.6, schooling ? 1.8 : 0);
    this.forNeighbors(f, range, (o, d2) => {
      const d = Math.sqrt(d2) || 1e-3;
      const ps = (self.personalSpace + o.personalSpace) * 0.5;
      if (d < ps) {
        const w = (ps - d) / ps;
        sep.x += ((self.position.x - o.position.x) / d) * w * w * 2.2;
        sep.y += ((self.position.y - o.position.y) / d) * w * w * 2.2;
        sep.z += ((self.position.z - o.position.z) / d) * w * w * 2.2;
      }
      if (schooling && o.schoolId === self.schoolId) {
        align.add(o.velocity);
        coh.add(o.position);
        nAlign++;
      }
    });
    if (schooling && nAlign) {
      align.scale(1 / nAlign).sub(f.velocity).scale(0.6);
      coh.scale(1 / nAlign).sub(f.position).scale(0.35);
      school.add(align).add(coh);
    }

    // territory preference
    terr.set(0, 0, 0);
    if (f.homeTerritory) {
      const r = (b.territoryRadius || 1) * f.territoryScale;
      terr.subOf(f.homeTerritory, f.position);
      const d = terr.len();
      terr.scale(d > r ? ((d - r) / d) * 0.8 : 0);
    }
    // reef-loving fish drift down toward the reef when well above their band
    if (b.reefAffinity > 0.5 && f.position.y > b.zone[1]) terr.y -= (f.position.y - b.zone[1]) * 0.3;
    if (f.position.y < b.zone[0]) terr.y += (b.zone[0] - f.position.y) * 0.4;

    // wandering: smooth, individual, slowly varying
    const tw = this.time;
    wander.set(
      Math.sin(tw * f.wanderFreq[0] * TAU + f.wanderSeed[0]) + 0.5 * Math.sin(tw * f.wanderFreq[1] * 2.7 + f.wanderSeed[1]),
      0.4 * Math.sin(tw * f.wanderFreq[1] * TAU + f.wanderSeed[2]),
      Math.sin(tw * f.wanderFreq[2] * TAU + f.wanderSeed[1]) + 0.5 * Math.sin(tw * f.wanderFreq[0] * 3.1 + f.wanderSeed[2]),
    ).scale(b.wander * 0.25 * (f.behaviorState === 'HOVERING' || f.behaviorState === 'RESTING' ? 0.4 : 1));

    // combine
    F.set(0, 0, 0)
      .addScaled(seek, schooling ? 0.35 : 1.0)
      .addScaled(avoid, 1.6)
      .addScaled(sep, 1.0)
      .addScaled(terr, 1.0)
      .addScaled(this.current, 0.15)
      .addScaled(wander, 1.0)
      .addScaled(school, 1.0);
    f.acceleration.copy(F).clampLen(b.accel * (f.behaviorState === 'AVOIDING' ? 2.2 : 1));

    // intent: where the fish wants its velocity to be shortly. The current heading carries
    // some weight even at low speed, so small or noisy forces cannot swing a slow fish around.
    const intent = this.t[11].copy(f.velocity).addScaled(f.acceleration, 0.8);
    let iSpeed = intent.len();
    intent.addScaled(f.heading, f.preferredSpeed * 0.35 * speedMul);
    const iLen = intent.len();
    if (iLen > 1e-4) intent.scale(1 / iLen); else intent.copy(f.heading);
    // keep mostly level; climbing and diving happen at shallow angles
    intent.y = clamp(intent.y, -0.45, 0.45);
    intent.normalize();

    // turn the heading toward the intent at a limited rate
    const cosA = clamp(f.heading.dot(intent), -1, 1);
    const angle = Math.acos(cosA);
    const hovering = f.behaviorState === 'HOVERING' || f.behaviorState === 'RESTING';
    const avoiding = f.behaviorState === 'AVOIDING';
    const speedK = avoiding ? 1 : 0.35 + 0.65 * clamp(f.speed / Math.max(1e-3, f.preferredSpeed * speedMul), 0, 1);
    const maxTurn = f.turnRate * dt * speedK * (hovering ? 0.5 : 1) * (avoiding ? 1.4 : 1) * clamp(f.aggression, 0.6, 1.3);
    const prev = probe.copy(f.heading);
    if (angle > 1e-4) {
      const axis = seek.crossOf(f.heading, intent);
      if (axis.lenSq() < 1e-8 || angle > 2.8) axis.copy(UP).scale(f.yawRate >= 0 ? 1 : -1);
      axis.normalize();
      rotate(f.heading, axis, Math.min(angle, maxTurn));
      f.heading.normalize();
    }
    // signed yaw rate about world up
    const cr = sep.crossOf(prev, f.heading);
    const yaw = Math.asin(clamp(cr.y / Math.max(1e-4, Math.hypot(prev.x, prev.z) * Math.hypot(f.heading.x, f.heading.z)), -1, 1));
    f.yawRate = lerp(f.yawRate, yaw / Math.max(dt, 1e-4), clamp(dt * 6, 0, 1));

    // decelerate into sharp turns, accelerate gently out of them
    const minSpeed = hovering ? 0.0 : f.preferredSpeed * 0.25 * speedMul;
    let target = clamp(iSpeed, minSpeed, f.maximumSpeed * speedMul);
    target *= 0.3 + 0.7 * Math.max(0, cosA) ** 1.5;
    const acc = b.accel * (target < f.speed ? 1.6 : 1);
    f.speed += clamp(target - f.speed, -acc * dt, acc * dt);
    f.speed = Math.max(0, f.speed);

    f.velocity.copy(f.heading).scale(f.speed);
    f.position.addScaled(f.velocity, dt).addScaled(this.current, dt * 0.06);
    this.constrain(f);
  }

  // Hard constraint: push the body out of rock and coral, keep it inside the tank.
  constrain(f) {
    const reef = this.reef, g = this.g, p = this.t[8];
    for (let k = 0; k < 3; k++) {
      const s = k === 0 ? 0.4 : k === 1 ? 0 : -0.42;
      p.copy(f.position).addScaled(f.heading, s * f.bodyLength);
      const val = reef.obstacle.sample(p.x, p.y, p.z);
      if (val < ISO * 0.2) continue;
      reef.obstacle.gradient(p.x, p.y, p.z, g);
      const gl = Math.hypot(g.x, g.y, g.z);
      if (gl < 1e-4) continue;
      const allowed = ISO - gl * f.clearance;
      if (val > allowed) {
        const push = Math.min(0.08, (val - allowed) / gl);
        f.position.x -= (g.x / gl) * push; f.position.y -= (g.y / gl) * push; f.position.z -= (g.z / gl) * push;
        const into = (f.velocity.x * g.x + f.velocity.y * g.y + f.velocity.z * g.z) / gl;
        if (into < 0) f.velocity.addScaled(g, -into / gl);
      }
    }
    const B = FISH_BOUNDS, half = f.bodyLength * 0.5;
    f.position.x = clamp(f.position.x, B.xMin, B.xMax);
    f.position.z = clamp(f.position.z, B.zMin, B.zMax - half * Math.abs(f.heading.z));
    const sandY = reef.sandHeight(f.position.x, f.position.z) + f.clearance + 0.05;
    f.position.y = clamp(f.position.y, sandY, B.yMax);
  }

  resolveOverlaps() {
    const n = this.fish.length;
    for (let i = 0; i < n; i++) {
      const a = this.fish[i];
      if (a.species === 'morayEel') continue;
      this.forNeighbors(a, 1.2, (b, d2) => {
        if (b.index < a.index || b.species === 'morayEel') return;
        const minD = (a.radius + b.radius) * 1.05;
        if (d2 >= minD * minD) return;
        const d = Math.sqrt(d2) || 1e-3;
        const push = (minD - d) * 0.5;
        const dx = (a.position.x - b.position.x) / d, dy = (a.position.y - b.position.y) / d, dz = (a.position.z - b.position.z) / d;
        a.position.x += dx * push; a.position.y += dy * push; a.position.z += dz * push;
        b.position.x -= dx * push; b.position.y -= dy * push; b.position.z -= dz * push;
      });
    }
  }

  // ---- moray ------------------------------------------------------------------------------
  updateMoray(f, dt) {
    if (this.time >= f.stateUntil) this.chooseState(f);
    const m = this.reef.moray;
    const want = { RESTING: 0.06, HOVERING: 0.16, EXPLORING: 0.42, SEEKING_SHELTER: -0.3 }[f.behaviorState] ?? 0.1;
    const prevExt = f.extension;
    f.extension += clamp(want - f.extension, -0.07 * dt, 0.07 * dt);
    const moving = Math.abs(f.extension - prevExt) / Math.max(dt, 1e-4);
    f.speed = moving;
    const t = this.time;
    const look = f.behaviorState === 'EXPLORING' ? 1 : 0.45;
    f.headYaw = lerp(f.headYaw, look * (0.45 * Math.sin(t * 0.21 + f.wanderSeed[0]) + 0.2 * Math.sin(t * 0.53 + f.wanderSeed[1])), clamp(dt * 1.5, 0, 1));
    f.heading.set(...m.dirOut);
    f.position.set(m.mouth[0] + m.dirOut[0] * f.extension, m.mouth[1] + m.dirOut[1] * f.extension, m.mouth[2] + m.dirOut[2] * f.extension);
    f.position.y += 0.03 * Math.sin(t * 0.37 + f.wanderSeed[2]);
    // steady rhythmic breathing through the open mouth
    f.gape = 0.12 + 0.13 * (0.5 + 0.5 * Math.sin(t * 1.7 + f.wanderSeed[1]));
    f.velocity.copy(f.heading).scale(moving);
  }

  // ---- procedural animation parameters ----------------------------------------------------
  animate(f, dt) {
    const a = f.def.anim, b = f.def.behavior;
    const ratio = clamp(f.speed / Math.max(0.05, b.speed), 0, 2.2);
    const turn = clamp(Math.abs(f.yawRate) / Math.max(0.3, f.turnRate), 0, 1.5);
    let freq = f.tailFrequency, amp = a.tailAmp, pecAmp = f.finAmplitude, pecFreq = a.pecFreq;
    switch (a.style) {
      case 0: // body-and-tail swimmers: tail beat follows speed
        freq *= 0.45 + 0.55 * ratio; amp *= 0.35 + 0.55 * Math.min(ratio, 1.4) + turn * 0.5;
        pecAmp *= 0.6 + 0.6 * Math.max(0, 1 - ratio * 0.6); break;
      case 1: // tangs and angels row with the pectorals; the tail joins in at speed
        freq *= 0.5 + 0.5 * ratio; amp *= 0.15 + 0.75 * clamp(ratio - 0.3, 0, 1.4) + turn * 0.45;
        pecAmp *= 0.5 + 0.7 * Math.max(0, 1.2 - ratio * 0.5); pecFreq *= 0.7 + 0.4 * ratio; break;
      case 2: // triggerfish undulate dorsal and anal fins
        freq *= 0.5 + 0.5 * ratio; amp *= 0.25 + 0.6 * clamp(ratio - 0.6, 0, 1.5) + turn * 0.4; break;
      case 3: // lionfish: slow fanning, almost no tail
        freq *= 0.6 + 0.4 * ratio; amp *= 0.4 + 0.6 * ratio + turn * 0.6; break;
      case 4: // moray: gentle undulation while moving, held still otherwise
        freq *= 0.4 + 2.5 * clamp(f.speed * 10, 0, 1); amp *= 0.15 + 0.85 * clamp(f.speed * 10, 0, 1); break;
    }
    f.tailAmp = lerp(f.tailAmp, amp, clamp(dt * 2.5, 0, 1));
    f.pecAmp = lerp(f.pecAmp, pecAmp, clamp(dt * 2, 0, 1));
    f.animationPhase = (f.animationPhase + TAU * freq * dt) % (TAU * 1000);
    f.pecPhase = (f.pecPhase + TAU * pecFreq * dt) % (TAU * 1000);
    f.dorsalPhase = (f.dorsalPhase + TAU * (1.6 + ratio) * dt) % (TAU * 1000);
    if (f.species === 'morayEel') {
      f.bend = f.headYaw;
    } else {
      f.bend = lerp(f.bend, clamp(-f.yawRate * 0.35, -0.7, 0.7), clamp(dt * 4, 0, 1));
      f.roll = lerp(f.roll, clamp(f.yawRate * 0.22, -0.3, 0.3) + 0.04 * Math.sin(f.animationPhase * 0.5), clamp(dt * 3, 0, 1));
    }
    // up vector: world up made perpendicular to the heading, then rolled into the turn
    const h = f.heading, up = f.up;
    up.copy(UP).addScaled(h, -h.y).normalize();
    rotate(up, h, f.roll);
    // light reaching the fish: dimmer in caves and under overhangs
    const o = this.reef.field, p = f.position;
    const occ = clamp((o.sample(p.x, p.y + 0.6, p.z) + o.sample(p.x, p.y + 1.4, p.z) + o.sample(p.x, p.y + 2.4, p.z) + 0.5 * o.sample(p.x + 0.5, p.y + 0.3, p.z) + 0.5 * o.sample(p.x - 0.5, p.y + 0.3, p.z)) / (ISO * 3), 0, 1);
    f.envLight = lerp(f.envLight, 1 - 0.75 * occ, clamp(dt * 2, 0, 1));
  }

  // 20 floats per fish, grouped by species (see js/wgsl/fish.js for the layout)
  writeInstances(bySpecies) {
    for (const key in bySpecies) bySpecies[key].count = 0;
    for (const f of this.fish) {
      const slot = bySpecies[f.species];
      if (!slot) continue;
      const o = slot.count++ * 20, d = slot.data;
      d[o] = f.position.x; d[o + 1] = f.position.y; d[o + 2] = f.position.z; d[o + 3] = f.bodyLength;
      d[o + 4] = f.heading.x; d[o + 5] = f.heading.y; d[o + 6] = f.heading.z; d[o + 7] = f.animationPhase;
      d[o + 8] = f.up.x; d[o + 9] = f.up.y; d[o + 10] = f.up.z; d[o + 11] = f.tailAmp;
      d[o + 12] = f.bend; d[o + 13] = f.pecPhase; d[o + 14] = f.pecAmp; d[o + 15] = clamp(-f.yawRate * 0.5, -1, 1);
      d[o + 16] = f.variant; d[o + 17] = f.envLight; d[o + 18] = f.gape; d[o + 19] = f.dorsalPhase;
    }
  }
}

// Rodrigues rotation of v about a unit axis.
function rotate(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const d = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  const cx = axis.y * v.z - axis.z * v.y, cy = axis.z * v.x - axis.x * v.z, cz = axis.x * v.y - axis.y * v.x;
  v.set(v.x * c + cx * s + axis.x * d * (1 - c), v.y * c + cy * s + axis.y * d * (1 - c), v.z * c + cz * s + axis.z * d * (1 - c));
  return v;
}
