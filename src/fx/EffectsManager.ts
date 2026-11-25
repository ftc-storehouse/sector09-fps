import * as THREE from 'three';
import type { PBRMaterialTextures } from '../core/ProceduralTextures';
import type { AudioEngine } from '../core/AudioEngine';
import type { SurfaceMaterialType } from '../types';

interface ShellItem {
  active: boolean;
  resting: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  angVel: THREE.Vector3;
  bounces: number;
  age: number;
}

interface SparkItem {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  color: THREE.Color;
  life: number;
  maxLife: number;
  size: number;
}

interface ShardItem {
  active: boolean;
  resting: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  angVel: THREE.Vector3;
  scale: number;
  age: number;
}

interface SmokeItem {
  active: boolean;
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
  baseOpacity: number;
}

interface TracerItem {
  active: boolean;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  start: THREE.Vector3;
  end: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface DecalItem {
  mesh: THREE.Mesh;
  emberMat?: THREE.MeshBasicMaterial;
  heat: number;
}

export class EffectsManager {
  private scene: THREE.Scene;
  private audio: AudioEngine;
  private textures: PBRMaterialTextures;

  // Instanced Brass Casings
  private readonly MAX_SHELLS = 140;
  private shellInst: THREE.InstancedMesh;
  private shells: ShellItem[] = [];
  private shellCursor = 0;

  // Instanced Sparks
  private readonly MAX_SPARKS = 320;
  private sparkInst: THREE.InstancedMesh;
  private sparks: SparkItem[] = [];
  private sparkCursor = 0;

  // Instanced Glass Shards
  private readonly MAX_SHARDS = 140;
  private shardInst: THREE.InstancedMesh;
  private shards: ShardItem[] = [];
  private shardCursor = 0;

  // Pooled Smoke Sprites
  private readonly MAX_SMOKE = 130;
  private smokes: SmokeItem[] = [];
  private smokeCursor = 0;

  // Pooled Bullet Tracers
  private readonly MAX_TRACERS = 36;
  private tracers: TracerItem[] = [];
  private tracerCursor = 0;

  // Ring-buffer Decals
  private readonly MAX_DECALS = 160;
  private decals: DecalItem[] = [];
  private decalCursor = 0;

  // Dynamic Explosion / Spark Flash Lights
  private flashLights: { light: THREE.PointLight; life: number; maxLife: number; peak: number }[] = [];

  // Floating Ambient Dust Motes
  private dustPoints!: THREE.Points;

  private dummy = new THREE.Object3D();
  private tmpVec = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private upAxis = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, textures: PBRMaterialTextures, audio: AudioEngine) {
    this.scene = scene;
    this.textures = textures;
    this.audio = audio;

    // 1. 5.56x45mm Brass Shell Casing Geometry (lathe tapered bottleneck)
    const lathePts = [
      new THREE.Vector2(0.0049, -0.022),
      new THREE.Vector2(0.0049, -0.019),
      new THREE.Vector2(0.0042, -0.018),
      new THREE.Vector2(0.0048, -0.016),
      new THREE.Vector2(0.0046, 0.009),
      new THREE.Vector2(0.0031, 0.015),
      new THREE.Vector2(0.0031, 0.022)
    ];
    const shellGeo = new THREE.LatheGeometry(lathePts, 10);
    shellGeo.rotateX(Math.PI * 0.5);
    const shellMat = new THREE.MeshStandardMaterial({
      color: 0xe8bc62,
      metalness: 0.94,
      roughness: 0.20
    });
    this.shellInst = new THREE.InstancedMesh(shellGeo, shellMat, this.MAX_SHELLS);
    this.shellInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shellInst.frustumCulled = false;
    this.scene.add(this.shellInst);

    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.MAX_SHELLS; i++) {
      this.shellInst.setMatrixAt(i, zeroMat);
      this.shells.push({
        active: false,
        resting: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        angVel: new THREE.Vector3(),
        bounces: 0,
        age: 0
      });
    }

