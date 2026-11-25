import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildProceduralTextures, sampleWorldPuddle, type PBRMaterialTextures } from '../core/ProceduralTextures';
import { PostProcessingPipeline } from '../core/PostProcessing';
import { AudioEngine } from '../core/AudioEngine';
import { EffectsManager } from '../fx/EffectsManager';
import { LevelBuilder } from '../world/LevelBuilder';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { EnemyManager } from '../entities/EnemyManager';
import type { QualityPreset, SurfaceMaterialType } from '../types';

export class Game {
  private renderer: THREE.WebGLRenderer;
  private worldScene: THREE.Scene;
  private worldCamera: THREE.PerspectiveCamera;
  private postFX: PostProcessingPipeline;
  private textures: PBRMaterialTextures;
  private audio: AudioEngine;
  private fx: EffectsManager;
  private level: LevelBuilder;
  private weapon: WeaponSystem;
  private enemies: EnemyManager;

  // Game & Wave State
  private running = false;
  private finished = false;
  private currentWave = 0;
  private nextWaveTimer = -1;
  private terminalReady = false;
  private missionStartTime = 0;
  private quality: QualityPreset = 'ultra';

  // Combat Telemetry
  private shotsFired = 0;
  private shotsHit = 0;
  private totalKills = 0;
  private headshotKills = 0;

  // Player Physics & Stance
  private playerPos = new THREE.Vector3(0, 0, 5.2);
  private playerVel = new THREE.Vector3();
  private yaw = 0; // 0 = looking down -Z
  private pitch = 0;
  private grounded = true;
  private crouching = false;
  private sliding = false;
  private slideTimer = 0;
  private slideDir = new THREE.Vector3();
  private eyeHeight = 1.68;
  private leanCurrent = 0;

  // Player Vitals
  private hp = 100;
  private armor = 100;
  private timeSinceHit = 10;
  private damageFlash = 0;
  private suppression = 0;
  private screenShake = 0;

  // Input State
  private keys = new Set<string>();
  private mouseLeft = false;
  private mouseRight = false;
  private mouseDX = 0;
  private mouseDY = 0;
  private footstepDist = 0;
  private hitmarkerTimer = 0;

  // Raycasters & High-Precision Frame Timer
  private aimRaycaster = new THREE.Raycaster();
  private lastFrameMs = performance.now();
  private elapsedTime = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private currentFps = 60;

