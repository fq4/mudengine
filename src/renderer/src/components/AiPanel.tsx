import { useEffect, useState } from 'react';
import type { AiAction, AiSnapshot } from '@shared/ai';
import type { SessionId } from '@shared/ipc';

export default function AiPanel({ session }: { session: SessionId }) {
  const [snapshot, setSnapshot] = useState<AiSnapshot | null>(null);
  const [goal, setGoal] = useState('');
  const [error, setError] = useState('');
  const api = window.mudengine;
  const refresh = () => api.aiSnapshot(session).then(setSnapshot).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  useEffect(() => {
    const saved = localStorage.getItem(`mudengine.ai.goal.${session}`) ?? '';
    const savedState = localStorage.getItem(`mudengine.ai.state.${session}`);
    setGoal(saved);
    void api.aiSnapshot(session).then((value) => {
      setSnapshot(value);
      if (savedState) { try { void api.aiRestore(session, JSON.parse(savedState)).then(setSnapshot); } catch { /* corrupt local state is ignored */ } }
      else if (saved && !value.state.objective) void api.aiGoal(session, saved).then(setSnapshot);
    });
  }, [session]);
  useEffect(() => { if (snapshot) localStorage.setItem(`mudengine.ai.state.${session}`, JSON.stringify({ objective: snapshot.state.objective, memories: snapshot.state.memories.slice(-50), recent: snapshot.state.recent.slice(-8), lastActionResult: snapshot.state.lastActionResult })); }, [session, snapshot]);
  if (!snapshot) return null;
  const run = (promise: Promise<AiSnapshot>) => promise.then((value) => { setError(''); setSnapshot(value); }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  const start = () => {
    const requestedGoal = goal.trim();
    run(requestedGoal ? api.aiGoal(session, requestedGoal) : api.aiEnable(session));
  };
  const action: AiAction = { name: 'inspect_character', reason: 'Player requested an observation' };
  return <aside className="ai-panel" aria-label="AI gameplay">
    <div className="ai-panel-title">AI gameplay <span className={`chip ${snapshot.state.enabled ? 'on' : 'off'}`}>{snapshot.state.status}</span></div>
    <div className="ai-panel-row"><label>Model</label><input defaultValue={snapshot.state.model} onBlur={(e) => run(api.aiEnable(session, e.currentTarget.value))} /></div>
    <div className="ai-panel-row"><label>Goal</label><input value={goal} onChange={(e) => { setGoal(e.target.value); localStorage.setItem(`mudengine.ai.goal.${session}`, e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter' && goal.trim()) { run(api.aiGoal(session, goal.trim())); } }} placeholder="Explore nearby safe rooms" /></div>
    <div className="ai-panel-actions"><button onClick={start}>Start / Resume</button><button onClick={() => run(api.aiPause(session))}>Pause</button><button onClick={() => run(api.aiStop(session))}>Stop</button><button onClick={() => api.aiAction(session, action).then(refresh).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}>Observe</button></div>
    <div className="ai-panel-copy"><strong>{snapshot.state.objective || 'No objective'}</strong><br />{snapshot.state.explanation || (snapshot.state.enabled ? 'AI is waiting for its first decision.' : 'AI is disabled.')}</div>
    {error && <div className="ai-panel-copy">Error: {error}</div>}
    <div className="ai-panel-copy">Last result: {snapshot.state.lastActionResult || '—'}</div>
    <div className="ai-panel-copy">Requests: {snapshot.state.usage.requests} · Tokens: {snapshot.state.usage.inputTokens + snapshot.state.usage.outputTokens} · Est. ${snapshot.state.usage.estimatedCostUsd.toFixed(4)}</div>
    <ul>{snapshot.state.recent.map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}</ul>
  </aside>;
}
