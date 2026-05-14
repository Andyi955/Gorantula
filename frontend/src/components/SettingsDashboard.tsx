import { useState, useEffect } from 'react';
import { Save, Lock, Bot, Cpu, FlaskConical, RotateCcw, Power } from 'lucide-react';
import {
    BROWSER_QA_CLEARED_EVENT,
    BROWSER_QA_SEEDED_EVENT,
    clearBrowserQaData,
    seedBrowserQaData,
} from '../utils/browserQaSeed';

const CREDENTIAL_FIELDS = [
    { id: 'GEMINI_API_KEY', name: 'Google Gemini API Key', default: '', inputType: 'password' },
    { id: 'OPENAI_API_KEY', name: 'OpenAI API Key', default: '', inputType: 'password' },
    { id: 'ANTHROPIC_API_KEY', name: 'Anthropic API Key', default: '', inputType: 'password' },
    { id: 'DEEPSEEK_API_KEY', name: 'DeepSeek API Key', default: '', inputType: 'password' },
    { id: 'DASHSCOPE_API_KEY', name: 'DashScope API Key', default: '', inputType: 'password' },
    { id: 'ZHIPUAI_API_KEY', name: 'Zhipu AI API Key', default: '', inputType: 'password' },
    { id: 'MOONSHOT_API_KEY', name: 'Moonshot API Key', default: '', inputType: 'password' },
    { id: 'MINIMAX_API_KEY', name: 'MiniMax API Key', default: '', inputType: 'password' },
    { id: 'OLLAMA_HOST', name: 'Ollama Base URL', default: 'http://localhost:11434', inputType: 'text' },
    { id: 'LMSTUDIO_BASE_URL', name: 'LM Studio Base URL', default: 'http://localhost:1234/v1', inputType: 'text' },
    { id: 'LM_API_TOKEN', name: 'LM Studio Token', default: '', inputType: 'password' }
];

const MODEL_FIELDS = [
    { id: 'GEMINI_MODEL', name: 'Gemini Default', default: 'gemini-3-flash-preview' },
    { id: 'OPENAI_MODEL', name: 'OpenAI Default', default: 'gpt-5.4-mini' },
    { id: 'ANTHROPIC_MODEL', name: 'Anthropic Default', default: 'claude-sonnet-4-6' },
    { id: 'DEEPSEEK_MODEL', name: 'DeepSeek Default', default: 'deepseek-v4-flash' },
    { id: 'DASHSCOPE_MODEL', name: 'DashScope Default', default: 'qwen3.6-plus' },
    { id: 'ZHIPUAI_MODEL', name: 'Zhipu AI Default', default: 'glm-5-turbo' },
    { id: 'MOONSHOT_MODEL', name: 'Moonshot Default', default: 'kimi-k2.6' },
    { id: 'MINIMAX_MODEL', name: 'MiniMax Default', default: 'MiniMax-M2.7-highspeed' },
    { id: 'OLLAMA_MODEL', name: 'Ollama Default', default: 'qwen3-coder' },
    { id: 'LMSTUDIO_MODEL', name: 'LM Studio Default', default: 'qwen3.6' }
];

const ROUTING_OPTIONS = [
    { id: 'gemini', name: 'Google Gemini' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic Claude' },
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'qwen', name: 'Qwen (DashScope)' },
    { id: 'zhipuai', name: 'GLM (Zhipu AI)' },
    { id: 'moonshot', name: 'Kimi (Moonshot)' },
    { id: 'minimax', name: 'MiniMax' },
    { id: 'ollama', name: 'Ollama Local' },
    { id: 'lmstudio', name: 'LM Studio Local' }
];

const PROVIDER_ACTIVATION_FIELDS = [
    { id: 'gemini', enabledKey: 'GEMINI_ENABLED', name: 'Google Gemini', setupKey: 'GEMINI_API_KEY' },
    { id: 'openai', enabledKey: 'OPENAI_ENABLED', name: 'OpenAI', setupKey: 'OPENAI_API_KEY' },
    { id: 'anthropic', enabledKey: 'ANTHROPIC_ENABLED', name: 'Anthropic Claude', setupKey: 'ANTHROPIC_API_KEY' },
    { id: 'deepseek', enabledKey: 'DEEPSEEK_ENABLED', name: 'DeepSeek', setupKey: 'DEEPSEEK_API_KEY', recommended: true },
    { id: 'qwen', enabledKey: 'DASHSCOPE_ENABLED', name: 'Qwen (DashScope)', setupKey: 'DASHSCOPE_API_KEY' },
    { id: 'zhipuai', enabledKey: 'ZHIPUAI_ENABLED', name: 'GLM (Zhipu AI)', setupKey: 'ZHIPUAI_API_KEY' },
    { id: 'moonshot', enabledKey: 'MOONSHOT_ENABLED', name: 'Kimi (Moonshot)', setupKey: 'MOONSHOT_API_KEY' },
    { id: 'minimax', enabledKey: 'MINIMAX_ENABLED', name: 'MiniMax', setupKey: 'MINIMAX_API_KEY' },
    { id: 'ollama', enabledKey: 'OLLAMA_ENABLED', name: 'Ollama Local', setupKey: 'OLLAMA_HOST' },
    { id: 'lmstudio', enabledKey: 'LMSTUDIO_ENABLED', name: 'LM Studio Local', setupKey: 'LMSTUDIO_BASE_URL' },
];

