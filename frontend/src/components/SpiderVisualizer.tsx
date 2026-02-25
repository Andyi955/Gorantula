import React, { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { SpiderScene } from './SpiderScene';

interface SpiderVisualizerProps {
    sharedSocket: WebSocket | null;
}

const SpiderVisualizer: React.FC<SpiderVisualizerProps> = ({ sharedSocket }) => {
    const [legStates, setLegStates] = useState<Record<number, string>>(
        Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, 'Idle']))
    );
    const [brainState, setBrainState] = useState<string>('Offline');

    useEffect(() => {
        if (!sharedSocket) {
            setBrainState('Offline');
            return;
        }

        const handleMessage = (event: MessageEvent) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'LEG_UPDATE') {
                const { legId, state } = msg.payload;
                setLegStates((prev) => ({ ...prev, [legId]: state }));
            } else if (msg.type === 'BRAIN_STATE') {
                setBrainState(msg.payload);
                if (['Done', 'Offline', 'Disconnected'].includes(msg.payload)) {
                    setLegStates(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, 'Idle'])));
                }
            } else if (msg.type === 'SYNTHESIS_COMPLETE') {
                setLegStates(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, 'Idle'])));
            }
        };

        sharedSocket.addEventListener('message', handleMessage);
        setBrainState('Connected');

        return () => {
            sharedSocket.removeEventListener('message', handleMessage);
        };
    }, [sharedSocket]);

    return (
        <div className="flex flex-col items-center justify-center h-full p-8 bg-black text-white font-mono">
            <div className="mb-8 text-center text-xl font-bold tracking-widest uppercase border-b border-cyber-green pb-2">
                <span className="text-cyber-green">Brain:</span> {brainState}
            </div>

            <div className="relative w-[600px] h-[600px] -my-10">
                <Canvas camera={{ position: [0, 0, 15], fov: 50 }}>
                    <SpiderScene legStates={legStates} brainState={brainState} />
                    <EffectComposer>
                        <Bloom
                            luminanceThreshold={0.2}
                            mipmapBlur
                            intensity={0.5}
                        />
                    </EffectComposer>
                </Canvas>
            </div>

            <div className="mt-12 w-full max-w-2xl grid grid-cols-2 gap-4">
                {Object.entries(legStates).map(([id, state]) => (
                    <div key={id} className={`p-2 border ${state !== 'Idle' ? 'border-cyber-green' : 'border-cyber-gray'} rounded text-sm`}>
                        <span className="text-cyber-cyan">Leg {id}:</span> {state}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SpiderVisualizer;
