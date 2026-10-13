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
  const [policyCommand, setPolicyCommand] = useState('');
  const [policyScope, setPolicyScope] = useState<'global' | 'server' | 'profile'>('global');
  const [policyOwner, setPolicyOwner] = useState('');
  const [policyMessage, setPolicyMessage] = useState('');
  const [policyAuthorization, setPolicyAuthorization] = useState<
    'autonomous' | 'ask-first' | 'rejected'
  >('ask-first');
  const api = window.mudengine;
  const refresh = () => api.aiSnapshot(session).then(setSnapshot);
  useEffect(() => {
    void refresh();
    void api.aiMemories(session).then(setMemories);
    const refreshIntervalMs = 1_000;
    const timer = window.setInterval(() => {
      void refresh();
    }, refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [session]);
  if (!snapshot) return null;
  const run = (promise: Promise<AiSnapshot>) => promise.then(setSnapshot);
  const action: AiAction = { name: 'inspect_character', reason: 'Player requested an observation' };
  return (
    <aside className="ai-panel" aria-label="AI gameplay">
      <div className="ai-panel-title">
        AI gameplay{' '}
        <span className={`chip ${snapshot.state.enabled ? 'on' : 'off'}`}>
          {snapshot.state.status}
        </span>
      </div>
      <div className="ai-panel-row">
        <label>Model</label>
        <input
          key={snapshot.state.model}
          defaultValue={snapshot.state.model}
          onBlur={(e) => run(api.aiEnable(session, e.currentTarget.value))}
        />
      </div>
      <div className="ai-panel-row">
        <label>Goal</label>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && goal.trim()) {
              run(api.aiGoal(session, goal.trim()));
              setGoal('');
            }
          }}
          placeholder="Explore nearby safe rooms"
        />
      </div>
      <div className="ai-panel-actions">
        <button onClick={() => run(api.aiEnable(session))}>Start / Resume</button>
        <button onClick={() => run(api.aiPause(session))}>Pause</button>
        <button onClick={() => run(api.aiStop(session))}>Stop</button>
        <button onClick={() => run(api.aiClearGoal(session))}>Clear goal</button>
        <button onClick={() => run(api.aiEmergencyStop(session))}>Emergency stop</button>
        <button onClick={() => api.aiAction(session, action).then(refresh)}>Observe</button>
        <button
          onClick={() =>
            api.aiProviderTest(session).then((result) => setProviderDiagnostic(result.message))
          }
        >
          Test provider
        </button>
      </div>
      {providerDiagnostic && <div className="ai-panel-copy">Provider: {providerDiagnostic}</div>}
      <div className="ai-panel-copy">
        <strong>{snapshot.state.objective || 'No objective'}</strong>
        <br />
        {snapshot.state.explanation || 'AI is disabled.'}
      </div>
      {snapshot.state.currentAction && (
        <div className="ai-panel-copy">
          <strong>Active action</strong>
          <br />
          <code>{snapshot.state.currentAction.name}</code> · {snapshot.state.currentAction.phase}
          <br />
          <small>{snapshot.state.currentAction.message}</small>
        </div>
      )}
      {snapshot.state.status === 'budget-paused' && (
        <div className="ai-panel-copy">
          <strong>Budget Paused</strong>
          <br />
          {snapshot.state.lastActionResult}
          {snapshot.state.budgetResetAt ? (
            <>
              <br />
              Reset: {new Date(snapshot.state.budgetResetAt).toLocaleTimeString()}
            </>
          ) : null}
        </div>
      )}
      <div className="ai-panel-copy">Last result: {snapshot.state.lastActionResult || '—'}</div>
      <div className="ai-panel-copy">
        Requests: {snapshot.state.usage.requests} · Tokens:{' '}
        {snapshot.state.usage.inputTokens + snapshot.state.usage.outputTokens} · Est. $
        {snapshot.state.usage.estimatedCostUsd.toFixed(4)}
      </div>
      {snapshot.aggregateBudget && (
        <div className="ai-panel-copy">
          <strong>Shared AI budget</strong>
          <br />
          {snapshot.aggregateBudget.requests} requests ·{' '}
          {(
            snapshot.aggregateBudget.inputTokens + snapshot.aggregateBudget.outputTokens
          ).toLocaleString()}{' '}
          tokens · ${snapshot.aggregateBudget.estimatedCostUsd.toFixed(4)} spent
          <br />
          <small>
            Limits: {snapshot.aggregateBudget.limits.requestsPerMinute}/min ·{' '}
            {snapshot.aggregateBudget.limits.requestsPerHour}/hour · $
            {snapshot.aggregateBudget.limits.sessionCostUsd.toFixed(2)} ·{' '}
            {snapshot.aggregateBudget.limits.sessionTokens?.toLocaleString() ?? 'unlimited'} tokens
          </small>
          <br />
          <button onClick={() => run(api.aiAggregateBudgetReset(session))}>
            Reset shared usage
          </button>
        </div>
      )}
      {snapshot.state.budgetLimits && (
        <div className="ai-panel-copy">
          <strong>Session budget</strong>
          <br />
          {snapshot.state.budgetLimits.requestsPerMinute}/min ·{' '}
          {snapshot.state.budgetLimits.requestsPerHour}/hour · $
          {snapshot.state.budgetLimits.sessionCostUsd.toFixed(2)} ·{' '}
          {snapshot.state.budgetLimits.sessionTokens?.toLocaleString() ?? 'unlimited'} tokens
          <br />
          <button
            onClick={() =>
              run(
                api.aiBudget(session, {
                  requestsPerMinute: 6,
                  requestsPerHour: 60,
                  sessionCostUsd: 0.25,
                  sessionTokens: 25_000
                })
              )
            }
          >
            Reset defaults
          </button>
        </div>
      )}
      {(snapshot.policy ?? []).length > 0 && (
        <div className="ai-panel-copy">
          <strong>Effective policy</strong>
          {snapshot.policy!.map((rule) => (
            <div key={`${rule.source}-${rule.command}`}>
              <code>{rule.command}</code> · {rule.authorization} <small>({rule.source})</small>
            </div>
          ))}
        </div>
      )}
      <div className="ai-panel-copy">
        <strong>Session policy override</strong>
        <input
          value={policyCommand}
          onChange={(e) => setPolicyCommand(e.target.value)}
          placeholder="exact command"
        />
        <div className="ai-panel-actions">
          <button onClick={() => run(api.aiPolicy(session, policyCommand, 'autonomous'))}>
            Autonomous
          </button>
          <button onClick={() => run(api.aiPolicy(session, policyCommand, 'ask-first'))}>
            Ask First
          </button>
          <button onClick={() => run(api.aiPolicy(session, policyCommand, 'rejected'))}>
            Prohibit
          </button>
          <button onClick={() => run(api.aiPolicy(session, policyCommand, null))}>Clear</button>
        </div>
        <select
          value={policyScope}
          onChange={(e) => setPolicyScope(e.target.value as typeof policyScope)}
        >
          <option value="global">Global</option>
          <option value="server">Server</option>
          <option value="profile">Profile</option>
        </select>
        {policyScope !== 'global' && (
          <input
            value={policyOwner}
            onChange={(e) => setPolicyOwner(e.target.value)}
            placeholder={`${policyScope} name`}
          />
        )}
        <select
          value={policyAuthorization}
          onChange={(e) => setPolicyAuthorization(e.target.value as typeof policyAuthorization)}
        >
          <option value="autonomous">Autonomous</option>
          <option value="ask-first">Ask First</option>
          <option value="rejected">Prohibited</option>
        </select>
        <div className="ai-panel-actions">
          <button
            onClick={async () => {
              if (
                !window.confirm(
                  `Save ${policyAuthorization} for exact command "${policyCommand}" at ${policyScope}${policyOwner ? ` (${policyOwner})` : ''}?`
                )
              )
                return;
              const error = await api.saveAiPolicy(
                policyScope,
                policyScope === 'global' ? null : policyOwner,
                policyCommand,
                policyAuthorization
              );
              setPolicyMessage(error ?? 'Permanent policy saved');
              void refresh();
            }}
          >
            Save permanent rule
          </button>
          <button
            onClick={async () => {
              if (
                !window.confirm(
                  `Clear the permanent rule for exact command "${policyCommand}" at ${policyScope}${policyOwner ? ` (${policyOwner})` : ''}?`
                )
              )
                return;
              const error = await api.saveAiPolicy(
                policyScope,
                policyScope === 'global' ? null : policyOwner,
                policyCommand,
                null
              );
              setPolicyMessage(error ?? 'Permanent policy cleared');
              void refresh();
            }}
          >
            Clear permanent rule
          </button>
        </div>
        {policyMessage && <small>{policyMessage}</small>}
      </div>
      {snapshot.state.pendingApprovals.length > 0 && (
        <div className="ai-panel-copy">
          <strong>Pending approvals</strong>
          {snapshot.state.pendingApprovals.map((approval) => (
            <div key={approval.id}>
              <div>
                <code>{approval.command}</code>
              </div>
              <small>
                {approval.reason} · {approval.risk} · expires{' '}
                {new Date(approval.expiresAt).toLocaleTimeString()}
              </small>
              {approval.target && <div>Target: {approval.target}</div>}
              {approval.knownFacts?.map((fact) => (
                <div key={fact}>Known: {fact}</div>
              ))}
              {approval.prediction && <div>Expected consequence: {approval.prediction}</div>}
              <div className="ai-panel-actions">
                <button onClick={() => run(api.aiApprove(session, approval.id))}>
                  Approve once
                </button>
                <button onClick={() => run(api.aiGrant(session, approval.id, 30 * 60 * 1000, 5))}>
                  Allow 30 min (5 uses)
                </button>
                <button onClick={() => run(api.aiReject(session, approval.id))}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {(snapshot.state.temporaryGrants ?? []).length > 0 && (
        <div className="ai-panel-copy">
          <strong>Temporary authorizations</strong>
          {(snapshot.state.temporaryGrants ?? []).map((grant) => (
            <div key={grant.id}>
              <code>{grant.command}</code>
              <small>
                {' '}
                · {grant.remainingUses ?? 'unlimited'} uses · expires{' '}
                {new Date(grant.expiresAt).toLocaleTimeString()}
              </small>
              <button onClick={() => run(api.aiRevokeGrant(session, grant.id))}>Revoke</button>
            </div>
          ))}
        </div>
      )}
      {snapshot.state.approvalHistory.length > 0 && (
        <div className="ai-panel-copy">
          <strong>Approval history</strong>
          {snapshot.state.approvalHistory
            .slice(-8)
            .reverse()
            .map((approval) => (
              <div key={`${approval.id}-${approval.status}`}>
                <code>{approval.command}</code>
                <small>
                  {' '}
                  · {approval.status} · {new Date(approval.createdAt).toLocaleTimeString()}
                </small>
              </div>
            ))}
        </div>
      )}
      {memories.length > 0 && (
        <div className="ai-panel-copy">
          <strong>Memory</strong>
          {memories.slice(-8).map((memory) => (
            <div key={memory.id}>
              <small>
                {memory.category} · {memory.verified ? 'verified' : 'inferred'} ·{' '}
                {Math.round(memory.confidence * 100)}%{memory.pinned ? ' · pinned' : ''}
              </small>
              {editingMemory === memory.id ? (
                <>
                  <input value={memoryText} onChange={(e) => setMemoryText(e.target.value)} />
                  <button
                    onClick={() =>
                      api.aiUpdateMemory(session, memory.id, memoryText).then((next) => {
                        setMemories(next);
                        setEditingMemory(null);
                      })
                    }
                  >
                    Save
                  </button>
                </>
              ) : (
                <>
                  <div>{memory.text}</div>
                  <button
                    onClick={() => {
                      setEditingMemory(memory.id);
                      setMemoryText(memory.text);
                    }}
                  >
                    Edit
                  </button>
                </>
              )}
              <button
                onClick={() =>
                  api
                    .aiSetMemoryMetadata(session, memory.id, !memory.verified, memory.pinned)
                    .then(setMemories)
                }
              >
                {memory.verified ? 'Mark inferred' : 'Verify'}
              </button>
              <button
                onClick={() =>
                  api
                    .aiSetMemoryMetadata(session, memory.id, memory.verified, !memory.pinned)
                    .then(setMemories)
                }
              >
                {memory.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button onClick={() => api.aiForgetMemory(session, memory.id).then(setMemories)}>
                Forget
              </button>
            </div>
          ))}
        </div>
      )}
      <ul>
        {snapshot.state.recent.map((item, i) => (
          <li key={`${i}-${item}`}>{item}</li>
        ))}
      </ul>
    </aside>
  );
}
