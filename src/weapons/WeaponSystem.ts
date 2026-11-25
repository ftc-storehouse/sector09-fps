import * as THREE from 'three';
import type { PBRMaterialTextures } from '../core/ProceduralTextures';
import type { AudioEngine } from '../core/AudioEngine';
import type { EffectsManager } from '../fx/EffectsManager';

export class WeaponSystem {
  public weaponScene: THREE.Scene;
  public weaponCamera: THREE.PerspectiveCamera;

  // Ammo & State
  public readonly MAG_SIZE = 30;
  public magAmmo = 31; // 30 + 1 chambered!
  public reserveAmmo = 180;
  public fireMode: 'auto' | 'semi' = 'auto';
  public suppressed = false;
  public tacLightOn = true;
  public isReloading = false;
  public adsAmount = 0; // 0 = hip, 1 = full holographic ADS

  // Recoil & heat outputs read by Game/PostFX
  public cameraPitchRecoil = 0;
  public cameraYawRecoil = 0;
  public lastShotPulse = 0;
  public barrelHeat = 0;

  // World-space attachments (laser beam + M600 scout flashlight)
  public worldTacLight: THREE.SpotLight;
  private worldLaserBeam: THREE.Mesh;
  private worldLaserDot: THREE.Sprite;

  // Viewmodel hierarchy
  private rigRoot = new THREE.Group();
  private gunGroup = new THREE.Group();
  private boltMesh!: THREE.Mesh;
  private magGroup = new THREE.Group();
  private visibleRounds: THREE.Mesh[] = [];
  private suppressorMesh!: THREE.Mesh;
  private selectorMesh!: THREE.Mesh;
  private leftHandGroup = new THREE.Group();
  private holoReticleMesh!: THREE.Mesh;
  private muzzleStarMesh!: THREE.Mesh;
  private muzzleSideMesh!: THREE.Mesh;
  private viewMuzzleLight!: THREE.PointLight;
  private barrelHeatMat!: THREE.MeshStandardMaterial;

  // Viewmodel dynamic local lighting synced to world
  private vmKeyLight: THREE.DirectionalLight;
  private vmCryoRimLight: THREE.PointLight;
  private vmHazardRimLight: THREE.PointLight;

  // OLED Side Display
  private oledCanvas: HTMLCanvasElement;
  private oledTex: THREE.CanvasTexture;
  private lastOledKey = '';

  // Timers & procedural spring states
  private fireCooldown = 0;
  private triggerReleased = true;
  private reloadTimer = 0;
  private reloadDuration = 2.05;
  private reloadWasEmpty = false;
  private reloadStagePlayed = 0;
  private inspectTimer = 0;
  private suppressorAnim = 0;
  private muzzleFlashTimer = 0;

  private swayPos = new THREE.Vector3();
  private swayRot = new THREE.Vector3();
  private recoilOffset = new THREE.Vector3();
  private recoilRot = new THREE.Vector3();
  private bobPhase = 0;

  private audio: AudioEngine;
  private fx: EffectsManager;

  constructor(
    worldScene: THREE.Scene,
    envMap: THREE.Texture | null,
    textures: PBRMaterialTextures,
    audio: AudioEngine,
    fx: EffectsManager
  ) {
    this.audio = audio;
    this.fx = fx;

    this.weaponScene = new THREE.Scene();
    this.weaponScene.environment = envMap;
    this.weaponCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.02, 5.0);

    // Viewmodel lights so CNC metal & FDE anodizing look photoreal
    const vmHemi = new THREE.HemisphereLight(0x9ec8ff, 0x1a222d, 0.65);
    this.weaponScene.add(vmHemi);

    this.vmKeyLight = new THREE.DirectionalLight(0xdceeff, 2.2);
    this.vmKeyLight.position.set(0.6, 1.4, 0.5);
    this.weaponScene.add(this.vmKeyLight);

    this.vmCryoRimLight = new THREE.PointLight(0x1ce2ff, 1.6, 3.0);
    this.vmCryoRimLight.position.set(-0.55, 0.25, -0.35);
    this.weaponScene.add(this.vmCryoRimLight);

    this.vmHazardRimLight = new THREE.PointLight(0xff5533, 0.9, 3.0);
    this.vmHazardRimLight.position.set(0.55, 0.15, -0.55);
    this.weaponScene.add(this.vmHazardRimLight);

    // Side-mounted Tactical OLED Ammo/Temp Canvas
    this.oledCanvas = document.createElement('canvas');
    this.oledCanvas.width = 256;
    this.oledCanvas.height = 128;
    this.oledTex = new THREE.CanvasTexture(this.oledCanvas);
    this.oledTex.colorSpace = THREE.SRGBColorSpace;

    this.buildCarbineGeometry(textures);
    this.rigRoot.add(this.gunGroup);
    this.weaponScene.add(this.rigRoot);

