import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Globe,
  HelpCircle,
  Megaphone,
  RotateCcw,
  Search,
  Sliders,
  Sparkles,
} from 'lucide-react';

export type ConsultationLevel = 1 | 2 | 3;
export type VerticalScope = 'ALL' | 'TECH' | 'SEO_AEO' | 'SOCIAL';

export interface ConsultationKnobConfig {
  globalLevel: ConsultationLevel;
  perVerticalLevel: Record<'TECH' | 'SEO_AEO' | 'SOCIAL', ConsultationLevel>;
  questionsPerVertical: Record<'TECH' | 'SEO_AEO' | 'SOCIAL', number>;
  updatedAt: string;
}

const STORAGE_KEY = 'commando_consultation_knob_v1';

export const DEFAULT_CONSULTATION_CONFIG: ConsultationKnobConfig = {
  globalLevel: 2,
  perVerticalLevel: {
    TECH: 3,
    SEO_AEO: 2,
    SOCIAL: 2,
  },
  questionsPerVertical: {
    TECH: 3,
    SEO_AEO: 2,
    SOCIAL: 2,
  },
  updatedAt: new Date().toISOString(),
};

export function loadConsultationKnobConfig(): ConsultationKnobConfig {
  if (typeof window === 'undefined') return DEFAULT_CONSULTATION_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONSULTATION_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ConsultationKnobConfig>;
    return {
      globalLevel: (parsed.globalLevel as ConsultationLevel) || 2,
      perVerticalLevel: {
        TECH: (parsed.perVerticalLevel?.TECH as ConsultationLevel) || 3,
        SEO_AEO: (parsed.perVerticalLevel?.SEO_AEO as ConsultationLevel) || 2,
        SOCIAL: (parsed.perVerticalLevel?.SOCIAL as ConsultationLevel) || 2,
      },
      questionsPerVertical: {
        TECH: parsed.questionsPerVertical?.TECH ?? 3,
        SEO_AEO: parsed.questionsPerVertical?.SEO_AEO ?? 2,
        SOCIAL: parsed.questionsPerVertical?.SOCIAL ?? 2,
      },
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return DEFAULT_CONSULTATION_CONFIG;
  }
}

export function saveConsultationKnobConfig(config: ConsultationKnobConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(
      new CustomEvent('commando:consultation-knob-change', { detail: config })
    );
  } catch {
    // ignore storage errors in restricted environments
  }
}

export const LEVEL_METADATA: Record<
  ConsultationLevel,
  {
    level: ConsultationLevel;
    shortTitle: string;
    title: string;
    badge: string;
    description: string;
    questionCountDefault: number;
    accentText: string;
    accentBorder: string;
    accentBg: string;
  }
> = {
  1: {
    level: 1,
    shortTitle: 'L1 • Decisive',
    title: 'Level 1 — Decisive / Autopilot',
    badge: '0–1 Qs • High-Level Sign-Off',
    description:
      'AI makes architectural & creative decisions autonomously and surfaces a clean 1-tap executive approval list.',
    questionCountDefault: 1,
    accentText: 'text-[var(--surface-text)]',
    accentBorder: 'border-[var(--surface-border-strong)]',
    accentBg: 'bg-[var(--surface-elevated)]',
  },
  2: {
    level: 2,
    shortTitle: 'L2 • Contract Gate',
    title: 'Level 2 — Contract Gate',
    badge: '2 Qs/Vertical • Trade-Offs',
    description:
      'AI pauses for contract sign-off before modifying specs or schemas and asks targeted trade-off & contract questions.',
    questionCountDefault: 2,
    accentText: 'text-[var(--surface-accent-gold)]',
    accentBorder: 'border-[var(--surface-accent-gold)]/40',
    accentBg: 'bg-[var(--surface-accent-gold)]/10',
  },
  3: {
    level: 3,
    shortTitle: 'L3 • Co-Architect',
    title: 'Level 3 — Interactive Co-Architect',
    badge: '3–4 Qs/Vertical • Deep Co-Design',
    description:
      'Agents actively consult the CEO on system principles, citation strategy, and brand voice so CEO & AI decide together.',
    questionCountDefault: 4,
    accentText: 'text-[var(--surface-accent)]',
    accentBorder: 'border-[var(--surface-accent)]/40',
    accentBg: 'bg-[var(--surface-accent)]/10',
  },
};

interface ConsultationKnobProps {
  config?: ConsultationKnobConfig;
  activeVertical?: VerticalScope;
  onChange?: (next: ConsultationKnobConfig) => void;
}

