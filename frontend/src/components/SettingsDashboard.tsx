import { useState, useEffect } from 'react';
import { Save, Lock, Bot, Cpu } from 'lucide-react';

const PROVIDERS = [
    { id: 'GEMINI_API_KEY', name: 'Google Gemini', default: '' },
    { id: 'OPENAI_API_KEY', name: 'OpenAI (ChatGPT)', default: '' },
    { id: 'ANTHROPIC_API_KEY', name: 'Anthropic (Claude)', default: '' },
    { id: 'DEEPSEEK_API_KEY', name: 'DeepSeek', default: '' },
    { id: 'DASHSCOPE_API_KEY', name: 'Qwen (DashScope)', default: '' },
    { id: 'ZHIPUAI_API_KEY', name: 'GLM (Zhipu AI)', default: '' },
    { id: 'MOONSHOT_API_KEY', name: 'Kimi (Moonshot)', default: '' },
    { id: 'MINIMAX_API_KEY', name: 'MiniMax', default: '' },
    { id: 'OLLAMA_HOST', name: 'Ollama Base URL', default: 'http://localhost:11434' },
    { id: 'LM_API_TOKEN', name: 'LM Studio Token', default: '' }
];

const ROUTING_OPTIONS = [
    { id: 'gemini', name: 'Google Gemini' },
    { id: 'openai', name: 'OpenAI (ChatGPT)' },
    { id: 'anthropic', name: 'Anthropic (Claude)' },
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'qwen', name: 'Qwen (DashScope)' },
    { id: 'zhipuai', name: 'GLM (Zhipu AI)' },
    { id: 'moonshot', name: 'Kimi (Moonshot)' },
    { id: 'minimax', name: 'MiniMax' },
    { id: 'ollama', name: 'Ollama Local' },
    { id: 'lmstudio', name: 'LM Studio Local' }
];

const ROUTING_SETTINGS = [
    { id: 'DEFAULT_SEARCH_MODEL', name: 'Internet Browsing & Search', desc: 'Synthesizing information' },
    { id: 'DEFAULT_PERSONA_MODEL', name: 'Background Personas', desc: 'Multi-agent reasoning' }
];

