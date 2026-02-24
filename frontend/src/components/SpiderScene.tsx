import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface SpiderSceneProps {
    legStates: Record<number, string>;
    brainState: string;
}

const getLegColor = (state: string) => {
    if (state.includes('Searching')) return '#00ff41'; // Green
    if (state.includes('Scraping')) return '#00f3ff'; // Cyan
    if (state.includes('Reading') || state.includes('Processing')) return '#bc13fe'; // Purple
    if (state.includes('Synthesizing') || state.includes('Deep Dive')) return '#f97316'; // Orange
    if (state.includes('Error')) return '#ef4444'; // Red
    return '#1a1a1a'; // Idle / cyber-gray
};

export const SpiderScene: React.FC<SpiderSceneProps> = ({ legStates, brainState }) => {
    const coreRef = useRef<THREE.Mesh>(null);
    const nodesRef = useRef<(THREE.Mesh | null)[]>([]);
    const linesRef = useRef<(THREE.Line | null)[]>([]);

    const radius = 6;
    const basePositions = useMemo(() => {
        return Array.from({ length: 8 }).map((_, i) => {
            const angle = (i * Math.PI * 2) / 8;
            return new THREE.Vector3(
                Math.cos(angle) * radius,
                Math.sin(angle) * radius,
                0
            );
        });
    }, [radius]);

    useFrame((state) => {
        const time = state.clock.getElapsedTime();

        // 1. Core Logic
        let corePos = new THREE.Vector3(0, 0, 0);
        if (coreRef.current) {
            coreRef.current.position.y = Math.sin(time * 2) * 0.2;
            corePos = coreRef.current.position.clone();

            const isProcessing = brainState !== 'Offline' && brainState !== 'Idle';
            const scaleBase = isProcessing ? 1.2 : 1;
            const scaleFluctuate = isProcessing ? Math.sin(time * 10) * 0.1 : Math.sin(time * 2) * 0.05;
            coreRef.current.scale.setScalar(scaleBase + scaleFluctuate);

            coreRef.current.rotation.x = time * 0.5;
            coreRef.current.rotation.y = time * 0.3;
        }

        // 2. Nodes Logic
        basePositions.forEach((basePos, i) => {
            const mesh = nodesRef.current[i];
            const line = linesRef.current[i];
            if (!mesh || !line) return;

            const legState = legStates[i] || 'Idle';
            const isActive = legState !== 'Idle';

            // Calculate target position
            const targetPos = new THREE.Vector3().copy(basePos);

            // Add global spin to the entire web conceptually
            targetPos.applyAxisAngle(new THREE.Vector3(0, 0, 1), time * 0.2);

            if (isActive) {
                targetPos.x += Math.sin(time * 20 + i) * 0.5;
                targetPos.y += Math.cos(time * 20 + i) * 0.5;
                targetPos.z += Math.sin(time * 15 + i) * 0.5;
            } else {
                targetPos.y += Math.sin(time + i) * 0.8;
                targetPos.z += Math.cos(time * 0.5 + i) * 0.3;
            }

            mesh.position.lerp(targetPos, 0.2); // smooth orbit

            // Update line geometry to track from core to mesh
            if (line.geometry) {
                const positions = line.geometry.attributes.position.array as Float32Array;
                // Core
                positions[0] = corePos.x;
                positions[1] = corePos.y;
                positions[2] = corePos.z;
                // Mesh
                positions[3] = mesh.position.x;
                positions[4] = mesh.position.y;
                positions[5] = mesh.position.z;
                line.geometry.attributes.position.needsUpdate = true;
            }
        });
    });

    const isBrainActive = brainState !== 'Offline' && brainState !== 'Idle' && brainState !== 'Waiting' && brainState !== 'Connected';
    const brainColor = isBrainActive ? '#00f3ff' : '#1a1a1a'; // Cyan when active

    return (
        <group>
            <ambientLight intensity={0.5} />
            <pointLight position={[0, 0, 10]} intensity={2} color="#00f3ff" />
            <pointLight position={[0, 0, -10]} intensity={1} color="#bc13fe" />

            {/* Core Brain */}
            <mesh ref={coreRef} position={[0, 0, 0]}>
                {/* @ts-ignore */}
                <sphereGeometry args={[1.2, 32, 32]} />
                <meshStandardMaterial
                    color={brainColor}
                    emissive={brainColor}
                    emissiveIntensity={isBrainActive ? 1.5 : 0.2}
                    wireframe={!isBrainActive}
                />
            </mesh>

            {/* Nodes and Lines */}
            {basePositions.map((_, i) => {
                const state = legStates[i] || 'Idle';
                const legColor = getLegColor(state);
                const isActive = state !== 'Idle';

                return (
                    <group key={i}>
                        <mesh ref={(el) => { if (el) nodesRef.current[i] = el; }}>
                            {/* @ts-ignore */}
                            <sphereGeometry args={[0.4, 16, 16]} />
                            <meshStandardMaterial
                                color={legColor}
                                emissive={legColor}
                                emissiveIntensity={isActive ? 2 : 0.2}
                                wireframe={!isActive}
                            />
                        </mesh>

                        {/* @ts-ignore */}
                        <line ref={(el: THREE.Line | null) => { linesRef.current[i] = el; }}>
                            <bufferGeometry>
                                <bufferAttribute
                                    attach="attributes-position"
                                    args={[new Float32Array(6), 3]}
                                />
                            </bufferGeometry>
                            <lineBasicMaterial attach="material" color={legColor} linewidth={isActive ? 3 : 1} transparent={true} opacity={isActive ? 0.8 : 0.15} />
                        </line>
                    </group>
                );
            })}
        </group>
    );
};
