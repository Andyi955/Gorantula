import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const SpiderVisualizer: React.FC = () => {
    const [legStates, setLegStates] = useState<Record<number, string>>(
        Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, 'Idle']))
    );
    const [brainState, setBrainState] = useState<string>('Offline');

    useEffect(() => {
        const socket = new WebSocket('ws://localhost:8080/ws');

        socket.onopen = () => {
            console.log('Connected to Gorantula Backend');
            setBrainState('Connected');
        };

        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'LEG_UPDATE') {
                const { legId, state } = msg.payload;
                setLegStates((prev) => ({ ...prev, [legId]: state }));
            } else if (msg.type === 'BRAIN_STATE') {
                setBrainState(msg.payload);
            }
        };

        socket.onclose = () => {
            setBrainState('Disconnected');
        };

        return () => socket.close();
    }, []);

    const getLegColor = (state: string) => {
        if (state === 'Searching Brave') return '#00ff41'; // Green
        if (state === 'Scraping Top URLs') return '#00f3ff'; // Cyan
        return '#333'; // Idle
    };

    return (
        <div className="flex flex-col items-center justify-center h-full p-8 bg-black text-white font-mono">
            <div className="mb-8 text-center text-xl font-bold tracking-widest uppercase border-b border-cyber-green pb-2">
                <span className="text-cyber-green">Brain:</span> {brainState}
            </div>

            <div className="relative w-80 h-80">
                {/* Spider Body */}
                <div className="absolute top-1/2 left-1/2 w-16 h-20 -mt-10 -ml-8 bg-cyber-gray border-2 border-cyber-cyan rounded-full z-10 flex items-center justify-center">
                    <div className="w-2 h-2 bg-cyber-green rounded-full shadow-[0_0_10px_#00ff41] animate-pulse" />
                </div>

                <svg viewBox="0 0 100 100" className="absolute top-0 left-0 w-full h-full">
                    {Array.from({ length: 8 }).map((_, i) => {
                        const angle = (i * 45) * (Math.PI / 180);
                        const x1 = 50 + Math.cos(angle) * 8;
                        const y1 = 50 + Math.sin(angle) * 10;
                        const x2 = 50 + Math.cos(angle) * 45;
                        const y2 = 50 + Math.sin(angle) * 45;

                        const state = legStates[i] || 'Idle';
                        const isActive = state !== 'Idle';

                        return (
                            <motion.line
                                key={i}
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke={getLegColor(state)}
                                strokeWidth="2"
                                initial={false}
                                animate={{
                                    x2: isActive ? 50 + Math.cos(angle) * (45 + Math.random() * 5) : x2,
                                    y2: isActive ? 50 + Math.sin(angle) * (45 + Math.random() * 5) : y2,
                                    strokeWidth: isActive ? 4 : 2,
                                }}
                                transition={{
                                    repeat: isActive ? Infinity : 0,
                                    duration: 0.1,
                                    repeatType: "reverse"
                                }}
                            />
                        );
                    })}
                </svg>
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
