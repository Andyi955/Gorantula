import { useMemo, useState, useEffect } from 'react';
import {
    AlertTriangle,
    ChevronRight,
    CheckCircle2,
    Cpu,
    Database,
    FlaskConical,
    KeyRound,
    Lock,
    Power,
    RefreshCcw,
    RotateCcw,
    Save,
    SlidersHorizontal,
    TerminalSquare,
} from 'lucide-react';
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
    { id: 'gemini', enabledKey: 'GEMINI_ENABLED', name: 'Google Gemini', setupKey: 'GEMINI_API_KEY', logo: '/assets/providers/gemini.svg' },
    { id: 'openai', enabledKey: 'OPENAI_ENABLED', name: 'OpenAI', setupKey: 'OPENAI_API_KEY', logo: '/assets/providers/openai.svg' },
    { id: 'anthropic', enabledKey: 'ANTHROPIC_ENABLED', name: 'Anthropic Claude', setupKey: 'ANTHROPIC_API_KEY', logo: '/assets/providers/anthropic.svg' },
    { id: 'deepseek', enabledKey: 'DEEPSEEK_ENABLED', name: 'DeepSeek', setupKey: 'DEEPSEEK_API_KEY', recommended: true, logo: '/assets/providers/deepseek.svg' },
    { id: 'qwen', enabledKey: 'DASHSCOPE_ENABLED', name: 'Qwen (DashScope)', setupKey: 'DASHSCOPE_API_KEY', logo: '/assets/providers/qwen.svg' },
    { id: 'zhipuai', enabledKey: 'ZHIPUAI_ENABLED', name: 'GLM (Zhipu AI)', setupKey: 'ZHIPUAI_API_KEY', logo: '/assets/providers/zhipuai.svg' },
    { id: 'moonshot', enabledKey: 'MOONSHOT_ENABLED', name: 'Kimi (Moonshot)', setupKey: 'MOONSHOT_API_KEY', logo: '/assets/providers/moonshot.svg' },
    { id: 'minimax', enabledKey: 'MINIMAX_ENABLED', name: 'MiniMax', setupKey: 'MINIMAX_API_KEY', logo: '/assets/providers/minimax.svg' },
    { id: 'ollama', enabledKey: 'OLLAMA_ENABLED', name: 'Ollama Local', setupKey: 'OLLAMA_HOST', logo: '/assets/providers/ollama.svg' },
    { id: 'lmstudio', enabledKey: 'LMSTUDIO_ENABLED', name: 'LM Studio Local', setupKey: 'LMSTUDIO_BASE_URL', logo: '/assets/providers/lmstudio.svg' },
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

const SETTINGS_SECTIONS = [
    { id: 'overview', label: 'Routing', description: 'Default task routes', icon: SlidersHorizontal },
    { id: 'providers', label: 'Providers', description: 'Activation switchboard', icon: Power },
    { id: 'credentials', label: 'Credentials', description: 'API keys and local hosts', icon: KeyRound },
    { id: 'models', label: 'Model IDs', description: 'Provider model overrides', icon: Cpu },
    { id: 'qa', label: 'QA Tools', description: 'Browser test workspace', icon: FlaskConical },
] as const;

type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id'];

const CREDENTIAL_GROUPS = [
    {
        id: 'cloud',
        label: 'Cloud APIs',
        description: 'Primary hosted model providers',
        fields: ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY'],
    },
    {
        id: 'alt',
        label: 'Alt APIs',
        description: 'Qwen, GLM, Kimi, MiniMax',
        fields: ['DASHSCOPE_API_KEY', 'ZHIPUAI_API_KEY', 'MOONSHOT_API_KEY', 'MINIMAX_API_KEY'],
    },
    {
        id: 'local',
        label: 'Local Runtimes',
        description: 'Ollama and LM Studio endpoints',
        fields: ['OLLAMA_HOST', 'LMSTUDIO_BASE_URL', 'LM_API_TOKEN'],
    },
] as const;

type CredentialGroupId = typeof CREDENTIAL_GROUPS[number]['id'];

