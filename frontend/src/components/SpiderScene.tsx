import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Group, Mesh, Quaternion, Vector3 } from 'three';
import type { SpiderEvidencePacket, SpiderLegVisualStatus, SpiderOperationMode } from './SpiderVisualizer';

interface SpiderSceneProps {
    legStates: Record<number, string>;
    legVisualStatuses?: Record<number, SpiderLegVisualStatus>;
    brainState: string;
    pipelineStatus?: 'idle' | 'running' | 'complete' | 'error' | 'cancelled';
    evidencePackets?: SpiderEvidencePacket[];
    operationMode?: SpiderOperationMode;
}

const idleColor = '#36505d';

const getStatusColor = (status?: SpiderLegVisualStatus) => {
    if (status === 'cancelled') return '#f6c879';
    if (status === 'error') return '#ff8c86';
    if (status === 'complete') return '#21ff71';
    return '';
};

const getLegColor = (state: string, status?: SpiderLegVisualStatus) => {
    const statusColor = getStatusColor(status);
    if (statusColor) return statusColor;
    if (state.includes('Searching')) return '#90f3da';
    if (state.includes('Scraping')) return '#59e4ff';
    if (state.includes('Reading') || state.includes('Processing')) return '#bc13fe';
    if (state.includes('Synthesizing') || state.includes('Deep Dive')) return '#f6c879';
    if (state.includes('Error')) return '#ff8c86';
    return idleColor;
};

const toVector = (value: [number, number, number]) => new Vector3(value[0], value[1], value[2]);

const Segment = ({
    start,
    end,
    color,
    radius,
    active,
}: {
    start: [number, number, number];
    end: [number, number, number];
    color: string;
    radius: number;
    active: boolean;
}) => {
    const { midpoint, length, quaternion } = useMemo(() => {
        const startVector = toVector(start);
        const endVector = toVector(end);
        const direction = new Vector3().subVectors(endVector, startVector);
        const segmentLength = direction.length();
        const segmentMidpoint = new Vector3().addVectors(startVector, endVector).multiplyScalar(0.5);
        const segmentQuaternion = new Quaternion().setFromUnitVectors(
            new Vector3(0, 1, 0),
            direction.normalize(),
        );

        return {
            midpoint: segmentMidpoint,
            length: segmentLength,
            quaternion: segmentQuaternion,
        };
    }, [end, start]);

    return (
        <mesh position={midpoint} quaternion={quaternion}>
            <cylinderGeometry args={[radius, radius * 1.18, length, 12]} />
            <meshStandardMaterial
                color="#0e2732"
                metalness={0.76}
                roughness={0.28}
                emissive={new Color(color)}
                emissiveIntensity={active ? 0.48 : 0.14}
            />
        </mesh>
    );
};

const Joint = ({ position, color, active }: { position: [number, number, number]; color: string; active: boolean }) => (
    <mesh position={position}>
        <sphereGeometry args={[active ? 0.22 : 0.16, 18, 18]} />
        <meshStandardMaterial
            color="#0b1720"
            metalness={0.72}
            roughness={0.18}
            emissive={new Color(color)}
            emissiveIntensity={active ? 1.2 : 0.28}
        />
    </mesh>
);

