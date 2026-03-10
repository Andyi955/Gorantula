import { useState, useEffect } from 'react';
import { Network, ChevronRight, Hash, Clock, Database, ChevronLeft } from 'lucide-react';

interface SynthesisAlert {
    type: string;
    entity: string;
    connectedCases: string[];
    analysis: string;
    timestamp: string;
}

interface SynthesisPanelProps {
    sharedSocket: WebSocket | null;
}

export default function SynthesisPanel({ sharedSocket }: SynthesisPanelProps) {
    const [alerts, setAlerts] = useState<SynthesisAlert[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [hasUnread, setHasUnread] = useState(false);

    useEffect(() => {
        // Load from local storage
        const saved = localStorage.getItem('gorantula_synthesis_alerts');
        if (saved) {
            try {
                setAlerts(JSON.parse(saved));
            } catch (e) { }
        }
    }, []);

    useEffect(() => {
        if (!sharedSocket) return;

        const handleMessage = (e: MessageEvent) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'SYNTHESIS_ALERT') {
                    const newAlert = msg.payload as SynthesisAlert;
                    setAlerts(prev => {
                        const updated = [newAlert, ...prev];
                        localStorage.setItem('gorantula_synthesis_alerts', JSON.stringify(updated.slice(0, 50))); // Keep last 50
                        return updated;
                    });
                    setHasUnread(true);
                    setIsOpen(true); // Auto-open the panel on new alert
                }
            } catch (err) { }
        };

        sharedSocket.addEventListener('message', handleMessage);
        return () => sharedSocket.removeEventListener('message', handleMessage);
    }, [sharedSocket]);

    const togglePanel = () => {
        setIsOpen(!isOpen);
        if (!isOpen) setHasUnread(false);
    };

    const clearAlerts = () => {
        setAlerts([]);
        localStorage.removeItem('gorantula_synthesis_alerts');
    };

    // The toggle button that floats on the right side if closed, or is hidden if empty
    if (alerts.length === 0) return null;

    return (
        <>
            {/* Floating Toggle Button */}
            {!isOpen && (
                <button
                    onClick={togglePanel}
                    className="absolute right-0 top-24 bg-cyber-purple text-white p-3 rounded-l-lg shadow-[0_0_15px_rgba(188,19,254,0.5)] z-40 border border-cyber-purple hover:bg-white hover:text-black transition-all flex items-center gap-2"
                >
                    <ChevronLeft size={18} />
                    <Network size={20} className={hasUnread ? "animate-pulse text-cyber-cyan" : ""} />
                    {hasUnread && (
                        <span className="absolute -top-2 -left-2 bg-red-500 text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full">
                            !
                        </span>
                    )}
                </button>
            )}

            {/* Slide-out Panel */}
            <div
                className={`absolute top-0 right-0 bottom-0 w-96 bg-cyber-black/95 backdrop-blur-md border-l border-cyber-purple shadow-[-10px_0_30px_rgba(188,19,254,0.2)] z-50 transform transition-transform duration-300 flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
            >
                <div className="p-4 border-b border-cyber-purple/50 flex justify-between items-center bg-cyber-purple/10">
                    <div className="flex items-center gap-2 text-cyber-purple font-black">
                        <Network size={20} />
                        <h2>GRAND UNIFIED THEORY</h2>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={clearAlerts} className="text-gray-500 hover:text-red-500 text-xs">
                            CLEAR
                        </button>
                        <button onClick={togglePanel} className="text-gray-400 hover:text-white">
                            <ChevronRight size={20} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {alerts.map((alert, idx) => (
                        <div key={idx} className="bg-black border border-cyber-purple/30 p-4 rounded-sm relative group hover:border-cyber-purple transition-colors">
                            <div className="absolute top-0 right-0 p-2 opacity-10">
                                <Network size={40} />
                            </div>

                            <div className="flex items-center gap-2 mb-3">
                                <span className="bg-cyber-purple/20 text-cyber-purple px-2 py-0.5 text-[10px] font-bold uppercase rounded border border-cyber-purple/50">
                                    Overlap Detected
                                </span>
                                <span className="text-gray-500 text-[10px] flex items-center gap-1">
                                    <Clock size={10} /> {alert.timestamp}
                                </span>
                            </div>

                            <div className="mb-4">
                                <h3 className="text-white font-bold text-lg mb-1 flex items-center gap-2">
                                    <Hash size={16} className="text-cyber-cyan" />
                                    <span className="text-cyber-cyan">{alert.entity}</span>
                                </h3>
                                <p className="text-gray-300 text-xs leading-relaxed">
                                    {alert.analysis}
                                </p>
                            </div>

                            <div className="mt-4 pt-3 border-t border-cyber-purple/20">
                                <div className="text-[10px] text-gray-500 mb-2 flex items-center gap-1 uppercase">
                                    <Database size={10} /> Connected Vaults:
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {alert.connectedCases.map((caseId, cIdx) => (
                                        <span key={cIdx} className="bg-cyber-gray/20 text-gray-300 px-2 py-1 text-[9px] rounded font-mono truncate max-w-full">
                                            {caseId}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}
