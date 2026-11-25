import * as THREE from 'three';
import type { PBRMaterialTextures } from '../core/ProceduralTextures';
import type { AudioEngine } from '../core/AudioEngine';
import type { EffectsManager } from '../fx/EffectsManager';
import type { ColliderBox, SurfaceMaterialType } from '../types';

export type EnemyKind = 'trooper' | 'drone' | 'juggernaut';

export interface EnemyUnit {
  id: string;
  kind: EnemyKind;
  root: THREE.Group;
  hp: number;
  maxHp: number;
  armorHp: number;
  alive: boolean;

  // Articulated sub-parts for animation & armor break-off
  chestArmorMesh?: THREE.Mesh;
  visorMesh?: THREE.Mesh;
  leftLeg?: THREE.Object3D;
  rightLeg?: THREE.Object3D;
  weaponArm?: THREE.Object3D;
  laserBeam?: THREE.Mesh;
  muzzleOffset: THREE.Vector3;

  // AI State
  vel: THREE.Vector3;
  strafeDir: number;
  strafeTimer: number;
  fireCooldown: number;
  burstRemaining: number;
  burstGap: number;
  flinchTimer: number;
  walkPhase: number;
}

interface RagdollChunk {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  life: number;
  resting: boolean;
}

export class EnemyManager {
  public units: EnemyUnit[] = [];
  public enemyHitMeshes: THREE.Object3D[] = [];
  private chunks: RagdollChunk[] = [];

  private scene: THREE.Scene;
  private textures: PBRMaterialTextures;
  private audio: AudioEngine;
  private fx: EffectsManager;
  private idSeq = 0;

  private raycaster = new THREE.Raycaster();

  constructor(scene: THREE.Scene, textures: PBRMaterialTextures, audio: AudioEngine, fx: EffectsManager) {
    this.scene = scene;
    this.textures = textures;
    this.audio = audio;
    this.fx = fx;
  }

  public clearAll(): void {
    for (const u of this.units) {
      this.scene.remove(u.root);
    }
    for (const c of this.chunks) {
      this.scene.remove(c.mesh);
    }
    this.units = [];
    this.enemyHitMeshes = [];
    this.chunks = [];
  }

  public getAliveCount(): number {
    let n = 0;
    for (const u of this.units) if (u.alive) n++;
    return n;
  }

  public spawnWave(wave: number): void {
    if (wave === 1) {
      // Wave 1: Breach Forward Guard (4 Troopers + 1 Recon Drone)
      this.spawnHumanoid('trooper', new THREE.Vector3(-5.8, 0, -8.5));
      this.spawnHumanoid('trooper', new THREE.Vector3(6.2, 0, -9.8));
      this.spawnHumanoid('trooper', new THREE.Vector3(-1.4, 0, -14.2));
      this.spawnHumanoid('trooper', new THREE.Vector3(8.5, 0, -16.0));
      this.spawnDrone(new THREE.Vector3(0.5, 2.5, -12.5));
    } else if (wave === 2) {
      // Wave 2: Flanking Counter-Assault (5 Troopers + 2 Striker Drones)
      this.spawnHumanoid('trooper', new THREE.Vector3(-10.2, 0, -15.5));
      this.spawnHumanoid('trooper', new THREE.Vector3(10.5, 0, -14.8));
      this.spawnHumanoid('trooper', new THREE.Vector3(-3.2, 0, -21.5));
      this.spawnHumanoid('trooper', new THREE.Vector3(4.0, 0, -22.2));
      this.spawnHumanoid('trooper', new THREE.Vector3(0.0, 0.65, -27.0));
      this.spawnDrone(new THREE.Vector3(-6.2, 2.7, -13.0));
      this.spawnDrone(new THREE.Vector3(6.4, 2.8, -18.5));
    } else {
      // Wave 3: Vault Defense — Heavy Juggernaut Commander + Elite Escort + Twin Drones
      this.spawnHumanoid('juggernaut', new THREE.Vector3(0, 0.65, -28.8));
      this.spawnHumanoid('trooper', new THREE.Vector3(-6.8, 0.65, -26.5));
      this.spawnHumanoid('trooper', new THREE.Vector3(6.8, 0.65, -26.5));
      this.spawnHumanoid('trooper', new THREE.Vector3(-9.5, 0, -20.5));
      this.spawnDrone(new THREE.Vector3(-3.5, 3.1, -24.0));
      this.spawnDrone(new THREE.Vector3(3.5, 3.1, -24.0));
    }
  }

