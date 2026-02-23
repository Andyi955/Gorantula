import { useState, useEffect } from 'react'
import SpiderVisualizer from './components/SpiderVisualizer'
import DetectiveBoard from './components/DetectiveBoard'
import { Terminal, Database, Folder, Plus } from 'lucide-react'

interface Investigation {
  id: string
  topic: string
}

function App() {
  const [activeTab, setActiveTab] = useState<'spider' | 'board'>('spider')
  const [prompt, setPrompt] = useState('')
  const [socket, setSocket] = useState<WebSocket | null>(null)

  const [investigations, setInvestigations] = useState<Investigation[]>([])
  const [currentInvestigationId, setCurrentInvestigationId] = useState<string | null>(null)

  useEffect(() => {
    const s = new WebSocket('ws://localhost:8080/ws')
    setSocket(s)

    // Load list from local storage if any
    const saved = localStorage.getItem('gorantula_investigations')
    if (saved) {
      const data = JSON.parse(saved)
      setInvestigations(data)
      if (data.length > 0) setCurrentInvestigationId(data[0].id)
    }

    return () => s.close()
  }, [])

  const runSpider = () => {
    if (socket && prompt) {
      const id = `inv-${Date.now()}`
      const newInv = { id, topic: prompt }

      const updated = [newInv, ...investigations]
      setInvestigations(updated)
      setCurrentInvestigationId(id)
      localStorage.setItem('gorantula_investigations', JSON.stringify(updated))

      socket.send(JSON.stringify({ type: 'CRAWL', payload: prompt }))
      setPrompt('')
      setActiveTab('spider')
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
              <button
                key={inv.id}
                onClick={() => setCurrentInvestigationId(inv.id)}
                className={`w-full text-left p-4 border-b border-cyber-gray/30 flex items-start gap-3 transition-colors ${currentInvestigationId === inv.id ? 'bg-cyber-green/10 border-l-2 border-l-cyber-green' : 'hover:bg-cyber-gray/20 text-gray-400'}`}
              >
                <Folder size={16} className={currentInvestigationId === inv.id ? 'text-cyber-green' : 'text-gray-600'} />
                <span className={`text-xs truncate ${currentInvestigationId === inv.id ? 'text-white font-bold' : ''}`}>
                  {inv.topic}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 relative">
          <div className={`absolute inset-0 transition-opacity duration-500 ${activeTab === 'spider' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-hidden">
                <SpiderVisualizer />
              </div>

              {/* Input Footer */}
              <div className="p-6 bg-cyber-gray/30 border-t border-cyber-gray backdrop-blur-sm">
                <div className="max-w-3xl mx-auto flex gap-4">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runSpider()}
                    placeholder="ENTER CRAWL PARAMETERS..."
                    className="flex-1 bg-black border border-cyber-gray px-4 py-3 text-cyber-green focus:border-cyber-green outline-none transition-colors"
                  />
                  <button
                    onClick={runSpider}
                    className="bg-cyber-green text-black px-8 py-3 font-bold hover:bg-white transition-colors"
                  >
                    EXECUTE
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className={`absolute inset-0 transition-opacity duration-500 ${activeTab === 'board' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <DetectiveBoard investigationId={currentInvestigationId} />
          </div>
        </main>
      </div>

      {/* Status Bar */}
      <footer className="px-4 py-1 border-t border-cyber-gray text-[10px] text-gray-600 flex justify-between z-50 bg-cyber-black">
        <div>SYSTEM STATUS: NOMINAL // WEBSOCKET: {socket?.readyState === 1 ? 'ACTIVE' : 'CONNECTING'}</div>
        <div>CURENT INVESTIGATION: {investigations.find(i => i.id === currentInvestigationId)?.topic || 'NONE'}</div>
      </footer>
    </div>
  )
}

export default App
