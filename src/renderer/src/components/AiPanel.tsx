import { useEffect, useState } from 'react';
import type { AiAction, AiSnapshot } from '@shared/ai';
import type { SessionId } from '@shared/ipc';

export default function AiPanel({ session }: { session: SessionId }) {
  const [snapshot, setSnapshot] = useState<AiSnapshot | null>(null);
  const [goal, setGoal] = useState('');
  const api = window.mudengine;
  const refresh = () => api.aiSnapshot(session).then(setSnapshot);
  useEffect(() => { void refresh(); }, [session]);
  if (!snapshot) return null;
  const run = (promise: Promise<AiSnapshot>) => promise.then(setSnapshot);
  const action: AiAction = { name: 'inspect_character', reason: 'Player requested an observation' };
  return <aside className="ai-panel" aria-label="AI gameplay">
    <div className="ai-panel-title">AI gameplay <span className={`chip ${snapshot.state.enabled ? 'on' : 'off'}`}>{snapshot.state.status}</span></div>
    <div className="ai-panel-row"><label>Model</label><input defaultValue={snapshot.state.model} onBlur={(e) => run(api.aiEnable(session, e.currentTarget.value))} /></div>
    <div className="ai-panel-row"><label>Goal</label><input value={goal} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && goal.trim()) { run(api.aiGoal(session, goal.trim())); setGoal(''); } }} placeholder="Explore nearby safe rooms" /></div>
    <div className="ai-panel-actions"><button onClick={() => run(api.aiEnable(session))}>Start / Resume</button><button onClick={() => run(api.aiPause(session))}>Pause</button><button onClick={() => run(api.aiStop(session))}>Stop</button><button onClick={() => api.aiAction(session, action).then(refresh)}>Observe</button></div>
    <div className="ai-panel-copy"><strong>{snapshot.state.objective || 'No objective'}</strong><br />{snapshot.state.explanation || 'AI is disabled.'}</div>
    <div className="ai-panel-copy">Last result: {snapshot.state.lastActionResult || '—'}</div>
    <div className="ai-panel-copy">Requests: {snapshot.state.usage.requests} · Tokens: {snapshot.state.usage.inputTokens + snapshot.state.usage.outputTokens} · Est. ${snapshot.state.usage.estimatedCostUsd.toFixed(4)}</div>
    <ul>{snapshot.state.recent.map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}</ul>
  </aside>;
}
