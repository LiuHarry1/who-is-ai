import { useEffect, useState } from 'react';
import { emitAck } from '../socket';
import type { AdminData, AiPromptsCfg, PersonaCfg, RoomId } from '../types';

interface SaveAck {
  ok: boolean;
  error?: string;
  data?: AdminData;
}

const card = 'rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3';
const inputCls =
  'w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-emerald-500';
const areaCls = inputCls + ' font-mono leading-relaxed';
const saveBtn =
  'rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-4 py-2 text-sm font-bold';

function SectionStatus({ msg }: { msg: string }) {
  if (!msg) return null;
  const isErr = msg.includes('失败') || msg.includes('错误');
  return <span className={`text-xs ${isErr ? 'text-red-400' : 'text-emerald-400'}`}>{msg}</span>;
}

export default function AdminPanel({ onExit }: { onExit: () => void }) {
  const [data, setData] = useState<AdminData | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    void (async () => {
      const res = await emitAck<SaveAck>('admin:get', {});
      if (res.ok && res.data) setData(res.data);
      else setLoadError(res.error ?? '加载失败');
    })();
  }, []);

  if (!data) {
    return (
      <div className="min-h-full flex items-center justify-center text-slate-400">
        {loadError || '加载配置中…'}
      </div>
    );
  }

  return (
    <div className="min-h-full p-4 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black">⚙️ 游戏内容设置</h1>
        <div className="flex gap-2 items-center">
          <button
            onClick={async () => {
              if (!confirm('恢复代码默认值？（人格卡 / Prompt / 主问题，不影响领域素材文件）')) return;
              const res = await emitAck<SaveAck>('admin:save', { section: 'resetDefaults' });
              if (res.ok && res.data) setData({ ...res.data });
            }}
            className="rounded-xl bg-red-900 hover:bg-red-800 px-4 py-2 text-sm"
          >
            恢复默认
          </button>
          <button onClick={onExit} className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-sm">
            返回控制台
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        所有修改保存后立即对之后的 AI 发言生效；只有"人格卡"是 AI 加入房间那一刻复制的——改完人格卡后，
        请在等待大厅阶段把对应房间的 AI 先"- AI"再"+ AI"重新加入。
      </p>

      <Models data={data} />
      <MainQuestions data={data} />
      <DomainNotes data={data} />
      <Personas data={data} />
      <Prompts data={data} />
    </div>
  );
}

// ---------- 模型 ----------

