import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { makeStencilSignTexture, type PBRMaterialTextures } from '../core/ProceduralTextures';
import type { ColliderBox, DestructibleProp, InteractiveTerminal, QualityPreset, SurfaceMaterialType } from '../types';
import type { EffectsManager } from '../fx/EffectsManager';

export class LevelBuilder {
  public colliders: ColliderBox[] = [];
  public raycastTargets: THREE.Object3D[] = [];
  public destructibles = new Map<string, DestructibleProp>();
  public terminal!: InteractiveTerminal;
  public floorReflector!: Reflector;

  private scene: THREE.Scene;
  private textures: PBRMaterialTextures;
  private emergencyBeacons: { pivot: THREE.Object3D; light: THREE.PointLight }[] = [];
  private cryoCores: THREE.Object3D[] = [];
  private cryoPositions: THREE.Vector3[] = [];
  private propCounter = 0;

  constructor(scene: THREE.Scene, textures: PBRMaterialTextures) {
    this.scene = scene;
    this.textures = textures;
  }

  private registerSolid(
    mesh: THREE.Object3D,
    surface: SurfaceMaterialType,
    blocksMovement = true,
    blocksSight = true,
    customBox?: THREE.Box3
  ): number {
    mesh.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.userData.surface = surface;
        this.raycastTargets.push(child);
      }
    });
    const box = customBox ?? new THREE.Box3().setFromObject(mesh);
    this.colliders.push({ box, blocksMovement, blocksSight, surface, mesh });
    return this.colliders.length - 1;
  }

  private registerShootableOnly(mesh: THREE.Object3D, surface: SurfaceMaterialType, destructibleId?: string): void {
    mesh.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.userData.surface = surface;
        if (destructibleId) child.userData.destructibleId = destructibleId;
        this.raycastTargets.push(child);
      }
    });
  }

  public build(): void {
    // Atmospheric exponential fog matching deep slate cryo-bunker
    this.scene.fog = new THREE.FogExp2(0x070c14, 0.021);
    this.scene.background = new THREE.Color(0x05080e);

    // Subtle cool sky / dark slate ground bounce fill so shadows have readable detail
    const hemi = new THREE.HemisphereLight(0x4c78a8, 0x121822, 0.48);
    this.scene.add(hemi);

    // 1. REAL-TIME PLANAR WET FLOOR REFLECTION + EPOXY CONCRETE OVERLAY
    const floorW = 32;
    const floorL = 44;
    const reflGeo = new THREE.PlaneGeometry(floorW, floorL);
    this.floorReflector = new Reflector(reflGeo, {
      clipBias: 0.003,
      textureWidth: 1024,
      textureHeight: 1024,
      color: 0x3b4d5e
    });
    this.floorReflector.rotation.x = -Math.PI * 0.5;
    this.floorReflector.position.set(0, 0.0, -14);
    this.floorReflector.renderOrder = -2;
    this.scene.add(this.floorReflector);

    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.floorAlbedo,
      normalMap: this.textures.floorNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: this.textures.floorRoughness,
      roughness: 0.9,
      metalness: 0.15,
      alphaMap: this.textures.floorAlpha,
      transparent: true,
      depthWrite: true
    });
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorL), floorMat);
    floorMesh.rotation.x = -Math.PI * 0.5;
    floorMesh.position.set(0, 0.003, -14);
    floorMesh.receiveShadow = true;
    floorMesh.renderOrder = -1;
    floorMesh.userData.surface = 'concrete';
    this.scene.add(floorMesh);
    this.raycastTargets.push(floorMesh);

    // Painted Tactical Lane Markings on Floor
    const stripeMat = new THREE.MeshStandardMaterial({
      map: this.textures.hazardAlbedo,
      roughnessMap: this.textures.hazardRoughness,
      roughness: 0.65,
      metalness: 0.25,
      polygonOffset: true,
      polygonOffsetFactor: -1
    });
    for (const zLine of [0.8, -24.2]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(28, 0.34), stripeMat);
      line.rotation.x = -Math.PI * 0.5;
      line.position.set(0, 0.006, zLine);
      line.receiveShadow = true;
      this.scene.add(line);
    }

    // 2. CEILING & STRUCTURAL I-BEAM TRUSSES
    const ceilMat = new THREE.MeshStandardMaterial({
      map: this.textures.ceilingAlbedo,
      normalMap: this.textures.ceilingNormal,
      roughness: 0.72,
      metalness: 0.65
    });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorL), ceilMat);
    ceiling.rotation.x = Math.PI * 0.5;
    ceiling.position.set(0, 5.4, -14);
    ceiling.userData.surface = 'metal';
    this.scene.add(ceiling);
    this.raycastTargets.push(ceiling);

    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: 0x202833,
      normalMap: this.textures.gunmetalNormal,
      roughness: 0.42,
      metalness: 0.85
    });

    for (let z = 4; z >= -32; z -= 6) {
      const girder = new THREE.Mesh(new THREE.BoxGeometry(30.4, 0.42, 0.38), darkSteelMat);
      girder.position.set(0, 5.18, z);
      girder.castShadow = true;
      girder.receiveShadow = true;
      this.scene.add(girder);
      this.registerShootableOnly(girder, 'metal');
    }

    // Overhead Cable Trays & Cryo Conduits running lengthwise
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x4b5868,
      normalMap: this.textures.gunmetalNormal,
      roughness: 0.32,
      metalness: 0.88
    });
    for (const xTray of [-6.5, 6.5]) {
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 40), darkSteelMat);
      tray.position.set(xTray, 4.88, -14);
      this.scene.add(tray);

      const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 40, 12), pipeMat);
      conduit.rotation.x = Math.PI * 0.5;
      conduit.position.set(xTray + 0.52, 4.95, -14);
      this.scene.add(conduit);
    }

    // 3. PERIMETER ARMORED BULKHEAD WALLS
    const makeWallMat = (rx: number, ry: number) => {
      const alb = this.textures.wallAlbedo.clone();
      const nrm = this.textures.wallNormal.clone();
      const rgh = this.textures.wallRoughness.clone();
      const met = this.textures.wallMetalness.clone();
      for (const t of [alb, nrm, rgh, met]) {
        t.repeat.set(rx, ry);
        t.needsUpdate = true;
      }
      return new THREE.MeshStandardMaterial({
        map: alb,
        normalMap: nrm,
        normalScale: new THREE.Vector2(1.15, 1.15),
        roughnessMap: rgh,
        metalnessMap: met,
        roughness: 0.85,
        metalness: 0.55
      });
    };

    const sideWallMat = makeWallMat(8, 1.4);
    const endWallMat = makeWallMat(6, 1.4);

    // West, East, South (Start Airlock), North (Vault End) Walls
    const westWall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.5, 44), sideWallMat);
    westWall.position.set(-15.2, 2.75, -14);
    westWall.receiveShadow = true;
    this.scene.add(westWall);
    this.registerSolid(westWall, 'concrete');

    const eastWall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.5, 44), sideWallMat);
    eastWall.position.set(15.2, 2.75, -14);
    eastWall.receiveShadow = true;
    this.scene.add(eastWall);
    this.registerSolid(eastWall, 'concrete');

    const southWall = new THREE.Mesh(new THREE.BoxGeometry(31, 5.5, 0.6), endWallMat);
    southWall.position.set(0, 2.75, 7.3);
    southWall.receiveShadow = true;
    this.scene.add(southWall);
    this.registerSolid(southWall, 'concrete');

    const northWall = new THREE.Mesh(new THREE.BoxGeometry(31, 5.5, 0.6), endWallMat);
    northWall.position.set(0, 2.75, -35.3);
    northWall.receiveShadow = true;
    this.scene.add(northWall);
    this.registerSolid(northWall, 'concrete');

    // Airlock Entry Narrowing Bulkheads (creates tight breach vestibule at z = +1.4)
    const vestMat = makeWallMat(2.2, 1.4);
    for (const side of [-1, 1]) {
      const bulk = new THREE.Mesh(new THREE.BoxGeometry(9.6, 5.4, 0.7), vestMat);
      bulk.position.set(side * 10.2, 2.7, 1.4);
      bulk.castShadow = true;
      bulk.receiveShadow = true;
      this.scene.add(bulk);
      this.registerSolid(bulk, 'concrete');

      // Chipped Hazard Bumper Strip at base
      const trim = new THREE.Mesh(new THREE.BoxGeometry(9.65, 0.24, 0.74), stripeMat);
      trim.position.set(side * 10.2, 0.12, 1.4);
      this.scene.add(trim);
    }

    // Airlock Heavy Blast Door behind spawn
    this.buildBlastDoor(0, 0, 6.95, 'AIRLOCK B3 // SEALED', '#ff4c58');
    // Vault Main Bulkhead Door at far north end
    this.buildBlastDoor(0, 0.65, -34.85, 'CORE VAULT // LEVEL-5', '#ffb038');

    // Wall Structural Pilasters along East & West walls
    for (let z = 4; z >= -32; z -= 6) {
      for (const side of [-1, 1]) {
        const pilaster = new THREE.Mesh(new THREE.BoxGeometry(0.65, 5.4, 0.75), darkSteelMat);
        pilaster.position.set(side * 14.65, 2.7, z);
        pilaster.castShadow = true;
        pilaster.receiveShadow = true;
        this.scene.add(pilaster);
        this.registerSolid(pilaster, 'metal');
      }
    }

    // Wall Signage Plates
    this.addSignPlate(new THREE.Vector3(0, 3.85, 1.02), 0, 'SECTOR-09 // CRYO BAY', 'LIVE FIRE CONTAINMENT PROTOCOL ACTIVE', '#ffb038');
    this.addSignPlate(new THREE.Vector3(-14.85, 3.1, -9.0), Math.PI * 0.5, 'SERVER VAULT WEST', 'QUANTUM TELEMETRY CLUSTER A-04', '#2ce8ff');
    this.addSignPlate(new THREE.Vector3(14.85, 3.1, -9.0), -Math.PI * 0.5, 'CRYO MANIFOLD EAST', 'CAUTION: HIGH PRESSURE LIQUID N2', '#ff5864');

    // 4. ELEVATED COMMAND VAULT PLATFORM (z = -24.5 to -35, height = 0.65m)
    const daisMat = makeWallMat(6, 0.4);
    const daisLeft = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.65, 10.5), daisMat);
    daisLeft.position.set(-9.75, 0.325, -29.75);
    daisLeft.receiveShadow = true;
    this.scene.add(daisLeft);
    this.registerSolid(daisLeft, 'concrete', false, false);

    const daisCenter = new THREE.Mesh(new THREE.BoxGeometry(29.8, 0.65, 10.5), daisMat);
    daisCenter.position.set(0, 0.325, -29.75);
    daisCenter.receiveShadow = true;
    this.scene.add(daisCenter);
    // Floor step height is handled smoothly in player elevation logic; register shootable surface!
    this.registerShootableOnly(daisCenter, 'concrete');

    // Ramp leading onto Command Vault (x in [-3.4, 3.4], z from -22.2 to -24.6)
    const rampGeo = new THREE.BoxGeometry(6.8, 0.25, 2.8);
    const ramp = new THREE.Mesh(rampGeo, daisMat);
    ramp.position.set(0, 0.28, -23.4);
    ramp.rotation.x = 0.235;
    ramp.receiveShadow = true;
    this.scene.add(ramp);
    this.registerShootableOnly(ramp, 'concrete');

    // Waist-high Ballistic Parapets along Dais front edge (left & right of ramp)
    for (const side of [-1, 1]) {
      const wallSeg = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1.15, 0.42), vestMat);
      wallSeg.position.set(side * 8.4, 0.65 + 0.575, -24.6);
      wallSeg.castShadow = true;
      wallSeg.receiveShadow = true;
      this.scene.add(wallSeg);
      this.registerSolid(wallSeg, 'concrete', true, false);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(8.26, 0.14, 0.48), stripeMat);
      cap.position.set(side * 8.4, 0.65 + 1.16, -24.6);
      this.scene.add(cap);
    }

    // 5. FOUR GLOWING CRYO-STASIS CONTainment PODS (Center Spine)
    const podCoords: [number, number][] = [
      [-4.2, -6.2],
      [4.2, -6.2],
      [-4.2, -16.5],
      [4.2, -16.5]
    ];
    for (const [px, pz] of podCoords) {
      this.buildCryoPod(px, pz);
    }

    // 6. WEST LANE: HIGH-DENSITY BLADE SERVER RACKS & BREAKABLE SECURITY GLASS BOOTH
    for (const rz of [-4.2, -7.6, -14.8, -18.2, -21.6]) {
      this.buildServerRack(-11.2, 0, rz, Math.PI * 0.5);
      this.buildServerRack(-13.6, 0, rz, Math.PI * 0.5);
    }
    // Breakable Glass Security Partition in West Lane
    this.buildGlassPartition(-10.2, 1.35, -11.2, 3.8, 2.5, 0.08);
    // Second Breakable Glass Observation Shield on Vault Dais
    this.buildGlassPartition(-5.8, 0.65 + 1.15, -27.8, 3.2, 2.1, 0.08);
    this.buildGlassPartition(5.8, 0.65 + 1.15, -27.8, 3.2, 2.1, 0.08);

    // 7. EAST LANE: INDUSTRIAL PIPE MANIFOLDS, SHOOTABLE STEAM PIPES & EXTINGUISHERS
    for (const pz of [-3.5, -10.5, -17.5]) {
      this.buildSteamPipeAssembly(14.1, pz);
    }
    this.buildFireExtinguisher(-5.35, 1.25, 1.02);
    this.buildFireExtinguisher(14.3, 1.35, -7.0);
    this.buildFireExtinguisher(-14.3, 1.35, -12.8);

    // 8. TACTICAL WAIST-HIGH COVER BARRICADES, PELICAN CASES & EXPLOSIVE CANISTERS
    // Cover barricades carefully placed for Q/E leaning and flanking
    this.buildJerseyBarrier(0, 0, -2.0, 0);
    this.buildJerseyBarrier(-7.2, 0, -3.2, 0.25);
    this.buildJerseyBarrier(7.6, 0, -4.8, -0.22);
    this.buildJerseyBarrier(0, 0, -11.4, 0);
    this.buildJerseyBarrier(8.4, 0, -13.2, 0.18);
    this.buildJerseyBarrier(-7.6, 0, -19.2, -0.15);
    this.buildJerseyBarrier(0, 0, -20.0, 0);

    // Tactical Weapon Crate Stacks with glowing field laptops
    this.buildTacticalCrateStack(2.6, 0, 2.8, -0.3, true);
    this.buildTacticalCrateStack(-2.8, 0, -7.8, 0.2, false);
    this.buildTacticalCrateStack(9.8, 0, -9.2, -0.4, true);
    this.buildTacticalCrateStack(7.4, 0, -19.5, 0.25, false);
    this.buildTacticalCrateStack(-3.4, 0.65, -28.2, 0.12, true);
    this.buildTacticalCrateStack(3.4, 0.65, -28.2, -0.15, false);

    // Explosive Red Cryo-Fuel Canisters (multi-stage leak -> detonation!)
    this.buildExplosiveCanister(-5.6, 0, -9.4);
    this.buildExplosiveCanister(6.4, 0, -12.8);
    this.buildExplosiveCanister(-1.8, 0, -19.2);
    this.buildExplosiveCanister(9.2, 0, -5.8);
    this.buildExplosiveCanister(-8.6, 0, -16.8);
    this.buildExplosiveCanister(2.3, 0.65, -27.4);

    // 9. SHOOTABLE OVERHEAD HANGING LED LIGHT FIXTURES + VOLUMETRIC CONES + SHADOW SPOTLIGHTS
    const lightGrid: [number, number, boolean][] = [
      [0, 3.8, true],
      [-7.5, -4.5, false],
      [7.5, -4.5, true],
      [0, -11.4, true],
      [-8.0, -17.5, false],
      [8.0, -17.5, false],
      [0, -27.5, true]
    ];
    for (const [lx, lz, castsShadow] of lightGrid) {
      this.buildHangingLightFixture(lx, lz, castsShadow);
    }

    // Rotating Red Emergency Beacons on Rear Vault Wall
    this.buildEmergencyBeacon(-9.5, 4.5, -34.6);
    this.buildEmergencyBeacon(9.5, 4.5, -34.6);

    // 10. OBJECTIVE MAINFRAME TERMINAL ON ELEVATED VAULT DAIS
    this.buildMainframeTerminal(0, 0.65, -31.5);
  }

  private buildBlastDoor(x: number, y: number, z: number, label: string, accent: string): void {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1a212b,
      normalMap: this.textures.gunmetalNormal,
      roughness: 0.4,
      metalness: 0.88
    });
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x2a3442,
      normalMap: this.textures.wallNormal,
      roughness: 0.48,
      metalness: 0.78
    });

    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.5, 0.45), frameMat);
    frameTop.position.y = 3.65;
    grp.add(frameTop);

    for (const s of [-1, 1]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.9, 0.45), frameMat);
      jamb.position.set(s * 2.08, 1.95, 0);
      grp.add(jamb);

      const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.82, 3.4, 0.24), leafMat);
      leaf.position.set(s * 0.93, 1.7, 0);
      grp.add(leaf);
    }

    const signTex = makeStencilSignTexture(label, 'BIOMETRIC LOCK ENGAGED', accent);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.9),
      new THREE.MeshStandardMaterial({
        map: signTex,
        emissive: new THREE.Color(accent),
        emissiveMap: signTex,
        emissiveIntensity: 0.55,
        roughness: 0.35
      })
    );
    sign.position.set(0, 4.35, z > 0 ? -0.24 : 0.24);
    if (z > 0) sign.rotation.y = Math.PI;
    grp.add(sign);

    this.scene.add(grp);
    this.registerShootableOnly(grp, 'metal');
  }

  private addSignPlate(pos: THREE.Vector3, rotY: number, title: string, sub: string, accent: string): void {
    const tex = makeStencilSignTexture(title, sub, accent);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.96),
      new THREE.MeshStandardMaterial({
        map: tex,
        emissive: new THREE.Color(accent),
        emissiveMap: tex,
        emissiveIntensity: 0.42,
        roughness: 0.35,
        metalness: 0.5
      })
    );
    mesh.position.copy(pos);
    mesh.rotation.y = rotY;
    this.scene.add(mesh);
  }

  private buildCryoPod(x: number, z: number): void {
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);

    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1d2632,
      normalMap: this.textures.gunmetalNormal,
      roughness: 0.38,
      metalness: 0.86
    });
    const hazardMat = new THREE.MeshStandardMaterial({
      map: this.textures.hazardAlbedo,
      roughness: 0.55,
      metalness: 0.35
    });

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.32, 0.72, 8), baseMat);
    pedestal.position.y = 0.36;
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    grp.add(pedestal);

    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.22, 0.14, 8), hazardMat);
    ring.position.y = 0.74;
    grp.add(ring);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.28, 1.16, 0.85, 8), baseMat);
    cap.position.y = 4.95;
    cap.castShadow = true;
    grp.add(cap);

    // 4 Structural Vertical Ribs around Glass Tube
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI * 0.25;
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.8, 0.12), baseMat);
      strut.position.set(Math.cos(a) * 1.04, 2.75, Math.sin(a) * 1.04);
      strut.castShadow = true;
      grp.add(strut);
    }

    // Glowing Bioluminescent Cyan Fluid Core
    const fluidMat = new THREE.MeshStandardMaterial({
      color: 0x0d98ba,
      emissive: new THREE.Color(0x14d8ff),
      emissiveIntensity: 1.55,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.58
    });
    const fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 3.7, 18), fluidMat);
    fluid.position.y = 2.7;
    grp.add(fluid);

    // Suspended Inner Specimen Capsule
    const core = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, 1.15, 6, 12),
      new THREE.MeshStandardMaterial({
        color: 0x09131c,
        emissive: new THREE.Color(0x0cf0ff),
        emissiveIntensity: 0.65,
        roughness: 0.3,
        metalness: 0.8
      })
    );
    core.position.y = 2.7;
    grp.add(core);
    this.cryoCores.push(core);
    this.cryoPositions.push(new THREE.Vector3(x, 0.25, z));

    // Outer Armored Glass Cylinder
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.96, 0.96, 3.75, 20, 1, true),
      new THREE.MeshPhysicalMaterial({
        color: 0xc8f4ff,
        roughness: 0.06,
        metalness: 0.08,
        transparent: true,
        opacity: 0.32
      })
    );
    glass.position.y = 2.7;
    grp.add(glass);

    // Cyan PointLight illuminating nearby puddles & gunmetal
    const glow = new THREE.PointLight(0x1ce2ff, 4.2, 9.5, 2.0);
    glow.position.set(0, 2.3, 0);
    grp.add(glow);

    this.scene.add(grp);
    const colBox = new THREE.Box3(
      new THREE.Vector3(x - 1.15, 0, z - 1.15),
      new THREE.Vector3(x + 1.15, 5.4, z + 1.15)
    );
    this.registerSolid(grp, 'metal', true, true, colBox);
  }

  private buildServerRack(x: number, y: number, z: number, rotY: number): void {
    const bodyMats = [
      new THREE.MeshStandardMaterial({ color: 0x161d26, roughness: 0.45, metalness: 0.82 }),
      new THREE.MeshStandardMaterial({ color: 0x161d26, roughness: 0.45, metalness: 0.82 }),
      new THREE.MeshStandardMaterial({ color: 0x161d26, roughness: 0.45, metalness: 0.82 }),
      new THREE.MeshStandardMaterial({ color: 0x161d26, roughness: 0.45, metalness: 0.82 }),
      new THREE.MeshStandardMaterial({
        map: this.textures.serverAlbedo,
        normalMap: this.textures.serverNormal,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: this.textures.serverEmissive,
        emissiveIntensity: 1.85,
        roughness: 0.35,
        metalness: 0.72
      }),
      new THREE.MeshStandardMaterial({
        map: this.textures.serverAlbedo,
        normalMap: this.textures.serverNormal,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: this.textures.serverEmissive,
        emissiveIntensity: 1.4,
        roughness: 0.35,
        metalness: 0.72
      })
    ];
    const rack = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.65, 0.95), bodyMats);
    rack.position.set(x, y + 1.325, z);
    rack.rotation.y = rotY;
    rack.castShadow = true;
    rack.receiveShadow = true;
    this.scene.add(rack);
    this.registerSolid(rack, 'metal');
  }

  private buildGlassPartition(x: number, y: number, z: number, w: number, h: number, d: number): void {
    const id = `prop_${++this.propCounter}`;
    const frameGrp = new THREE.Group();
    frameGrp.position.set(x, y, z);

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x222c38, metalness: 0.85, roughness: 0.35 });
    const bot = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.14, d + 0.08), frameMat);
    bot.position.y = -h * 0.5;
    frameGrp.add(bot);
    this.scene.add(frameGrp);

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xaee8ff,
      roughness: 0.07,
      metalness: 0.1,
      transparent: true,
      opacity: 0.38
    });
    const glassMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glassMat);
    glassMesh.position.set(x, y, z);
    this.scene.add(glassMesh);

    const colIdx = this.registerSolid(glassMesh, 'glass', true, false);
    glassMesh.userData.destructibleId = id;
    this.destructibles.set(id, {
      id,
      kind: 'glass_panel',
      mesh: glassMesh,
      hp: 35,
      maxHp: 35,
      destroyed: false,
      colliderIndex: colIdx
    });
  }

  private buildJerseyBarrier(x: number, y: number, z: number, rotY: number): void {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    grp.rotation.y = rotY;

    const concMat = new THREE.MeshStandardMaterial({
      map: this.textures.wallAlbedo,
      normalMap: this.textures.wallNormal,
      roughness: 0.86,
      metalness: 0.12
    });
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.45, 0.72), concMat);
    base.position.y = 0.225;
    base.castShadow = true;
    base.receiveShadow = true;
    grp.add(base);

    const upper = new THREE.Mesh(new THREE.BoxGeometry(3.15, 0.72, 0.44), concMat);
    upper.position.y = 0.80;
    upper.castShadow = true;
    upper.receiveShadow = true;
    grp.add(upper);

    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(3.18, 0.16, 0.47),
      new THREE.MeshStandardMaterial({
        map: this.textures.hazardAlbedo,
        roughness: 0.6,
        metalness: 0.3
      })
    );
    stripe.position.y = 1.08;
    grp.add(stripe);

    this.scene.add(grp);
    this.registerSolid(grp, 'concrete', true, false);
  }

  private buildTacticalCrateStack(x: number, y: number, z: number, rotY: number, withLaptop: boolean): void {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    grp.rotation.y = rotY;

    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x262f2b,
      normalMap: this.textures.stippleNormal,
      roughness: 0.62,
      metalness: 0.35
    });
    const latchMat = new THREE.MeshStandardMaterial({ color: 0x8b95a2, metalness: 0.9, roughness: 0.3 });

    const lower = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.68, 0.95), crateMat);
    lower.position.y = 0.34;
    lower.castShadow = true;
    lower.receiveShadow = true;
    grp.add(lower);

    const upper = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.52, 0.78), crateMat);
    upper.position.set(-0.08, 0.94, 0.04);
    upper.rotation.y = 0.14;
    upper.castShadow = true;
    upper.receiveShadow = true;
    grp.add(upper);

    for (const lx of [-0.45, 0.45]) {
      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.98), latchMat);
      latch.position.set(lx, 0.36, 0);
      grp.add(latch);
    }

    if (withLaptop) {
      const id = `prop_${++this.propCounter}`;
      const monGrp = new THREE.Group();
      monGrp.position.set(0.18, 1.21, 0.05);
      monGrp.rotation.y = 0.35;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.30), latchMat);
      const scrMat = new THREE.MeshStandardMaterial({
        color: 0x0b2230,
        emissive: new THREE.Color(0x22d8ff),
        emissiveIntensity: 1.5,
        roughness: 0.2
      });
      const scr = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.025), scrMat);
      scr.position.set(0, 0.14, -0.14);
      scr.rotation.x = 0.22;
      monGrp.add(base, scr);
      grp.add(monGrp);
      this.registerShootableOnly(monGrp, 'glass', id);
      this.destructibles.set(id, {
        id,
        kind: 'monitor',
        mesh: monGrp,
        hp: 15,
        maxHp: 15,
        destroyed: false,
        emissiveMat: scrMat
      });
    }

    this.scene.add(grp);
    this.registerSolid(grp, 'metal', true, false);
  }

  private buildExplosiveCanister(x: number, y: number, z: number): void {
    const id = `prop_${++this.propCounter}`;
    const grp = new THREE.Group();
    grp.position.set(x, y, z);

    const redMat = new THREE.MeshStandardMaterial({
      color: 0xb82028,
      normalMap: this.textures.gunmetalNormal,
      roughness: 0.34,
      metalness: 0.62
    });
    const capMat = new THREE.MeshStandardMaterial({
      map: this.textures.hazardAlbedo,
      roughness: 0.5,
      metalness: 0.5
    });

    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.05, 16), redMat);
    tank.position.y = 0.525;
    tank.castShadow = true;
    tank.receiveShadow = true;
    grp.add(tank);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.275, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), redMat);
    dome.position.y = 1.04;
    grp.add(dome);

    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.286, 0.286, 0.16, 16), capMat);
    band.position.y = 0.72;
    grp.add(band);

    const valve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 0.18, 10),
      new THREE.MeshStandardMaterial({ color: 0xd4a84f, metalness: 0.9, roughness: 0.25 })
    );
    valve.position.y = 1.32;
    grp.add(valve);

    this.scene.add(grp);
    const colIdx = this.registerSolid(grp, 'hazard_canister', true, false);
    grp.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) c.userData.destructibleId = id;
    });
    this.destructibles.set(id, {
      id,
      kind: 'canister',
      mesh: grp,
      hp: 48,
      maxHp: 48,
      destroyed: false,
      colliderIndex: colIdx
    });
  }

  private buildSteamPipeAssembly(x: number, z: number): void {
    const id = `prop_${++this.propCounter}`;
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x8b959e,
      normalMap: this.textures.gunmetalNormal,
      roughness: 0.30,
      metalness: 0.88
    });
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 4.6, 14), pipeMat);
    pipe.position.set(x, 2.3, z);
    pipe.castShadow = true;
    this.scene.add(pipe);

    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.025, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0xd63030, roughness: 0.4, metalness: 0.6 })
    );
    wheel.position.set(x - 0.15, 1.65, z);
    wheel.rotation.y = Math.PI * 0.5;
    this.scene.add(wheel);

    this.registerShootableOnly(pipe, 'steam_pipe', id);
    this.registerShootableOnly(wheel, 'steam_pipe', id);
    this.destructibles.set(id, {
      id,
      kind: 'steam_pipe',
      mesh: pipe,
      hp: 20,
      maxHp: 20,
      destroyed: false
    });
  }

  private buildFireExtinguisher(x: number, y: number, z: number): void {
    const id = `prop_${++this.propCounter}`;
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.52, 12),
      new THREE.MeshStandardMaterial({ color: 0xc91e28, roughness: 0.28, metalness: 0.65 })
    );
    const nozzle = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.12, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x22262c, metalness: 0.8, roughness: 0.3 })
    );
    nozzle.position.y = 0.30;
    grp.add(body, nozzle);
    this.scene.add(grp);
    this.registerShootableOnly(grp, 'extinguisher', id);
    this.destructibles.set(id, {
      id,
      kind: 'extinguisher',
      mesh: grp,
      hp: 16,
      maxHp: 16,
      destroyed: false
    });
  }

  private buildHangingLightFixture(x: number, z: number, castsShadow: boolean): void {
    const id = `prop_${++this.propCounter}`;
    const grp = new THREE.Group();
    grp.position.set(x, 4.72, z);

    const hoodMat = new THREE.MeshStandardMaterial({ color: 0x1b222c, metalness: 0.85, roughness: 0.38 });
    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.14, 0.46), hoodMat);
    grp.add(hood);

    for (const cx of [-0.9, 0.9]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6), hoodMat);
      rod.position.set(cx, 0.35, 0);
      grp.add(rod);
    }

    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0xeaf6ff,
      emissive: new THREE.Color(0xcce8ff),
      emissiveIntensity: 3.4,
      roughness: 0.15
    });
    const tube = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.06, 0.30), tubeMat);
    tube.position.y = -0.07;
    grp.add(tube);

    // Soft Fresnel + Vertical Attenuation Volumetric God-Ray Shader (zero hard cone edges!)
    const coneGeo = new THREE.ConeGeometry(3.3, 4.65, 28, 1, true);
    const coneMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x8ecaff) }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewPos;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPos.xyz;
          vNormalView = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewPos;
        void main() {
          vec3 viewDir = normalize(vViewPos);
          float fresnel = pow(abs(dot(normalize(vNormalView), viewDir)), 2.35);
          float vertFade = pow(clamp(vUv.y, 0.0, 1.0), 1.75) * smoothstep(1.0, 0.86, vUv.y);
          float alpha = fresnel * vertFade * 0.135;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.y = -2.38;
    cone.name = 'volumetric_cone';
    grp.add(cone);

    // Real Spotlight illuminating scene + puddles
    const spot = new THREE.SpotLight(0xd6ebff, castsShadow ? 26 : 18, 17, Math.PI * 0.40, 0.58, 1.7);
    spot.position.set(x, 4.6, z);
    spot.target.position.set(x, 0, z);
    if (castsShadow) {
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0004;
      spot.shadow.camera.near = 0.8;
      spot.shadow.camera.far = 16;
    }
    this.scene.add(spot);
    this.scene.add(spot.target);
    this.scene.add(grp);

    // Only hood and tube are shootable (never cone!)
    hood.userData.surface = 'light_fixture';
    hood.userData.destructibleId = id;
    tube.userData.surface = 'light_fixture';
    tube.userData.destructibleId = id;
    this.raycastTargets.push(hood, tube);

    this.destructibles.set(id, {
      id,
      kind: 'ceiling_light',
      mesh: grp,
      hp: 18,
      maxHp: 18,
      destroyed: false,
      lightRef: spot,
      emissiveMat: tubeMat
    });
  }

  private buildEmergencyBeacon(x: number, y: number, z: number): void {
    const mount = new THREE.Group();
    mount.position.set(x, y, z);

    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 0.28, 12),
      new THREE.MeshStandardMaterial({
        color: 0xff2233,
        emissive: new THREE.Color(0xff1e2d),
        emissiveIntensity: 2.8,
        roughness: 0.2
      })
    );
    mount.add(housing);

    const pivot = new THREE.Object3D();
    const spot = new THREE.SpotLight(0xff2636, 18, 18, 0.55, 0.65, 1.6);
    spot.position.set(0, 0, 0);
    spot.target.position.set(0, -1.5, 6);
    pivot.add(spot);
    pivot.add(spot.target);
    mount.add(pivot);

    const pt = new THREE.PointLight(0xff2636, 2.2, 7, 2);
    mount.add(pt);

    this.scene.add(mount);
    this.emergencyBeacons.push({ pivot, light: pt });
  }

  private buildMainframeTerminal(x: number, y: number, z: number): void {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a232e,
      normalMap: this.textures.gunmetalNormal,
      roughness: 0.35,
      metalness: 0.85
    });
    const consoleBase = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.08, 0.95), bodyMat);
    consoleBase.position.y = 0.54;
    consoleBase.castShadow = true;
    consoleBase.receiveShadow = true;
    grp.add(consoleBase);

    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 512;
    screenCanvas.height = 256;
    const screenTex = new THREE.CanvasTexture(screenCanvas);
    screenTex.colorSpace = THREE.SRGBColorSpace;

    const screenMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.75, 0.88),
      new THREE.MeshStandardMaterial({
        map: screenTex,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: screenTex,
        emissiveIntensity: 1.5,
        roughness: 0.2
      })
    );
    screenMesh.position.set(0, 1.48, 0.12);
    screenMesh.rotation.x = -0.22;
    grp.add(screenMesh);

    const termLight = new THREE.PointLight(0xffaa33, 3.8, 7.5, 2);
    termLight.position.set(0, 1.75, 0.65);
    grp.add(termLight);

    this.scene.add(grp);
    this.registerSolid(grp, 'metal', true, false);

    this.terminal = {
      position: new THREE.Vector3(x, y + 1.2, z + 0.55),
      mesh: grp,
      activated: false,
      screenCanvas,
      screenTex
    };
    this.updateTerminalScreen('LOCKDOWN ACTIVE', 'CLEAR ALL AEGIS UNITS TO UNLOCK', '#ff4c58');
  }

  public updateTerminalScreen(status: string, sub: string, color: string): void {
    const ctx = this.terminal.screenCanvas.getContext('2d')!;
    ctx.fillStyle = '#071019';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.strokeRect(12, 12, 488, 232);

    ctx.fillStyle = color;
    ctx.font = 'bold 20px Consolas, monospace';
    ctx.fillText('SECTOR-09 // CORE OVERRIDE TERMINAL', 28, 52);

    ctx.fillStyle = '#eef7ff';
    ctx.font = 'bold 36px Bahnschrift, Consolas, sans-serif';
    ctx.fillText(status, 28, 126);

    ctx.fillStyle = color;
    ctx.font = '20px Consolas, monospace';
    ctx.fillText(sub, 28, 178);
    this.terminal.screenTex.needsUpdate = true;
  }

  public damageProp(
    id: string,
    damage: number,
    hitPoint: THREE.Vector3,
    hitNormal: THREE.Vector3,
    fx: EffectsManager,
    onExplosion?: (center: THREE.Vector3, radius: number, maxDmg: number) => void
  ): void {
    const prop = this.destructibles.get(id);
    if (!prop || prop.destroyed) return;

    prop.hp -= damage;

    if (prop.kind === 'canister') {
      // First hit starts pressurized flame jet; destruction triggers full explosion!
      if (!prop.leaking && prop.hp > 0) {
        prop.leaking = true;
        prop.leakPoint = hitPoint.clone();
        prop.leakNormal = hitNormal.clone();
        prop.leakTimer = 2.1;
      }
      if (prop.hp <= 0) {
        this.detonateCanister(prop, fx, onExplosion);
      }
      return;
    }

    if (prop.kind === 'steam_pipe' || prop.kind === 'extinguisher') {
      if (!prop.leaking) {
        prop.leaking = true;
        prop.leakPoint = hitPoint.clone();
        prop.leakNormal = hitNormal.clone();
        prop.leakTimer = prop.kind === 'extinguisher' ? 4.5 : 9.0;
        if (prop.kind === 'extinguisher') {
          prop.destroyed = true;
          fx.spawnSmoke(hitPoint, new THREE.Vector3(0, 1.5, 0), 0.4, 2.6, 1.4, 0xeef6ff, 0.65);
        }
      }
      return;
    }

    if (prop.hp <= 0) {
      prop.destroyed = true;
      if (prop.kind === 'glass_panel') {
        const box = new THREE.Box3().setFromObject(prop.mesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
        fx.spawnGlassShatter(center, size, 48);
        prop.mesh.visible = false;
        if (prop.colliderIndex !== undefined) {
          this.colliders[prop.colliderIndex].blocksMovement = false;
          this.colliders[prop.colliderIndex].blocksSight = false;
        }
      } else if (prop.kind === 'ceiling_light') {
        fx.spawnSparks(hitPoint, new THREE.Vector3(0, -1, 0), 34, 0x66ddff, 8.5);
        if (prop.lightRef) prop.lightRef.intensity = 0;
        if (prop.emissiveMat) prop.emissiveMat.emissiveIntensity = 0.05;
        const cone = prop.mesh.getObjectByName('volumetric_cone');
        if (cone) cone.visible = false;
      } else if (prop.kind === 'monitor') {
        fx.spawnSparks(hitPoint, hitNormal, 22, 0x33e8ff, 6.5);
        if (prop.emissiveMat) {
          prop.emissiveMat.emissiveIntensity = 0;
          prop.emissiveMat.color.setHex(0x050608);
        }
      }
    }
  }

  private detonateCanister(
    prop: DestructibleProp,
    fx: EffectsManager,
    onExplosion?: (center: THREE.Vector3, radius: number, maxDmg: number) => void
  ): void {
    if (prop.destroyed) return;
    prop.destroyed = true;
    prop.leaking = false;
    prop.mesh.visible = false;
    if (prop.colliderIndex !== undefined) {
      this.colliders[prop.colliderIndex].blocksMovement = false;
    }
    const center = prop.mesh.position.clone().add(new THREE.Vector3(0, 0.55, 0));
    fx.spawnExplosion(center);
    if (onExplosion) onExplosion(center, 6.5, 190);
  }

  public setQuality(q: QualityPreset): void {
    this.floorReflector.visible = q !== 'perf';
  }

  public update(
    dt: number,
    elapsed: number,
    fx: EffectsManager,
    onExplosion?: (center: THREE.Vector3, radius: number, maxDmg: number) => void
  ): void {
    // Rotate Vault Emergency Red Beacons
    for (let i = 0; i < this.emergencyBeacons.length; i++) {
      const b = this.emergencyBeacons[i];
      b.pivot.rotation.y = elapsed * 3.8 + i * Math.PI;
      b.light.intensity = 1.6 + Math.sin(elapsed * 7.6 + i) * 1.1;
    }

    // Bob Cryo-Pod Specimens + emit floor cryo mist wisps
    for (let i = 0; i < this.cryoCores.length; i++) {
      this.cryoCores[i].position.y = 2.7 + Math.sin(elapsed * 1.4 + i * 1.7) * 0.14;
      this.cryoCores[i].rotation.y = elapsed * 0.35 + i;
      if (Math.random() < dt * 2.2) {
        const p = this.cryoPositions[i];
        const ang = Math.random() * Math.PI * 2;
        fx.spawnSmoke(
          new THREE.Vector3(p.x + Math.cos(ang) * 1.25, 0.12, p.z + Math.sin(ang) * 1.25),
          new THREE.Vector3(Math.cos(ang) * 0.45, 0.08, Math.sin(ang) * 0.45),
          0.35,
          1.35,
          1.6,
          0x9be8ff,
          0.14
        );
      }
    }

    // Update punctured leaking canisters / steam pipes
    for (const prop of this.destructibles.values()) {
      if (!prop.leaking || !prop.leakPoint || !prop.leakNormal) continue;
      prop.leakTimer = (prop.leakTimer ?? 0) - dt;

      if (prop.kind === 'canister') {
        if (Math.random() < 0.65) {
          fx.spawnSmoke(
            prop.leakPoint,
            prop.leakNormal.clone().multiplyScalar(3.6).add(new THREE.Vector3(0, 1.4, 0)),
            0.12,
            0.55,
            0.22,
            0xff8822,
            0.75,
            true
          );
        }
        if ((prop.leakTimer ?? 0) <= 0 && !prop.destroyed) {
          this.detonateCanister(prop, fx, onExplosion);
        }
      } else {
        // High-pressure white steam / CO2 jet
        if (Math.random() < 0.75) {
          fx.spawnSmoke(
            prop.leakPoint,
            prop.leakNormal.clone().multiplyScalar(5.2).add(new THREE.Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7, 0)),
            0.10,
            0.95,
            0.48,
            0xe6f2ff,
            0.34,
            false
          );
        }
        if ((prop.leakTimer ?? 0) <= 0) {
          prop.leaking = false;
        }
      }
    }
  }

  /**
   * Smooth floor elevation helper (handles the ramp from z = -22.0 up to the +0.65m Command Dais at z <= -24.6)
   */
  public getFloorHeight(x: number, z: number): number {
    if (z <= -24.6) return 0.65;
    if (z < -22.0 && Math.abs(x) < 3.45) {
      const t = (-22.0 - z) / 2.6;
      return THREE.MathUtils.clamp(t, 0, 1) * 0.65;
    }
    return 0.0;
  }
}
