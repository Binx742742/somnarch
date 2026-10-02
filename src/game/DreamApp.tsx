import { useEffect, useRef, useState, type RefObject } from "react";
import { DreamSession, type HudNodes, type Screen } from "./mount";

function collectHud(root: HTMLDivElement): HudNodes {
  const q = (key: string) => root.querySelector(`[data-hud="${key}"]`) as HTMLElement | null;
  for (const key of ["monster", "channel", "banner"]) {
    const el = q(key);
    if (el) el.hidden = true;
  }
  return {
    root,
    objective: q("objective"),
    prompt: q("prompt"),
    hp: q("hp"),
    stam: q("stam"),
    keys: q("keys"),
    channel: q("channel"),
    channelFill: q("channel-fill"),
    banner: q("banner"),
    log: q("log"),
    items: q("items"),
    cds: q("cds"),
    monsterWrap: q("monster"),
    monsterFill: q("monster-fill"),
    map: root.querySelector('[data-hud="map"]') as HTMLCanvasElement | null,
    names: q("names"),
    role: q("role"),
  };
}

function cleanName(value: string): string {
  const next = value.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 16);
  return next || "Ash";
}

function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export function DreamApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<DreamSession | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "menu" });
  const [name, setName] = useState("Ash");
  const [joinCode, setJoinCode] = useState("");
  const [muted, setMuted] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const [bootError, setBootError] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    let session: DreamSession;
    try {
      session = new DreamSession(canvas, collectHud(root), setScreen);
    } catch (error) {
      setBootError(error instanceof Error ? error.message : "The dream could not open.");
      return;
    }
    sessionRef.current = session;
    session.layout();
    const observer = new ResizeObserver(() => session.layout());
    observer.observe(canvas);
    const saved = localStorage.getItem("somnarch-v1");
    if (saved) {
      try {
        const data = JSON.parse(saved) as { name?: string; mute?: boolean };
        if (data.name) setName(cleanName(data.name));
        if (data.mute) {
          setMuted(true);
          session.setMuted(true);
        }
      } catch {
        /* ignore broken save */
      }
    }
    const query = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarse(query.matches || window.innerWidth < 780);
    apply();
    query.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      query.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
      session.dispose();
      sessionRef.current = null;
    };
  }, []);

  function persist(nextName: string, nextMute: boolean) {
    localStorage.setItem("somnarch-v1", JSON.stringify({ v: 1, name: nextName, mute: nextMute }));
  }

  function play(role: "dreamer" | "somnarch") {
    const who = cleanName(name);
    setName(who);
    persist(who, muted);
    sessionRef.current?.startSolo(role, who);
  }

  const playing = screen.kind === "play";
  const showTouch = coarse && playing && !screen.pause;

  return (
    <div ref={rootRef} className="relative h-dvh w-full overflow-hidden bg-bg text-fg">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />
      <div className="dream-vignette pointer-events-none absolute inset-0" />
      <div className="dream-near pointer-events-none absolute inset-0" />
      <div className="dream-hurt pointer-events-none absolute inset-0" />
      <div className="dream-grain pointer-events-none absolute inset-0" />

      {screen.kind === "menu" || screen.kind === "lobby" ? (
        <aside className="dossier absolute inset-y-0 left-0 z-10 w-full overflow-y-auto px-5 py-4 md:w-96 md:py-6">
          <p className="font-display text-xs tracking-widest text-moon">FIVE-SOUL HORROR</p>
          <h1 className="mt-2 font-display text-4xl text-fg md:text-5xl">SOMNARCH</h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
            Four dreamers. One stitched butcher. Wake the cul-de-sac, or be sewn into it.
          </p>
          {bootError ? <p className="mt-4 text-sm text-blood">{bootError}</p> : null}

          {screen.kind === "menu" ? (
            <Menu
              name={name}
              joinCode={joinCode}
              muted={muted}
              onName={(value) => setName(value.slice(0, 16))}
              onJoinCode={setJoinCode}
              onMute={() => {
                const next = !muted;
                setMuted(next);
                persist(cleanName(name), next);
                sessionRef.current?.setMuted(next);
              }}
              onDreamer={() => play("dreamer")}
              onMonster={() => play("somnarch")}
              onHost={() => {
                const who = cleanName(name);
                const code = makeCode();
                setName(who);
                persist(who, muted);
                sessionRef.current?.hostCircle(code, who);
              }}
              onJoin={() => {
                const code = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
                if (code.length < 4) return;
                const who = cleanName(name);
                setName(who);
                persist(who, muted);
                sessionRef.current?.joinCircle(code, who);
              }}
            />
          ) : (
            <Lobby
              screen={screen}
              onWant={(role) => sessionRef.current?.setWant(role)}
              onBegin={() => sessionRef.current?.begin()}
              onLeave={() => sessionRef.current?.leave()}
            />
          )}
        </aside>
      ) : null}

      <div className={playing ? "pointer-events-none absolute inset-0 z-10" : "hidden"}>
        <div className="absolute top-4 right-4 left-4 flex items-start justify-between gap-3 md:left-auto md:w-96">
          <div className="min-w-0">
            <p data-hud="role" className="font-display text-xs tracking-widest text-moon" />
            <p data-hud="objective" className="mt-1 max-w-xs text-sm leading-snug text-fg" />
          </div>
          <canvas data-hud="map" width={148} height={148} className="h-24 w-24 shrink-0 rounded-full border border-line" />
        </div>
        <p data-hud="banner" className="absolute top-28 right-4 left-4 text-center font-display text-sm text-moon md:top-24" />
        <div data-hud="log" className="absolute top-36 right-4 hidden max-w-xs text-right text-xs text-muted md:block" />
        <div data-hud="monster" className="absolute top-4 left-1/2 w-40 -translate-x-1/2">
          <p className="mb-1 text-center text-xs tracking-widest text-blood">SOMNARCH</p>
          <div className="meter">
            <span data-hud="monster-fill" className="bg-blood" />
          </div>
        </div>
        <div className={`absolute right-4 left-4 flex max-w-lg flex-col gap-2 md:left-6 ${coarse ? "bottom-44" : "bottom-6"}`}>
          <p data-hud="prompt" className="font-display text-sm text-moon" />
          <div data-hud="channel" className="meter max-w-xs">
            <span data-hud="channel-fill" className="bg-moon" />
          </div>
          <p data-hud="keys" className="text-sm text-fg" />
          <div className="meter max-w-xs">
            <span data-hud="hp" className="bg-blood" />
          </div>
          <div className="meter max-w-xs">
            <span data-hud="stam" className="bg-moon" />
          </div>
          <p data-hud="items" className="text-xs text-muted" />
          <p data-hud="cds" className="text-xs text-moon" />
          {!coarse ? (
            <p className="text-xs text-muted">
              <kbd>WASD</kbd> move <kbd>Shift</kbd> sprint <kbd>Space</kbd> dodge <kbd>E</kbd> rite <kbd>F</kbd> item <kbd>Q</kbd> veil/pulse <kbd>R</kbd> tether/stitch <kbd>LMB</kbd> strike <kbd>Esc</kbd> pause
            </p>
          ) : null}
        </div>
        <div data-hud="names" className="pointer-events-none absolute inset-0" />
      </div>

      {showTouch ? <TouchPad session={sessionRef} /> : null}

      {screen.kind === "play" && screen.pause ? (
        <div className="dossier absolute top-1/2 left-1/2 z-20 w-[min(100%-2rem,22rem)] -translate-x-1/2 -translate-y-1/2 p-6">
          <h2 className="font-display text-2xl">Paused</h2>
          <p className="mt-2 text-sm text-muted">The cul-de-sac holds its breath.</p>
          <div className="mt-5 flex flex-col gap-3">
            <button type="button" className="bg-blood px-4 py-3 text-fg" onClick={() => sessionRef.current?.togglePause()}>
              Resume
            </button>
            <button type="button" className="border border-line px-4 py-3 text-moon" onClick={() => sessionRef.current?.leave()}>
              Leave the cul-de-sac
            </button>
          </div>
        </div>
      ) : null}

      {screen.kind === "end" ? (
        <div className="dossier absolute top-1/2 left-1/2 z-20 w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 p-6">
          <p className="font-display text-xs tracking-widest text-moon">{screen.result === "win" ? "THE DREAM BREAKS" : "THE DREAM KEEPS YOU"}</p>
          <h2 className="mt-2 font-display text-3xl">{screen.result === "win" ? "Awake" : "Unmade"}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">{screen.line}</p>
          <div className="mt-5 flex flex-col gap-3">
            {screen.canRestart ? (
              <button type="button" className="bg-blood px-4 py-3 text-fg" onClick={() => sessionRef.current?.again()}>
                Dream again
              </button>
            ) : (
              <p className="text-sm text-muted">Wait for the circle, or step out.</p>
            )}
            <button type="button" className="border border-line px-4 py-3 text-moon" onClick={() => sessionRef.current?.leave()}>
              Leave the cul-de-sac
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Menu(props: {
  name: string;
  joinCode: string;
  muted: boolean;
  onName: (value: string) => void;
  onJoinCode: (value: string) => void;
  onMute: () => void;
  onDreamer: () => void;
  onMonster: () => void;
  onHost: () => void;
  onJoin: () => void;
}) {
  return (
    <div className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-muted">
        Name in the dream
        <input
          value={props.name}
          maxLength={16}
          onChange={(e) => props.onName(e.target.value)}
          className="border border-line bg-surface px-3 py-3 text-fg outline-none"
        />
      </label>
      <button type="button" className="bg-blood px-4 py-3 text-left text-fg" onClick={props.onDreamer}>
        Start as Dreamer
      </button>
      <button type="button" className="border border-line px-4 py-3 text-left text-moon" onClick={props.onMonster}>
        Play as the Somnarch
      </button>
      <button type="button" className="border border-line px-4 py-3 text-left text-fg" onClick={props.onHost}>
        Open a circle
      </button>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          props.onJoin();
        }}
      >
        <input
          value={props.joinCode}
          maxLength={4}
          placeholder="CODE"
          aria-label="Circle code"
          onChange={(e) => props.onJoinCode(e.target.value.toUpperCase())}
          className="w-28 border border-line bg-surface px-3 py-3 tracking-widest text-fg uppercase outline-none"
        />
        <button type="submit" className="flex-1 border border-line px-4 py-3 text-moon">
          Join circle
        </button>
      </form>
      <div className="mt-2 border-t border-line pt-4 text-sm leading-relaxed text-muted">
        <p>Gather four latch-keys, then hold the rite at the clock altar. You become Lucid. Q spends nerve to veil before that.</p>
        <p className="mt-2">Lucid souls kindle three hearths — chapel, mill, mausoleum — and press R to tether the others. The Somnarch can snuff a hearth and stitch you still.</p>
        <p className="mt-2">It dies only when every living dreamer is Lucid and every hearth burns. Until then, chase it and it gets back up.</p>
        <p className="mt-2">Circles are for friends on a direct link, not a ranked pit. Empty souls are filled by the dream.</p>
      </div>
      <button type="button" className="text-left text-sm text-moon" onClick={props.onMute}>
        {props.muted ? "Sound is sealed" : "Sound is open"}
      </button>
    </div>
  );
}

function Lobby(props: {
  screen: Extract<Screen, { kind: "lobby" }>;
  onWant: (role: "dreamer" | "somnarch") => void;
  onBegin: () => void;
  onLeave: () => void;
}) {
  const mine = props.screen.members.find((m) => m.state === "you");
  return (
    <div className="mt-6 flex flex-col gap-4">
      <p className="font-display text-3xl tracking-widest text-moon">{props.screen.code}</p>
      <p className="text-sm text-muted">Share the code. Five seats. One Somnarch, four dreamers. The dream fills empty chairs.</p>
      {props.screen.note ? <p className="text-sm text-moon">{props.screen.note}</p> : null}
      <ul className="flex flex-col gap-2">
        {props.screen.members.map((member) => (
          <li key={member.id} className="flex items-center justify-between gap-3 border border-line px-3 py-2 text-sm">
            <span>
              {member.name}
              <span className="text-muted"> · {member.state}</span>
            </span>
            <span className={member.want === "somnarch" ? "text-blood" : "text-moon"}>
              {member.seated ? (member.want === "somnarch" ? "Somnarch" : "Dreamer") : "Outside"}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button type="button" className="flex-1 border border-line px-3 py-3 text-fg" onClick={() => props.onWant("dreamer")}>
          Dreamer
        </button>
        <button type="button" className="flex-1 border border-blood px-3 py-3 text-blood" onClick={() => props.onWant("somnarch")}>
          Somnarch
        </button>
      </div>
      <p className="text-xs text-muted">You are set to {mine?.want === "somnarch" ? "the Somnarch" : "a dreamer"}.</p>
      {props.screen.host ? (
        <button type="button" className="bg-blood px-4 py-3 text-fg" onClick={props.onBegin}>
          Begin the dream
        </button>
      ) : (
        <p className="text-sm text-muted">Waiting for the host to begin.</p>
      )}
      <button type="button" className="text-left text-sm text-moon" onClick={props.onLeave}>
        Leave the circle
      </button>
    </div>
  );
}

function TouchPad({ session }: { session: RefObject<DreamSession | null> }) {
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  function stick(clientX: number, clientY: number) {
    const origin = drag.current;
    if (!origin) return;
    const dx = clientX - origin.x;
    const dy = clientY - origin.y;
    const max = 52;
    const mag = Math.hypot(dx, dy);
    const clamped = mag > max ? max / mag : 1;
    const kx = dx * clamped;
    const ky = dy * clamped;
    setKnob({ x: kx, y: ky });
    const nx = kx / max;
    const ny = ky / max;
    const m = Math.hypot(nx, ny);
    if (m < 0.2) session.current?.setStick(0, 0);
    else {
      const s = (m - 0.2) / 0.8 / m;
      session.current?.setStick(nx * s, -ny * s);
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div
        className="pointer-events-auto absolute bottom-6 left-4 h-32 w-32 rounded-full border border-line bg-surface/70 touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          stick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (drag.current?.id === e.pointerId) stick(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          drag.current = null;
          setKnob({ x: 0, y: 0 });
          session.current?.setStick(0, 0);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setKnob({ x: 0, y: 0 });
          session.current?.setStick(0, 0);
        }}
      >
        <span
          className="absolute top-1/2 left-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-moon"
          style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
        />
      </div>
      <div
        className="pointer-events-auto absolute inset-y-28 right-0 left-1/2 touch-none"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (look.current?.id !== e.pointerId) return;
          session.current?.addLook((e.clientX - look.current.x) * 0.005, (e.clientY - look.current.y) * 0.004);
          look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => {
          look.current = null;
        }}
        onPointerCancel={() => {
          look.current = null;
        }}
      />
      <div className="pointer-events-auto absolute right-3 bottom-6 grid grid-cols-2 gap-2">
        <TouchButton label="Strike" on={(down) => session.current?.setTouchFlag("atk", down)} />
        <TouchButton label="Dodge" on={(down) => session.current?.setTouchFlag("dash", down)} />
        <TouchButton label="Wake" on={(down) => session.current?.setTouchFlag("interact", down)} />
        <TouchButton label="Item" on={(down) => session.current?.setTouchFlag("use", down)} />
        <TouchButton label="Pulse" on={(down) => session.current?.setTouchFlag("abl", down)} />
        <TouchButton label="Rite" on={(down) => session.current?.setTouchFlag("kit", down)} />
        <TouchButton label="Sprint" on={(down) => session.current?.setTouchFlag("sprint", down)} />
      </div>
    </div>
  );
}

function TouchButton({ label, on }: { label: string; on: (down: boolean) => void }) {
  return (
    <button
      type="button"
      className="h-14 w-14 border border-line bg-surface/80 text-xs text-fg touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        on(true);
      }}
      onPointerUp={() => on(false)}
      onPointerCancel={() => on(false)}
    >
      {label}
    </button>
  );
}
