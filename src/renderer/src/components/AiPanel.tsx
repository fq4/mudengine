import { useEffect, useState } from 'react';
import type { AiAction, AiSnapshot, AiMemoryRecord } from '@shared/ai';
import type { SessionId } from '@shared/ipc';

export default function AiPanel({ session }: { session: SessionId }) {
  const [snapshot, setSnapshot] = useState<AiSnapshot | null>(null);
  const [goal, setGoal] = useState('');
  const [memories, setMemories] = useState<AiMemoryRecord[]>([]);
  const [providerDiagnostic, setProviderDiagnostic] = useState('');
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [memoryText, setMemoryText] = useState('');
  const api = window.mudengine;
  const refresh = () => api.aiSnapshot(session).then(setSnapshot);
  useEffect(() => { void refresh(); void api.aiMemories(session).then(setMemories); }, [session]);
  if (!snapshot) return null;
  const run = (promise: Promise<AiSnapshot>) => promise.then(setSnapshot);
  const action: AiAction = { name: 'inspect_character', reason: 'Player requested an observation' };
  return <aside className="ai-panel" aria-label="AI gameplay">
    <div className="ai-panel-title">AI gameplay <span className={`chip ${snapshot.state.enabled ? 'on' : 'off'}`}>{snapshot.state.status}</span></div>
    <div className="ai-panel-row"><label>Model</label><input defaultValue={snapshot.state.model} onBlur={(e) => run(api.aiEnable(session, e.currentTarget.value))} /></div>
    <div className="ai-panel-row"><label>Goal</label><input value={goal} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && goal.trim()) { run(api.aiGoal(session, goal.trim())); setGoal(''); } }} placeholder="Explore nearby safe rooms" /></div>
    <div className="ai-panel-actions"><button onClick={() => run(api.aiEnable(session))}>Start / Resume</button><button onClick={() => run(api.aiPause(session))}>Pause</button><button onClick={() => run(api.aiStop(session))}>Stop</button><button onClick={() => run(api.aiEmergencyStop(session))}>Emergency stop</button><button onClick={() => api.aiAction(session, action).then(refresh)}>Observe</button><button onClick={() => api.aiProviderTest(session).then((result) => setProviderDiagnostic(result.message))}>Test provider</button></div>
    {providerDiagnostic && <div className="ai-panel-copy">Provider: {providerDiagnostic}</div>}
    <div className="ai-panel-copy"><strong>{snapshot.state.objective || 'No objective'}</strong><br />{snapshot.state.explanation || 'AI is disabled.'}</div>
    <div className="ai-panel-copy">Last result: {snapshot.state.lastActionResult || '—'}</div>
    <div className="ai-panel-copy">Requests: {snapshot.state.usage.requests} · Tokens: {snapshot.state.usage.inputTokens + snapshot.state.usage.outputTokens} · Est. ${snapshot.state.usage.estimatedCostUsd.toFixed(4)}</div>
    {snapshot.state.pendingApprovals.length > 0 && <div className="ai-panel-copy"><strong>Pending approvals</strong>{snapshot.state.pendingApprovals.map((approval) => <div key={approval.id}><div>{approval.command}</div><small>{approval.reason} · {approval.risk} · expires {new Date(approval.expiresAt).toLocaleTimeString()}</small><div className="ai-panel-actions"><button onClick={() => run(api.aiApprove(session, approval.id))}>Approve once</button><button onClick={() => run(api.aiGrant(session, approval.id, 30 * 60 * 1000, 5))}>Allow 30 min (5 uses)</button><button onClick={() => run(api.aiReject(session, approval.id))}>Reject</button></div></div>)}</div>}
    {(snapshot.state.temporaryGrants ?? []).length > 0 && <div className="ai-panel-copy"><strong>Temporary authorizations</strong>{(snapshot.state.temporaryGrants ?? []).map((grant) => <div key={grant.id}><code>{grant.command}</code><small> · {grant.remainingUses ?? 'unlimited'} uses · expires {new Date(grant.expiresAt).toLocaleTimeString()}</small></div>)}</div>}
    {memories.length > 0 && <div className="ai-panel-copy"><strong>Memory</strong>{memories.slice(-8).map((memory) => <div key={memory.id}><small>{memory.category} · {memory.verified ? 'verified' : 'inferred'} · {Math.round(memory.confidence * 100)}%</small>{editingMemory === memory.id ? <><input value={memoryText} onChange={(e) => setMemoryText(e.target.value)} /><button onClick={() => api.aiUpdateMemory(session, memory.id, memoryText).then((next) => { setMemories(next); setEditingMemory(null); })}>Save</button></> : <><div>{memory.text}</div><button onClick={() => { setEditingMemory(memory.id); setMemoryText(memory.text); }}>Edit</button></>}<button onClick={() => api.aiForgetMemory(session, memory.id).then(setMemories)}>Forget</button></div>)}</div>}
    <ul>{snapshot.state.recent.map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}</ul>
  </aside>;
}