const SpiderLeg = ({ id, state, status = 'idle' }: { id: number; state: string; status?: SpiderLegVisualStatus }) => {
    const legRef = useRef<Group>(null);
    const color = getLegColor(state, status);
    const active = status === 'running' || status === 'complete' || status === 'error';
    const powerDown = status === 'cancelled';
    const angle = (id / 8) * Math.PI * 2;
    const sideBend = id % 2 === 0 ? 0.76 : -0.76;
    const hoverOffset = (id % 4) * 0.08;

    useFrame(({ clock }) => {
        if (!legRef.current) return;

        const time = clock.getElapsedTime();
        const lift = active ? Math.sin(time * 3.6 + id) * 0.18 : Math.sin(time * 1.2 + id) * (powerDown ? 0.02 : 0.06);
        const sweep = active ? Math.sin(time * 1.8 + id) * 0.055 : Math.sin(time * 0.8 + id) * (powerDown ? 0.006 : 0.018);
        legRef.current.position.z = lift;
        legRef.current.rotation.z = angle + sweep;
    });

    const hip: [number, number, number] = [1.06, 0, hoverOffset];
    const knee: [number, number, number] = [2.82, sideBend, 0.18 + hoverOffset];
    const ankle: [number, number, number] = [4.55, sideBend * 0.42, -0.1 + hoverOffset];
    const foot: [number, number, number] = [5.9, sideBend * 0.74, -0.72 + hoverOffset];

    return (
        <group ref={legRef} rotation={[0, 0, angle]}>
            <Segment start={hip} end={knee} color={color} radius={0.11} active={active} />
            <Segment start={knee} end={ankle} color={color} radius={0.095} active={active} />
            <Segment start={ankle} end={foot} color={color} radius={0.06} active={active} />
            {[hip, knee, ankle, foot].map((position, index) => (
                <Joint key={index} position={position} color={color} active={active || index === 0} />
            ))}
            <mesh position={[3.65, sideBend * 0.56, 0.08 + hoverOffset]} rotation={[0, 0, Math.PI / 2]}>
                <boxGeometry args={[0.22, 0.92, 0.08]} />
                <meshStandardMaterial
                    color={active ? color : '#102532'}
                    emissive={new Color(color)}
                    emissiveIntensity={active ? 1.4 : (powerDown ? 0.08 : 0.18)}
                    transparent
                    opacity={active ? 0.82 : (powerDown ? 0.22 : 0.38)}
                />
            </mesh>
        </group>
    );
};

const EvidencePacket = ({ packet }: { packet: SpiderEvidencePacket }) => {
    const packetRef = useRef<Group>(null);
    const angle = (packet.legId / 8) * Math.PI * 2;
    const start = useMemo(() => new Vector3(Math.cos(angle) * 5.4, Math.sin(angle) * 5.4, 0.42), [angle]);
    const end = useMemo(() => new Vector3(0, 0, 0.62), []);
    const color = getStatusColor(packet.status) || '#90f3da';

    useFrame(() => {
        if (!packetRef.current) return;
        const progress = Math.min(1, Math.max(0, (Date.now() - packet.createdAt) / 1500));
        const eased = 1 - Math.pow(1 - progress, 3);
        packetRef.current.position.copy(start.clone().lerp(end, eased));
        packetRef.current.scale.setScalar(0.8 + Math.sin(progress * Math.PI) * 0.36);
    });

    return (
        <group ref={packetRef} position={start}>
            {packet.mode === 'local' ? (
                <>
                    <mesh rotation={[0, 0, Math.PI / 12]}>
                        <boxGeometry args={[0.28, 0.2, 0.025]} />
                        <meshBasicMaterial color={color} transparent opacity={0.86} />
                    </mesh>
                    <mesh position={[0.03, -0.04, 0.018]} rotation={[0, 0, Math.PI / 12]}>
                        <boxGeometry args={[0.16, 0.012, 0.012]} />
                        <meshBasicMaterial color="#061119" transparent opacity={0.74} />
                    </mesh>
                </>
            ) : (
                <mesh>
                    <sphereGeometry args={[0.11, 18, 18]} />
                    <meshBasicMaterial color={color} transparent opacity={0.9} />
                </mesh>
            )}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.19, 0.008, 12, 28]} />
                <meshBasicMaterial color={color} transparent opacity={0.36} />
            </mesh>
        </group>
    );
};

const ScanRings = ({ active }: { active: boolean }) => {
    const ringRef = useRef<Group>(null);

    useFrame(({ clock }) => {
        if (!ringRef.current) return;
        const time = clock.getElapsedTime();
        ringRef.current.rotation.z = time * (active ? 0.38 : 0.16);
        ringRef.current.position.z = Math.sin(time * 1.5) * 0.05;
    });

    return (
        <group ref={ringRef} rotation={[0, 0, 0]}>
            {[2.2, 3.4, 4.8, 6.2].map((radius, index) => (
                <mesh key={radius} rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[radius, 0.01 + index * 0.003, 96, 8]} />
                    <meshBasicMaterial color={index % 2 === 0 ? '#59e4ff' : '#90f3da'} transparent opacity={active ? 0.42 - index * 0.06 : 0.18} />
                </mesh>
            ))}
        </group>
    );
};

