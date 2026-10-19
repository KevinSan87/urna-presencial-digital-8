import { Check, ChevronRight, CircleAlert, Clock3, Vote } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { PublicVotingData, VotingGroup } from "@shared/voting";
import { api } from "@/lib/api";

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `vote-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function isPublicVotingData(value: unknown): value is PublicVotingData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PublicVotingData>;
  return Boolean(candidate.config && typeof candidate.config.name === "string" && Array.isArray(candidate.groups));
}

function GroupVisual({ group, compact = false }: { group: Pick<VotingGroup, "name" | "logo">; compact?: boolean }) {
  if (group.logo) return <img className={compact ? "group-visual group-visual--compact" : "group-visual"} src={group.logo} alt={`Logo de ${group.name}`} />;
  return <div className={compact ? "group-visual group-visual--fallback group-visual--compact" : "group-visual group-visual--fallback"}><span>{initials(group.name)}</span><Vote size={compact ? 28 : 42} strokeWidth={1.5} /></div>;
}

export default function PublicVoting() {
  const [data, setData] = useState<PublicVotingData | null>(null);
  const [selected, setSelected] = useState<VotingGroup | null>(null);
  const [stage, setStage] = useState<"ready" | "confirm" | "processing" | "success">("ready");
  const [seconds, setSeconds] = useState(5);
  const [error, setError] = useState("");
  const [access, setAccess] = useState<"checking" | "locked" | "unlocked">("checking");
  const [accessPassword, setAccessPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestIdRef = useRef("");
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const next = await api<PublicVotingData>("/api/voting/public");
      if (!isPublicVotingData(next)) throw new Error("O servidor retornou uma resposta incompleta.");
      setData(next);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a votação.");
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    api<{ unlocked: boolean }>("/api/voting/access")
      .then(result => {
        setAccess(result.unlocked ? "unlocked" : "locked");
        if (result.unlocked) void load();
      })
      .catch(() => setAccess("locked"));
  }, [load]);

  useEffect(() => {
    if (access !== "unlocked") return;
    void load();
    const interval = window.setInterval(() => void load(), 5000);
    const retryWhenOnline = () => void load();
    const retryWhenVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("online", retryWhenOnline);
    document.addEventListener("visibilitychange", retryWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", retryWhenOnline);
      document.removeEventListener("visibilitychange", retryWhenVisible);
    };
  }, [access, load]);

  async function unlockDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUnlocking(true);
    setError("");
    try {
      await api("/api/voting/unlock", { method: "POST", body: JSON.stringify({ password: accessPassword }) });
      setAccessPassword("");
      setAccess("unlocked");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Senha incorreta.");
    } finally {
      setUnlocking(false);
    }
  }

  useEffect(() => {
    if (stage !== "success") return;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      void audio.play().catch(() => {
        audio.load();
        void audio.play().catch(() => undefined);
      });
    }
    setSeconds(5);
    const interval = window.setInterval(() => setSeconds(value => Math.max(0, value - 1)), 1000);
    const timeout = window.setTimeout(() => {
      setSelected(null);
      setStage("ready");
      void load();
    }, 5000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [stage, load]);

  async function confirmVote() {
    if (!selected || stage === "processing" || data?.config.status !== "open") return;
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = 0;
      audio.muted = true;
      void audio.play().catch(() => undefined);
    }
    setStage("processing");
    setError("");
    try {
      await api("/api/voting/vote", { method: "POST", body: JSON.stringify({ groupId: selected.id, requestId: requestIdRef.current }) });
      setStage("success");
    } catch (err) {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      }
      setStage("confirm");
      setError(err instanceof Error ? err.message : "Não foi possível registrar o voto.");
      void load();
    }
  }

  if (access === "locked") {
    return (
      <main className="public-page device-gate">
        <form className="device-gate__card" onSubmit={unlockDevice}>
          <p className="eyebrow">Acesso necessário</p>
          <h1>Liberar este computador</h1>
          <p>Digite a senha para liberar este computador para a votação.</p>
          <input autoFocus type="password" value={accessPassword} onChange={event => setAccessPassword(event.target.value)} placeholder="Senha" aria-label="Senha de acesso" />
          {error && <p className="form-error">{error}</p>}
          <button className="button button--primary button--full" disabled={unlocking || !accessPassword}>{unlocking ? "LIBERANDO…" : "LIBERAR PARA VOTAR"}</button>
        </form>
      </main>
    );
  }

  if (access === "checking" || !data) {
    return <main className="public-page public-page--loading"><div className="loading-orbit" /><p>Preparando a votação…</p>{error && <p className="public-error">{error}</p>}</main>;
  }

  return (
    <>
      <audio ref={audioRef} src="/audio/confirm.wav?v=2" preload="auto" />
      {stage === "success" ? (
        <main className="public-page public-success">
        <div className="success-mark"><Check size={72} strokeWidth={2.3} /></div>
        <p className="eyebrow">Registro concluído</p>
        <h1>VOTO CONFIRMADO!</h1>
        <p className="success-copy">Obrigado pela participação.</p>
        <div className="next-vote"><Clock3 size={18} /> Próxima votação em <strong>{seconds}s</strong></div>
        <div className="success-progress"><span style={{ width: `${(seconds / 5) * 100}%` }} /></div>
        </main>
      ) : (() => {
        const closed = data.config.status === "closed";
        return (
    <main className="public-page">
      <section className="public-intro">
        <h1>{data.config.name}</h1>
      </section>

      {closed ? (
        <section className="closed-card"><CircleAlert size={34} /><div><strong>Esta votação foi encerrada.</strong><span>Fale com a organização se precisar de ajuda.</span></div></section>
      ) : data.groups.length ? (
        <section className="group-grid" aria-label="Grupos disponíveis">
          {data.groups.map(group => (
            <article className="group-card" key={group.id}>
              <GroupVisual group={group} />
              <div className="group-card__content"><span className="group-id">Grupo {group.id}</span><h2>{group.name}</h2>{group.description && <p>{group.description}</p>}</div>
              <button className="vote-button" onClick={() => { requestIdRef.current = createRequestId(); setSelected(group); setStage("confirm"); setError(""); }}><span>VOTAR</span><ChevronRight size={20} /></button>
            </article>
          ))}
        </section>
      ) : (
        <section className="empty-public"><Vote size={34} /><strong>Nenhum grupo disponível</strong><span>A organização ainda não cadastrou opções para esta votação.</span></section>
      )}

      {error && stage !== "confirm" && <p className="public-error">{error}</p>}

      {selected && (stage === "confirm" || stage === "processing") && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="confirm-modal">
            <div className="modal-topline"><span>Confira sua escolha</span><button className="icon-button" onClick={() => { setSelected(null); setStage("ready"); }} aria-label="Voltar">×</button></div>
            <GroupVisual group={selected} compact />
            <p className="eyebrow">Você escolheu</p><h2 id="confirm-title">{selected.name}</h2>
            <p className="confirm-copy">Seu voto será registrado para este grupo. Esta ação não pode ser desfeita.</p>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions"><button className="button button--secondary" onClick={() => { setSelected(null); setStage("ready"); }}>VOLTAR</button><button className="button button--primary" onClick={() => void confirmVote()} disabled={stage === "processing"}>{stage === "processing" ? "REGISTRANDO…" : "CONFIRMAR VOTO"}</button></div>
          </div>
        </div>
      )}
    </main>
        );
      })()}
    </>
  );
}