const ROUTING_SETTINGS = [
    { id: 'DEFAULT_SEARCH_MODEL', name: 'Internet Browsing & Search', desc: 'Synthesizing information' },
    { id: 'DEFAULT_PERSONA_MODEL', name: 'Background Personas', desc: 'Multi-agent reasoning' }
];

const ROUTING_REQUIREMENTS: Record<string, string> = {
    gemini: 'GEMINI_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    qwen: 'DASHSCOPE_API_KEY',
    zhipuai: 'ZHIPUAI_API_KEY',
    moonshot: 'MOONSHOT_API_KEY',
    minimax: 'MINIMAX_API_KEY',
    ollama: 'OLLAMA_HOST',
    lmstudio: 'LMSTUDIO_BASE_URL',
};

const PROVIDER_ACTIVATION_KEYS = PROVIDER_ACTIVATION_FIELDS.reduce<Record<string, string>>((keys, provider) => {
    keys[provider.id] = provider.enabledKey;
    return keys;
}, {});

const SettingsDashboard = () => {
    const [keys, setKeys] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
    const showBrowserQaTools = import.meta.env.DEV || import.meta.env.MODE === 'test';

    useEffect(() => {
        fetch('http://localhost:8080/api/settings')
            .then(res => res.json())
            .then(data => {
                setKeys(data.keys || {});
                setLoading(false);
            })
            .catch(err => {
                console.debug('Settings unavailable; backend may be offline.', err);
                setLoading(false);
            });
    }, []);

    const pushTransientStatus = (nextStatus: { type: 'success' | 'error', msg: string }) => {
        setStatus(nextStatus);
        setTimeout(() => setStatus(null), 3000);
    };

    const handleChange = (id: string, value: string) => {
        setKeys(prev => ({ ...prev, [id]: value }));
    };

    const isProviderEnabled = (providerId: string) => {
        const enabledKey = PROVIDER_ACTIVATION_KEYS[providerId];
        const rawValue = enabledKey ? keys[enabledKey] : '';
        if (rawValue === 'true') return true;
        if (rawValue === 'false') return false;

        const requirementKey = ROUTING_REQUIREMENTS[providerId];
        return requirementKey ? Boolean(keys[requirementKey]) : true;
    };

    const hasProviderSetup = (providerId: string) => {
        const requirementKey = ROUTING_REQUIREMENTS[providerId];
        return requirementKey ? Boolean(keys[requirementKey]) : true;
    };

    const isProviderExplicitlyDisabled = (providerId: string) => {
        const enabledKey = PROVIDER_ACTIVATION_KEYS[providerId];
        return enabledKey ? keys[enabledKey] === 'false' : false;
    };

    const toggleProvider = (enabledKey: string, nextEnabled: boolean) => {
        handleChange(enabledKey, nextEnabled ? 'true' : 'false');
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

    const handleSeedBrowserQaData = () => {
        const result = seedBrowserQaData();
        window.dispatchEvent(new CustomEvent(BROWSER_QA_SEEDED_EVENT, { detail: result }));
        pushTransientStatus({ type: 'success', msg: 'Browser QA data loaded' });
    };

    const handleClearBrowserQaData = () => {
        clearBrowserQaData();
        window.dispatchEvent(new CustomEvent(BROWSER_QA_CLEARED_EVENT));
        pushTransientStatus({ type: 'success', msg: 'Browser QA data cleared' });
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
                        <p className="text-sm text-gray-400 mb-6">Select the default provider route for each task. Autoselect prefers DeepSeek V4 Flash when activated and otherwise falls back to the next available provider.</p>

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
                                        <option value="">-- Autoselect (Best Available) --</option>
                                        {ROUTING_OPTIONS.map(opt => {
                                            const disabled = !isProviderEnabled(opt.id) || !hasProviderSetup(opt.id);
                                            const disabledReason = isProviderExplicitlyDisabled(opt.id) ? 'Disabled' : 'Requires Setup';

                                            return (
                                                <option key={opt.id} value={opt.id} disabled={disabled}>
                                                    {opt.name} {disabled ? `(${disabledReason})` : ''}
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
                        <div className="absolute top-0 left-0 w-1 h-full bg-cyber-green"></div>
                        <h3 className="text-xl font-bold text-cyber-purple mb-2 flex items-center gap-2"><Power size={20} /> Provider Activation</h3>
                        <p className="text-sm text-gray-400 mb-6">Turn provider routes on or off explicitly. A provider still needs its matching API key or local host before it can run.</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {PROVIDER_ACTIVATION_FIELDS.map(provider => {
                                const enabled = isProviderEnabled(provider.id);
                                const configured = hasProviderSetup(provider.id);
                                return (
                                    <button
                                        key={provider.id}
                                        type="button"
                                        role="switch"
                                        aria-checked={enabled}
                                        aria-label={`${provider.name} ${enabled ? 'enabled' : 'disabled'}`}
                                        onClick={() => toggleProvider(provider.enabledKey, !enabled)}
                                        className={`flex items-center justify-between gap-3 border px-3 py-2 text-left transition-colors ${enabled ? 'border-cyber-green/50 bg-cyber-green/10 text-cyber-green' : 'border-cyber-gray/60 bg-black text-gray-400'}`}
                                    >
                                        <span className="min-w-0">
                                            <span className="block text-xs font-bold uppercase tracking-[0.16em]">
                                                {provider.name}
                                                {provider.recommended ? ' (Default)' : ''}
                                            </span>
                                            <span className="mt-1 block text-[10px] uppercase tracking-[0.14em] text-gray-500">
                                                {configured ? 'Setup present' : `Needs ${provider.setupKey}`}
                                            </span>
                                        </span>
                                        <span className={`h-5 w-9 rounded-full border p-0.5 transition-colors ${enabled ? 'border-cyber-green bg-cyber-green/30' : 'border-cyber-gray bg-cyber-black'}`}>
                                            <span className={`block h-3.5 w-3.5 rounded-full transition-transform ${enabled ? 'translate-x-4 bg-cyber-green' : 'translate-x-0 bg-gray-500'}`} />
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="p-4 border border-cyber-gray bg-cyber-black/50 overflow-hidden relative group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-cyber-purple"></div>
                        <h3 className="text-xl font-bold text-cyber-purple mb-2 flex items-center gap-2"><Lock size={20} /> API Credentials & Local Hosts</h3>
                        <p className="text-sm text-gray-400 mb-2">Configure provider keys plus the local runtime hosts used by Ollama and LM Studio. Blank fields will unset the environment configuration.</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                            {CREDENTIAL_FIELDS.map(field => (
                                <div key={field.id} className="flex flex-col gap-2">
                                    <label className="text-xs font-bold text-cyber-cyan tracking-widest uppercase flex items-center gap-2">
                                        <Lock size={12} className="opacity-70" /> {field.name}
                                    </label>
                                    <input
                                        type={field.inputType}
                                        value={keys[field.id] || ''}
                                        onChange={(e) => handleChange(field.id, e.target.value)}
                                        placeholder={field.default || `Enter ${field.id}...`}
                                        className="bg-black border border-cyber-gray/50 px-3 py-2 text-sm focus:border-cyber-purple focus:outline-none transition-colors w-full font-mono placeholder:text-gray-700 placeholder:italic"
                                    />
                                    <span className="text-[10px] text-gray-600 font-mono">ENV: {field.id}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 border border-cyber-gray bg-cyber-black/50 overflow-hidden relative group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-cyber-purple"></div>
                        <h3 className="text-xl font-bold text-cyber-purple mb-2 flex items-center gap-2"><Cpu size={20} /> Provider Model IDs</h3>
                        <p className="text-sm text-gray-400 mb-2">Override the default model ID used for each provider. Leave a field blank to use the built-in recommended default for that provider.</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                            {MODEL_FIELDS.map(field => (
                                <div key={field.id} className="flex flex-col gap-2">
                                    <label className="text-xs font-bold text-cyber-cyan tracking-widest uppercase flex items-center gap-2">
                                        <Cpu size={12} className="opacity-70" /> {field.name}
                                    </label>
                                    <input
                                        type="text"
                                        value={keys[field.id] || ''}
                                        onChange={(e) => handleChange(field.id, e.target.value)}
                                        placeholder={field.default}
                                        className="bg-black border border-cyber-gray/50 px-3 py-2 text-sm focus:border-cyber-purple focus:outline-none transition-colors w-full font-mono placeholder:text-gray-700 placeholder:italic"
                                    />
                                    <span className="text-[10px] text-gray-600 font-mono">ENV: {field.id}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {showBrowserQaTools && (
                        <div className="p-4 border border-cyber-gray bg-cyber-black/50 overflow-hidden relative group">
                            <div className="absolute top-0 left-0 w-1 h-full bg-cyber-green"></div>
                            <h3 className="text-xl font-bold text-cyber-green mb-2 flex items-center gap-2"><FlaskConical size={20} /> Local QA Tools</h3>
                            <p className="text-sm text-gray-400 mb-6">
                                Seed a deterministic local browser test workspace for manual QA and browser-use smoke tests. These cases stay in LocalStorage only and can be cleared at any time.
                            </p>

                            <div className="flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={handleSeedBrowserQaData}
                                    className="flex items-center gap-2 border border-cyber-green/40 bg-cyber-green/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-cyber-green transition-colors hover:bg-cyber-green hover:text-black"
                                >
                                    <FlaskConical size={14} />
                                    Load Browser Test Data
                                </button>
                                <button
                                    type="button"
                                    onClick={handleClearBrowserQaData}
                                    className="flex items-center gap-2 border border-cyber-gray/60 bg-black px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-gray-300 transition-colors hover:border-white hover:text-white"
                                >
                                    <RotateCcw size={14} />
                                    Clear Browser Test Data
                                </button>
                            </div>
                        </div>
                    )}

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