    // World-space M600 Tactical Scout Flashlight (casts dynamic shadows!)
    this.worldTacLight = new THREE.SpotLight(0xf2f8ff, 34, 26, 0.44, 0.52, 1.5);
    this.worldTacLight.castShadow = true;
    this.worldTacLight.shadow.mapSize.set(1024, 1024);
    this.worldTacLight.shadow.bias = -0.0003;
    this.worldTacLight.shadow.camera.near = 0.35;
    this.worldTacLight.shadow.camera.far = 25;
    worldScene.add(this.worldTacLight);
    worldScene.add(this.worldTacLight.target);

    // World-space PEQ-15 Green Tactical Laser Beam + Surface Dot
    const beamGeo = new THREE.CylinderGeometry(0.0016, 0.0016, 1.0, 6);
    beamGeo.rotateX(Math.PI * 0.5);
    const beamMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.25, 3.2, 0.85),
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.worldLaserBeam = new THREE.Mesh(beamGeo, beamMat);
    this.worldLaserBeam.frustumCulled = false;
    worldScene.add(this.worldLaserBeam);

    const dotMat = new THREE.SpriteMaterial({
      map: textures.glowSprite,
      color: new THREE.Color(0.4, 4.0, 1.1),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.worldLaserDot = new THREE.Sprite(dotMat);
    this.worldLaserDot.scale.setScalar(0.055);
    worldScene.add(this.worldLaserDot);

    this.refreshOledDisplay();
  }

  private buildCarbineGeometry(textures: PBRMaterialTextures): void {
    // Authentic Two-Tone SIG MCX-Spear / CAG Custom Materials:
    // Anodized FDE Bronze-Tan CNC Upper & M-LOK Handguard + Matte Parkerized Black Steel + Nickel-Boron Bolt
    const fdeAnodized = new THREE.MeshStandardMaterial({
      color: 0x7c6a52,
      normalMap: textures.gunmetalNormal,
      normalScale: new THREE.Vector2(0.45, 0.45),
      metalness: 0.84,
      roughness: 0.31
    });

    const matteBlackMetal = new THREE.MeshStandardMaterial({
      color: 0x1c2128,
      normalMap: textures.gunmetalNormal,
      normalScale: new THREE.Vector2(0.5, 0.5),
      metalness: 0.88,
      roughness: 0.36
    });

    const polymerStipple = new THREE.MeshStandardMaterial({
      color: 0x181b1f,
      normalMap: textures.stippleNormal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      metalness: 0.12,
      roughness: 0.76
    });

    const chromeBoltMat = new THREE.MeshStandardMaterial({
      color: 0xd5dce3,
      normalMap: textures.gunmetalNormal,
      metalness: 0.96,
      roughness: 0.16
    });

    const burntTitaniumMat = new THREE.MeshStandardMaterial({
      color: 0x564c44,
      normalMap: textures.gunmetalNormal,
      metalness: 0.90,
      roughness: 0.27
    });

    this.barrelHeatMat = new THREE.MeshStandardMaterial({
      color: 0x262b32,
      normalMap: textures.gunmetalNormal,
      emissive: new THREE.Color(0xff3b08),
      emissiveIntensity: 0.0,
      metalness: 0.9,
      roughness: 0.32
    });

    // 1. UPPER & LOWER BILLET RECEIVERS
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.040, 0.044, 0.23), fdeAnodized);
    upper.position.set(0, 0.008, -0.015);
    this.gunGroup.add(upper);

    // Beveled Upper Top Bridge
    const upperBridge = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.010, 0.50), fdeAnodized);
    upperBridge.position.set(0, 0.032, -0.15);
    this.gunGroup.add(upperBridge);

    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.042, 0.175), fdeAnodized);
    lower.position.set(0, -0.028, -0.005);
    this.gunGroup.add(lower);

    // Magwell Flared Skirt
    const magwell = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.034, 0.078), fdeAnodized);
    magwell.position.set(0, -0.046, -0.055);
    this.gunGroup.add(magwell);

    // Ejection Port Recess + Reciprocating Chrome Bolt Carrier Group
    const portRecess = new THREE.Mesh(
      new THREE.BoxGeometry(0.006, 0.018, 0.068),
      new THREE.MeshBasicMaterial({ color: 0x050608 })
    );
    portRecess.position.set(0.0185, 0.012, -0.042);
    this.gunGroup.add(portRecess);

    this.boltMesh = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.016, 0.064), chromeBoltMat);
    this.boltMesh.position.set(0.0175, 0.012, -0.042);
    this.gunGroup.add(this.boltMesh);

    // Brass Deflector & Forward Assist on right side
    const deflector = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.016, 4), fdeAnodized);
    deflector.rotation.z = -Math.PI * 0.5;
    deflector.position.set(0.023, 0.012, -0.002);
    this.gunGroup.add(deflector);

    const fwdAssist = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.024, 10), matteBlackMetal);
    fwdAssist.rotation.x = Math.PI * 0.5;
    fwdAssist.rotation.y = 0.28;
    fwdAssist.position.set(0.021, 0.006, 0.035);
    this.gunGroup.add(fwdAssist);

    // Rear T-Charging Handle + Tucked Shoulder Stock Buffer Strut
    const chargingHandle = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.008, 0.018), matteBlackMetal);
    chargingHandle.position.set(0, 0.025, 0.088);
    this.gunGroup.add(chargingHandle);

    const stockStrut = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.030, 0.13), matteBlackMetal);
    stockStrut.position.set(0, -0.016, 0.135);
    this.gunGroup.add(stockStrut);

    // Ambidextrous Fire Selector Switch (left side, visible!)
    this.selectorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.007, 0.024), matteBlackMetal);
    this.selectorMesh.position.set(-0.021, -0.022, 0.032);
    this.gunGroup.add(this.selectorMesh);

    // Ergonomic Stippled Pistol Grip + Trigger Guard + Curved Match Trigger
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.098, 0.044), polymerStipple);
    grip.position.set(0, -0.088, 0.045);
    grip.rotation.x = 0.29;
    this.gunGroup.add(grip);

    const trigGuard = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.005, 0.044), matteBlackMetal);
    trigGuard.position.set(0, -0.056, 0.006);
    this.gunGroup.add(trigGuard);

    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.020, 0.007), chromeBoltMat);
    trigger.position.set(0, -0.045, 0.012);
    trigger.rotation.x = 0.25;
    this.gunGroup.add(trigger);

    // 2. VENTILATED M-LOK HANDGUARD + GLOWING FLUTED BARREL + GAS BLOCK
    // Upper/lower/side rails with open slots so glowing red barrel shines through!
    const hgTop = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.012, 0.28), fdeAnodized);
    hgTop.position.set(0, 0.024, -0.265);
    const hgBot = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.012, 0.28), fdeAnodized);
    hgBot.position.set(0, -0.014, -0.265);
    this.gunGroup.add(hgTop, hgBot);

    for (const side of [-1, 1]) {
      for (let seg = 0; seg < 4; seg++) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.030, 0.046), fdeAnodized);
        strut.position.set(side * 0.0185, 0.005, -0.155 - seg * 0.068);
        this.gunGroup.add(strut);
      }
    }

    // Internal Fluted Steel Barrel (heats up!)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0105, 0.38, 14), this.barrelHeatMat);
    barrel.rotation.x = Math.PI * 0.5;
    barrel.position.set(0, 0.006, -0.31);
    this.gunGroup.add(barrel);

    // 3-Chamber Muzzle Brake + Quick-Detach Burnt-Titanium SOCOM Suppressor ([V] key)
    const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.055, 12), matteBlackMetal);
    muzzleBrake.rotation.x = Math.PI * 0.5;
    muzzleBrake.position.set(0, 0.006, -0.515);
    this.gunGroup.add(muzzleBrake);

    this.suppressorMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0195, 0.0195, 0.165, 18), burntTitaniumMat);
    this.suppressorMesh.rotation.x = Math.PI * 0.5;
    this.suppressorMesh.position.set(0, 0.006, -0.565);
    this.suppressorMesh.visible = false;
    this.gunGroup.add(this.suppressorMesh);

    // Underbarrel Angled Carbon-Fiber Foregrip
    const afg = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, 0.034, 0.085),
      new THREE.MeshStandardMaterial({
        map: textures.carbonAlbedo,
        normalMap: textures.carbonNormal,
        roughness: 0.42,
        metalness: 0.25
      })
    );
    afg.position.set(0, -0.032, -0.265);
    afg.rotation.x = -0.22;
    this.gunGroup.add(afg);

    // 3. INSTANCED PICATINNY TOP RAIL TEETH (28 CNC Lugs!)
    const lugGeo = new THREE.BoxGeometry(0.023, 0.0055, 0.006);
    const railInst = new THREE.InstancedMesh(lugGeo, matteBlackMetal, 28);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 28; i++) {
      dummy.position.set(0, 0.039, 0.075 - i * 0.017);
      dummy.updateMatrix();
      railInst.setMatrixAt(i, dummy.matrix);
    }
    this.gunGroup.add(railInst);

    // 4. EOTECH EXPS3 HOLOGRAPHIC WEAPON SIGHT (Optical center at y = +0.084, x = 0)
    const sightGrp = new THREE.Group();
    sightGrp.position.set(0, 0.042, -0.02);

    const sightBase = new THREE.Mesh(new THREE.BoxGeometry(0.040, 0.012, 0.082), matteBlackMetal);
    sightBase.position.y = 0.006;
    sightGrp.add(sightBase);

    // Transverse Battery Cylinder at front of EOTech
    const batt = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.042, 12), matteBlackMetal);
    batt.rotation.z = Math.PI * 0.5;
    batt.position.set(0, 0.012, -0.035);
    sightGrp.add(batt);

    // Protective Armored Hood Walls (sleek wide-FOV combat window at local y = 0.042 -> gun y = 0.084!)
    const hoodLeft = new THREE.Mesh(new THREE.BoxGeometry(0.0042, 0.044, 0.064), matteBlackMetal);
    hoodLeft.position.set(-0.0215, 0.040, 0.004);
    const hoodRight = new THREE.Mesh(new THREE.BoxGeometry(0.0042, 0.044, 0.064), matteBlackMetal);
    hoodRight.position.set(0.0215, 0.040, 0.004);
    const hoodTop = new THREE.Mesh(new THREE.BoxGeometry(0.047, 0.0045, 0.064), matteBlackMetal);
    hoodTop.position.set(0, 0.062, 0.004);
    sightGrp.add(hoodLeft, hoodRight, hoodTop);

    // Anti-Reflective Coated Glass Window
    const lens = new THREE.Mesh(
      new THREE.PlaneGeometry(0.036, 0.036),
      new THREE.MeshPhysicalMaterial({
        color: 0x88ccff,
        roughness: 0.05,
        metalness: 0.1,
        transparent: true,
        opacity: 0.11
      })
    );
    lens.position.set(0, 0.042, 0.004);
    sightGrp.add(lens);

    // Collimated Glowing Red Holographic Circle-Dot Reticle (HDR bloomed!)
    this.holoReticleMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.027, 0.027),
      new THREE.MeshBasicMaterial({
        map: textures.holoReticle,
        color: new THREE.Color(2.8, 0.5, 0.5),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    this.holoReticleMesh.position.set(0, 0.042, 0.006);
    sightGrp.add(this.holoReticleMesh);
    this.gunGroup.add(sightGrp);

    // 5. AN/PEQ-15 TACTICAL LASER BOX (Right-side rail so it never blocks EOTech sightline!)
    const peq = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.020, 0.078), polymerStipple);
    peq.position.set(0.028, 0.016, -0.32);
    this.gunGroup.add(peq);

    // SureFire M600 Tactical Scout Flashlight on Left-Upper M-LOK Offset Mount
    const scoutBody = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.105, 12), matteBlackMetal);
    scoutBody.rotation.x = Math.PI * 0.5;
    scoutBody.position.set(-0.029, 0.018, -0.34);
    this.gunGroup.add(scoutBody);

    // 6. CANTED MICRO-OLED BALLISTIC TELEMETRY SCREEN (Left Side Rail)
    const oledMount = new THREE.Group();
    oledMount.position.set(-0.028, 0.026, -0.115);
    oledMount.rotation.set(0.08, 0.32, 0.42);
    const oledHousing = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.020, 0.006), matteBlackMetal);
    const oledScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.030, 0.016),
      new THREE.MeshBasicMaterial({ map: this.oledTex })
    );
    oledScreen.position.z = 0.0035;
    oledMount.add(oledHousing, oledScreen);
    this.gunGroup.add(oledMount);

    // 7. DETACHABLE WINDOWED PMAG + VISIBLE STACKED 5.56MM BRASS ROUNDS
    this.magGroup.position.set(0, -0.108, -0.058);
    this.magGroup.rotation.x = -0.11;
    const magBody = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.135, 0.062), polymerStipple);
    const magBaseplate = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.014, 0.068), fdeAnodized);
    magBaseplate.position.y = -0.070;
    this.magGroup.add(magBody, magBaseplate);

    // Visible Brass Cartridges inside left & right mag windows!
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xe8bc5a, metalness: 0.94, roughness: 0.2 });
    const roundGeo = new THREE.CylinderGeometry(0.0042, 0.0042, 0.038, 8);
    roundGeo.rotateX(Math.PI * 0.5);
    for (let r = 0; r < 8; r++) {
      const rnd = new THREE.Mesh(roundGeo, brassMat);
      rnd.position.set(-0.0108, 0.038 - r * 0.011, 0.002);
      this.magGroup.add(rnd);
      this.visibleRounds.push(rnd);
    }
    this.gunGroup.add(this.magGroup);

    // 8. FIRST-PERSON CARBON-KNUCKLE TACTICAL GLOVES & SLEEVES
    const sleeveMat = new THREE.MeshStandardMaterial({
      color: 0x1e2522,
      normalMap: textures.stippleNormal,
      roughness: 0.88,
      metalness: 0.05
    });
    const gloveMat = new THREE.MeshStandardMaterial({
      map: textures.carbonAlbedo,
      normalMap: textures.carbonNormal,
      roughness: 0.55,
      metalness: 0.22
    });

    // Right Firing Hand & Forearm
    const rHand = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.065, 0.068), gloveMat);
    rHand.position.set(0.006, -0.078, 0.056);
    rHand.rotation.x = 0.28;
    const rArm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.044, 0.28, 10), sleeveMat);
    rArm.rotation.x = 1.25;
    rArm.rotation.z = -0.18;
    rArm.position.set(0.045, -0.135, 0.19);
    this.gunGroup.add(rHand, rArm);

    // Left Support C-Clamp Hand & Forearm (animates with mag during reload!)
    const lHand = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.052, 0.078), gloveMat);
    lHand.position.set(-0.014, -0.022, -0.255);
    lHand.rotation.z = 0.35;
    const lThumb = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.016, 0.042), gloveMat);
    lThumb.position.set(-0.010, 0.028, -0.25);
    const lArm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.045, 0.34, 10), sleeveMat);
    lArm.rotation.x = 1.18;
    lArm.rotation.z = 0.42;
    lArm.position.set(-0.095, -0.115, -0.095);
    this.leftHandGroup.add(lHand, lThumb, lArm);
    this.gunGroup.add(this.leftHandGroup);

    // 9. VOLUMETRIC 3D MUZZLE FLASH PLANES + VIEWMODEL FLASH LIGHT
    const flashMat = new THREE.MeshBasicMaterial({
      map: textures.muzzleStarSprite,
      color: new THREE.Color(3.6, 2.2, 0.9),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.muzzleStarMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), flashMat);
    this.muzzleStarMesh.position.set(0, 0.006, -0.56);
    this.muzzleSideMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), flashMat);
    this.muzzleSideMesh.rotation.y = Math.PI * 0.5;
    this.muzzleSideMesh.position.set(0, 0.006, -0.58);
    this.gunGroup.add(this.muzzleStarMesh, this.muzzleSideMesh);

    this.viewMuzzleLight = new THREE.PointLight(0xff9d3b, 0, 1.8, 2);
    this.viewMuzzleLight.position.set(0.03, 0.05, -0.52);
    this.gunGroup.add(this.viewMuzzleLight);
  }

  private refreshOledDisplay(): void {
    const tempC = Math.round(32 + this.barrelHeat * 430);
    const key = `${this.magAmmo}|${this.fireMode}|${this.suppressed}|${Math.floor(tempC / 8)}`;
    if (key === this.lastOledKey) return;
    this.lastOledKey = key;

    const ctx = this.oledCanvas.getContext('2d')!;
    ctx.fillStyle = '#050c12';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = this.magAmmo <= 6 ? '#ff4455' : '#28e8ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 120);

    ctx.fillStyle = this.magAmmo <= 6 ? '#ff4d5a' : '#e8f8ff';
    ctx.font = 'bold 64px Consolas, monospace';
    ctx.fillText(String(this.magAmmo).padStart(2, '0'), 18, 76);

    ctx.fillStyle = '#28e8ff';
    ctx.font = 'bold 20px Consolas, monospace';
    ctx.fillText(this.fireMode.toUpperCase(), 118, 42);
    ctx.fillStyle = this.suppressed ? '#52ffa8' : '#ffb84d';
    ctx.fillText(this.suppressed ? 'SUPP' : 'BRAKE', 118, 70);

    // Barrel thermal bar
    ctx.fillStyle = '#182836';
    ctx.fillRect(18, 94, 220, 16);
    ctx.fillStyle = this.barrelHeat > 0.65 ? '#ff4824' : '#28e8ff';
    ctx.fillRect(18, 94, Math.round(220 * Math.min(1, this.barrelHeat)), 16);
    ctx.fillStyle = '#9cc4e4';
    ctx.font = '13px Consolas, monospace';
    ctx.fillText(`${tempC}C`, 196, 88);

    this.oledTex.needsUpdate = true;
  }

  public toggleFireMode(): void {
    this.fireMode = this.fireMode === 'auto' ? 'semi' : 'auto';
    this.selectorMesh.rotation.x = this.fireMode === 'auto' ? 0 : 0.72;
    this.audio.playReloadStep('click');
    this.refreshOledDisplay();
  }

  public toggleSuppressor(): void {
    if (this.isReloading) return;
    this.suppressed = !this.suppressed;
    this.suppressorMesh.visible = this.suppressed;
    this.suppressorAnim = 0.28;
    this.audio.playReloadStep('mag_in');
    this.refreshOledDisplay();
  }

  public toggleTacLight(): void {
    this.tacLightOn = !this.tacLightOn;
    this.worldTacLight.visible = this.tacLightOn;
    this.audio.playReloadStep('click');
  }

  public triggerInspect(): void {
    if (this.isReloading || this.adsAmount > 0.3) return;
    this.inspectTimer = 2.4;
    this.audio.playReloadStep('click');
  }

  public startReload(): void {
    const maxCap = this.magAmmo > 0 ? this.MAG_SIZE + 1 : this.MAG_SIZE;
    if (this.isReloading || this.magAmmo >= maxCap || this.reserveAmmo <= 0) return;
    this.isReloading = true;
    this.inspectTimer = 0;
    this.reloadWasEmpty = this.magAmmo === 0;
    this.reloadDuration = this.reloadWasEmpty ? 2.25 : 1.75;
    this.reloadTimer = 0;
    this.reloadStagePlayed = 0;
  }

  /**
   * Attempts to fire a round; returns true if a shot was fired this frame.
   */
  public tryFire(triggerHeld: boolean, sprinting: boolean): boolean {
    if (!triggerHeld) {
      this.triggerReleased = true;
      return false;
    }
    if (this.isReloading || sprinting || this.fireCooldown > 0) return false;
    if (this.fireMode === 'semi' && !this.triggerReleased) return false;

    if (this.magAmmo <= 0) {
      if (this.triggerReleased) {
        this.audio.playDryFire();
        this.triggerReleased = false;
        this.startReload();
      }
      return false;
    }

    this.triggerReleased = false;
    this.inspectTimer = 0;
    this.magAmmo--;
    this.fireCooldown = 60 / 790; // 790 RPM authentic MCX-Spear cyclic rate

    // Audio & Heat
    this.audio.playGunshot(this.suppressed, this.magAmmo);
    this.barrelHeat = Math.min(1.0, this.barrelHeat + 0.048);
    this.lastShotPulse = 1.0;

    // Muzzle flash (dramatically reduced when suppressor is attached!)
    this.muzzleFlashTimer = this.suppressed ? 0.018 : 0.042;
    this.muzzleStarMesh.rotation.z = Math.random() * Math.PI * 2;
    const fScale = this.suppressed ? 0.32 : 0.9 + Math.random() * 0.35;
    this.muzzleStarMesh.scale.setScalar(fScale);
    this.muzzleSideMesh.scale.setScalar(fScale);

    // Physical recoil kick + camera climb
    const adsMult = THREE.MathUtils.lerp(1.0, 0.58, this.adsAmount);
    const brakeMult = this.suppressed ? 0.92 : 0.85;
    this.recoilOffset.z += 0.032 * adsMult;
    this.recoilOffset.y += 0.005 * adsMult;
    this.recoilRot.x += 0.055 * adsMult * brakeMult;
    this.recoilRot.z += (Math.random() - 0.5) * 0.038;

    this.cameraPitchRecoil += (0.0125 + Math.random() * 0.004) * adsMult * brakeMult;
    this.cameraYawRecoil += (Math.random() - 0.5) * 0.007 * adsMult;

    // Update visible stacked brass rounds in windowed PMAG
    for (let i = 0; i < this.visibleRounds.length; i++) {
      this.visibleRounds[i].visible = this.magAmmo > i + 2;
    }
    this.refreshOledDisplay();
    return true;
  }

  public update(
    dt: number,
    elapsed: number,
    worldCamera: THREE.PerspectiveCamera,
    aimHitPoint: THREE.Vector3,
    mouseDeltaX: number,
    mouseDeltaY: number,
    moveSpeedRatio: number,
    sprinting: boolean,
    sliding: boolean,
    adsHeld: boolean,
    leanAmount: number // -1 left, 0 center, +1 right
  ): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.lastShotPulse = Math.max(0, this.lastShotPulse - dt * 7.5);
    this.barrelHeat = Math.max(0, this.barrelHeat - dt * 0.085);
    this.barrelHeatMat.emissiveIntensity = Math.pow(Math.max(0, this.barrelHeat - 0.18) / 0.82, 1.8) * 3.2;

    if (Math.random() < dt * 3) this.refreshOledDisplay();

    // Smooth ADS transition
    const targetAds = adsHeld && !this.isReloading && !sprinting ? 1.0 : 0.0;
    this.adsAmount = THREE.MathUtils.damp(this.adsAmount, targetAds, 16, dt);

    // Bolt carrier reciprocation + empty bolt lock-back!
    const boltTargetZ =
      this.magAmmo === 0 && (!this.isReloading || this.reloadTimer < this.reloadDuration * 0.82)
        ? 0.016 // Locked rearward!
        : this.fireCooldown > 0.045
          ? 0.018 // Slamming back during cycle
          : -0.042; // In battery
    this.boltMesh.position.z = THREE.MathUtils.damp(this.boltMesh.position.z, boltTargetZ, 38, dt);

    // Muzzle Flash fade
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      const mat = this.muzzleStarMesh.material as THREE.MeshBasicMaterial;
      mat.opacity = this.suppressed ? 0.25 : 0.92;
      this.viewMuzzleLight.intensity = this.suppressed ? 0.6 : 4.5;
    } else {
      (this.muzzleStarMesh.material as THREE.MeshBasicMaterial).opacity = 0;
      this.viewMuzzleLight.intensity = 0;
    }

    // Overheated Barrel Muzzle Smoke Wisps!
    if (this.barrelHeat > 0.42 && this.fireCooldown <= 0 && Math.random() < dt * 8 * this.barrelHeat) {
      const muzWorld = this.getWorldMuzzlePos(worldCamera);
      this.fx.spawnSmoke(
        muzWorld,
        new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.38 + Math.random() * 0.22, (Math.random() - 0.5) * 0.15),
        0.04,
        0.22,
        0.75,
        0xcdd8e4,
        0.16 * this.barrelHeat
      );
    }

    // Multi-Stage Reload Animation
    let reloadRotX = 0;
    let reloadRotZ = 0;
    let reloadPosY = 0;
    if (this.isReloading) {
      this.reloadTimer += dt;
      const p = this.reloadTimer / this.reloadDuration;

      if (p > 0.14 && this.reloadStagePlayed === 0) {
        this.reloadStagePlayed = 1;
        this.audio.playReloadStep('mag_out');
      }
      if (p > 0.56 && this.reloadStagePlayed === 1) {
        this.reloadStagePlayed = 2;
        this.audio.playReloadStep('mag_in');
        for (const r of this.visibleRounds) r.visible = true;
      }
      if (this.reloadWasEmpty && p > 0.80 && this.reloadStagePlayed === 2) {
        this.reloadStagePlayed = 3;
        this.audio.playReloadStep('bolt_slap');
      }

      if (p < 0.25) {
        const k = p / 0.25;
        reloadRotZ = -0.38 * k;
        reloadRotX = 0.18 * k;
        this.magGroup.position.y = -0.108 - Math.max(0, (k - 0.4) / 0.6) * 0.22;
      } else if (p < 0.62) {
        const k = (p - 0.25) / 0.37;
        reloadRotZ = -0.38;
        reloadRotX = 0.18;
        this.magGroup.position.y = -0.328 + THREE.MathUtils.smoothstep(k, 0.2, 0.92) * 0.22;
        reloadPosY = k > 0.82 ? 0.012 : 0; // Tactile seat bump
      } else if (p < 1.0) {
        const k = (p - 0.62) / 0.38;
        this.magGroup.position.y = -0.108;
        if (this.reloadWasEmpty && k < 0.6) {
          reloadRotZ = THREE.MathUtils.lerp(-0.38, 0.32, k / 0.6); // Tilt to slap bolt catch!
        } else {
          reloadRotZ = THREE.MathUtils.lerp(this.reloadWasEmpty ? 0.32 : -0.38, 0, (k - (this.reloadWasEmpty ? 0.6 : 0)) / (this.reloadWasEmpty ? 0.4 : 1.0));
          reloadRotX = 0.18 * (1 - k);
        }
      } else {
        // Complete reload (30+1 tactical vs 30 empty!)
        const cap = this.reloadWasEmpty ? this.MAG_SIZE : this.MAG_SIZE + 1;
        const needed = cap - this.magAmmo;
        const take = Math.min(needed, this.reserveAmmo);
        this.magAmmo += take;
        this.reserveAmmo -= take;
        this.isReloading = false;
        this.magGroup.position.y = -0.108;
        this.refreshOledDisplay();
      }
      // Left hand follows magazine during reload
      this.leftHandGroup.position.y = (this.magGroup.position.y + 0.108) * 0.85;
      this.leftHandGroup.position.z = (this.magGroup.position.y + 0.108) * -0.55;
    } else {
      this.leftHandGroup.position.set(0, 0, 0);
    }

    // Weapon Inspect ([F]) & Suppressor Twist ([V])
    let inspectRotY = 0;
    let inspectRotZ = 0;
    if (this.inspectTimer > 0) {
      this.inspectTimer = Math.max(0, this.inspectTimer - dt);
      const s = Math.sin((1 - this.inspectTimer / 2.4) * Math.PI);
      inspectRotZ = 0.62 * s;
      inspectRotY = 0.44 * s;
    }
    if (this.suppressorAnim > 0) {
      this.suppressorAnim = Math.max(0, this.suppressorAnim - dt);
      reloadRotX -= Math.sin((this.suppressorAnim / 0.28) * Math.PI) * 0.22;
    }

    // Mouse rotational sway + walk/sprint bob + recoil decay
    const swayLimit = 0.045;
    this.swayPos.x = THREE.MathUtils.damp(
      this.swayPos.x,
      THREE.MathUtils.clamp(-mouseDeltaX * 0.0014, -swayLimit, swayLimit) * (1 - this.adsAmount * 0.75),
      12,
      dt
    );
    this.swayPos.y = THREE.MathUtils.damp(
      this.swayPos.y,
      THREE.MathUtils.clamp(mouseDeltaY * 0.0014, -swayLimit, swayLimit) * (1 - this.adsAmount * 0.75),
      12,
      dt
    );
    this.swayRot.y = THREE.MathUtils.damp(this.swayRot.y, THREE.MathUtils.clamp(-mouseDeltaX * 0.012, -0.12, 0.12), 11, dt);
    this.swayRot.x = THREE.MathUtils.damp(this.swayRot.x, THREE.MathUtils.clamp(-mouseDeltaY * 0.010, -0.10, 0.10), 11, dt);

    this.recoilOffset.lerp(new THREE.Vector3(0, 0, 0), Math.min(1, dt * 15));
    this.recoilRot.lerp(new THREE.Vector3(0, 0, 0), Math.min(1, dt * 14));

    if (moveSpeedRatio > 0.05 && !sliding) {
      this.bobPhase += dt * (sprinting ? 14.5 : 9.2);
    } else {
      this.bobPhase += dt * 1.6; // Subtle breathing
    }
    const bobAmp = moveSpeedRatio > 0.05 && !sliding ? (sprinting ? 0.013 : 0.0065) * (1 - this.adsAmount * 0.82) : 0.0012 * (1 - this.adsAmount * 0.7);
    const bobX = Math.cos(this.bobPhase * 0.5) * bobAmp;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * bobAmp * -1.2;

    // Base Pose: Hipfire vs Optical Center ADS vs Tactical Sprint vs Slide/Lean Cant!
    const hipX = 0.158;
    const hipY = -0.148;
    const hipZ = -0.33;
    const adsX = 0.0;
    const adsY = -0.084; // Exact optical center of EOTech window!
    const adsZ = -0.21;

    const posX = THREE.MathUtils.lerp(hipX, adsX, this.adsAmount) + this.swayPos.x + bobX;
    const posY = THREE.MathUtils.lerp(hipY, adsY, this.adsAmount) + this.swayPos.y + bobY + reloadPosY + this.recoilOffset.y;
    const posZ = THREE.MathUtils.lerp(hipZ, adsZ, this.adsAmount) + this.recoilOffset.z;

    // Tactical Rifle Canting on Q/E Lean OR Sliding!
    const cantZ = (-leanAmount * 0.34 - (sliding ? 0.42 : 0)) * (1 - this.adsAmount * 0.65);
    const sprintRotX = sprinting && !sliding ? -0.28 : 0;
    const sprintRotY = sprinting && !sliding ? 0.46 : 0;

    this.rigRoot.position.set(posX, posY, posZ);
    this.rigRoot.rotation.set(
      this.swayRot.x * (1 - this.adsAmount * 0.7) + this.recoilRot.x + reloadRotX + sprintRotX,
      this.swayRot.y * (1 - this.adsAmount * 0.7) + inspectRotY + sprintRotY,
      cantZ + this.recoilRot.z + reloadRotZ + inspectRotZ
    );

    // True Holographic Collimated Reticle Parallax Shift inside EOTech Window!
    this.holoReticleMesh.position.x = THREE.MathUtils.clamp(-this.swayPos.x * 0.35 - this.recoilRot.z * 0.08, -0.011, 0.011);
    this.holoReticleMesh.position.y = 0.042 + THREE.MathUtils.clamp(-this.swayPos.y * 0.35 - this.recoilRot.x * 0.12, -0.011, 0.011);

    // Sync Viewmodel Rim Lights to Player's World Z Position (cyan cryo hall vs red vault)
    const pz = worldCamera.position.z;
    this.vmCryoRimLight.intensity = pz < 0 && pz > -22 ? 2.1 : 0.7;
    this.vmHazardRimLight.intensity = pz <= -20 ? 2.0 + Math.sin(elapsed * 7.6) * 0.8 : 0.5;

    // Update World-Space Tactical Flashlight & Green PEQ-15 Laser
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(worldCamera.quaternion);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(worldCamera.quaternion);
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(worldCamera.quaternion);

    const lightOrigin = worldCamera.position
      .clone()
      .addScaledVector(camRight, THREE.MathUtils.lerp(0.14, 0.02, this.adsAmount))
      .addScaledVector(camUp, -0.10)
      .addScaledVector(camFwd, 0.45);

    this.worldTacLight.position.copy(lightOrigin);
    this.worldTacLight.target.position.copy(aimHitPoint);

    const laserOrigin = worldCamera.position
      .clone()
      .addScaledVector(camRight, THREE.MathUtils.lerp(0.19, 0.028, this.adsAmount))
      .addScaledVector(camUp, THREE.MathUtils.lerp(-0.11, -0.05, this.adsAmount))
      .addScaledVector(camFwd, 0.48);

    const laserDist = laserOrigin.distanceTo(aimHitPoint);
    const showLaser = !this.isReloading && !sprinting && laserDist > 0.35;
    this.worldLaserBeam.visible = showLaser;
    this.worldLaserDot.visible = showLaser;
    if (showLaser) {
      this.worldLaserBeam.position.copy(laserOrigin).lerp(aimHitPoint, 0.5);
      this.worldLaserBeam.scale.set(1, 1, laserDist);
      this.worldLaserBeam.lookAt(aimHitPoint);
      this.worldLaserDot.position.copy(aimHitPoint).addScaledVector(camFwd, -0.02);
    }
  }

  public getWorldMuzzlePos(worldCamera: THREE.PerspectiveCamera): THREE.Vector3 {
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(worldCamera.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(worldCamera.quaternion);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(worldCamera.quaternion);
    return worldCamera.position
      .clone()
      .addScaledVector(r, THREE.MathUtils.lerp(0.16, 0.0, this.adsAmount))
      .addScaledVector(u, THREE.MathUtils.lerp(-0.13, -0.07, this.adsAmount))
      .addScaledVector(f, 0.68);
  }

  public getWorldEjectionPort(worldCamera: THREE.PerspectiveCamera): { pos: THREE.Vector3; vel: THREE.Vector3 } {
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(worldCamera.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(worldCamera.quaternion);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(worldCamera.quaternion);
    const pos = worldCamera.position
      .clone()
      .addScaledVector(r, THREE.MathUtils.lerp(0.22, 0.06, this.adsAmount))
      .addScaledVector(u, -0.10)
      .addScaledVector(f, 0.32);
    const vel = r
      .clone()
      .multiplyScalar(2.4 + Math.random() * 1.1)
      .addScaledVector(u, 1.5 + Math.random() * 0.8)
      .addScaledVector(f, -0.5 + Math.random() * 0.6);
    return { pos, vel };
  }

  public resize(aspect: number): void {
    this.weaponCamera.aspect = aspect;
    this.weaponCamera.updateProjectionMatrix();
  }
}
