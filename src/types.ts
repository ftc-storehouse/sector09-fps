import * as THREE from 'three';

export type QualityPreset = 'ultra' | 'high' | 'perf';

export type SurfaceMaterialType =
  | 'concrete'
  | 'metal'
  | 'glass'
  | 'hazard_canister'
  | 'steam_pipe'
  | 'extinguisher'
  | 'light_fixture'
  | 'enemy_head'
  | 'enemy_armor'
  | 'enemy_body'
  | 'enemy_core';

export interface ColliderBox {
  box: THREE.Box3;
  blocksMovement: boolean;
  blocksSight: boolean;
  surface: SurfaceMaterialType;
  mesh?: THREE.Object3D;
}

export interface DestructibleProp {
  id: string;
  kind: 'canister' | 'extinguisher' | 'steam_pipe' | 'glass_panel' | 'ceiling_light' | 'monitor';
  mesh: THREE.Object3D;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  leaking?: boolean;
  leakPoint?: THREE.Vector3;
  leakNormal?: THREE.Vector3;
  leakTimer?: number;
  lightRef?: THREE.Light;
  emissiveMat?: THREE.MeshStandardMaterial;
  colliderIndex?: number;
}

export interface InteractiveTerminal {
  position: THREE.Vector3;
  mesh: THREE.Object3D;
  activated: boolean;
  screenCanvas: HTMLCanvasElement;
  screenTex: THREE.CanvasTexture;
}