    // 2. HDR Glowing Spark Streaks
    const sparkGeo = new THREE.BoxGeometry(0.009, 0.09, 0.009);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.sparkInst = new THREE.InstancedMesh(sparkGeo, sparkMat, this.MAX_SPARKS);
    this.sparkInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparkInst.frustumCulled = false;
    this.scene.add(this.sparkInst);

    const white = new THREE.Color(3.5, 2.0, 0.7);
    for (let i = 0; i < this.MAX_SPARKS; i++) {
      this.sparkInst.setMatrixAt(i, zeroMat);
      this.sparkInst.setColorAt(i, white);
      this.sparks.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        color: new THREE.Color(3.5, 2.1, 0.8),
        life: 0,
        maxLife: 0.4,
        size: 1
      });
    }

    // 3. Shattered Tempered Glass Shards
    const shardGeo = new THREE.TetrahedronGeometry(0.055, 0);
    shardGeo.scale(1.2, 0.22, 0.9);
    const shardMat = new THREE.MeshPhysicalMaterial({
      color: 0xbbe8ff,
      metalness: 0.1,
      roughness: 0.08,
      transmission: 0.65,
      transparent: true,
      opacity: 0.78
    });
    this.shardInst = new THREE.InstancedMesh(shardGeo, shardMat, this.MAX_SHARDS);
    this.shardInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardInst.frustumCulled = false;
    this.scene.add(this.shardInst);

    for (let i = 0; i < this.MAX_SHARDS; i++) {
      this.shardInst.setMatrixAt(i, zeroMat);
      this.shards.push({
        active: false,
        resting: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        angVel: new THREE.Vector3(),
        scale: 1,
        age: 0
      });
    }

    // 4. Smoke / Steam / Fireball Pool
    for (let i = 0; i < this.MAX_SMOKE; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.textures.smokeSprite,
        color: 0xc8d6e5,
        transparent: true,
        opacity: 0,
        depthWrite: false
      });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      this.scene.add(sp);
      this.smokes.push({
        active: false,
        sprite: sp,
        mat,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        startScale: 0.2,
        endScale: 1.0,
        baseOpacity: 0.3
      });
    }

    // 5. Bullet Tracers Pool
    const trGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 1.0, 5);
    trGeo.rotateX(Math.PI * 0.5);
    for (let i = 0; i < this.MAX_TRACERS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(4.0, 2.6, 1.1),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const m = new THREE.Mesh(trGeo, mat);
      m.visible = false;
      m.frustumCulled = false;
      this.scene.add(m);
      this.tracers.push({
        active: false,
        mesh: m,
        mat,
        start: new THREE.Vector3(),
        end: new THREE.Vector3(),
        life: 0,
        maxLife: 0.055
      });
    }

    // 6. Decal Pool
    const decGeo = new THREE.PlaneGeometry(0.13, 0.13);
    for (let i = 0; i < this.MAX_DECALS; i++) {
      const decMat = new THREE.MeshStandardMaterial({
        map: this.textures.bulletHoleAlbedo,
        normalMap: this.textures.bulletHoleNormal,
        transparent: true,
        roughness: 0.85,
        metalness: 0.2,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3
      });
      const m = new THREE.Mesh(decGeo, decMat);
      m.visible = false;

      // Hot glowing ember core inside fresh bullet crater
      const emMat = new THREE.MeshBasicMaterial({
        map: this.textures.glowSprite,
        color: new THREE.Color(3.2, 1.2, 0.25),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4
      });
      const ember = new THREE.Mesh(new THREE.PlaneGeometry(0.065, 0.065), emMat);
      m.add(ember);

      this.scene.add(m);
      this.decals.push({ mesh: m, emberMat: emMat, heat: 0 });
    }

    // 7. Pooled Dynamic Flash Lights
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xff9933, 0, 12, 2);
      l.visible = false;
      this.scene.add(l);
      this.flashLights.push({ light: l, life: 0, maxLife: 0.1, peak: 8 });
    }

    // 8. Atmospheric Floating Illuminated Dust Motes
    const dustCount = 420;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 28;
      dustPos[i * 3 + 1] = 0.25 + Math.random() * 4.9;
      dustPos[i * 3 + 2] = 6 - Math.random() * 40;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      map: this.textures.glowSprite,
      color: 0xa8d4ff,
      size: 0.045,
      transparent: true,
      opacity: 0.36,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.dustPoints = new THREE.Points(dustGeo, dustMat);
    this.scene.add(this.dustPoints);
  }

  public spawnShellCasing(worldPos: THREE.Vector3, ejectVel: THREE.Vector3): void {
    const s = this.shells[this.shellCursor];
    this.shellCursor = (this.shellCursor + 1) % this.MAX_SHELLS;
    s.active = true;
    s.resting = false;
    s.pos.copy(worldPos);
    s.vel.copy(ejectVel);
    s.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    s.angVel.set((Math.random() - 0.5) * 34, (Math.random() - 0.5) * 34, (Math.random() - 0.5) * 34);
    s.bounces = 0;
    s.age = 0;
  }

  public spawnSparks(
    origin: THREE.Vector3,
    normal: THREE.Vector3,
    count: number,
    colorHex = 0xffaa44,
    speed = 6.5
  ): void {
    const hdrCol = new THREE.Color(colorHex).multiplyScalar(3.4);
    for (let i = 0; i < count; i++) {
      const sp = this.sparks[this.sparkCursor];
      this.sparkCursor = (this.sparkCursor + 1) % this.MAX_SPARKS;
      sp.active = true;
      sp.pos.copy(origin).addScaledVector(normal, 0.02);
      sp.vel
        .set(
          normal.x + (Math.random() - 0.5) * 1.45,
          normal.y + Math.random() * 0.95,
          normal.z + (Math.random() - 0.5) * 1.45
        )
        .normalize()
        .multiplyScalar(speed * (0.45 + Math.random() * 0.9));
      sp.color.copy(hdrCol);
      sp.maxLife = 0.16 + Math.random() * 0.32;
      sp.life = sp.maxLife;
      sp.size = 0.65 + Math.random() * 0.85;
      this.sparkInst.setColorAt((this.sparkCursor + this.MAX_SPARKS - 1) % this.MAX_SPARKS, sp.color);
    }
    if (this.sparkInst.instanceColor) this.sparkInst.instanceColor.needsUpdate = true;
  }

  public spawnGlassShatter(center: THREE.Vector3, halfExtents: THREE.Vector3, count = 36): void {
    for (let i = 0; i < count; i++) {
      const sh = this.shards[this.shardCursor];
      this.shardCursor = (this.shardCursor + 1) % this.MAX_SHARDS;
      sh.active = true;
      sh.resting = false;
      sh.pos.set(
        center.x + (Math.random() - 0.5) * halfExtents.x * 1.8,
        center.y + (Math.random() - 0.5) * halfExtents.y * 1.8,
        center.z + (Math.random() - 0.5) * halfExtents.z * 1.8
      );
      sh.vel.set((Math.random() - 0.5) * 4.2, 0.8 + Math.random() * 2.4, (Math.random() - 0.5) * 4.2);
      sh.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      sh.angVel.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
      sh.scale = 0.6 + Math.random() * 1.1;
      sh.age = 0;
    }
  }

  public spawnSmoke(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    startScale = 0.16,
    endScale = 0.95,
    maxLife = 0.9,
    color = 0xc9d6e4,
    opacity = 0.28,
    additive = false
  ): void {
    const s = this.smokes[this.smokeCursor];
    this.smokeCursor = (this.smokeCursor + 1) % this.MAX_SMOKE;
    s.active = true;
    s.sprite.visible = true;
    s.sprite.position.copy(pos);
    s.vel.copy(vel);
    s.startScale = startScale;
    s.endScale = endScale;
    s.maxLife = maxLife;
    s.life = maxLife;
    s.baseOpacity = opacity;
    s.mat.color.setHex(color);
    s.mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.mat.rotation = Math.random() * Math.PI * 2;
    s.sprite.scale.setScalar(startScale);
  }

  public spawnTracer(start: THREE.Vector3, end: THREE.Vector3, isEnemy = false): void {
    const tr = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.MAX_TRACERS;
    tr.active = true;
    tr.start.copy(start);
    tr.end.copy(end);
    tr.maxLife = isEnemy ? 0.085 : 0.048;
    tr.life = tr.maxLife;
    tr.mat.color.setRGB(isEnemy ? 4.5 : 3.8, isEnemy ? 0.65 : 2.5, isEnemy ? 0.45 : 1.0);

    const dist = start.distanceTo(end);
    tr.mesh.visible = dist > 0.4;
    tr.mesh.position.copy(start).lerp(end, 0.5);
    tr.mesh.scale.set(isEnemy ? 1.45 : 1.0, isEnemy ? 1.45 : 1.0, dist);
    tr.mesh.lookAt(end);
  }

  public spawnDecal(point: THREE.Vector3, normal: THREE.Vector3, scorch = false, hotMetal = false): void {
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.MAX_DECALS;
    d.mesh.visible = true;
    d.mesh.position.copy(point).addScaledVector(normal, 0.006);
    this.tmpVec.copy(point).add(normal);
    d.mesh.lookAt(this.tmpVec);
    d.mesh.rotateZ(Math.random() * Math.PI * 2);

    const mat = d.mesh.material as THREE.MeshStandardMaterial;
    if (scorch) {
      mat.map = this.textures.scorchTexture;
      mat.normalMap = null;
      d.mesh.scale.setScalar(16 + Math.random() * 5);
      d.heat = 0;
    } else {
      mat.map = this.textures.bulletHoleAlbedo;
      mat.normalMap = this.textures.bulletHoleNormal;
      d.mesh.scale.setScalar(0.85 + Math.random() * 0.45);
      d.heat = hotMetal ? 1.0 : 0.45;
    }
    mat.needsUpdate = true;
  }

  public spawnFlashLight(pos: THREE.Vector3, colorHex: number, intensity: number, duration: number, distance = 12): void {
    let slot = this.flashLights.find((f) => f.life <= 0);
    if (!slot) slot = this.flashLights[0];
    slot.light.position.copy(pos);
    slot.light.color.setHex(colorHex);
    slot.light.intensity = intensity;
    slot.light.distance = distance;
    slot.light.visible = true;
    slot.maxLife = duration;
    slot.life = duration;
    slot.peak = intensity;
  }

  public spawnSurfaceImpact(point: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceMaterialType): void {
    if (surface === 'metal' || surface === 'steam_pipe' || surface === 'hazard_canister' || surface === 'enemy_armor') {
      this.spawnSparks(point, normal, 18, 0xffb048, 8.2);
      this.spawnDecal(point, normal, false, true);
      this.spawnFlashLight(this.tmpVec.copy(point).addScaledVector(normal, 0.12), 0xff9a38, 3.2, 0.055, 4.5);
    } else if (surface === 'enemy_head' || surface === 'enemy_core') {
      this.spawnSparks(point, normal, 28, 0x38e8ff, 9.5);
      this.spawnFlashLight(point, 0x38e8ff, 5.5, 0.08, 6.0);
    } else if (surface === 'glass' || surface === 'light_fixture') {
      this.spawnSparks(point, normal, 12, 0x99eeff, 5.5);
    } else {
      // Concrete dust + occasional aggregate ricochet sparks
      this.spawnDecal(point, normal, false, false);
      this.spawnSparks(point, normal, 6, 0xffaa55, 5.0);
      this.spawnSmoke(
        this.tmpVec.copy(point).addScaledVector(normal, 0.06),
        new THREE.Vector3(normal.x * 0.8, 0.45 + Math.random() * 0.5, normal.z * 0.8),
        0.14,
        0.72,
        0.55,
        0x9aa6b2,
        0.32
      );
    }
  }

  public spawnExplosion(pos: THREE.Vector3): void {
    this.audio.playExplosion();
    this.spawnFlashLight(new THREE.Vector3(pos.x, pos.y + 0.5, pos.z), 0xff7722, 34, 0.34, 22);
    this.spawnSparks(pos, this.upAxis, 75, 0xff9933, 13.5);
    this.spawnDecal(new THREE.Vector3(pos.x, 0.005, pos.z), this.upAxis, true, false);

    // Multi-layered fireball + dark rising smoke plume
    for (let i = 0; i < 12; i++) {
      this.spawnSmoke(
        new THREE.Vector3(pos.x + (Math.random() - 0.5) * 0.9, pos.y + Math.random() * 0.7, pos.z + (Math.random() - 0.5) * 0.9),
        new THREE.Vector3((Math.random() - 0.5) * 3.5, 1.8 + Math.random() * 3.2, (Math.random() - 0.5) * 3.5),
        0.55,
        2.6,
        0.42 + Math.random() * 0.25,
        i < 7 ? 0xff8828 : 0xffcc66,
        0.78,
        true
      );
    }
    for (let i = 0; i < 14; i++) {
      this.spawnSmoke(
        new THREE.Vector3(pos.x + (Math.random() - 0.5) * 1.2, pos.y + 0.3, pos.z + (Math.random() - 0.5) * 1.2),
        new THREE.Vector3((Math.random() - 0.5) * 2.2, 1.2 + Math.random() * 2.0, (Math.random() - 0.5) * 2.2),
        0.65,
        3.4,
        1.4 + Math.random() * 0.8,
        0x22262c,
        0.48,
        false
      );
    }
  }

  public update(dt: number, elapsed: number): void {
    // 1. Update Brass Shell Casings
    let shellsDirty = false;
    for (let i = 0; i < this.MAX_SHELLS; i++) {
      const s = this.shells[i];
      if (!s.active || s.resting) continue;
      shellsDirty = true;
      s.age += dt;
      s.vel.y -= 9.81 * dt;
      s.pos.addScaledVector(s.vel, dt);
      s.rot.x += s.angVel.x * dt;
      s.rot.y += s.angVel.y * dt;
      s.rot.z += s.angVel.z * dt;

      const floorY = s.pos.z < -24.5 ? 0.662 : 0.012;
      if (s.pos.y <= floorY) {
        s.pos.y = floorY;
        s.vel.y = Math.abs(s.vel.y) * 0.42;
        s.vel.x *= 0.68;
        s.vel.z *= 0.68;
        s.angVel.multiplyScalar(0.55);
        if (s.bounces < 2 && s.vel.y > 0.35) {
          this.audio.playShellBounce(s.bounces === 0 ? 0.065 : 0.03);
        }
        s.bounces++;
        if (s.bounces > 4 || (Math.abs(s.vel.y) < 0.2 && s.vel.lengthSq() < 0.05)) {
          s.resting = true;
          s.rot.x = 0;
          s.rot.z = Math.PI * 0.5;
        }
      }

      this.dummy.position.copy(s.pos);
      this.dummy.rotation.copy(s.rot);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.shellInst.setMatrixAt(i, this.dummy.matrix);
    }
    if (shellsDirty) this.shellInst.instanceMatrix.needsUpdate = true;

    // 2. Update Sparks
    let sparksDirty = false;
    for (let i = 0; i < this.MAX_SPARKS; i++) {
      const sp = this.sparks[i];
      if (!sp.active) continue;
      sparksDirty = true;
      sp.life -= dt;
      if (sp.life <= 0) {
        sp.active = false;
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.sparkInst.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      sp.vel.y -= 13.5 * dt;
      sp.pos.addScaledVector(sp.vel, dt);
      const floorY = sp.pos.z < -24.5 ? 0.66 : 0.01;
      if (sp.pos.y < floorY) {
        sp.pos.y = floorY;
        sp.vel.y = Math.abs(sp.vel.y) * 0.48;
        sp.vel.x *= 0.78;
        sp.vel.z *= 0.78;
      }

      const speed = sp.vel.length();
      const lifeRatio = sp.life / sp.maxLife;
      this.dummy.position.copy(sp.pos);
      if (speed > 0.05) {
        this.tmpVec.copy(sp.vel).divideScalar(speed);
        this.tmpQuat.setFromUnitVectors(this.upAxis, this.tmpVec);
        this.dummy.quaternion.copy(this.tmpQuat);
      }
      this.dummy.scale.set(sp.size * lifeRatio, Math.max(0.35, speed * 0.22) * sp.size, sp.size * lifeRatio);
      this.dummy.updateMatrix();
      this.sparkInst.setMatrixAt(i, this.dummy.matrix);
    }
    if (sparksDirty) this.sparkInst.instanceMatrix.needsUpdate = true;

    // 3. Update Glass Shards
    let shardsDirty = false;
    for (let i = 0; i < this.MAX_SHARDS; i++) {
      const sh = this.shards[i];
      if (!sh.active || sh.resting) continue;
      shardsDirty = true;
      sh.age += dt;
      sh.vel.y -= 11.0 * dt;
      sh.pos.addScaledVector(sh.vel, dt);
      sh.rot.x += sh.angVel.x * dt;
      sh.rot.y += sh.angVel.y * dt;
      sh.rot.z += sh.angVel.z * dt;
      const floorY = sh.pos.z < -24.5 ? 0.665 : 0.015;
      if (sh.pos.y <= floorY) {
        sh.pos.y = floorY;
        sh.vel.y = Math.abs(sh.vel.y) * 0.3;
        sh.vel.x *= 0.6;
        sh.vel.z *= 0.6;
        if (Math.abs(sh.vel.y) < 0.25) {
          sh.resting = true;
          sh.rot.x = Math.PI * 0.5;
        }
      }
      this.dummy.position.copy(sh.pos);
      this.dummy.rotation.copy(sh.rot);
      this.dummy.scale.setScalar(sh.scale);
      this.dummy.updateMatrix();
      this.shardInst.setMatrixAt(i, this.dummy.matrix);
    }
    if (shardsDirty) this.shardInst.instanceMatrix.needsUpdate = true;

    // 4. Update Smoke / Steam Billboards
    for (const s of this.smokes) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.sprite.visible = false;
        continue;
      }
      const p = 1.0 - s.life / s.maxLife;
      s.sprite.position.addScaledVector(s.vel, dt);
      s.vel.multiplyScalar(1.0 - Math.min(0.9, dt * 1.9));
      s.sprite.scale.setScalar(THREE.MathUtils.lerp(s.startScale, s.endScale, p));
      const fadeIn = Math.min(1, p * 5);
      const fadeOut = Math.pow(1 - p, 1.4);
      s.mat.opacity = s.baseOpacity * fadeIn * fadeOut;
      s.mat.rotation += dt * 0.45;
    }

    // 5. Update Tracers
    for (const tr of this.tracers) {
      if (!tr.active) continue;
      tr.life -= dt;
      if (tr.life <= 0) {
        tr.active = false;
        tr.mesh.visible = false;
      } else {
        tr.mat.opacity = (tr.life / tr.maxLife) * 0.85;
      }
    }

    // 6. Cool down molten bullet craters
    for (const d of this.decals) {
      if (d.heat > 0 && d.emberMat) {
        d.heat = Math.max(0, d.heat - dt * 0.65);
        d.emberMat.opacity = d.heat * 0.9;
      }
    }

    // 7. Flash Lights
    for (const fl of this.flashLights) {
      if (fl.life > 0) {
        fl.life -= dt;
        if (fl.life <= 0) {
          fl.light.visible = false;
          fl.light.intensity = 0;
        } else {
          fl.light.intensity = fl.peak * (fl.life / fl.maxLife);
        }
      }
    }

    // 8. Gentle drift of illuminated dust motes
    this.dustPoints.position.y = Math.sin(elapsed * 0.35) * 0.08;
    this.dustPoints.position.x = Math.cos(elapsed * 0.22) * 0.12;
  }
}
