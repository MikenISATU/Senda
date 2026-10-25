"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const LOOP_SECONDS = 12;
const NODES: [number, number, number][] = [
  [-2.1, 0.3, 0.9], [-0.5, 1.75, -1.1], [1.95, 0.85, 0.3], [1.2, -1.45, 1.2], [-1.15, -1.5, -0.9],
];

function Ribbon() {
  const curve = useMemo(() => new THREE.CatmullRomCurve3(NODES.map((p) => new THREE.Vector3(...p)), true, "centripetal"), []);
  const inner = useMemo(() => new THREE.CatmullRomCurve3(NODES.map(([x, y, z]) => new THREE.Vector3(x * 0.82, y * 0.82, z + 0.35)), true, "centripetal"), []);
  const packet = useRef<THREE.Mesh>(null);
  const packet2 = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = (clock.getElapsedTime() % LOOP_SECONDS) / LOOP_SECONDS;
    packet.current?.position.copy(curve.getPointAt(t));
    packet2.current?.position.copy(inner.getPointAt((t + 0.5) % 1));
  });
  return (
    <group>
      <mesh>
        <tubeGeometry args={[curve, 160, 0.16, 6, true]} />
        <meshStandardMaterial color="#4169F5" emissive="#2D4FD6" emissiveIntensity={0.35} roughness={0.3} metalness={0.05} flatShading />
      </mesh>
      <mesh>
        <tubeGeometry args={[inner, 140, 0.045, 5, true]} />
        <meshStandardMaterial color="#24CBA8" roughness={0.4} emissive="#24CBA8" emissiveIntensity={0.25} flatShading />
      </mesh>
      <mesh ref={packet}>
        <icosahedronGeometry args={[0.13, 0]} />
        <meshStandardMaterial color="#24CBA8" emissive="#24CBA8" emissiveIntensity={0.9} flatShading />
      </mesh>
      <mesh ref={packet2}>
        <icosahedronGeometry args={[0.08, 0]} />
        <meshStandardMaterial color="#FFFFFF" emissive="#9FB4FF" emissiveIntensity={0.8} flatShading />
      </mesh>
      {NODES.map((p, i) => (
        <group key={i} position={p}>
          <mesh>
            <icosahedronGeometry args={[0.46, 0]} />
            <meshPhysicalMaterial color="#F5F7FC" emissive="#E7EDFF" emissiveIntensity={0.35} roughness={0.08} clearcoat={1} clearcoatRoughness={0.1} transparent opacity={0.32} depthWrite={false} flatShading />
          </mesh>
          <mesh renderOrder={2}>
            <icosahedronGeometry args={[0.24, 0]} />
            <meshStandardMaterial color={i % 2 ? "#24CBA8" : "#4169F5"} emissive={i % 2 ? "#24CBA8" : "#4169F5"} emissiveIntensity={0.3} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Rig() {
  const group = useRef<THREE.Group>(null);
  const { pointer } = useThree();
  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.getElapsedTime();
    // Seamless loop: rotation is a pure sine of the loop phase.
    const phase = (t % (LOOP_SECONDS * 2)) / (LOOP_SECONDS * 2);
    const targetY = Math.sin(phase * Math.PI * 2) * 0.35 + pointer.x * 0.25;
    const targetX = Math.cos(phase * Math.PI * 2) * 0.12 - pointer.y * 0.15;
    group.current.rotation.y += (targetY - group.current.rotation.y) * 0.05;
    group.current.rotation.x += (targetX - group.current.rotation.x) * 0.05;
  });
  return (
    <group ref={group}>
      <Ribbon />
    </group>
  );
}

export default function HeroScene({ running }: { running: boolean }) {
  return (
    <Canvas
      frameloop={running ? "always" : "never"}
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 7.8], fov: 42 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      aria-hidden
    >
      <ambientLight intensity={1.05} />
      <hemisphereLight args={["#FFFFFF", "#9FB4FF", 0.6]} />
      <directionalLight position={[4, 5, 6]} intensity={1.6} />
      <directionalLight position={[-5, -2, 3]} intensity={0.5} color="#9FB4FF" />
      <Rig />
    </Canvas>
  );
}