const Core = ({ active }: { active: boolean }) => {
    const coreRef = useRef<Mesh>(null);
    const shellRef = useRef<Mesh>(null);

    useFrame(({ clock }) => {
        const time = clock.getElapsedTime();
        if (coreRef.current) {
            const scale = active ? 1 + Math.sin(time * 4.8) * 0.06 : 0.92 + Math.sin(time * 1.4) * 0.025;
            coreRef.current.scale.setScalar(scale);
            coreRef.current.rotation.y = time * 0.42;
            coreRef.current.rotation.x = time * 0.24;
        }
        if (shellRef.current) {
            shellRef.current.rotation.y = -time * 0.18;
            shellRef.current.rotation.z = time * 0.12;
        }
    });

    return (
        <group>
            <mesh ref={shellRef}>
                <sphereGeometry args={[1.1, 48, 48]} />
                <meshPhysicalMaterial
                    color="#153544"
                    roughness={0.08}
                    metalness={0.08}
                    transmission={0.42}
                    thickness={0.7}
                    transparent
                    opacity={0.38}
                    emissive="#59e4ff"
                    emissiveIntensity={active ? 0.34 : 0.12}
                />
            </mesh>
            <mesh ref={coreRef}>
                <boxGeometry args={[0.72, 0.72, 0.72]} />
                <meshStandardMaterial
                    color={active ? '#59e4ff' : '#102532'}
                    emissive={active ? '#90f3da' : '#36505d'}
                    emissiveIntensity={active ? 1.8 : 0.32}
                    metalness={0.44}
                    roughness={0.18}
                />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[1.34, 0.025, 16, 96]} />
                <meshBasicMaterial color={active ? '#90f3da' : '#36505d'} transparent opacity={0.72} />
            </mesh>
        </group>
    );
};

export const SpiderScene: React.FC<SpiderSceneProps> = ({
    legStates,
    legVisualStatuses = {},
    brainState,
    pipelineStatus = 'idle',
    evidencePackets = [],
    operationMode = 'web',
}) => {
    const sceneRef = useRef<Group>(null);
    const active = brainState !== 'Offline' && brainState !== 'Disconnected' && pipelineStatus !== 'cancelled';
    const dimmed = pipelineStatus === 'cancelled' || pipelineStatus === 'error';

    useFrame(({ clock }) => {
        if (!sceneRef.current) return;
        const time = clock.getElapsedTime();
        sceneRef.current.rotation.x = -0.18 + Math.sin(time * 0.28) * (dimmed ? 0.008 : 0.025);
        sceneRef.current.rotation.y = Math.sin(time * 0.22) * (dimmed ? 0.025 : 0.08);
    });

    return (
        <group ref={sceneRef}>
            <color attach="background" args={['#04090d']} />
            <ambientLight intensity={0.34} />
            <pointLight position={[0, 0, 7]} intensity={3.2} color="#59e4ff" />
            <pointLight position={[-5, -4, 4]} intensity={1.4} color="#bc13fe" />
            <pointLight position={[5, 4, 5]} intensity={1.1} color="#90f3da" />
            <gridHelper args={[16, 28, '#183746', '#0b1821']} position={[0, 0, -1.04]} rotation={[Math.PI / 2, 0, 0]} />

            <ScanRings active={active} />
            {Array.from({ length: 8 }, (_, id) => (
                <SpiderLeg key={id} id={id} state={legStates[id] || 'Idle'} status={legVisualStatuses[id] || 'idle'} />
            ))}
            {evidencePackets.map((packet) => (
                <EvidencePacket key={packet.id} packet={{ ...packet, mode: packet.mode || operationMode }} />
            ))}
            <Core active={active} />
        </group>
    );
};
