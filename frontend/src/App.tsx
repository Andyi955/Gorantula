import { useState, useEffect, useRef, useCallback } from 'react'
import SpiderVisualizer from './components/SpiderVisualizer'
import DetectiveBoard from './components/DetectiveBoard'
import SettingsDashboard from './components/SettingsDashboard'
import TimelineView from './components/TimelineView'
import VaultChatbot from './components/VaultChatbot'
import SynthesisPanel from './components/SynthesisPanel'
import { Terminal, Database, Folder, Plus, Trash2, Settings, Clock, MessageSquare } from 'lucide-react'

interface Investigation {
  id: string
  topic: string
}

function App() {
  const [activeTab, setActiveTab] = useState<'spider' | 'board' | 'timeline' | 'chat' | 'settings'>('spider')
  const [prompt, setPrompt] = useState('')
  const [crawlMode, setCrawlMode] = useState<'web' | 'local'>('web')
  const [socketConfig, setSocketConfig] = useState<{ socket: WebSocket | null, ready: boolean }>({ socket: null, ready: false })

  const [investigations, setInvestigations] = useState<Investigation[]>([])
  const [currentInvestigationId, setCurrentInvestigationId] = useState<string | null>(null)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)

  const reconnectTimeoutRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const isUnmounted = useRef(false);

  const connect = () => {
    console.log('[App] Connecting to WebSocket...');
    const s = new WebSocket('ws://localhost:8080/ws')

    socketRef.current = s;

    s.onopen = () => {
      console.log('[App] WebSocket Connected');
      setSocketConfig({ socket: s, ready: true });
    };

    s.onclose = () => {
      console.log('[App] WebSocket Disconnected. Retrying in 2s...');
      setSocketConfig({ socket: null, ready: false });
      socketRef.current = null;
      if (!isUnmounted.current) {
        reconnectTimeoutRef.current = window.setTimeout(connect, 2000);
      }
    };

    s.onerror = (err) => {
      console.error('[App] WebSocket Error:', err);
      s.close();
    };
  };

  useEffect(() => {
    connect();

    // Load list from local storage if any
    const saved = localStorage.getItem('gorantula_investigations')
    if (saved) {
      const data = JSON.parse(saved)
      setInvestigations(data)
      if (data.length > 0) setCurrentInvestigationId(data[0].id)
    }

    return () => {
      isUnmounted.current = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) socketRef.current.close();
    }
  }, [])

  const runSpider = (customPrompt?: string, customLabel?: string, overrideMode?: 'web' | 'local') => {
    const textToRun = customPrompt || prompt;
    const labelToUse = customLabel || textToRun;
    const modeToUse = overrideMode || crawlMode;
    if (socketConfig.socket && socketConfig.ready && textToRun) {
      const id = `inv-${Date.now()}`

      // Extract folder name for better label
      let displayTopic = labelToUse;
      if (modeToUse === 'local') {
        const parts = labelToUse.split(/[\\/]/);
        displayTopic = `Local: ${parts[parts.length - 1] || labelToUse}`;
      }

      const newInv = { id, topic: displayTopic }

      const updated = [newInv, ...investigations]
      setInvestigations(updated)
      setCurrentInvestigationId(id)
      localStorage.setItem('gorantula_investigations', JSON.stringify(updated))

      socketConfig.socket.send(JSON.stringify({ type: modeToUse === 'local' ? 'CRAWL_LOCAL' : 'CRAWL', payload: textToRun }))
      if (!customPrompt) setPrompt('')
      setActiveTab('spider')
      return id;
    } else {
      alert("System not ready. Please check backend connection.");
      return null;
    }
  }

  const handleDeepDiveNode = useCallback((promptStr: string, titleStr: string, sourceNodeId: string) => {
    const newInvId = runSpider(`Deep Dive Research on: ${promptStr}`, `Deep Dive: ${titleStr.substring(0, 50)}${titleStr.length > 50 ? '...' : ''}`, 'web');
    if (newInvId && currentInvestigationId) {
      // Update original board to link to this new investigation
      const saved = localStorage.getItem(`inv_data_${currentInvestigationId}`);
      if (saved) {
        const { nodes, edges } = JSON.parse(saved);
        const updatedNodes = nodes.map((n: any) =>
          n.id === sourceNodeId ? { ...n, data: { ...n.data, linkedInvestigationId: newInvId, isDeepDiveSource: false } } : n
        );
        localStorage.setItem(`inv_data_${currentInvestigationId}`, JSON.stringify({ nodes: updatedNodes, edges }));
      }
    }
  }, [currentInvestigationId, runSpider]);

  const handleNavigateToChild = useCallback((id: string) => {
    setCurrentInvestigationId(id);
    setActiveTab('board');
  }, []);

  const handleNavigateSynthesis = useCallback((id: string, nodeId?: string) => {
    setCurrentInvestigationId(id);
    setActiveTab('board');
    if (nodeId) {
      setFocusedNodeId(nodeId);
      setTimeout(() => setFocusedNodeId(null), 1000);
    }
  }, []);

  const deleteInvestigation = (e: React.MouseEvent, idToRemove: string) => {
    e.stopPropagation()
    // Instantly delete without blocking browser popup
    const updated = investigations.filter(inv => inv.id !== idToRemove)
    setInvestigations(updated)
    localStorage.setItem('gorantula_investigations', JSON.stringify(updated))
    localStorage.removeItem(`inv_data_${idToRemove}`)

    if (currentInvestigationId === idToRemove) {
      setCurrentInvestigationId(updated.length > 0 ? updated[0].id : null)
    }
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-cyber-black font-mono">
      {/* Top Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-cyber-gray z-50 bg-cyber-black">
        <h1 className="text-2xl font-black tracking-tighter italic text-cyber-green">
          GORANTULA <span className="text-white text-sm not-italic font-normal ml-2 opacity-50">v2.0 // ARCHITECT</span>
        </h1>

        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('spider')}
            className={`flex items-center gap-2 px-4 py-2 rounded transition-all ${activeTab === 'spider' ? 'bg-cyber-purple text-white shadow-[0_0_15px_rgba(188,19,254,0.5)]' : 'text-gray-500 hover:text-white'}`}
          >
            <Terminal size={18} />
            Spider View
          </button>
          <button
            onClick={() => setActiveTab('board')}
            className={`flex items-center gap-2 px-4 py-2 rounded transition-all ${activeTab === 'board' ? 'bg-cyber-cyan text-black shadow-[0_0_15px_rgba(0,243,255,0.5)]' : 'text-gray-500 hover:text-white'}`}
          >
            <Database size={18} />
            Detective Board
          </button>
          <button
            onClick={() => setActiveTab('timeline')}
            className={`flex items-center gap-2 px-4 py-2 rounded transition-all ${activeTab === 'timeline' ? 'bg-cyber-green text-black shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'text-gray-500 hover:text-white'}`}
          >
            <Clock size={18} />
            Timeline View
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-2 px-4 py-2 rounded transition-all ${activeTab === 'chat' ? 'bg-cyber-purple text-white shadow-[0_0_15px_rgba(188,19,254,0.5)]' : 'text-gray-500 hover:text-white'}`}
          >
            <MessageSquare size={18} />
            Vault Chat
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-4 py-2 rounded transition-all ${activeTab === 'settings' ? 'bg-cyber-gray/30 text-white shadow-[0_0_15px_rgba(255,255,255,0.2)]' : 'text-gray-500 hover:text-white'}`}
          >
            <Settings size={18} />
            Settings
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 border-r border-cyber-gray bg-black/50 flex flex-col">
          <div className="p-4 border-b border-cyber-gray flex justify-between items-center bg-cyber-gray/10">
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Investigations</span>
            <button className="text-cyber-green hover:text-white transition-colors">
              <Plus size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {investigations.map((inv) => (
              <div key={inv.id} className="group relative">
                <button
                  onClick={() => setCurrentInvestigationId(inv.id)}
                  className={`w-full text-left p-4 border-b border-cyber-gray/30 flex items-start gap-3 transition-colors ${currentInvestigationId === inv.id ? 'bg-cyber-green/10 border-l-2 border-l-cyber-green' : 'hover:bg-cyber-gray/20 text-gray-400'}`}
                >
                  <Folder size={16} className={currentInvestigationId === inv.id ? 'text-cyber-green' : 'text-gray-600'} />
                  <span className={`text-xs truncate max-w-[150px] ${currentInvestigationId === inv.id ? 'text-white font-bold' : ''}`}>
                    {inv.topic}
                  </span>
                </button>
                <button
                  onClick={(e) => deleteInvestigation(e, inv.id)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete Investigation"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 relative">
          <SynthesisPanel
            sharedSocket={socketConfig.socket}
            currentInvestigationId={currentInvestigationId}
            onNavigateVault={handleNavigateSynthesis}
          />

          <div className={`absolute inset-0 transition-opacity duration-500 ${activeTab === 'spider' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-hidden">
                <SpiderVisualizer sharedSocket={socketConfig.socket} />
              </div>

              {/* Input Footer */}
              <div className="p-6 bg-cyber-gray/30 border-t border-cyber-gray backdrop-blur-sm">
                <div className="max-w-4xl mx-auto flex gap-4 items-center">
                  <div className="flex bg-black border border-cyber-gray overflow-hidden shrink-0">
                    <button
                      onClick={() => setCrawlMode('web')}
                      className={`px-4 py-3 text-xs font-bold transition-colors ${crawlMode === 'web' ? 'bg-cyber-purple text-white shadow-[0_0_10px_rgba(188,19,254,0.5)]' : 'text-gray-500 hover:text-white'}`}
                    >
                      WEB
                    </button>
                    <button
                      onClick={() => setCrawlMode('local')}
                      className={`px-4 py-3 text-xs font-bold transition-colors border-l border-cyber-gray ${crawlMode === 'local' ? 'bg-cyber-cyan text-black shadow-[0_0_10px_rgba(0,243,255,0.5)]' : 'text-gray-500 hover:text-white'}`}
                    >
                      LOCAL
                    </button>
                  </div>

                  <div className="flex-1 flex gap-2 relative">
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && runSpider()}
                      placeholder={crawlMode === 'web' ? "ENTER CRAWL PARAMETERS..." : "ENTER ABSOLUTE OS PATHS (DELIMITED) OR CLICK BROWSE..."}
                      className="w-full bg-black border border-cyber-gray px-4 py-3 text-cyber-green focus:border-cyber-green outline-none transition-colors"
                    />

                    {crawlMode === 'local' && (
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch('http://localhost:8080/api/pick-files');
                            if (!res.ok) throw new Error('Failed to open file picker');
                            const paths = await res.json();
                            if (paths && paths.length > 0) {
                              setPrompt(paths.join('|'));
                            }
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        className="absolute right-0 top-0 bottom-0 bg-cyber-gray/20 hover:bg-cyber-cyan/20 text-cyber-cyan px-4 font-bold border-l border-cyber-gray transition-colors flex items-center gap-2 text-xs"
                      >
                        <Folder size={14} /> BROWSE...
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => runSpider()}
                    className="bg-cyber-green text-black px-8 py-3 font-bold hover:bg-white transition-colors"
                  >
                    EXECUTE
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className={`absolute inset-0 transition-opacity duration-500 ${activeTab === 'board' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <DetectiveBoard
              investigationId={currentInvestigationId}
              sharedSocket={socketConfig.socket}
              onDeepDiveNode={handleDeepDiveNode}
              onNavigateToChild={handleNavigateToChild}
              focusNodeId={focusedNodeId}
            />
          </div>

          <div className={`absolute inset-0 transition-opacity duration-500 ${activeTab === 'timeline' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <TimelineView
              investigationId={currentInvestigationId}
              onNavigateToNode={(nodeId) => {
                setFocusedNodeId(nodeId);
                setActiveTab('board');
                // Clear the focus after a delay to allow re-triggering same node
                setTimeout(() => setFocusedNodeId(null), 1000);
              }}
            />
          </div>

          <div className={`absolute inset-0 transition-opacity duration-500 flex flex-col ${activeTab === 'chat' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <VaultChatbot sharedSocket={socketConfig.socket} />
          </div>

          <div className={`absolute inset-0 transition-opacity duration-500 ${activeTab === 'settings' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <SettingsDashboard />
          </div>
        </main>
      </div>

      {/* Status Bar */}
      < footer className="px-4 py-2 border-t border-cyber-gray text-[10px] text-gray-600 flex items-center justify-between z-50 bg-cyber-black shadow-[0_-5px_20px_rgba(0,0,0,0.5)] overflow-hidden h-8" >
        <div className="flex items-center gap-2 shrink-0 bg-cyber-black z-10 pr-4">
          <div className={`w-2 h-2 rounded-full ${socketConfig.ready ? 'bg-cyber-green animate-pulse' : 'bg-red-500'}`} />
          <span>SYSTEM STATUS: {socketConfig.ready ? 'NOMINAL // WEBSOCKET: ACTIVE' : 'OFFLINE'}</span>
        </div>

        <div className="flex-1 relative overflow-hidden flex items-center h-full ml-4 mask-edges-left">
          <div className="absolute whitespace-nowrap animate-marquee flex items-center gap-2 text-cyber-cyan">
            <span className="font-bold opacity-50 shrink-0">CURRENT INVESTIGATION:</span>
            <span className="font-black tracking-widest uppercase truncate max-w-none">
              {investigations.find(i => i.id === currentInvestigationId)?.topic || 'NONE'}
            </span>
          </div>
        </div>
      </footer >
    </div >
  )
}

export default App