function Models({ data }: { data: AdminData }) {
  const [models, setModels] = useState(data.config.models);
  const [modelList, setModelList] = useState(data.modelList);
  const [msg, setMsg] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [testing, setTesting] = useState(false);
  const modelFields = [
    { key: 'primary' as const, label: '主模型（对话生成）' },
    { key: 'fallback' as const, label: '降级模型（主模型失败/超时后使用）' },
  ];
  return (
    <div className={card}>
      <div className="font-bold">🤖 LLM 接入</div>
      <p className="text-xs text-slate-500">
        下拉列表来自当前接入点的 /models 接口（共 {modelList.length} 个），也可以直接手动输入模型名。
        注意：模型必须支持 chat/completions 接口（如 gpt-5.5 只支持 responses API，不可用）。
        保存后立即生效；改了 URL/Key 后建议点"测试连接"确认可用。
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs text-slate-400">接入地址 Base URL（OpenAI 兼容，一般以 /v1 结尾）</span>
          <input
            className={inputCls + ' font-mono'}
            value={models.baseUrl}
            onChange={(e) => setModels({ ...models, baseUrl: e.target.value })}
            placeholder="http://localhost:4141/v1"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-slate-400">API Key</span>
          <input
            className={inputCls + ' font-mono'}
            type="password"
            value={models.apiKey}
            onChange={(e) => setModels({ ...models, apiKey: e.target.value })}
            placeholder="dummy"
          />
        </label>
      </div>
      <datalist id="model-options">
        {modelList.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <div className="grid sm:grid-cols-2 gap-3">
        {modelFields.map((f) => (
          <label key={f.key} className="block space-y-1">
            <span className="text-xs text-slate-400">{f.label}</span>
            <input
              className={inputCls + ' font-mono'}
              list="model-options"
              value={models[f.key]}
              onChange={(e) => setModels({ ...models, [f.key]: e.target.value })}
              placeholder="选择或输入模型名"
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          className={saveBtn}
          disabled={!models.baseUrl.trim() || !models.primary.trim() || !models.fallback.trim()}
          onClick={async () => {
            const res = await emitAck<SaveAck>('admin:save', { section: 'models', data: models });
            setMsg(res.ok ? '已保存' : `保存失败: ${res.error}`);
            if (res.ok && res.data) setModelList(res.data.modelList);
          }}
        >
          保存 LLM 配置
        </button>
        <button
          className="rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 px-4 py-2 text-sm"
          disabled={testing}
          onClick={async () => {
            setTesting(true);
            setTestMsg('测试中…');
            const res = await emitAck<{ ok: boolean; error?: string; reply?: string }>('admin:testLLM', {});
            setTestMsg(res.ok ? `连接正常，模型回复: ${res.reply}` : `连接失败: ${res.error}`);
            setTesting(false);
          }}
        >
          测试连接（用已保存的配置）
        </button>
        <SectionStatus msg={msg} />
        <SectionStatus msg={testMsg} />
      </div>
    </div>
  );
}

// ---------- 主问题 ----------

function MainQuestions({ data }: { data: AdminData }) {
  const [q, setQ] = useState(data.config.mainQuestions);
  const [msg, setMsg] = useState('');
  return (
    <div className={card}>
      <div className="font-bold">📣 第一轮主问题</div>
      {(['tech', 'life'] as RoomId[]).map((r) => (
        <label key={r} className="block space-y-1">
          <span className="text-xs text-slate-400">{r === 'tech' ? '💻 技术聊天室' : '🌍 生活聊天室'}</span>
          <input className={inputCls} value={q[r]} onChange={(e) => setQ({ ...q, [r]: e.target.value })} />
        </label>
      ))}
      <div className="flex items-center gap-3">
        <button
          className={saveBtn}
          onClick={async () => {
            const res = await emitAck<SaveAck>('admin:save', { section: 'mainQuestions', data: q });
            setMsg(res.ok ? '已保存' : `保存失败: ${res.error}`);
          }}
        >
          保存主问题
        </button>
        <SectionStatus msg={msg} />
      </div>
    </div>
  );
}

// ---------- 领域素材 ----------

function DomainNotes({ data }: { data: AdminData }) {
  const [notes, setNotes] = useState(data.domainNotes);
  const [msg, setMsg] = useState('');
  return (
    <div className={card}>
      <div className="font-bold">📚 领域素材（domain-notes）</div>
      <p className="text-xs text-slate-500">
        注入 AI prompt 的行话/战例/吐槽素材，AI 会当作自己的经历改编使用。保存即生效。别放涉密信息。
      </p>
      {(['tech', 'life'] as RoomId[]).map((r) => (
        <label key={r} className="block space-y-1">
          <span className="text-xs text-slate-400">{r === 'tech' ? 'tech.md（技术房）' : 'life.md（生活房）'}</span>
          <textarea
            className={areaCls}
            rows={10}
            value={notes[r]}
            onChange={(e) => setNotes({ ...notes, [r]: e.target.value })}
          />
        </label>
      ))}
      <div className="flex items-center gap-3">
        <button
          className={saveBtn}
          onClick={async () => {
            const res = await emitAck<SaveAck>('admin:save', { section: 'domainNotes', data: notes });
            setMsg(res.ok ? '已保存' : `保存失败: ${res.error}`);
          }}
        >
          保存素材
        </button>
        <SectionStatus msg={msg} />
      </div>
    </div>
  );
}

// ---------- 人格卡 ----------

function Personas({ data }: { data: AdminData }) {
  const [personas, setPersonas] = useState(data.config.personas);
  const [msg, setMsg] = useState('');

  const update = (room: RoomId, idx: number, field: keyof PersonaCfg, value: string) => {
    const list = personas[room].map((p, i) => (i === idx ? { ...p, [field]: value } : p));
    setPersonas({ ...personas, [room]: list });
  };

  return (
    <div className={card}>
      <div className="font-bold">🎭 AI 人格卡</div>
      <p className="text-xs text-slate-500">
        修改后需要重新加入 AI 才生效（大厅阶段 - AI 再 + AI）。姓名仅主持人可见，玩家只看到匿名代号。
      </p>
      {(['tech', 'life'] as RoomId[]).map((room) => (
        <div key={room} className="space-y-2">
          <div className="text-sm font-bold text-slate-300">
            {room === 'tech' ? '💻 技术房' : '🌍 生活房'}
            <button
              className="ml-2 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 px-2 py-1"
              onClick={() =>
                setPersonas({
                  ...personas,
                  [room]: [...personas[room], { name: '', background: '', style: '' }],
                })
              }
            >
              + 新增
            </button>
          </div>
          {personas[room].map((p, i) => (
            <div key={i} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-2">
              <div className="flex gap-2 items-center">
                <input
                  className={inputCls + ' max-w-40'}
                  placeholder="姓名"
                  value={p.name}
                  onChange={(e) => update(room, i, 'name', e.target.value)}
                />
                <button
                  className="text-xs rounded-lg bg-red-900 hover:bg-red-800 px-2 py-1.5 shrink-0"
                  onClick={() =>
                    setPersonas({ ...personas, [room]: personas[room].filter((_, j) => j !== i) })
                  }
                >
                  删除
                </button>
              </div>
              <textarea
                className={areaCls}
                rows={3}
                placeholder="背景（职业经历、最近在忙什么）"
                value={p.background}
                onChange={(e) => update(room, i, 'background', e.target.value)}
              />
              <textarea
                className={areaCls}
                rows={2}
                placeholder="说话风格（语气、口头禅、标点习惯）"
                value={p.style}
                onChange={(e) => update(room, i, 'style', e.target.value)}
              />
            </div>
          ))}
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button
          className={saveBtn}
          onClick={async () => {
            const res = await emitAck<SaveAck>('admin:save', { section: 'personas', data: personas });
            setMsg(res.ok ? '已保存' : `保存失败: ${res.error}`);
            if (res.ok && res.data) setPersonas(res.data.config.personas);
          }}
        >
          保存人格卡
        </button>
        <SectionStatus msg={msg} />
      </div>
    </div>
  );
}

// ---------- Prompt ----------

const PROMPT_FIELDS: { key: keyof AiPromptsCfg; label: string; rows: number }[] = [
  { key: 'baseRules', label: '基础规则（所有 AI 的铁律）', rows: 12 },
  { key: 'roomContextTech', label: '技术房听众背景', rows: 4 },
  { key: 'roomContextLife', label: '生活房听众背景', rows: 4 },
  { key: 'strategyHigh', label: '第二轮策略：高怀疑（被大量投票）', rows: 4 },
  { key: 'strategyLow', label: '第二轮策略：低怀疑（几乎没被投）', rows: 4 },
  { key: 'strategyMid', label: '第二轮策略：中等怀疑', rows: 2 },
  { key: 'strategyNone', label: '第一轮默认策略', rows: 2 },
];

function Prompts({ data }: { data: AdminData }) {
  const [prompts, setPrompts] = useState(data.config.prompts);
  const [msg, setMsg] = useState('');
  return (
    <div className={card}>
      <div className="font-bold">🧠 Prompt 设置</div>
      <p className="text-xs text-slate-500">保存后立即生效（包括规则讲解阶段的首答预生成）。改动前建议先复制备份。</p>
      {PROMPT_FIELDS.map((f) => (
        <label key={f.key} className="block space-y-1">
          <span className="text-xs text-slate-400">{f.label}</span>
          <textarea
            className={areaCls}
            rows={f.rows}
            value={prompts[f.key]}
            onChange={(e) => setPrompts({ ...prompts, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <div className="flex items-center gap-3">
        <button
          className={saveBtn}
          onClick={async () => {
            const res = await emitAck<SaveAck>('admin:save', { section: 'prompts', data: prompts });
            setMsg(res.ok ? '已保存' : `保存失败: ${res.error}`);
          }}
        >
          保存 Prompt
        </button>
        <SectionStatus msg={msg} />
      </div>
    </div>
  );
}