  private tagHitbox(mesh: THREE.Object3D, enemyId: string, surface: SurfaceMaterialType): void {
    mesh.userData.enemyId = enemyId;
    mesh.userData.surface = surface;
    this.enemyHitMeshes.push(mesh);
  }

  private spawnHumanoid(kind: 'trooper' | 'juggernaut', pos: THREE.Vector3): void {
    const id = `enemy_${++this.idSeq}`;
    const isBoss = kind === 'juggernaut';
    const scale = isBoss ? 1.18 : 1.0;

    const root = new THREE.Group();
    root.position.copy(pos);
    root.scale.setScalar(scale);

    const chassisMat = new THREE.MeshStandardMaterial({
      color: isBoss ? 0x1e1b1c : 0x222a34,
      normalMap: this.textures.gunmetalNormal,
      metalness: 0.82,
      roughness: 0.38
    });
    const armorMat = new THREE.MeshStandardMaterial({
      color: isBoss ? 0x5c2226 : 0x3b4654,
      normalMap: this.textures.wallNormal,
      metalness: 0.76,
      roughness: 0.34
    });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0xff2233,
      emissive: new THREE.Color(isBoss ? 0xff7711 : 0xff1e2d),
      emissiveIntensity: 3.4,
      roughness: 0.15
    });
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x18e0ff,
      emissive: new THREE.Color(isBoss ? 0xff8811 : 0x18e8ff),
      emissiveIntensity: 2.8,
      roughness: 0.2
    });

    // Pelvis & Spine Torso
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.20, 0.24), chassisMat);
    pelvis.position.y = 0.92;
    pelvis.castShadow = true;
    root.add(pelvis);
    this.tagHitbox(pelvis, id, 'enemy_body');

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.48, 0.26), chassisMat);
    torso.position.y = 1.28;
    torso.castShadow = true;
    root.add(torso);
    this.tagHitbox(torso, id, 'enemy_body');

    // Glowing Inner Power Core (exposed when ceramic chest plate shatters!)
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 12), coreMat);
    core.rotation.x = Math.PI * 0.5;
    core.position.set(0, 1.31, 0.12);
    root.add(core);
    this.tagHitbox(core, id, 'enemy_core');

    // Detachable Ballistic Ceramic Chest Plate
    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.40, 0.09), armorMat);
    chestPlate.position.set(0, 1.30, 0.14);
    chestPlate.castShadow = true;
    root.add(chestPlate);
    this.tagHitbox(chestPlate, id, 'enemy_armor');

    // Shoulder Pauldrons
    for (const s of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.26), armorMat);
      pauldron.position.set(s * 0.32, 1.44, 0);
      pauldron.castShadow = true;
      root.add(pauldron);
      this.tagHitbox(pauldron, id, 'enemy_armor');
    }

    // Angular Tactical Helmet + Glowing Visor (CRITICAL HEADSHOT HITBOX!)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.27, 0.27), armorMat);
    head.position.set(0, 1.69, 0.01);
    head.castShadow = true;
    root.add(head);
    this.tagHitbox(head, id, 'enemy_head');

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.075, 0.04), visorMat);
    visor.position.set(0, 1.70, 0.135);
    root.add(visor);
    this.tagHitbox(visor, id, 'enemy_head');

    // Articulated Legs
    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.12, 0.85, 0);
    const lLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.85, 0.18), chassisMat);
    lLegMesh.position.y = -0.425;
    lLegMesh.castShadow = true;
    leftLeg.add(lLegMesh);
    root.add(leftLeg);
    this.tagHitbox(lLegMesh, id, 'enemy_body');

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.12, 0.85, 0);
    const rLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.85, 0.18), chassisMat);
    rLegMesh.position.y = -0.425;
    rLegMesh.castShadow = true;
    rightLeg.add(rLegMesh);
    root.add(rightLeg);
    this.tagHitbox(rLegMesh, id, 'enemy_body');

    // Weapon Arm + Enemy Tactical Rifle + Visible Sweeping Red Laser Sight!
    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.26, 1.38, 0.05);
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.14, 0.42), chassisMat);
    armMesh.position.set(0, -0.04, 0.16);
    const rifleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.62), armorMat);
    rifleMesh.position.set(-0.08, -0.02, 0.36);
    weaponArm.add(armMesh, rifleMesh);

    const laserGeo = new THREE.CylinderGeometry(0.0014, 0.0028, 11, 5);
    laserGeo.rotateX(Math.PI * 0.5);
    laserGeo.translate(0, 0, 5.5);
    const laserMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.2, 0.22, 0.28),
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const laserBeam = new THREE.Mesh(laserGeo, laserMat);
    laserBeam.position.set(-0.08, 0.01, 0.65);
    weaponArm.add(laserBeam);
    root.add(weaponArm);

    this.scene.add(root);

    this.units.push({
      id,
      kind,
      root,
      hp: isBoss ? 360 : 110,
      maxHp: isBoss ? 360 : 110,
      armorHp: isBoss ? 150 : 48,
      alive: true,
      chestArmorMesh: chestPlate,
      visorMesh: visor,
      leftLeg,
      rightLeg,
      weaponArm,
      laserBeam,
      muzzleOffset: new THREE.Vector3(0.18 * scale, 1.36 * scale, 0.68 * scale),
      vel: new THREE.Vector3(),
      strafeDir: Math.random() < 0.5 ? -1 : 1,
      strafeTimer: 1.0 + Math.random() * 1.5,
      fireCooldown: 0.9 + Math.random() * 0.9,
      burstRemaining: 0,
      burstGap: 0,
      flinchTimer: 0,
      walkPhase: Math.random() * 6
    });
  }

  private spawnDrone(pos: THREE.Vector3): void {
    const id = `enemy_${++this.idSeq}`;
    const root = new THREE.Group();
    root.position.copy(pos);

    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x1d2530,
      normalMap: this.textures.gunmetalNormal,
      metalness: 0.88,
      roughness: 0.28
    });
    const hull = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), hullMat);
    hull.scale.set(1.2, 0.65, 1.3);
    root.add(hull);
    this.tagHitbox(hull, id, 'enemy_armor');

    // Twin Ducted Rotors
    for (const s of [-1, 1]) {
      const duct = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.04, 8, 16), hullMat);
      duct.rotation.x = Math.PI * 0.5;
      duct.position.set(s * 0.44, 0.04, 0);
      root.add(duct);
      this.tagHitbox(duct, id, 'enemy_body');
    }

    // Glowing Crimson Optical Eye (Critical Hitbox!)
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.10, 10, 10),
      new THREE.MeshStandardMaterial({
        color: 0xff2233,
        emissive: new THREE.Color(0xff2233),
        emissiveIntensity: 3.6
      })
    );
    eye.position.set(0, -0.02, 0.30);
    root.add(eye);
    this.tagHitbox(eye, id, 'enemy_head');

    this.scene.add(root);
    this.units.push({
      id,
      kind: 'drone',
      root,
      hp: 68,
      maxHp: 68,
      armorHp: 0,
      alive: true,
      visorMesh: eye,
      muzzleOffset: new THREE.Vector3(0, -0.08, 0.35),
      vel: new THREE.Vector3(),
      strafeDir: Math.random() < 0.5 ? -1 : 1,
      strafeTimer: 1.2,
      fireCooldown: 1.1 + Math.random() * 0.8,
      burstRemaining: 0,
      burstGap: 0,
      flinchTimer: 0,
      walkPhase: Math.random() * 6
    });
  }

  /**
   * Applies bullet hit to an enemy unit; returns { killed, headshot }.
   */
  public applyBulletHit(
    enemyId: string,
    surface: SurfaceMaterialType,
    baseDamage: number,
    hitPoint: THREE.Vector3,
    hitNormal: THREE.Vector3
  ): { killed: boolean; headshot: boolean; unitKind: EnemyKind } {
    const u = this.units.find((e) => e.id === enemyId);
    if (!u || !u.alive) return { killed: false, headshot: false, unitKind: 'trooper' };

    const isHead = surface === 'enemy_head';
    const isCore = surface === 'enemy_core';
    let dmg = baseDamage;

    if (isHead) {
      dmg *= 3.4;
    } else if (isCore) {
      dmg *= 2.4;
    } else if (surface === 'enemy_armor' && u.armorHp > 0) {
      u.armorHp -= baseDamage;
      dmg *= 0.58; // Ceramic plate absorbs kinetic energy until shattered!
      if (u.armorHp <= 0 && u.chestArmorMesh && u.chestArmorMesh.visible) {
        this.detachPiece(u.chestArmorMesh, hitNormal);
        u.chestArmorMesh.visible = false;
        // Remove broken armor plate from future raycasts so shots hit the glowing core behind it!
        const idx = this.enemyHitMeshes.indexOf(u.chestArmorMesh);
        if (idx >= 0) this.enemyHitMeshes.splice(idx, 1);
      }
    }

    u.hp -= dmg;
    u.flinchTimer = 0.16;

    if (u.hp <= 0) {
      this.killUnit(u, isHead, hitPoint, hitNormal);
      return { killed: true, headshot: isHead, unitKind: u.kind };
    }
    return { killed: false, headshot: isHead, unitKind: u.kind };
  }

  public applyExplosionDamage(center: THREE.Vector3, radius: number, maxDamage: number): { kills: number } {
    let kills = 0;
    for (const u of this.units) {
      if (!u.alive) continue;
      const unitCenter = u.root.position.clone().add(new THREE.Vector3(0, u.kind === 'drone' ? 0 : 1.0, 0));
      const d = unitCenter.distanceTo(center);
      if (d < radius) {
        const falloff = 1.0 - d / radius;
        u.hp -= maxDamage * falloff;
        if (u.hp <= 0) {
          const dir = unitCenter.clone().sub(center).normalize();
          this.killUnit(u, false, unitCenter, dir);
          kills++;
        }
      }
    }
    return { kills };
  }

  private detachPiece(sourceMesh: THREE.Mesh, pushDir: THREE.Vector3): void {
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    sourceMesh.getWorldPosition(worldPos);
    sourceMesh.getWorldQuaternion(worldQuat);
    sourceMesh.getWorldScale(worldScale);

    const clone = new THREE.Mesh(sourceMesh.geometry, sourceMesh.material);
    clone.position.copy(worldPos);
    clone.quaternion.copy(worldQuat);
    clone.scale.copy(worldScale);
    clone.castShadow = true;
    this.scene.add(clone);

    this.chunks.push({
      mesh: clone,
      vel: pushDir.clone().multiplyScalar(3.2).add(new THREE.Vector3((Math.random() - 0.5) * 2.5, 2.2 + Math.random() * 2.0, (Math.random() - 0.5) * 2.5)),
      angVel: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
      life: 14,
      resting: false
    });
  }

  private killUnit(u: EnemyUnit, headshot: boolean, hitPoint: THREE.Vector3, hitNormal: THREE.Vector3): void {
    u.alive = false;
    if (u.laserBeam) u.laserBeam.visible = false;

    // Remove all hitboxes belonging to dead unit
    this.enemyHitMeshes = this.enemyHitMeshes.filter((m) => m.userData.enemyId !== u.id);

    if (u.kind === 'drone') {
      this.fx.spawnExplosion(u.root.position.clone());
      this.scene.remove(u.root);
      return;
    }

    if (headshot) {
      this.fx.spawnGlassShatter(hitPoint, new THREE.Vector3(0.14, 0.14, 0.14), 24);
      this.fx.spawnSparks(hitPoint, hitNormal, 42, 0x28ebff, 11);
    } else {
      this.fx.spawnSparks(hitPoint, hitNormal, 28, 0xff9933, 8.5);
    }

    // Disassemble armored synth into physical tumbling chassis debris on the floor!
    u.root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && child !== u.laserBeam && child.visible) {
        this.detachPiece(child as THREE.Mesh, hitNormal);
      }
    });
    this.scene.remove(u.root);
  }

  public update(
    dt: number,
    elapsed: number,
    playerEyePos: THREE.Vector3,
    colliders: ColliderBox[],
    getFloorHeight: (x: number, z: number) => number,
    worldTargets: THREE.Object3D[],
    onHitPlayer: (dmg: number) => void,
    onSuppressPlayer: (amount: number) => void
  ): void {
    // Update detached armor & ragdoll chunks
    for (const c of this.chunks) {
      if (c.resting) continue;
      c.life -= dt;
      c.vel.y -= 12.5 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.angVel.x * dt;
      c.mesh.rotation.y += c.angVel.y * dt;
      c.mesh.rotation.z += c.angVel.z * dt;
      const fy = getFloorHeight(c.mesh.position.x, c.mesh.position.z) + 0.08;
      if (c.mesh.position.y <= fy) {
        c.mesh.position.y = fy;
        c.vel.y = Math.abs(c.vel.y) * 0.28;
        c.vel.x *= 0.62;
        c.vel.z *= 0.62;
        c.angVel.multiplyScalar(0.5);
        if (Math.abs(c.vel.y) < 0.3 && c.vel.lengthSq() < 0.08) {
          c.resting = true;
        }
      }
    }

    // Update Active Tactical AI Units
    for (const u of this.units) {
      if (!u.alive) continue;

      const toPlayer = playerEyePos.clone().sub(u.root.position);
      const horizDist = Math.hypot(toPlayer.x, toPlayer.z);
      const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);

      // Smoothly rotate toward player
      let diff = targetYaw - u.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      u.root.rotation.y += diff * Math.min(1, dt * 7.5);

      // Flinch recoil
      if (u.flinchTimer > 0) {
        u.flinchTimer -= dt;
        u.root.rotation.x = -Math.sin((u.flinchTimer / 0.16) * Math.PI) * 0.16;
      } else {
        u.root.rotation.x = 0;
      }

      // Tactical Strafe & Spacing Movement
      u.strafeTimer -= dt;
      if (u.strafeTimer <= 0) {
        u.strafeDir = Math.random() < 0.5 ? -1 : 1;
        u.strafeTimer = 1.1 + Math.random() * 1.6;
      }

      const fwdX = Math.sin(targetYaw);
      const fwdZ = Math.cos(targetYaw);
      const rightX = fwdZ * u.strafeDir;
      const rightZ = -fwdX * u.strafeDir;

      const speed = u.kind === 'drone' ? 3.8 : u.kind === 'juggernaut' ? 1.85 : 2.65;
      const desiredAdvance = horizDist > 13.5 ? 0.75 : horizDist < 6.0 ? -0.55 : 0.0;
      const moveX = (fwdX * desiredAdvance + rightX * 0.85) * speed * dt;
      const moveZ = (fwdZ * desiredAdvance + rightZ * 0.85) * speed * dt;

      const nextX = THREE.MathUtils.clamp(u.root.position.x + moveX, -13.6, 13.6);
      const nextZ = THREE.MathUtils.clamp(u.root.position.z + moveZ, -33.2, -1.5);

      if (u.kind === 'drone') {
        u.root.position.x = nextX;
        u.root.position.z = nextZ;
        u.root.position.y = 2.45 + Math.sin(elapsed * 2.8 + u.walkPhase) * 0.35;
        u.root.rotation.z = -u.strafeDir * 0.18;
      } else {
        // Check horizontal collider clearance for ground synths
        let blocked = false;
        for (const col of colliders) {
          if (!col.blocksMovement) continue;
          if (
            nextX + 0.42 > col.box.min.x &&
            nextX - 0.42 < col.box.max.x &&
            nextZ + 0.42 > col.box.min.z &&
            nextZ - 0.42 < col.box.max.z &&
            u.root.position.y + 0.4 < col.box.max.y
          ) {
            blocked = true;
            u.strafeDir *= -1;
            break;
          }
        }
        if (!blocked) {
          u.root.position.x = nextX;
          u.root.position.z = nextZ;
        }
        u.root.position.y = getFloorHeight(u.root.position.x, u.root.position.z);

        // Articulated Walk Cycle
        u.walkPhase += dt * 7.5;
        if (u.leftLeg && u.rightLeg) {
          u.leftLeg.rotation.x = Math.sin(u.walkPhase) * 0.42;
          u.rightLeg.rotation.x = -Math.sin(u.walkPhase) * 0.42;
        }
        if (u.weaponArm) {
          const aimPitch = -Math.atan2(playerEyePos.y - (u.root.position.y + 1.38), horizDist);
          u.weaponArm.rotation.x = THREE.MathUtils.clamp(aimPitch, -0.5, 0.5);
        }
      }

      // Line-of-Sight & Burst Fire Logic
      u.fireCooldown -= dt;
      if (u.fireCooldown <= 0 && u.burstRemaining === 0) {
        // Check if wall blocks sight before wasting burst
        const muzWorld = u.muzzleOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), u.root.rotation.y).add(u.root.position);
        const dirToPlayer = playerEyePos.clone().sub(muzWorld).normalize();
        this.raycaster.set(muzWorld, dirToPlayer);
        this.raycaster.far = muzWorld.distanceTo(playerEyePos);
        const hits = this.raycaster.intersectObjects(worldTargets, false);
        const sightClear = hits.length === 0 || hits[0].object.userData.surface === 'glass';

        if (sightClear) {
          u.burstRemaining = u.kind === 'juggernaut' ? 5 : 3;
          u.burstGap = 0;
        } else {
          u.fireCooldown = 0.45;
        }
      }

      if (u.burstRemaining > 0) {
        u.burstGap -= dt;
        if (u.burstGap <= 0) {
          u.burstRemaining--;
          u.burstGap = u.kind === 'juggernaut' ? 0.11 : 0.13;
          if (u.burstRemaining === 0) {
            u.fireCooldown = u.kind === 'juggernaut' ? 1.25 : 1.55 + Math.random() * 0.9;
          }
          this.fireEnemyRound(u, playerEyePos, worldTargets, onHitPlayer, onSuppressPlayer);
        }
      }
    }
  }

  private fireEnemyRound(
    u: EnemyUnit,
    playerEyePos: THREE.Vector3,
    worldTargets: THREE.Object3D[],
    onHitPlayer: (dmg: number) => void,
    onSuppressPlayer: (amount: number) => void
  ): void {
    this.audio.playEnemyShot();
    const muzWorld = u.muzzleOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), u.root.rotation.y).add(u.root.position);

    const spread = u.kind === 'juggernaut' ? 0.065 : 0.085;
    const dir = playerEyePos
      .clone()
      .add(new THREE.Vector3((Math.random() - 0.5) * 1.15, (Math.random() - 0.5) * 0.85 - 0.12, (Math.random() - 0.5) * 1.15))
      .sub(muzWorld)
      .normalize();
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.normalize();

    this.raycaster.set(muzWorld, dir);
    this.raycaster.far = 48;
    const hits = this.raycaster.intersectObjects(worldTargets, false);
    const wallDist = hits.length > 0 ? hits[0].distance : 48;

    // Closest point of approach to player capsule
    const toEye = playerEyePos.clone().sub(muzWorld);
    const proj = toEye.dot(dir);
    let endPt = muzWorld.clone().addScaledVector(dir, wallDist);

    if (proj > 0 && proj < wallDist) {
      const closest = muzWorld.clone().addScaledVector(dir, proj);
      const missDist = closest.distanceTo(playerEyePos);
      if (missDist < 0.42) {
        endPt = closest;
        onHitPlayer(u.kind === 'juggernaut' ? 11 : 8);
      } else if (missDist < 1.85) {
        onSuppressPlayer(0.32);
        this.audio.playBulletWhiz();
      }
    } else if (hits.length > 0) {
      const h = hits[0];
      const nrm = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      this.fx.spawnSurfaceImpact(h.point, nrm, (h.object.userData.surface as SurfaceMaterialType) ?? 'concrete');
    }

    this.fx.spawnTracer(muzWorld, endPt, true);
  }
}