const MODEL_GROUPS = [
    {
        id: 'cloud',
        label: 'Cloud IDs',
        description: 'Gemini, OpenAI, Anthropic, DeepSeek',
        fields: ['GEMINI_MODEL', 'OPENAI_MODEL', 'ANTHROPIC_MODEL', 'DEEPSEEK_MODEL'],
    },
    {
        id: 'alt',
        label: 'Alt IDs',
        description: 'Qwen, GLM, Kimi, MiniMax',
        fields: ['DASHSCOPE_MODEL', 'ZHIPUAI_MODEL', 'MOONSHOT_MODEL', 'MINIMAX_MODEL'],
    },
    {
        id: 'local',
        label: 'Local IDs',
        description: 'Ollama and LM Studio models',
        fields: ['OLLAMA_MODEL', 'LMSTUDIO_MODEL'],
    },
] as const;

type ModelGroupId = typeof MODEL_GROUPS[number]['id'];

const SettingsDashboard = () => {
    const [keys, setKeys] = useState<Record<string, string>>({});
    const [baselineKeys, setBaselineKeys] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
    const [activeSection, setActiveSection] = useState<SettingsSectionId>('overview');
    const [activeCredentialGroup, setActiveCredentialGroup] = useState<CredentialGroupId>('cloud');
    const [activeModelGroup, setActiveModelGroup] = useState<ModelGroupId>('cloud');
    const [lastSavedAt, setLastSavedAt] = useState<string>('Not saved this session');
    const showBrowserQaTools = import.meta.env.DEV || import.meta.env.MODE === 'test';

    useEffect(() => {
        fetch('http://localhost:8080/api/settings')
            .then(res => res.json())
            .then(data => {
                const nextKeys = data.keys || {};
                setKeys(nextKeys);
                setBaselineKeys(nextKeys);
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

    const dirty = useMemo(() => JSON.stringify(keys) !== JSON.stringify(baselineKeys), [baselineKeys, keys]);

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

    const providerReadiness = useMemo(() => {
        const activeProviders = PROVIDER_ACTIVATION_FIELDS.filter(provider => isProviderEnabled(provider.id));
        const missingProviders = activeProviders.filter(provider => !hasProviderSetup(provider.id));
        const localProviders = activeProviders.filter(provider => provider.id === 'ollama' || provider.id === 'lmstudio');
        return { activeProviders, missingProviders, localProviders };
    }, [keys]);

    const selectedSearchProvider = keys.DEFAULT_SEARCH_MODEL || 'deepseek';
    const selectedPersonaProvider = keys.DEFAULT_PERSONA_MODEL || 'deepseek';
    const deepseekModel = keys.DEEPSEEK_MODEL || 'deepseek-v4-flash';
    const credentialFieldsForActiveGroup = useMemo(() => {
        const group = CREDENTIAL_GROUPS.find(candidate => candidate.id === activeCredentialGroup) || CREDENTIAL_GROUPS[0];
        const fieldIds = new Set<string>(group.fields);
        return CREDENTIAL_FIELDS.filter(field => fieldIds.has(field.id));
    }, [activeCredentialGroup]);
    const modelFieldsForActiveGroup = useMemo(() => {
        const group = MODEL_GROUPS.find(candidate => candidate.id === activeModelGroup) || MODEL_GROUPS[0];
        const fieldIds = new Set<string>(group.fields);
        return MODEL_FIELDS.filter(field => fieldIds.has(field.id));
    }, [activeModelGroup]);

    const handleReset = () => {
        setKeys(baselineKeys);
        pushTransientStatus({ type: 'success', msg: 'Unsaved edits reverted' });
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

            const newData = await fetch('http://localhost:8080/api/settings').then(r => r.json());
            const nextKeys = newData.keys || {};
            setKeys(nextKeys);
            setBaselineKeys(nextKeys);
            setLastSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

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

    const renderProviderOption = (opt: typeof ROUTING_OPTIONS[number]) => {
        const disabled = !isProviderEnabled(opt.id) || !hasProviderSetup(opt.id);
        const disabledReason = isProviderExplicitlyDisabled(opt.id) ? 'Disabled' : 'Requires Setup';

        return (
            <option key={opt.id} value={opt.id} disabled={disabled}>
                {opt.name} {disabled ? `(${disabledReason})` : ''}
            </option>
        );
    };

    if (loading) {
        return (
            <div className="forensic-settings-root">
                <div className="forensic-settings-loading">Initializing Neural Link to Settings...</div>
            </div>
        );
    }

    return (
        <div className="forensic-settings-root" data-testid="settings-control-room">
            <div className="forensic-settings-grid-bg" aria-hidden="true" />

            <header className="forensic-settings-command">
                <div className="forensic-settings-title-block">
                    <div className="forensic-settings-kicker">
                        <TerminalSquare size={18} />
                        Control Room
                    </div>
                    <h2 aria-label="Model Provider Uplink">
                        <span aria-hidden="true">Model</span>
                        <span aria-hidden="true">Provider</span>
                        <span aria-hidden="true">Uplink</span>
                    </h2>
                    <div className="forensic-settings-title-rule" aria-hidden="true" />
                    <div className="forensic-settings-chips" aria-label="Settings status">
                        <span className="forensic-settings-chip forensic-settings-chip-success">
                            <CheckCircle2 size={13} />
                            Backend linked
                        </span>
                        <span className={`forensic-settings-chip ${dirty ? 'forensic-settings-chip-warning' : ''}`}>
                            {dirty ? 'Unsaved changes' : 'Config synchronized'}
                        </span>
                        <span className="forensic-settings-chip">Saved {lastSavedAt}</span>
                    </div>
                </div>

                <div className="forensic-settings-command-actions">
                    {status && (
                        <div className={`forensic-settings-status forensic-settings-status-${status.type}`} role="status">
                            {status.msg}
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={handleReset}
                        disabled={!dirty || saving}
                        className="forensic-settings-secondary-action"
                    >
                        <RefreshCcw size={15} />
                        Reset
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="forensic-settings-save-action"
                    >
                        <Save size={16} />
                        {saving ? 'Transmitting...' : 'Save Changes'}
                    </button>
                </div>
            </header>

            <div className="forensic-settings-workspace">
                <nav className="forensic-settings-nav" aria-label="Settings sections">
                    <div className="forensic-settings-nav-heading">Sections</div>
                    {SETTINGS_SECTIONS.map(section => {
                        if (section.id === 'qa' && !showBrowserQaTools) return null;
                        const Icon = section.icon;
                        return (
                            <button
                                key={section.id}
                                type="button"
                                onClick={() => setActiveSection(section.id)}
                                className={`forensic-settings-nav-item ${activeSection === section.id ? 'forensic-settings-nav-item-active' : ''}`}
                            >
                                <Icon size={16} />
                                <span>
                                    <strong>{section.label}</strong>
                                    <small>{section.description}</small>
                                </span>
                            </button>
                        );
                    })}

                    <div className="forensic-settings-nav-readout">
                        <span>Default Route</span>
                        <strong>DeepSeek V4 Flash</strong>
                        <small>Low-cost daily investigation mode</small>
                    </div>
                </nav>

                <main className="forensic-settings-main">
                    {activeSection === 'overview' && (
                        <section className="forensic-settings-panel forensic-settings-panel-purple">
                            <div className="forensic-settings-panel-header">
                                <div>
                                    <span className="forensic-settings-panel-kicker">Model Routing</span>
                                    <h3><Cpu size={18} /> Task Routes</h3>
                                </div>
                                <span className="forensic-settings-panel-badge">Autoselect prefers DeepSeek</span>
                            </div>
                            <p className="forensic-settings-panel-copy">
                                Select the default provider route for each task. Autoselect prefers DeepSeek V4 Flash when activated and otherwise falls back to the next available provider.
                            </p>

                            <div className="forensic-settings-route-grid">
                                {ROUTING_SETTINGS.map(r => (
                                    <label key={r.id} className="forensic-settings-field">
                                        <span>{r.name}</span>
                                        <select
                                            value={keys[r.id] || ''}
                                            onChange={(e) => handleChange(r.id, e.target.value)}
                                        >
                                            <option value="">-- Autoselect (Best Available) --</option>
                                            {ROUTING_OPTIONS.map(renderProviderOption)}
                                        </select>
                                        <small>ENV: {r.id} | {r.desc}</small>
                                    </label>
                                ))}
                            </div>
                        </section>
                    )}

                    {activeSection === 'providers' && (
                        <section className="forensic-settings-panel forensic-settings-panel-green">
                            <div className="forensic-settings-panel-header">
                                <div>
                                    <span className="forensic-settings-panel-kicker">Provider Activation</span>
                                    <h3><Power size={18} /> Route Switchboard</h3>
                                </div>
                                <span className="forensic-settings-panel-badge">
                                    {providerReadiness.activeProviders.length} active / {PROVIDER_ACTIVATION_FIELDS.length} total
                                </span>
                            </div>
                            <p className="forensic-settings-panel-copy">
                                Turn provider routes on or off explicitly. A provider still needs its matching API key or local host before it can run.
                            </p>

                            <div className="forensic-settings-provider-grid">
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
                                            className={`forensic-settings-provider ${enabled ? 'forensic-settings-provider-on' : ''} ${provider.recommended ? 'forensic-settings-provider-default' : ''}`}
                                            >
                                                <img
                                                    src={provider.logo}
                                                    alt=""
                                                    className="forensic-settings-provider-logo"
                                                    aria-hidden="true"
                                                />
                                                <span className="forensic-settings-provider-copy">
                                                    <strong>
                                                        {provider.name}
                                                        {provider.recommended ? ' (Default)' : ''}
                                                    </strong>
                                                    <small>{configured ? 'Setup present' : `Needs ${provider.setupKey}`}</small>
                                                </span>
                                                <span className={`forensic-settings-provider-status ${enabled ? 'forensic-settings-provider-status-on' : ''}`}>
                                                    {enabled ? 'Active' : 'Inactive'}
                                                </span>
                                                <span className="forensic-settings-switch" aria-hidden="true">
                                                    <span />
                                                </span>
                                                <ChevronRight size={14} className="forensic-settings-provider-arrow" aria-hidden="true" />
                                            </button>
                                        );
                                    })}
                            </div>
                        </section>
                    )}

                    {activeSection === 'credentials' && (
                        <section className="forensic-settings-panel forensic-settings-panel-cyan">
                            <div className="forensic-settings-panel-header">
                                <div>
                                    <span className="forensic-settings-panel-kicker">Credentials</span>
                                    <h3><Lock size={18} /> API Keys & Local Hosts</h3>
                                </div>
                                <span className="forensic-settings-panel-badge">{providerReadiness.missingProviders.length} missing setup</span>
                            </div>
                            <p className="forensic-settings-panel-copy">
                                Configure provider keys plus local runtime hosts. Use the groups below so local endpoints and alternate APIs are never buried in a long form.
                            </p>

                            <div className="forensic-settings-segmented" role="tablist" aria-label="Credential groups">
                                {CREDENTIAL_GROUPS.map(group => (
                                    <button
                                        key={group.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={activeCredentialGroup === group.id}
                                        onClick={() => setActiveCredentialGroup(group.id)}
                                        className={activeCredentialGroup === group.id ? 'forensic-settings-segment-active' : ''}
                                    >
                                        <strong>{group.label}</strong>
                                        <span>{group.description}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="forensic-settings-input-grid">
                                {credentialFieldsForActiveGroup.map(field => (
                                    <label key={field.id} className="forensic-settings-field">
                                        <span><Lock size={12} /> {field.name}</span>
                                        <input
                                            type={field.inputType}
                                            value={keys[field.id] || ''}
                                            onChange={(e) => handleChange(field.id, e.target.value)}
                                            placeholder={field.default || `Enter ${field.id}...`}
                                        />
                                        <small>ENV: {field.id}</small>
                                    </label>
                                ))}
                            </div>
                        </section>
                    )}

                    {activeSection === 'models' && (
                        <section className="forensic-settings-panel forensic-settings-panel-purple">
                            <div className="forensic-settings-panel-header">
                                <div>
                                    <span className="forensic-settings-panel-kicker">Model IDs</span>
                                    <h3><Cpu size={18} /> Provider Model Overrides</h3>
                                </div>
                                <span className="forensic-settings-panel-badge">{deepseekModel}</span>
                            </div>
                            <p className="forensic-settings-panel-copy">
                                Override the default model ID used for each provider. Use grouped banks so local model IDs stay easy to reach.
                            </p>

                            <div className="forensic-settings-segmented" role="tablist" aria-label="Model ID groups">
                                {MODEL_GROUPS.map(group => (
                                    <button
                                        key={group.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={activeModelGroup === group.id}
                                        onClick={() => setActiveModelGroup(group.id)}
                                        className={activeModelGroup === group.id ? 'forensic-settings-segment-active' : ''}
                                    >
                                        <strong>{group.label}</strong>
                                        <span>{group.description}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="forensic-settings-input-grid">
                                {modelFieldsForActiveGroup.map(field => (
                                    <label key={field.id} className="forensic-settings-field">
                                        <span><Cpu size={12} /> {field.name}</span>
                                        <input
                                            type="text"
                                            value={keys[field.id] || ''}
                                            onChange={(e) => handleChange(field.id, e.target.value)}
                                            placeholder={field.default}
                                        />
                                        <small>ENV: {field.id}</small>
                                    </label>
                                ))}
                            </div>
                        </section>
                    )}

                    {activeSection === 'qa' && showBrowserQaTools && (
                        <section className="forensic-settings-panel forensic-settings-panel-green">
                            <div className="forensic-settings-panel-header">
                                <div>
                                    <span className="forensic-settings-panel-kicker">Local QA</span>
                                    <h3><FlaskConical size={18} /> Browser Test Workspace</h3>
                                </div>
                                <span className="forensic-settings-panel-badge">Dev only</span>
                            </div>
                            <p className="forensic-settings-panel-copy">
                                Seed a deterministic local browser test workspace for manual QA and browser-use smoke tests. These cases stay in local browser storage only and can be cleared at any time.
                            </p>

                            <div className="forensic-settings-qa-actions">
                                <button type="button" onClick={handleSeedBrowserQaData}>
                                    <FlaskConical size={15} />
                                    Load Browser Test Data
                                </button>
                                <button type="button" onClick={handleClearBrowserQaData}>
                                    <RotateCcw size={15} />
                                    Clear Browser Test Data
                                </button>
                            </div>
                        </section>
                    )}
                </main>

                <aside className="forensic-settings-summary" aria-label="Provider readiness summary">
                    <div className="forensic-settings-summary-card forensic-settings-summary-primary">
                        <span>Default Route</span>
                        <strong>DeepSeek V4 Flash</strong>
                        <small>{deepseekModel}</small>
                    </div>

                    <div className="forensic-settings-summary-card">
                        <span>Search Route</span>
                        <strong>{selectedSearchProvider}</strong>
                        <small>Internet browsing and scrape synthesis</small>
                    </div>

                    <div className="forensic-settings-summary-card">
                        <span>Persona Route</span>
                        <strong>{selectedPersonaProvider}</strong>
                        <small>Connector, skeptic, timeline, and discovery personas</small>
                    </div>

                    <div className="forensic-settings-summary-card">
                        <span>Provider Readiness</span>
                        <strong>{providerReadiness.activeProviders.length} active / {providerReadiness.missingProviders.length} need setup</strong>
                        {providerReadiness.missingProviders.length > 0 ? (
                            <small className="forensic-settings-warning-line">
                                <AlertTriangle size={12} />
                                {providerReadiness.missingProviders.map(provider => provider.name).join(', ')}
                            </small>
                        ) : (
                            <small className="forensic-settings-success-line">
                                <CheckCircle2 size={12} />
                                All active providers configured
                            </small>
                        )}
                    </div>

                    <div className="forensic-settings-summary-card">
                        <span>Local Runtime</span>
                        <strong>{providerReadiness.localProviders.length > 0 ? 'Enabled' : 'Standby'}</strong>
                        <small>Ollama / LM Studio local routes</small>
                    </div>

                    <div className="forensic-settings-summary-card">
                        <span>Config Source</span>
                        <strong><Database size={14} /> Backend API</strong>
                        <small>http://localhost:8080/api/settings</small>
                    </div>
                </aside>
            </div>
        </div>
    );
};

export default SettingsDashboard;