export const ConsultationKnob: React.FC<ConsultationKnobProps> = ({
  config: controlledConfig,
  activeVertical = 'ALL',
  onChange,
}) => {
  const [internalConfig, setInternalConfig] = useState<ConsultationKnobConfig>(() =>
    loadConsultationKnobConfig()
  );
  const [selectedScope, setSelectedScope] = useState<VerticalScope>(activeVertical);
  const [savedPulse, setSavedPulse] = useState(false);

  const config = controlledConfig || internalConfig;

  useEffect(() => {
    setSelectedScope(activeVertical);
  }, [activeVertical]);

  useEffect(() => {
    const onExternalUpdate = (e: Event) => {
      const custom = e as CustomEvent<ConsultationKnobConfig>;
      if (custom.detail) {
        setInternalConfig(custom.detail);
      }
    };
    window.addEventListener('commando:consultation-knob-change', onExternalUpdate);
    return () =>
      window.removeEventListener('commando:consultation-knob-change', onExternalUpdate);
  }, []);

  const updateConfig = (next: ConsultationKnobConfig) => {
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    setInternalConfig(stamped);
    saveConsultationKnobConfig(stamped);
    onChange?.(stamped);
    setSavedPulse(true);
    window.setTimeout(() => setSavedPulse(false), 1400);
  };

  const currentLevel: ConsultationLevel =
    selectedScope === 'ALL'
      ? config.globalLevel
      : config.perVerticalLevel[selectedScope];

  const handleSelectLevel = (level: ConsultationLevel) => {
    const defaultQs = LEVEL_METADATA[level].questionCountDefault;
    if (selectedScope === 'ALL') {
      updateConfig({
        ...config,
        globalLevel: level,
        perVerticalLevel: {
          TECH: level,
          SEO_AEO: level,
          SOCIAL: level,
        },
        questionsPerVertical: {
          TECH: defaultQs,
          SEO_AEO: defaultQs,
          SOCIAL: defaultQs,
        },
      });
    } else {
      updateConfig({
        ...config,
        perVerticalLevel: {
          ...config.perVerticalLevel,
          [selectedScope]: level,
        },
        questionsPerVertical: {
          ...config.questionsPerVertical,
          [selectedScope]: defaultQs,
        },
      });
    }
  };

  const handleVerticalQuestionSlider = (
    vertical: 'TECH' | 'SEO_AEO' | 'SOCIAL',
    qCount: number
  ) => {
    const derivedLevel: ConsultationLevel =
      qCount <= 1 ? 1 : qCount === 2 ? 2 : 3;
    updateConfig({
      ...config,
      perVerticalLevel: {
        ...config.perVerticalLevel,
        [vertical]: derivedLevel,
      },
      questionsPerVertical: {
        ...config.questionsPerVertical,
        [vertical]: qCount,
      },
    });
  };

  const handleResetDefaults = () => {
    updateConfig(DEFAULT_CONSULTATION_CONFIG);
  };

  const activeMeta = LEVEL_METADATA[currentLevel];

  const scopes: {
    id: VerticalScope;
    label: string;
    icon: React.ReactNode;
    agentHint: string;
  }[] = [
    {
      id: 'ALL',
      label: 'Global',
      icon: <Globe className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />,
      agentHint: 'All Verticals',
    },
    {
      id: 'TECH',
      label: 'Tech',
      icon: <Cpu className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />,
      agentHint: '@cto • @tech_lead',
    },
    {
      id: 'SEO_AEO',
      label: 'SEO/AEO',
      icon: <Search className="h-3.5 w-3.5 text-[var(--surface-accent)]" />,
      agentHint: '@cbo • @aeo_lead',
    },
    {
      id: 'SOCIAL',
      label: 'Social',
      icon: <Megaphone className="h-3.5 w-3.5 text-[var(--surface-text-secondary)]" />,
      agentHint: '@social_lead',
    },
  ];

  return (
    <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 sm:p-5 shadow-xs flex flex-col justify-between gap-4">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 text-[var(--surface-accent-gold)]">
              <Sliders className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-[var(--surface-text)]">
                  AI Consultation Knob
                </h3>
              </div>
              <p className="text-[11px] text-[var(--surface-text-secondary)] mt-0.5">
                Control how many design &amp; principle questions agents ask per vertical
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleResetDefaults}
            title="Reset Consultation Knob to defaults"
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-mono text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)] transition cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </button>
        </div>

        {/* Scope Selector Tabs (Global | Tech | SEO/AEO | Social) */}
        <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-[var(--surface-muted)] p-1 border border-[var(--surface-border)]">
          {scopes.map((sc) => {
            const active = selectedScope === sc.id;
            const lvl =
              sc.id === 'ALL'
                ? config.globalLevel
                : config.perVerticalLevel[sc.id];
            return (
              <button
                key={sc.id}
                type="button"
                onClick={() => setSelectedScope(sc.id)}
                className={`flex flex-col items-center justify-center rounded-lg px-2 py-1.5 text-center transition cursor-pointer ${
                  active
                    ? 'bg-[var(--surface-panel)] text-[var(--surface-text)] border border-[var(--surface-accent-gold)]/50 shadow-xs'
                    : 'text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)] border border-transparent'
                }`}
              >
                <div className="flex items-center gap-1 text-[11px] font-semibold">
                  {sc.icon}
                  <span>{sc.label}</span>
                </div>
                <span className="text-[9px] font-mono text-[var(--surface-accent-gold)] mt-0.5 font-bold">
                  L{lvl}
                </span>
              </button>
            );
          })}
        </div>

        {/* 3-Step Interactive Knob Selector (1: Decisive | 2: Contract Gate | 3: Interactive Co-Architect) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-[var(--surface-text-secondary)]">
              Mode for{' '}
              <strong className="text-[var(--surface-text)]">
                {selectedScope === 'ALL' ? 'All Verticals' : selectedScope}
              </strong>
              :
            </span>
            <span className={`font-bold ${activeMeta.accentText}`}>
              {activeMeta.badge}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {([1, 2, 3] as ConsultationLevel[]).map((lvl) => {
              const meta = LEVEL_METADATA[lvl];
              const isSelected = currentLevel === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => handleSelectLevel(lvl)}
                  className={`rounded-xl border p-2.5 text-left transition cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? `${meta.accentBg} ${meta.accentBorder} shadow-xs`
                      : 'border-[var(--surface-border)] bg-[var(--surface-elevated)] hover:border-[var(--surface-border-strong)] text-[var(--surface-text-secondary)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-xs font-mono font-bold ${
                        isSelected ? meta.accentText : 'text-[var(--surface-text)]'
                      }`}
                    >
                      {meta.shortTitle}
                    </span>
                    {isSelected && (
                      <Sparkles className={`h-3 w-3 ${meta.accentText}`} />
                    )}
                  </div>
                  <div className="text-[10px] text-[var(--surface-text-secondary)] mt-1 leading-tight">
                    {lvl === 1
                      ? 'AI decides & lists'
                      : lvl === 2
                        ? 'Contract sign-off'
                        : 'Co-design w/ CEO'}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active Level Explanation Banner */}
          <div
            className={`rounded-xl border p-2.5 text-xs leading-relaxed ${activeMeta.accentBg} ${activeMeta.accentBorder}`}
          >
            <div className={`font-bold font-mono text-[11px] ${activeMeta.accentText}`}>
              {activeMeta.title}
            </div>
            <p className="text-[var(--surface-text)] text-[11px] mt-0.5">
              {activeMeta.description}
            </p>
          </div>
        </div>
      </div>

      {/* Per-Vertical Question Frequency Sliders */}
      <div className="space-y-2.5 pt-2 border-t border-[var(--surface-border)]">
        <div className="flex items-center justify-between text-[11px] font-mono text-[var(--surface-text-secondary)]">
          <span className="flex items-center gap-1.5">
            <HelpCircle className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
            <span>Questions Asked Per Vertical Sprint</span>
          </span>
          {savedPulse ? (
            <span className="inline-flex items-center gap-1 text-[var(--surface-accent-gold)] font-semibold">
              <CheckCircle2 className="h-3 w-3" />
              <span>Synced Live</span>
            </span>
          ) : (
            <span className="text-[var(--surface-text-muted)]">localStorage synced</span>
          )}
        </div>

        {(
          [
            {
              key: 'TECH' as const,
              label: 'Tech (@cto / @tech_lead)',
              color: 'accent-[var(--surface-accent-gold)]',
              pill: 'bg-[var(--surface-accent-gold)]/15 text-[var(--surface-accent-gold)] border-[var(--surface-accent-gold)]/30',
            },
            {
              key: 'SEO_AEO' as const,
              label: 'SEO/AEO (@cbo / @aeo_lead)',
              color: 'accent-[var(--surface-accent)]',
              pill: 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border-[var(--surface-accent)]/30',
            },
            {
              key: 'SOCIAL' as const,
              label: 'Social (@social_lead)',
              color: 'accent-[var(--surface-accent-gold)]',
              pill: 'bg-[var(--surface-elevated)] text-[var(--surface-text)] border-[var(--surface-border-strong)]',
            },
          ] as const
        ).map((row) => {
          const qVal = config.questionsPerVertical[row.key];
          const vLevel = config.perVerticalLevel[row.key];
          return (
            <div
              key={row.key}
              className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] px-3 py-2 space-y-1.5"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-[var(--surface-text)]">{row.label}</span>
                <div className="flex items-center gap-1.5 font-mono">
                  <span className={`rounded border px-1.5 py-0.2 text-[10px] font-semibold ${row.pill}`}>
                    L{vLevel}
                  </span>
                  <span className="text-[var(--surface-accent-gold)] font-bold">
                    {qVal} {qVal === 1 ? 'question' : 'questions'}
                  </span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={5}
                step={1}
                value={qVal}
                onChange={(e) =>
                  handleVerticalQuestionSlider(row.key, Number(e.target.value))
                }
                aria-label={`Questions per sprint for ${row.label}`}
                className={`w-full h-1.5 bg-[var(--surface-muted)] rounded-lg cursor-pointer ${row.color}`}
              />
              <div className="flex justify-between text-[9px] font-mono text-[var(--surface-text-muted)]">
                <span>0 (Autopilot)</span>
                <span>2 (Contract Gate)</span>
                <span>5 (Deep Co-Design)</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ConsultationKnob;