  // Cached DOM references
  private hudEl = document.getElementById('hud')!;
  private menuEl = document.getElementById('menu-screen')!;
  private debriefEl = document.getElementById('debrief-screen')!;
  private crosshairEl = document.getElementById('crosshair')!;
  private hitmarkerEl = document.getElementById('hitmarker')!;
  private interactEl = document.getElementById('interact-prompt')!;
  private lowAmmoEl = document.getElementById('low-ammo-warn')!;
  private killFeedEl = document.getElementById('kill-feed')!;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      powerPreference: 'high-performance',
      antialias: false,
      stencil: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.worldScene = new THREE.Scene();
    this.worldCamera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 95);

    // Generate HDR Image-Based Lighting (PMREM) for authentic metallic & wet specular reflections
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.worldScene.environment = envTex;
    this.worldScene.environmentIntensity = 0.46;

    this.textures = buildProceduralTextures(this.renderer.capabilities.getMaxAnisotropy());
    this.audio = new AudioEngine();
    this.fx = new EffectsManager(this.worldScene, this.textures, this.audio);

    this.level = new LevelBuilder(this.worldScene, this.textures);
    this.level.build();

    this.weapon = new WeaponSystem(this.worldScene, envTex, this.textures, this.audio, this.fx);
    this.enemies = new EnemyManager(this.worldScene, this.textures, this.audio, this.fx);

    this.postFX = new PostProcessingPipeline(
      this.renderer,
      this.worldScene,
      this.worldCamera,
      this.weapon.weaponScene,
      this.weapon.weaponCamera
    );

    this.bindEvents(canvas);
    this.exposeDiagnostics();
    this.animate();
  }

  private bindEvents(canvas: HTMLCanvasElement): void {
    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.worldCamera.aspect = w / h;
      this.worldCamera.updateProjectionMatrix();
      this.weapon.resize(w / h);
      this.postFX.resize(w, h);
    });

    document.getElementById('btn-start')!.addEventListener('click', () => {
      this.audio.init();
      if (this.finished) this.resetMission();
      this.enterGameplay(canvas);
    });

    document.getElementById('btn-restart')!.addEventListener('click', () => {
      this.audio.init();
      this.resetMission();
      this.enterGameplay(canvas);
    });

    canvas.addEventListener('click', () => {
      if (this.running && document.pointerLockElement !== canvas) {
        try {
          canvas.requestPointerLock();
        } catch {
          // Fallback if pointer lock is restricted in embedded view
        }
      }
    });

    document.querySelectorAll<HTMLButtonElement>('.q-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.q-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const q = (btn.dataset.q as QualityPreset) || 'ultra';
        this.setQuality(q);
      });
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && this.running && !this.finished) {
        this.running = false;
        this.mouseLeft = false;
        this.mouseRight = false;
        this.keys.clear();
        this.menuEl.classList.remove('hidden');
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.running) return;
      const sens = this.weapon.adsAmount > 0.5 ? 0.00125 : 0.00205;
      this.yaw -= e.movementX * sens;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * sens, -1.46, 1.46);
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    window.addEventListener('mousedown', (e) => {
      if (!this.running) return;
      if (e.button === 0) this.mouseLeft = true;
      if (e.button === 2) this.mouseRight = true;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) this.mouseRight = false;
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.running && document.pointerLockElement === null) {
        this.running = false;
        this.menuEl.classList.remove('hidden');
        return;
      }
      if (!this.running) return;
      const code = e.code;
      this.keys.add(code);

      if (code === 'KeyR') this.weapon.startReload();
      if (code === 'KeyB') this.weapon.toggleFireMode();
      if (code === 'KeyV') this.weapon.toggleSuppressor();
      if (code === 'KeyT') this.weapon.toggleTacLight();

      if (code === 'KeyF') {
        if (this.terminalReady && this.playerPos.distanceTo(this.level.terminal.position) < 3.4) {
          this.completeMission(true);
        } else {
          this.weapon.triggerInspect();
        }
      }

      // Tactical Sprint-Slide trigger (Shift + C while moving forward!)
      if ((code === 'KeyC' || code === 'ControlLeft') && !this.sliding && this.grounded) {
        if (this.keys.has('ShiftLeft') && this.keys.has('KeyW')) {
          this.sliding = true;
          this.slideTimer = 0.62;
          this.slideDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
          this.audio.playFootstep(0.6, true);
        } else {
          this.crouching = !this.crouching;
        }
      }

      if (code === 'Space' && this.grounded) {
        this.grounded = false;
        this.crouching = false;
        this.sliding = false;
        this.playerVel.y = 5.2;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  private enterGameplay(canvas: HTMLCanvasElement): void {
    this.running = true;
    this.menuEl.classList.add('hidden');
    this.debriefEl.classList.add('hidden');
    this.hudEl.classList.remove('hidden');
    if (this.missionStartTime === 0) {
      this.missionStartTime = performance.now();
    }
    try {
      const req = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (req && typeof req.catch === 'function') req.catch(() => {});
    } catch {
      // Ignore pointer lock rejection in automated/embedded environments
    }
  }

  private setQuality(q: QualityPreset): void {
    this.quality = q;
    this.renderer.shadowMap.enabled = q !== 'perf';
    this.postFX.setQuality(q);
    this.level.setQuality(q);
    document.getElementById('hud-quality')!.textContent = `QUALITY: ${q.toUpperCase()}`;
  }

  private resetMission(): void {
    this.finished = false;
    this.currentWave = 0;
    this.nextWaveTimer = -1;
    this.terminalReady = false;
    this.missionStartTime = performance.now();
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.totalKills = 0;
    this.headshotKills = 0;

    this.hp = 100;
    this.armor = 100;
    this.damageFlash = 0;
    this.suppression = 0;
    this.playerPos.set(0, 0, 5.2);
    this.playerVel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.crouching = false;
    this.sliding = false;

    this.weapon.magAmmo = 31;
    this.weapon.reserveAmmo = 180;
    this.weapon.barrelHeat = 0;
    this.weapon.isReloading = false;

    this.enemies.clearAll();
    this.level.updateTerminalScreen('LOCKDOWN ACTIVE', 'CLEAR ALL AEGIS UNITS TO UNLOCK', '#ff4c58');
  }

  private triggerNextWave(waveNum: number): void {
    this.currentWave = waveNum;
    this.enemies.spawnWave(waveNum);
    if (waveNum > 1) {
      // Tactical armor plate partial resupply between waves
      this.armor = Math.min(100, this.armor + 35);
      this.weapon.reserveAmmo = Math.min(210, this.weapon.reserveAmmo + 60);
    }
    this.pushKillFeed(`// WAVE ${waveNum} HOSTILES DETECTED`, '#ffb038');
  }

  private handleExplosionSplash = (center: THREE.Vector3, radius: number, maxDmg: number): void => {
    const res = this.enemies.applyExplosionDamage(center, radius, maxDmg);
    if (res.kills > 0) {
      this.totalKills += res.kills;
      this.pushKillFeed(`CRYO-FUEL DETONATION // +${res.kills} KILLS`, '#ff9933');
    }
    const pDist = center.distanceTo(this.playerPos);
    if (pDist < 14) {
      this.screenShake = Math.max(this.screenShake, (1 - pDist / 14) * 0.55);
    }
    if (pDist < radius * 0.85) {
      this.onPlayerHit((1 - pDist / (radius * 0.85)) * 38);
    }
  };

  private onPlayerHit = (dmg: number): void => {
    if (this.finished) return;
    this.timeSinceHit = 0;
    this.damageFlash = Math.min(1.0, this.damageFlash + 0.55);
    this.screenShake = Math.max(this.screenShake, 0.16);

    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.68);
      this.armor -= absorbed;
      this.hp -= dmg - absorbed;
    } else {
      this.hp -= dmg;
    }

    if (this.hp <= 0) {
      this.hp = 0;
      this.completeMission(false);
    }
  };

  private completeMission(victory: boolean): void {
    this.finished = true;
    this.running = false;
    document.exitPointerLock();

    if (victory) {
      this.level.updateTerminalScreen('SECTOR-09 SECURED', 'LOCKDOWN OVERRIDDEN // ALL CLEAR', '#38ffa8');
    }

    this.hudEl.classList.add('hidden');
    this.menuEl.classList.add('hidden');
    this.debriefEl.classList.remove('hidden');

    const elapsedSec = Math.max(1, Math.floor((performance.now() - this.missionStartTime) / 1000));
    const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const ss = String(elapsedSec % 60).padStart(2, '0');
    const hsPct = this.totalKills > 0 ? Math.round((this.headshotKills / this.totalKills) * 100) : 0;
    const accPct = this.shotsFired > 0 ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;

    let rank = 'B';
    if (!victory) rank = 'KIA';
    else if (elapsedSec < 165 && (hsPct >= 30 || accPct >= 28)) rank = 'S';
    else if (elapsedSec < 240) rank = 'A';

    document.getElementById('debrief-kicker')!.textContent = victory ? 'AFTER ACTION REPORT // SUCCESS' : 'SIGNAL LOST // OPERATOR DOWN';
    document.getElementById('debrief-title')!.textContent = victory ? 'SECTOR-09 SECURED' : 'MISSION FAILED';
    document.getElementById('stat-time')!.textContent = `${mm}:${ss}`;
    document.getElementById('stat-kills')!.textContent = String(this.totalKills);
    document.getElementById('stat-hs')!.textContent = `${hsPct}%`;
    document.getElementById('stat-acc')!.textContent = `${accPct}%`;
    document.getElementById('stat-rank')!.textContent = rank;
  }

  private pushKillFeed(text: string, borderColor = '#ff4a55'): void {
    const div = document.createElement('div');
    div.className = 'kill-item';
    div.style.borderRightColor = borderColor;
    div.textContent = text;
    this.killFeedEl.prepend(div);
    while (this.killFeedEl.children.length > 4) {
      this.killFeedEl.lastChild?.remove();
    }
    setTimeout(() => div.remove(), 4200);
  }

  private updatePlayerMovement(dt: number): { moveRatio: number; sprinting: boolean } {
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const inputDir = new THREE.Vector3();
    if (this.keys.has('KeyW')) inputDir.add(fwd);
    if (this.keys.has('KeyS')) inputDir.sub(fwd);
    if (this.keys.has('KeyD')) inputDir.add(right);
    if (this.keys.has('KeyA')) inputDir.sub(right);
    if (inputDir.lengthSq() > 0) inputDir.normalize();

    const wantsSprint =
      this.keys.has('ShiftLeft') &&
      this.keys.has('KeyW') &&
      !this.mouseRight &&
      !this.crouching &&
      !this.weapon.isReloading;

    let targetVelX = 0;
    let targetVelZ = 0;

    if (this.sliding) {
      this.slideTimer -= dt;
      const slideSpeed = 9.4 * Math.max(0.25, this.slideTimer / 0.62);
      targetVelX = this.slideDir.x * slideSpeed;
      targetVelZ = this.slideDir.z * slideSpeed;
      if (this.slideTimer <= 0) {
        this.sliding = false;
        this.crouching = true;
      }
    } else {
      const baseSpeed = wantsSprint ? 6.8 : this.crouching ? 2.85 : this.weapon.adsAmount > 0.5 ? 3.15 : 4.75;
      targetVelX = inputDir.x * baseSpeed;
      targetVelZ = inputDir.z * baseSpeed;
    }

    this.playerVel.x = THREE.MathUtils.damp(this.playerVel.x, targetVelX, 16, dt);
    this.playerVel.z = THREE.MathUtils.damp(this.playerVel.z, targetVelZ, 16, dt);

    // Gravity & Floor Elevation
    if (!this.grounded) {
      this.playerVel.y -= 15.5 * dt;
    }
    this.playerPos.y += this.playerVel.y * dt;

    // Axis-separated Capsule-vs-AABB Collision with Smooth Wall Sliding
    const radius = 0.40;
    const stepX = this.playerPos.x + this.playerVel.x * dt;
    if (!this.overlapsCollider(stepX, this.playerPos.y, this.playerPos.z, radius)) {
      this.playerPos.x = stepX;
    } else {
      this.playerVel.x = 0;
    }

    const stepZ = this.playerPos.z + this.playerVel.z * dt;
    if (!this.overlapsCollider(this.playerPos.x, this.playerPos.y, stepZ, radius)) {
      this.playerPos.z = stepZ;
    } else {
      this.playerVel.z = 0;
    }

    const floorY = this.level.getFloorHeight(this.playerPos.x, this.playerPos.z);
    if (this.playerPos.y <= floorY) {
      this.playerPos.y = floorY;
      this.playerVel.y = 0;
      this.grounded = true;
    }

    // Eye height & Q/E Tactical Lean (clamped against adjacent walls so camera never clips!)
    const targetEye = this.sliding ? 0.82 : this.crouching ? 1.06 : 1.68;
    this.eyeHeight = THREE.MathUtils.damp(this.eyeHeight, targetEye, 14, dt);

    const rawLean = (this.keys.has('KeyE') ? 1 : 0) - (this.keys.has('KeyQ') ? 1 : 0);
    let safeLean = rawLean;
    if (rawLean !== 0) {
      const testX = this.playerPos.x + right.x * rawLean * 0.46;
      const testZ = this.playerPos.z + right.z * rawLean * 0.46;
      if (this.overlapsCollider(testX, this.playerPos.y + 0.9, testZ, 0.22)) {
        safeLean = rawLean * 0.2;
      }
    }
    this.leanCurrent = THREE.MathUtils.damp(this.leanCurrent, safeLean, 14, dt);

    // Footstep cadence + wet puddle splash check!
    const horizSpeed = Math.hypot(this.playerVel.x, this.playerVel.z);
    if (this.grounded && !this.sliding && horizSpeed > 0.6) {
      this.footstepDist += horizSpeed * dt;
      const stride = wantsSprint ? 2.15 : 1.72;
      if (this.footstepDist >= stride) {
        this.footstepDist = 0;
        const wetness = sampleWorldPuddle(this.playerPos.x, this.playerPos.z);
        this.audio.playFootstep(wetness, wantsSprint);
      }
    }

    // Trigger Wave 1 as soon as player steps out of Airlock (z < 2.6)
    if (this.currentWave === 0 && this.playerPos.z < 2.6) {
      this.triggerNextWave(1);
    }

    return { moveRatio: THREE.MathUtils.clamp(horizSpeed / 6.8, 0, 1), sprinting: wantsSprint };
  }

  private overlapsCollider(x: number, y: number, z: number, r: number): boolean {
    for (const c of this.level.colliders) {
      if (!c.blocksMovement) continue;
      if (
        x + r > c.box.min.x &&
        x - r < c.box.max.x &&
        z + r > c.box.min.z &&
        z - r < c.box.max.z &&
        y + 0.45 < c.box.max.y &&
        y + 1.75 > c.box.min.y
      ) {
        return true;
      }
    }
    return false;
  }

  private fireBallisticShot(): void {
    this.shotsFired++;
    if (this.currentWave === 0) {
      this.triggerNextWave(1);
    }

    // Spawn Physical Brass 5.56mm Casing from Ejection Port
    const ej = this.weapon.getWorldEjectionPort(this.worldCamera);
    this.fx.spawnShellCasing(ej.pos, ej.vel);

    const muzPos = this.weapon.getWorldMuzzlePos(this.worldCamera);
    if (!this.weapon.suppressed) {
      this.fx.spawnFlashLight(muzPos, 0xff9a38, 9.5, 0.042, 9.5);
    }
    this.fx.spawnSmoke(
      muzPos,
      new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.35 + Math.random() * 0.25, (Math.random() - 0.5) * 0.4),
      0.06,
      0.38,
      0.38,
      0xd4dee8,
      this.weapon.suppressed ? 0.22 : 0.14
    );

    // Compute shot ray with tight ADS precision vs hipfire dispersion
    const spread = THREE.MathUtils.lerp(0.020, 0.0015, this.weapon.adsAmount) * (1 + this.weapon.barrelHeat * 0.35);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.worldCamera.quaternion);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    this.aimRaycaster.set(this.worldCamera.position, dir);
    this.aimRaycaster.far = 65;

    const allTargets = [...this.level.raycastTargets, ...this.enemies.enemyHitMeshes];
    const hits = this.aimRaycaster.intersectObjects(allTargets, false);

    if (hits.length > 0) {
      const hit = hits[0];
      const normal = hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
        : dir.clone().negate();
      const surface = (hit.object.userData.surface as SurfaceMaterialType) ?? 'concrete';

      this.fx.spawnTracer(muzPos, hit.point, false);
      this.fx.spawnSurfaceImpact(hit.point, normal, surface);

      const enemyId = hit.object.userData.enemyId as string | undefined;
      const propId = hit.object.userData.destructibleId as string | undefined;

      if (enemyId) {
        this.shotsHit++;
        const baseDmg = this.weapon.suppressed ? 33 : 36;
        const result = this.enemies.applyBulletHit(enemyId, surface, baseDmg, hit.point, normal);
        this.audio.playImpact(surface, result.headshot);
        this.showHitmarker(result.headshot);

        if (result.killed) {
          this.totalKills++;
          if (result.headshot) this.headshotKills++;
          const label =
            result.unitKind === 'juggernaut'
              ? 'AEGIS JUGGERNAUT'
              : result.unitKind === 'drone'
                ? 'STRIKER DRONE'
                : 'AEGIS TROOPER';
          this.pushKillFeed(
            `${label} // ${result.headshot ? 'CRITICAL HEADSHOT' : 'NEUTRALIZED'}`,
            result.headshot ? '#ff3344' : '#38e8ff'
          );
        }
      } else {
        this.audio.playImpact(surface, false);
        if (propId) {
          this.level.damageProp(propId, 36, hit.point, normal, this.fx, this.handleExplosionSplash);
        }
      }
    } else {
      this.fx.spawnTracer(muzPos, this.worldCamera.position.clone().addScaledVector(dir, 50), false);
    }
  }

  private showHitmarker(headshot: boolean): void {
    this.hitmarkerTimer = 0.14;
    this.hitmarkerEl.classList.remove('hidden');
    this.hitmarkerEl.classList.toggle('headshot', headshot);
  }

  private updateHUD(dt: number, sprinting: boolean): void {
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.4) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      document.getElementById('hud-fps')!.textContent = `${this.currentFps} FPS`;
    }

    if (this.hitmarkerTimer > 0) {
      this.hitmarkerTimer -= dt;
      if (this.hitmarkerTimer <= 0) this.hitmarkerEl.classList.add('hidden');
    }

    // Bodycam live clock & compass bearing
    const nowMs = Math.floor(performance.now());
    const cs = String(Math.floor((nowMs % 1000) / 10)).padStart(2, '0');
    const sec = String((19 + Math.floor(nowMs / 1000)) % 60).padStart(2, '0');
    document.getElementById('hud-clock')!.textContent = `23:47:${sec}:${cs}`;
    const deg = (((-this.yaw * 180) / Math.PI) % 360 + 360) % 360;
    const compassEl = document.getElementById('compass-strip')!;
    compassEl.style.transform = `translateX(${((180 - deg) * 0.95).toFixed(1)}px)`;

    // Hide hipfire crosshair when aiming through 3D Holographic Sight!
    this.crosshairEl.style.opacity = String(THREE.MathUtils.clamp(1 - this.weapon.adsAmount * 1.5, 0, 1));

    document.getElementById('ammo-mag')!.textContent = String(this.weapon.magAmmo);
    document.getElementById('ammo-reserve')!.textContent = String(this.weapon.reserveAmmo);
    this.lowAmmoEl.classList.toggle('hidden', this.weapon.magAmmo > 7 || this.weapon.isReloading);

    document.getElementById('hp-val')!.textContent = String(Math.ceil(this.hp));
    document.getElementById('hp-fill')!.style.width = `${Math.max(0, this.hp)}%`;
    document.getElementById('armor-val')!.textContent = `${Math.ceil(this.armor)}%`;
    document.getElementById('armor-fill')!.style.width = `${Math.max(0, this.armor)}%`;

    const bpm = Math.round(74 + (100 - this.hp) * 0.7 + this.suppression * 42 + (sprinting ? 22 : 0));
    document.getElementById('bpm-val')!.textContent = String(bpm);

    document.getElementById('stance-badge')!.textContent = this.sliding
      ? 'SLIDE'
      : this.crouching
        ? 'CROUCH'
        : sprinting
          ? 'SPRINT'
          : 'STAND';

    const leanBadge = document.getElementById('lean-badge')!;
    if (Math.abs(this.leanCurrent) > 0.15) {
      leanBadge.textContent = this.leanCurrent < 0 ? '◀ LEAN L' : 'LEAN R ▶';
      leanBadge.classList.remove('dim');
    } else {
      leanBadge.textContent = 'CENTER';
      leanBadge.classList.add('dim');
    }

    const lightBadge = document.getElementById('light-badge')!;
    lightBadge.classList.toggle('active', this.weapon.tacLightOn);

    const supBadge = document.getElementById('sup-badge')!;
    supBadge.textContent = this.weapon.suppressed ? 'SOCOM SUPPRESSOR [V]' : 'MUZZLE BRAKE [V]';
    supBadge.classList.toggle('active', this.weapon.suppressed);

    const modeBadge = document.getElementById('mode-badge')!;
    modeBadge.textContent = `${this.weapon.fireMode.toUpperCase()} [B]`;

    // Objectives & Wave Progression
    const alive = this.enemies.getAliveCount();
    document.getElementById('obj-count')!.textContent = String(alive);
    document.getElementById('obj-wave')!.textContent = `${Math.max(1, this.currentWave)} / 3`;

    const objTitle = document.getElementById('obj-title')!;
    if (this.currentWave === 0) {
      objTitle.textContent = '推进切入低温收容大厅 (B3)';
    } else if (!this.terminalReady) {
      objTitle.textContent =
        this.currentWave < 3
          ? `肃清区域防卫合成体 (第 ${this.currentWave} 波)`
          : '击败重装指挥官并夺取核心高台';
    } else {
      objTitle.textContent = '前往北侧高台按 [F] 覆写主控终端';
    }

    const canInteract = this.terminalReady && this.playerPos.distanceTo(this.level.terminal.position) < 3.4;
    this.interactEl.classList.toggle('hidden', !canInteract);
    if (canInteract) {
      this.interactEl.textContent = '[F] 覆写 SECTOR-09 主控终端 // SECURE FACILITY';
    }

    (document.getElementById('damage-overlay') as HTMLElement).style.opacity = String(this.damageFlash * 0.85);
    (document.getElementById('suppression-overlay') as HTMLElement).style.opacity = String(this.suppression);
  }

  private exposeDiagnostics(): void {
    (window as unknown as Record<string, unknown>).__SECTOR09__ = {
      getState: () => ({
        running: this.running,
        fps: this.currentFps,
        wave: this.currentWave,
        enemiesAlive: this.enemies.getAliveCount(),
        magAmmo: this.weapon.magAmmo,
        suppressed: this.weapon.suppressed,
        playerPos: this.playerPos.toArray(),
        triangles: this.renderer.info.render.triangles,
        drawCalls: this.renderer.info.render.calls
      })
    };
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const nowMs = performance.now();
    const dt = Math.min((nowMs - this.lastFrameMs) / 1000, 0.05);
    this.lastFrameMs = nowMs;
    this.elapsedTime += dt;
    const elapsed = this.elapsedTime;

    if (!this.running) {
      // Cinematic Slow Orbit Preview in Sector-09 Hall while Menu/Debrief is open!
      this.weapon.weaponScene.visible = false;
      const camZ = -9.5 + Math.sin(elapsed * 0.22) * 5.5;
      const camX = Math.cos(elapsed * 0.18) * 3.2;
      this.worldCamera.position.set(camX, 1.85, camZ);
      this.worldCamera.lookAt(0, 1.45, -22);
      this.weapon.worldTacLight.visible = false;
      this.level.update(dt, elapsed, this.fx);
      this.fx.update(dt, elapsed);
      this.postFX.update(elapsed, 0, 0, 0, 0);
      this.postFX.render();
      return;
    }

    this.weapon.weaponScene.visible = true;
    this.weapon.worldTacLight.visible = this.weapon.tacLightOn;

    // 1. Player Movement & Stance
    const { moveRatio, sprinting } = this.updatePlayerMovement(dt);

    // Apply Weapon Camera Recoil Climb + Smooth Recovery
    if (this.weapon.cameraPitchRecoil > 0.0001 || Math.abs(this.weapon.cameraYawRecoil) > 0.0001) {
      const pStep = this.weapon.cameraPitchRecoil * Math.min(1, dt * 26);
      const yStep = this.weapon.cameraYawRecoil * Math.min(1, dt * 26);
      this.pitch = THREE.MathUtils.clamp(this.pitch + pStep, -1.46, 1.46);
      this.yaw += yStep;
      this.weapon.cameraPitchRecoil -= pStep;
      this.weapon.cameraYawRecoil -= yStep;
    }

    // Position World Camera with Lean Offset + Roll + Explosion Shake
    const rightVec = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const shakeX = (Math.random() - 0.5) * this.screenShake * 0.18;
    const shakeY = (Math.random() - 0.5) * this.screenShake * 0.18;
    this.screenShake = Math.max(0, this.screenShake - dt * 2.4);

    this.worldCamera.position
      .copy(this.playerPos)
      .add(new THREE.Vector3(0, this.eyeHeight + shakeY, 0))
      .addScaledVector(rightVec, this.leanCurrent * 0.44 + shakeX);

    const roll = -this.leanCurrent * 0.11 - (this.sliding ? 0.08 : 0);
    const euler = new THREE.Euler(this.pitch, this.yaw, roll, 'YXZ');
    this.worldCamera.quaternion.setFromEuler(euler);

    // Dynamic World FOV (Zoom in ADS, widen slightly in Sprint/Slide!)
    const targetFov = THREE.MathUtils.lerp(sprinting || this.sliding ? 84 : 78, 56, this.weapon.adsAmount);
    if (Math.abs(this.worldCamera.fov - targetFov) > 0.05) {
      this.worldCamera.fov = THREE.MathUtils.damp(this.worldCamera.fov, targetFov, 14, dt);
      this.worldCamera.updateProjectionMatrix();
    }

    // 2. Compute Aim Raycast Target for Laser & Flashlight Convergence
    const centerDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.worldCamera.quaternion);
    this.aimRaycaster.set(this.worldCamera.position, centerDir);
    this.aimRaycaster.far = 50;
    const aimHits = this.aimRaycaster.intersectObjects(
      [...this.level.raycastTargets, ...this.enemies.enemyHitMeshes],
      false
    );
    const aimPoint =
      aimHits.length > 0
        ? aimHits[0].point
        : this.worldCamera.position.clone().addScaledVector(centerDir, 28);

    // 3. Weapon Firing & Viewmodel Rig Update
    if (this.weapon.tryFire(this.mouseLeft, sprinting)) {
      this.fireBallisticShot();
    }

    this.weapon.update(
      dt,
      elapsed,
      this.worldCamera,
      aimPoint,
      this.mouseDX,
      this.mouseDY,
      moveRatio,
      sprinting,
      this.sliding,
      this.mouseRight,
      this.leanCurrent
    );
    this.mouseDX = 0;
    this.mouseDY = 0;

    // 4. Wave Progression Check
    if (this.currentWave > 0 && !this.terminalReady && this.enemies.getAliveCount() === 0) {
      if (this.currentWave < 3) {
        if (this.nextWaveTimer < 0) {
          this.nextWaveTimer = 1.8;
        } else {
          this.nextWaveTimer -= dt;
          if (this.nextWaveTimer <= 0) {
            this.nextWaveTimer = -1;
            this.triggerNextWave(this.currentWave + 1);
          }
        }
      } else {
        this.terminalReady = true;
        this.level.updateTerminalScreen('OVERRIDE READY', 'PRESS [F] TO SECURE SECTOR-09', '#ffb838');
        this.pushKillFeed('ALL HOSTILES CLEARED // ACCESS MAINFRAME [F]', '#38ffa8');
      }
    }

    // 5. Update AI, Level Destructibles, FX & Health Regen
    this.enemies.update(
      dt,
      elapsed,
      this.worldCamera.position,
      this.level.colliders,
      (x, z) => this.level.getFloorHeight(x, z),
      this.level.raycastTargets,
      this.onPlayerHit,
      (sup) => {
        this.suppression = Math.min(1.0, this.suppression + sup);
      }
    );

    this.level.update(dt, elapsed, this.fx, this.handleExplosionSplash);
    this.fx.update(dt, elapsed);

    this.timeSinceHit += dt;
    if (this.timeSinceHit > 4.2 && this.hp < 100) {
      this.hp = Math.min(100, this.hp + dt * 14);
    }
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.6);
    this.suppression = Math.max(0, this.suppression - dt * 0.85);

    // 6. Update HUD & Render HDR Post-Processing Frame
    this.updateHUD(dt, sprinting);
    this.postFX.update(elapsed, this.weapon.adsAmount, this.weapon.lastShotPulse, this.damageFlash, this.suppression);
    this.postFX.render();
  };
}
