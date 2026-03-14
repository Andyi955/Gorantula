import { useState, useRef } from 'react';
import { useEffect } from 'react';
import { Bot, Send, User, ChevronDown, CheckSquare, Square, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface VaultChatbotProps {
    sharedSocket: WebSocket | null;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

interface VaultFile {
    fileName: string;
    filePath: string;
    modTime: string;
}

export default function VaultChatbot({ sharedSocket }: VaultChatbotProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [availableFiles, setAvailableFiles] = useState<VaultFile[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isWaiting, setIsWaiting] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Fetch vault files
        fetch('http://localhost:8080/api/vault-files')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setAvailableFiles(data);
                }
            })
            .catch(err => console.error("Failed to fetch vault files:", err));
    }, []);

    useEffect(() => {
        if (!sharedSocket) return;

        const handleMessage = (event: MessageEvent) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'CHAT_RESPONSE') {
                    setMessages(prev => [...prev, { id: `bot-${Date.now()}`, role: 'assistant', content: msg.payload }]);
                    setIsWaiting(false);
                } else if (msg.type === 'ERROR' && isWaiting) {
                    setMessages(prev => [...prev, { id: `err-${Date.now()}`, role: 'assistant', content: `**Error:** ${msg.payload}` }]);
                    setIsWaiting(false);
                }
            } catch (e) {
                console.error("Failed to parse websocket message", e);
            }
        };

        sharedSocket.addEventListener('message', handleMessage);
        return () => sharedSocket.removeEventListener('message', handleMessage);
    }, [sharedSocket, isWaiting]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isWaiting]);

    const toggleFileSelection = (filePath: string) => {
        const nextSet = new Set(selectedFiles);
        if (nextSet.has(filePath)) {
            nextSet.delete(filePath);
        } else {
            nextSet.add(filePath);
        }
        setSelectedFiles(nextSet);
    };

    const selectAll = () => {
        setSelectedFiles(new Set(availableFiles.map(f => f.filePath)));
    };

    const selectNone = () => {
        setSelectedFiles(new Set());
    };

    const handleSend = () => {
        if (!input.trim() || !sharedSocket || selectedFiles.size === 0) return;

        const userQuery = input.trim();
        setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content: userQuery }]);
        setInput('');
        setIsWaiting(true);

        sharedSocket.send(JSON.stringify({
            type: 'CHAT_RAG',
            payload: {
                query: userQuery,
                files: Array.from(selectedFiles)
            }
        }));
    };

    return (
        <div className="flex flex-col h-full bg-cyber-black font-mono">
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-cyber-gray space-y-4">
                        <Bot size={64} className="text-cyber-green opacity-20" />
                        <h2 className="text-xl font-bold text-white tracking-widest uppercase">Vault Chat Interface</h2>
                        <p className="max-w-md text-center text-sm">
                            Select one or more historical investigation files from the vault below, then ask a question.
                            The AI will review those specific files to ground its answer using only your gathered intelligence.
                        </p>
                    </div>
                ) : (
                    messages.map(msg => (
                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-4xl flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                                <div className={`w-8 h-8 flex items-center justify-center shrink-0 rounded ${msg.role === 'user' ? 'bg-cyber-purple' : 'bg-cyber-green'}`}>
                                    {msg.role === 'user' ? <User size={16} className="text-white" /> : <Bot size={16} className="text-black" />}
                                </div>
                                <div className={`p-6 rounded border shadow-lg ${msg.role === 'user' ? 'bg-black border-cyber-purple text-white shadow-[0_0_15px_rgba(188,19,254,0.2)]' : 'bg-cyber-green/5 border-cyber-green/50 text-gray-200 shadow-[0_0_15px_rgba(16,185,129,0.1)]'}`}>
                                    <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-black prose-pre:border prose-pre:border-cyber-gray prose-a:text-cyber-cyan">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {msg.content}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}

                {isWaiting && (
                    <div className="flex justify-start">
                        <div className="max-w-3xl flex gap-4 flex-row">
                            <div className="w-8 h-8 flex items-center justify-center shrink-0 rounded bg-cyber-green">
                                <Bot size={16} className="text-black" />
                            </div>
                            <div className="p-4 rounded border bg-cyber-green/5 border-cyber-green/50 text-cyber-green flex items-center gap-3">
                                <div className="w-2 h-2 rounded-full bg-cyber-green animate-ping" />
                                <span className="animate-pulse text-sm font-bold tracking-widest uppercase">Interrogating Vault Data...</span>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={bottomRef} className="h-4" />
            </div>

            <div className="p-6 bg-cyber-gray/10 border-t border-cyber-gray backdrop-blur-sm z-20">
                <div className="max-w-5xl mx-auto flex flex-col gap-3">

                    <div className="relative">
                        <button
                            className={`w-full flex items-center justify-between bg-black border px-4 py-3 text-sm transition-colors ${selectedFiles.size > 0 ? 'border-cyber-green text-cyber-green hover:bg-cyber-green/10 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'border-cyber-gray text-gray-500 hover:text-white'}`}
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        >
                            <div className="flex items-center gap-2">
                                <FileText size={16} />
                                <span className="font-bold tracking-widest uppercase">{selectedFiles.size} of {availableFiles.length} FILES SELECTED FOR CONTEXT</span>
                            </div>
                            <ChevronDown size={16} className={`transform transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isDropdownOpen && (
                            <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 max-h-64 overflow-y-auto bg-black border border-cyber-gray shadow-[0_-10px_30px_rgba(0,0,0,0.8)] z-50 rounded-t">
                                {availableFiles.length > 0 && (
                                    <div className="flex bg-cyber-gray/20 border-b border-cyber-gray p-3 gap-3 sticky top-0 z-10 backdrop-blur-md">
                                        <button onClick={selectAll} className="text-xs px-4 py-2 bg-black border border-cyber-gray text-cyber-cyan hover:bg-cyber-cyan/10 hover:border-cyber-cyan transition-colors font-bold uppercase tracking-widest shadow-[0_0_10px_rgba(0,243,255,0.1)]">Select All</button>
                                        <button onClick={selectNone} className="text-xs px-4 py-2 bg-black border border-cyber-gray text-red-400 hover:bg-red-400/10 transition-colors uppercase tracking-widest font-bold">Clear</button>
                                    </div>
                                )}

                                {availableFiles.length === 0 ? (
                                    <div className="px-4 py-4 text-sm text-gray-500 italic">No historical investigations found in the vault.</div>
                                ) : (
                                    <div className="py-2 flex flex-col gap-1 px-2">
                                        {availableFiles.map(file => (
                                            <button
                                                key={file.filePath}
                                                onClick={() => toggleFileSelection(file.filePath)}
                                                className={`w-full text-left px-4 py-2 text-sm flex items-center gap-3 transition-colors group border-l-2 ${selectedFiles.has(file.filePath) ? 'bg-cyber-green/5 border-cyber-green' : 'border-transparent hover:bg-cyber-gray/20'}`}
                                            >
                                                {selectedFiles.has(file.filePath) ? (
                                                    <CheckSquare size={16} className="text-cyber-green shrink-0 shadow-[0_0_10px_rgba(16,185,129,0.5)] bg-black" />
                                                ) : (
                                                    <Square size={16} className="text-gray-600 group-hover:text-cyber-gray shrink-0 transition-colors" />
                                                )}
                                                <div className="flex flex-col truncate">
                                                    <span className={`truncate ${selectedFiles.has(file.filePath) ? 'text-white font-bold' : 'text-gray-400 group-hover:text-gray-200'}`}>
                                                        {file.fileName}
                                                    </span>
                                                    <span className={`${selectedFiles.has(file.filePath) ? 'text-cyber-green/70' : 'text-gray-600'} text-[10px]`}>
                                                        {new Date(file.modTime).toLocaleString()}
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex gap-2 relative shadow-[0_0_20px_rgba(0,0,0,0.5)]">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder={selectedFiles.size > 0 ? "Ask a question mapping the selected intelligence..." : "SELECT CONTEXT FILES DIRECTLY ABOVE FIRST"}
                            disabled={selectedFiles.size === 0 || isWaiting}
                            className="w-full bg-black border border-cyber-gray px-4 py-4 text-white focus:border-cyber-green outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed placeholder-gray-600"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || selectedFiles.size === 0 || isWaiting}
                            className="bg-cyber-green text-black px-8 py-3 font-bold hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shrink-0 border border-cyber-green text-lg tracking-widest shadow-[0_0_15px_rgba(16,185,129,0.5)] disabled:shadow-none"
                        >
                            <Send size={20} />
                            INTERROGATE
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
}