const SettingsDashboard = () => {
    const [keys, setKeys] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

    useEffect(() => {
        fetch('http://localhost:8080/api/settings')
            .then(res => res.json())
            .then(data => {
                setKeys(data.keys || {});
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load settings', err);
                setLoading(false);
            });
    }, []);

    const handleChange = (id: string, value: string) => {
        setKeys(prev => ({ ...prev, [id]: value }));
    };

    const handleSave = async () => {
        setSaving(true);
        setStatus(null);
        try {
            const resp = await fetch('http://localhost:8080/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keys })
            });

            if (!resp.ok) throw new Error('Failed to save settings');

            setStatus({ type: 'success', msg: 'Settings saved successfully' });

            // Reload masking
            const newData = await fetch('http://localhost:8080/api/settings').then(r => r.json());
            setKeys(newData.keys || {});

            setTimeout(() => setStatus(null), 3000);
        } catch (err) {
            console.error(err);
            setStatus({ type: 'error', msg: 'Failed to save settings' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="text-cyber-green p-8">Initializing Neural Link to Settings...</div>;

    return (
        <div className="h-full flex flex-col p-8 bg-black/80 font-mono text-white overflow-y-auto">
            <div className="max-w-4xl mx-auto w-full">
                <div className="flex items-center gap-4 mb-8">
                    <Bot size={32} className="text-cyber-purple drop-shadow-[0_0_8px_rgba(188,19,254,0.8)]" />
                    <h2 className="text-3xl font-black tracking-tight uppercase text-cyber-purple drop-shadow-[0_0_8px_rgba(188,19,254,0.3)]">
                        Model Provider Uplink
                    </h2>
                </div>

                {status && (
                    <div className={`mb-6 p-4 border flex items-center gap-3 font-bold uppercase tracking-widest text-sm ${status.type === 'success' ? 'bg-cyber-green/10 border-cyber-green text-cyber-green shadow-[0_0_10px_rgba(57,255,20,0.2)]' : 'bg-red-500/10 border-red-500 text-red-500 shadow-[0_0_10px_rgba(255,0,0,0.2)]'}`}>
                        {status.msg}
                    </div>
                )}

                <div className="space-y-6">
                    <div className="p-4 border border-cyber-gray bg-cyber-black/50 overflow-hidden relative group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-cyber-purple"></div>
                        <h3 className="text-xl font-bold text-cyber-purple mb-2 flex items-center gap-2"><Cpu size={20} /> Model Routing</h3>
                        <p className="text-sm text-gray-400 mb-6">Select the default neural models for various cognitive tasks. Make sure you have configured the corresponding API keys below.</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {ROUTING_SETTINGS.map(r => (
                                <div key={r.id} className="flex flex-col gap-2">
                                    <label className="text-xs font-bold text-cyber-cyan tracking-widest uppercase flex items-center gap-2">
                                        {r.name}
                                    </label>
                                    <select
                                        value={keys[r.id] || ''}
                                        onChange={(e) => handleChange(r.id, e.target.value)}
                                        className="bg-black border border-cyber-gray/50 px-3 py-2 text-sm focus:border-cyber-purple focus:outline-none transition-colors w-full font-mono text-white"
                                    >
                                        <option value="">-- Autoselect (Gemini) --</option>
                                        {ROUTING_OPTIONS.map(opt => {
                                            // Determine if the option should be disabled because the key is missing
                                            let disabled = false;

                                            if (opt.id === 'openai' && !keys['OPENAI_API_KEY']) disabled = true;
                                            if (opt.id === 'deepseek' && !keys['DEEPSEEK_API_KEY']) disabled = true;
                                            if (opt.id === 'qwen' && !keys['DASHSCOPE_API_KEY']) disabled = true;
                                            if (opt.id === 'glm' && !keys['ZHIPU_API_KEY']) disabled = true;
                                            if (opt.id === 'kimi' && !keys['MOONSHOT_API_KEY']) disabled = true;
                                            if (opt.id === 'minimax' && !keys['MINIMAX_API_KEY']) disabled = true;
                                            if (opt.id === 'ollama' && !keys['OLLAMA_HOST']) disabled = true;
                                            if (opt.id === 'lmstudio' && !keys['LMSTUDIO_HOST']) disabled = true;
                                            if (opt.id === 'anthropic' && !keys['ANTHROPIC_API_KEY']) disabled = true;

                                            return (
                                                <option key={opt.id} value={opt.id} disabled={disabled}>
                                                    {opt.name} {disabled ? '(Requires Key)' : ''}
                                                </option>
                                            )
                                        })}
                                    </select>
                                    <span className="text-[10px] text-gray-600 font-mono">ENV: {r.id} | {r.desc}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 border border-cyber-gray bg-cyber-black/50 overflow-hidden relative group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-cyber-purple"></div>
                        <h3 className="text-xl font-bold text-cyber-purple mb-2 flex items-center gap-2"><Lock size={20} /> API Credentials</h3>
                        <p className="text-sm text-gray-400 mb-2">Configure API keys for external intelligences and local LLM routers. Blank fields will unset the environment configuration.</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                            {PROVIDERS.map(p => (
                                <div key={p.id} className="flex flex-col gap-2">
                                    <label className="text-xs font-bold text-cyber-cyan tracking-widest uppercase flex items-center gap-2">
                                        <Lock size={12} className="opacity-70" /> {p.name}
                                    </label>
                                    <input
                                        type="password"
                                        value={keys[p.id] || ''}
                                        onChange={(e) => handleChange(p.id, e.target.value)}
                                        placeholder={p.default || `Enter ${p.id}...`}
                                        className="bg-black border border-cyber-gray/50 px-3 py-2 text-sm focus:border-cyber-purple focus:outline-none transition-colors w-full font-mono placeholder:text-gray-700 placeholder:italic"
                                    />
                                    <span className="text-[10px] text-gray-600 font-mono">ENV: {p.id}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="mt-8 flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 bg-cyber-purple hover:bg-white hover:text-black text-white px-8 py-3 font-bold tracking-widest transition-all shadow-[0_0_15px_rgba(188,19,254,0.4)] disabled:opacity-50 disabled:cursor-not-allowed uppercase"
                    >
                        <Save size={18} />
                        {saving ? 'Transmitting...' : 'Commit Settings'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsDashboard;
