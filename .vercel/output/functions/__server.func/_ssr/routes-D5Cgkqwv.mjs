import { o as __toESM } from "../_runtime.mjs";
import { K as require_react, b as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { A as TorusGeometry, C as PointLight, D as Scene, E as SRGBColorSpace, M as Vector3, O as ShaderMaterial, S as PerspectiveCamera, T as PointsMaterial, _ as HemisphereLight, a as WebGLRenderer, b as MeshBasicMaterial, c as BufferAttribute, d as Color, f as ConeGeometry, g as Group, h as FogExp2, i as EffectComposer, j as Vector2, k as SphereGeometry, l as BufferGeometry, m as DirectionalLight, n as RenderPass, o as AmbientLight, p as CylinderGeometry, r as OutputPass, s as BoxGeometry, t as UnrealBloomPass, u as CircleGeometry, v as MathUtils, w as Points, x as MeshStandardMaterial, y as Mesh } from "../_libs/three.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-D5Cgkqwv.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var FAST_POLL_MS = 400;
var IDLE_POLL_MS = 2e3;
var PING_INTERVAL_MS = 2e3;
var STALL_MS = 1e4;
var MAX_RECOVERY_ATTEMPTS = 3;
var SIGNAL_RETRY_DELAYS_MS = [250, 750];
function defaultIceServers() {
	return [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
}
var P2PRoom = class {
	opts;
	peers = /* @__PURE__ */ new Map();
	/** Per-remote-peer signal delivery chains (order-preserving). */
	signalQueues = /* @__PURE__ */ new Map();
	cursor = 0;
	pollTimer = null;
	pingTimer = null;
	closed = false;
	everPolled = false;
	lastPeersFingerprint = "";
	constructor(opts) {
		this.opts = opts;
	}
	/**
	* The first poll IS the join: it registers this peer and returns the
	* roster. A failed first poll (cold DB, offline tab) must not strand the
	* room: the loop and timers start regardless and the next poll retries.
	*/
	async join() {
		try {
			await this.pollOnce();
		} catch {}
		if (this.closed) return;
		this.schedulePoll(this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS);
		this.pingTimer = setInterval(() => {
			this.pingAll();
			this.watchdog();
		}, PING_INTERVAL_MS);
	}
	close() {
		this.closed = true;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		if (this.pingTimer) clearInterval(this.pingTimer);
		for (const slot of this.peers.values()) slot.pc.close();
		this.peers.clear();
		fetch("/api/rtc", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				op: "leave",
				room: this.opts.room,
				peer: this.opts.selfId
			}),
			keepalive: true
		}).catch(() => {});
	}
	/** Send on the unreliable game-state channel (drops stale packets). */
	broadcast(data) {
		const wire = JSON.stringify({
			t: "d",
			d: data
		});
		for (const slot of this.peers.values()) if (slot.state?.readyState === "open") slot.state.send(wire);
	}
	/** Send reliably (ordered) to one peer, or to all when peerId is omitted. */
	send(data, peerId) {
		const wire = JSON.stringify({
			t: "d",
			d: data
		});
		const targets = peerId ? [this.peers.get(peerId)] : [...this.peers.values()];
		for (const slot of targets) if (slot?.reliable?.readyState === "open") slot.reliable.send(wire);
	}
	peerList() {
		return [...this.peers.values()].map((s) => ({ ...s.info }));
	}
	schedulePoll(delay) {
		if (this.closed) return;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		this.pollTimer = setTimeout(() => void this.poll(), delay);
	}
	anyPairConnecting() {
		for (const s of this.peers.values()) {
			if (s.terminal) continue;
			if (s.info.connectionState !== "connected") return true;
		}
		return false;
	}
	async pollOnce() {
		const params = new URLSearchParams({
			room: this.opts.room,
			peer: this.opts.selfId,
			name: this.opts.name ?? "",
			since: String(this.cursor)
		});
		const res = await fetch(`/api/rtc?${params}`);
		if (this.closed) return;
		if (!res.ok) throw new Error(`signaling poll failed: ${res.status}`);
		const body = await res.json();
		if (this.closed) return;
		if (!this.everPolled) {
			this.everPolled = true;
			this.opts.onConnected?.();
		}
		this.reconcileRoster(body.peers);
		const roster = new Set(body.peers.map((p) => p.id));
		for (const sig of body.signals) {
			this.cursor = Math.max(this.cursor, sig.id);
			await this.onSignal(sig.from, sig.kind, sig.payload, roster);
			if (this.closed) return;
		}
	}
	async poll() {
		if (this.closed) return;
		try {
			await this.pollOnce();
		} catch {}
		this.schedulePoll(this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS);
	}
	reconcileRoster(peers) {
		const alive = new Set(peers.map((p) => p.id));
		for (const p of peers) {
			if (p.id === this.opts.selfId) continue;
			const existing = this.peers.get(p.id);
			if (existing) existing.info.name = p.name;
			else this.connectTo(p.id, p.name, this.opts.selfId > p.id);
		}
		for (const [id, slot] of this.peers) if (!alive.has(id)) {
			slot.pc.close();
			this.peers.delete(id);
		}
		this.emitPeers();
	}
	connectTo(peerId, name, initiator) {
		if (this.closed) return null;
		const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers ?? defaultIceServers() });
		const slot = {
			pc,
			makingOffer: false,
			ignoreOffer: false,
			pendingCandidates: [],
			lastProgressAt: Date.now(),
			recoveryAttempts: 0,
			info: {
				id: peerId,
				name,
				connectionState: pc.connectionState,
				candidateType: null,
				rttMs: null
			}
		};
		this.peers.set(peerId, slot);
		pc.onicecandidate = (e) => {
			if (e.candidate) this.sendSignal(peerId, "ice", e.candidate.toJSON());
		};
		pc.onconnectionstatechange = () => {
			slot.info.connectionState = pc.connectionState;
			if (pc.connectionState === "connecting" || pc.connectionState === "connected") slot.lastProgressAt = Date.now();
			if (pc.connectionState === "connected") {
				slot.recoveryAttempts = 0;
				slot.terminal = false;
				this.readCandidateType(slot);
			}
			this.emitPeers();
			if (pc.connectionState === "failed") pc.restartIce();
			if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.schedulePoll(FAST_POLL_MS);
		};
		pc.onnegotiationneeded = async () => {
			try {
				slot.makingOffer = true;
				await pc.setLocalDescription();
				await this.sendSignal(peerId, "offer", pc.localDescription.toJSON());
			} catch {} finally {
				slot.makingOffer = false;
			}
		};
		pc.ondatachannel = (e) => this.attachChannel(slot, e.channel);
		if (initiator) {
			this.attachChannel(slot, pc.createDataChannel("state", {
				ordered: false,
				maxRetransmits: 0
			}));
			this.attachChannel(slot, pc.createDataChannel("reliable", { ordered: true }));
		}
		return slot;
	}
	attachChannel(slot, channel) {
		if (channel.label === "state") slot.state = channel;
		else slot.reliable = channel;
		channel.onopen = () => {
			slot.lastProgressAt = Date.now();
		};
		channel.onmessage = (e) => {
			let msg;
			try {
				msg = JSON.parse(e.data);
			} catch {
				return;
			}
			if (msg.t === "ping") {
				if (slot.state?.readyState === "open") slot.state.send(JSON.stringify({ t: "pong" }));
			} else if (msg.t === "pong") {
				if (slot.pingSentAt) {
					slot.info.rttMs = Math.round(performance.now() - slot.pingSentAt);
					slot.pingSentAt = void 0;
					this.emitPeers();
				}
			} else this.opts.onMessage?.(slot.info.id, msg.d, channel.label === "state" ? "state" : "reliable");
		};
	}
	/** Apply buffered ICE candidates once a remote description is in place. */
	async flushPendingCandidates(slot) {
		while (slot.pendingCandidates.length > 0) {
			const candidate = slot.pendingCandidates.shift();
			try {
				await slot.pc.addIceCandidate(candidate);
			} catch (err) {
				if (!slot.ignoreOffer) console.warn("[p2p] addIceCandidate failed:", err);
			}
			if (this.closed) return;
		}
	}
	async onSignal(from, kind, payload, roster) {
		if (this.closed) return;
		let slot = this.peers.get(from);
		if (!slot) {
			if (!roster.has(from)) return;
			const created = this.connectTo(from, "", false);
			if (!created) return;
			slot = created;
		}
		const polite = this.opts.selfId < from;
		try {
			if (kind === "offer" || kind === "answer") {
				const description = payload;
				const collision = kind === "offer" && (slot.makingOffer || slot.pc.signalingState !== "stable");
				slot.ignoreOffer = !polite && collision;
				if (slot.ignoreOffer) return;
				try {
					await slot.pc.setRemoteDescription(description);
				} catch (err) {
					if (kind !== "offer" || slot.recreatedForOffer) throw err;
					const attempts = slot.recoveryAttempts;
					const name = slot.info.name;
					slot.pc.close();
					this.peers.delete(from);
					const fresh = this.connectTo(from, name, false);
					if (!fresh) return;
					fresh.recoveryAttempts = attempts;
					fresh.recreatedForOffer = true;
					slot = fresh;
					await slot.pc.setRemoteDescription(description);
				}
				if (this.closed) return;
				await this.flushPendingCandidates(slot);
				if (this.closed) return;
				if (kind === "offer") {
					await slot.pc.setLocalDescription();
					if (this.closed) return;
					await this.sendSignal(from, "answer", slot.pc.localDescription.toJSON());
				}
			} else if (kind === "ice") {
				const candidate = payload;
				if (!slot.pc.remoteDescription) {
					slot.pendingCandidates.push(candidate);
					return;
				}
				try {
					await slot.pc.addIceCandidate(candidate);
				} catch (err) {
					if (!slot.ignoreOffer) console.warn("[p2p] addIceCandidate failed:", err);
				}
			}
		} catch {}
	}
	/**
	* Signals are serialized per remote peer (a candidate must never overtake
	* its SDP into the DB) and retried on failure with short backoff.
	*/
	sendSignal(to, kind, payload) {
		const next = (this.signalQueues.get(to) ?? Promise.resolve()).then(() => this.postSignal(to, kind, payload));
		this.signalQueues.set(to, next.catch(() => {}));
		return next;
	}
	async postSignal(to, kind, payload) {
		for (let attempt = 0;; attempt++) {
			if (this.closed) return;
			try {
				const res = await fetch("/api/rtc", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						op: "signal",
						room: this.opts.room,
						from: this.opts.selfId,
						to,
						kind,
						payload
					})
				});
				if (res.ok) return;
				throw new Error(`signal POST failed: ${res.status}`);
			} catch (err) {
				if (attempt >= SIGNAL_RETRY_DELAYS_MS.length) {
					console.warn(`[p2p] signal ${kind} to ${to} failed after retries`, err);
					return;
				}
				await new Promise((r) => setTimeout(r, SIGNAL_RETRY_DELAYS_MS[attempt]));
			}
		}
	}
	pingAll() {
		const wire = JSON.stringify({ t: "ping" });
		for (const slot of this.peers.values()) {
			if (slot.state?.readyState !== "open") continue;
			const stale = slot.pingSentAt !== void 0 && performance.now() - slot.pingSentAt > 2 * PING_INTERVAL_MS;
			if (slot.pingSentAt === void 0 || stale) {
				slot.pingSentAt = performance.now();
				slot.state.send(wire);
			}
		}
	}
	/**
	* Stuck-pair recovery, piggybacked on the ping interval. A pair that has
	* made no progress for STALL_MS gets rebuilt by the dialer with a FRESH
	* RTCPeerConnection (new DTLS identity — fixes the suspend/resume
	* fingerprint wedge). After MAX_RECOVERY_ATTEMPTS the pair is terminal:
	* visible to the app as its last connectionState, ignored by fast-poll.
	*/
	watchdog() {
		if (this.closed) return;
		const now = Date.now();
		for (const [peerId, slot] of this.peers) {
			const live = slot.pc.connectionState;
			if (live !== slot.info.connectionState) {
				slot.info.connectionState = live;
				if (live === "connecting" || live === "connected") slot.lastProgressAt = now;
				this.emitPeers();
			}
			if (slot.terminal || live === "connected") continue;
			if (now - slot.lastProgressAt <= STALL_MS) continue;
			if (slot.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
				slot.terminal = true;
				this.emitPeers();
				continue;
			}
			slot.recoveryAttempts += 1;
			slot.lastProgressAt = now;
			if (this.opts.selfId > peerId) {
				const { name } = slot.info;
				const attempts = slot.recoveryAttempts;
				slot.pc.close();
				this.peers.delete(peerId);
				const fresh = this.connectTo(peerId, name, true);
				if (fresh) fresh.recoveryAttempts = attempts;
				this.schedulePoll(FAST_POLL_MS);
			}
		}
	}
	async readCandidateType(slot) {
		try {
			const stats = await slot.pc.getStats();
			let selected;
			stats.forEach((s) => {
				if (s.type === "candidate-pair" && s.nominated) selected = s;
			});
			const localId = selected?.localCandidateId;
			if (localId) {
				const local = stats.get(localId);
				slot.info.candidateType = local?.candidateType ?? null;
				this.emitPeers();
			}
		} catch {}
	}
	emitPeers() {
		const list = this.peerList();
		const fingerprint = JSON.stringify(list.map((p) => [
			p.id,
			p.name,
			p.connectionState,
			p.candidateType,
			p.rttMs
		]));
		if (fingerprint === this.lastPeersFingerprint) return;
		this.lastPeersFingerprint = fingerprint;
		this.opts.onPeersChanged?.(list);
	}
};
/** Procedural dream-bed: drones, heartbeat, and stingers. No sample files. */
var DreamAudio = class {
	ctx = null;
	master = null;
	music = null;
	sfx = null;
	muted = false;
	started = false;
	heart = 0;
	heartAcc = 0;
	unlock() {
		if (!this.ctx) {
			const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
			this.ctx = ctx;
			const master = ctx.createGain();
			master.gain.value = .8;
			const music = ctx.createGain();
			music.gain.value = .9;
			const sfx = ctx.createGain();
			sfx.gain.value = .9;
			music.connect(master);
			sfx.connect(master);
			master.connect(ctx.destination);
			this.master = master;
			this.music = music;
			this.sfx = sfx;
			this.bed();
		}
		if (this.ctx.state === "suspended") this.ctx.resume();
		this.started = true;
	}
	resume() {
		if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
	}
	setMuted(muted) {
		this.muted = muted;
		if (!this.master || !this.ctx) return;
		this.master.gain.setTargetAtTime(muted ? 0 : .8, this.ctx.currentTime, .03);
	}
	update(dt) {
		if (!this.started || this.muted || !this.ctx) return;
		this.heartAcc += dt;
		const gap = 1.15 - this.heart * .86;
		if (this.heart > .08 && this.heartAcc >= gap) {
			this.heartAcc = 0;
			this.thump(70 + this.heart * 30, .12 + this.heart * .08);
		}
	}
	swing() {
		this.noise(180, .09, .08);
	}
	hit() {
		this.noise(90, .16, .2);
		this.tone(140, .12, "square", .05);
	}
	pick() {
		this.tone(660, .08, "sine", .05);
		this.tone(990, .12, "sine", .03);
	}
	lucid() {
		this.tone(392, .2, "sine", .06);
		this.tone(587, .28, "triangle", .04);
	}
	down() {
		this.tone(196, .3, "sawtooth", .04);
	}
	death() {
		this.noise(60, .35, .18);
		this.tone(90, .4, "sine", .06);
	}
	stun() {
		this.tone(880, .07, "square", .04);
		this.tone(440, .14, "square", .03);
	}
	win() {
		this.tone(523, .2, "sine", .05);
		this.tone(659, .28, "sine", .05);
		this.tone(784, .4, "triangle", .04);
	}
	lose() {
		this.tone(220, .4, "sine", .06);
		this.tone(110, .6, "triangle", .05);
	}
	foot() {
		this.noise(240, .04, .03);
	}
	bed() {
		const ctx = this.ctx;
		const music = this.music;
		if (!ctx || !music) return;
		const filter = ctx.createBiquadFilter();
		filter.type = "lowpass";
		filter.frequency.value = 280;
		filter.connect(music);
		for (const freq of [
			49,
			73.4,
			110
		]) {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "sine";
			osc.frequency.value = freq;
			gain.gain.value = freq < 60 ? .045 : .02;
			osc.connect(gain);
			gain.connect(filter);
			osc.start();
		}
		const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
		const noise = ctx.createBufferSource();
		noise.buffer = buffer;
		noise.loop = true;
		const band = ctx.createBiquadFilter();
		band.type = "bandpass";
		band.frequency.value = 420;
		band.Q.value = .6;
		const ng = ctx.createGain();
		ng.gain.value = .015;
		noise.connect(band);
		band.connect(ng);
		ng.connect(music);
		noise.start();
	}
	tone(freq, dur, type, vol) {
		if (!this.ctx || !this.sfx || this.muted || !this.started) return;
		const ctx = this.ctx;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = type;
		osc.frequency.value = freq;
		gain.gain.setValueAtTime(vol, ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(1e-4, ctx.currentTime + dur);
		osc.connect(gain);
		gain.connect(this.sfx);
		osc.start();
		osc.stop(ctx.currentTime + dur + .02);
		osc.onended = () => {
			osc.disconnect();
			gain.disconnect();
		};
	}
	noise(freq, dur, vol) {
		if (!this.ctx || !this.sfx || this.muted || !this.started) return;
		const ctx = this.ctx;
		const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
		const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		const filter = ctx.createBiquadFilter();
		filter.type = "lowpass";
		filter.frequency.value = freq;
		const gain = ctx.createGain();
		gain.gain.value = vol;
		src.connect(filter);
		filter.connect(gain);
		gain.connect(this.sfx);
		src.start();
		src.onended = () => {
			src.disconnect();
			filter.disconnect();
			gain.disconnect();
		};
	}
	thump(freq, dur) {
		this.tone(freq, dur, "sine", .05 + this.heart * .04);
	}
};
var BOUNDARY = 36.5;
var BLOCKS = [
	{
		kind: "boiler",
		x: 0,
		z: 23,
		w: 14,
		d: 9,
		h: 7.2
	},
	{
		kind: "chapel",
		x: 20,
		z: 14,
		w: 8,
		d: 9,
		h: 9
	},
	{
		kind: "nursery",
		x: -19,
		z: 13,
		w: 8,
		d: 7,
		h: 5.2
	},
	{
		kind: "manor",
		x: 21,
		z: -6,
		w: 9,
		d: 8,
		h: 6.4
	},
	{
		kind: "diner",
		x: -21,
		z: -5,
		w: 10,
		d: 6.5,
		h: 4
	},
	{
		kind: "school",
		x: 6,
		z: -21,
		w: 12,
		d: 7.5,
		h: 5.4
	},
	{
		kind: "station",
		x: -12,
		z: -20,
		w: 7,
		d: 9,
		h: 3.5
	},
	{
		kind: "cottage",
		x: -30,
		z: 18,
		w: 5.5,
		d: 5.5,
		h: 4.2
	}
];
var LAMPS = [
	[-10, 0],
	[10, 2],
	[0, -12],
	[-16, -12],
	[14, 6]
];
/** Hand-authored loot lawns. Filtered at match start so none sit inside a house. */
var LOOT_SPOTS = [
	[-8, 4],
	[8, 5],
	[0, -8],
	[-6, -12],
	[12, -12],
	[-14, -2],
	[13, -16],
	[-28, 6],
	[28, -2],
	[28, 8],
	[-8, 16],
	[8, 18],
	[-24, -14],
	[16, -8],
	[-4, 10],
	[4, -16],
	[-16, 6],
	[24, 4],
	[-10, -18],
	[0, 12],
	[18, -16],
	[-26, -6],
	[10, 10],
	[-18, -16]
];
var DREAMER_SPAWNS = [
	[0, 6.5],
	[-12, 2],
	[12, -2],
	[-4, -13]
];
var MONSTER_SPAWN = [0, 14];
var PATROL = [
	[0, 12],
	[14, 6],
	[16, -14],
	[0, -14],
	[-16, -8],
	[-14, 8],
	[-6, 16]
];
function hitsBlock(x, z, radius) {
	for (const b of BLOCKS) {
		const hx = b.w * .5 + radius;
		const hz = b.d * .5 + radius;
		if (Math.abs(x - b.x) <= hx && Math.abs(z - b.z) <= hz) return true;
	}
	return false;
}
function outside(x, z, radius = 0) {
	return Math.hypot(x, z) > BOUNDARY - radius;
}
function lineBlocked(x0, z0, x1, z1) {
	const dist = Math.hypot(x1 - x0, z1 - z0);
	const steps = Math.max(1, Math.ceil(dist / .65));
	for (let i = 1; i < steps; i++) {
		const t = i / steps;
		if (hitsBlock(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, .12)) return true;
	}
	return false;
}
function spotClear(x, z) {
	const h = Math.hypot(x, z);
	return h > 4.2 && h < 32 && !hitsBlock(x, z, 1.05) && !outside(x, z, 1.2);
}
/** Slide against house walls, then keep the body inside the dream. */
function moveCircle(x, z, dx, dz, radius) {
	let nx = x + dx;
	let nz = z;
	if (hitsBlock(nx, nz, radius) || outside(nx, nz, radius)) nx = x;
	let nx2 = nx;
	let nz2 = z + dz;
	if (hitsBlock(nx2, nz2, radius) || outside(nx2, nz2, radius)) nz2 = z;
	const h = Math.hypot(nx2, nz2);
	const limit = BOUNDARY - radius;
	if (h > limit && h > 1e-4) {
		nx2 *= limit / h;
		nz2 *= limit / h;
	}
	return {
		x: nx2,
		z: nz2
	};
}
var COATS = [
	8010290,
	4082774,
	9076072,
	3945288
];
var DreamRenderer = class {
	renderer;
	scene = new Scene();
	camera = new PerspectiveCamera(58, 1, .08, 240);
	composer;
	actorRoot = new Group();
	pickupRoot = new Group();
	figures = /* @__PURE__ */ new Map();
	loots = /* @__PURE__ */ new Map();
	clockHands = [];
	windows = [];
	disposables = [];
	ash;
	monsterLight;
	altarLight;
	orbit = .4;
	shake = 0;
	look = new Vector3();
	proj = new Vector3();
	bloom = false;
	constructor(canvas) {
		const renderer = new WebGLRenderer({
			canvas,
			antialias: true,
			powerPreference: "high-performance",
			alpha: false
		});
		renderer.outputColorSpace = SRGBColorSpace;
		renderer.toneMapping = 4;
		renderer.toneMappingExposure = 1.12;
		renderer.setClearColor(460298, 1);
		this.renderer = renderer;
		this.scene.background = new Color(1050638);
		this.scene.fog = new FogExp2(1313810, .027);
		this.buildLights();
		this.buildSky();
		this.buildGround();
		this.buildHouses();
		this.buildTrees();
		this.buildAltar();
		this.buildFloaters();
		this.ash = this.buildAsh();
		this.scene.add(this.actorRoot);
		this.scene.add(this.pickupRoot);
		this.buildShowcase();
		this.monsterLight = new PointLight(16726826, 0, 9, 2);
		this.scene.add(this.monsterLight);
		this.altarLight = new PointLight(16763024, 18, 18, 2);
		this.altarLight.position.set(0, 2.4, 0);
		this.scene.add(this.altarLight);
		const coarse = window.matchMedia("(pointer: coarse)").matches;
		this.bloom = !coarse && window.innerWidth >= 900;
		if (this.bloom) {
			const composer = new EffectComposer(renderer);
			composer.addPass(new RenderPass(this.scene, this.camera));
			const bloomPass = new UnrealBloomPass(new Vector2(320, 180), .38, .55, .84);
			composer.addPass(bloomPass);
			composer.addPass(new OutputPass());
			this.composer = composer;
		} else this.composer = null;
		this.resize();
	}
	resize() {
		const canvas = this.renderer.domElement;
		const w = canvas.clientWidth || 1;
		const h = canvas.clientHeight || 1;
		const dpr = Math.min(window.devicePixelRatio || 1, w < 800 ? 1.25 : 1.7);
		this.renderer.setPixelRatio(dpr);
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.composer?.setPixelRatio(dpr);
		this.composer?.setSize(w, h);
	}
	render(dt, view) {
		this.orbit += dt * (view.mode === "menu" ? .12 : .04);
		this.shake = Math.max(0, this.shake * Math.exp(-3.5 * dt) + view.shake);
		this.placeCamera(dt, view);
		this.flicker(dt);
		this.driftAsh(dt);
		for (const hand of this.clockHands) hand.rotation.z += dt * (hand.userData.fast ? 1.4 : .28);
		this.altarLight.intensity = 14 + Math.sin(this.orbit * 3) * 3;
		this.syncActors(dt, view);
		this.syncPickups(view);
		if (this.composer) this.composer.render();
		else this.renderer.render(this.scene, this.camera);
	}
	project(x, y, z, width, height) {
		this.proj.set(x, y, z);
		this.proj.project(this.camera);
		return {
			x: (this.proj.x * .5 + .5) * width,
			y: (-this.proj.y * .5 + .5) * height,
			visible: this.proj.z < 1 && this.proj.z > -1
		};
	}
	dispose() {
		this.composer?.dispose();
		this.renderer.dispose();
		this.scene.traverse((obj) => {
			const mesh = obj;
			if (mesh.geometry) mesh.geometry.dispose();
			const mat = mesh.material;
			if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
			else if (mat) mat.dispose();
		});
		for (const d of this.disposables) d.dispose();
	}
	placeCamera(dt, view) {
		let yaw = view.camYaw;
		let pitch = MathUtils.clamp(view.camPitch, .28, 1.08);
		let tx = view.targetX;
		let tz = view.targetZ;
		let dist = view.viewerRole === "somnarch" ? 6.5 : 5.15;
		if (view.mode === "menu" || view.mode === "end") {
			yaw = this.orbit;
			pitch = view.mode === "end" ? .92 : .66;
			dist = view.mode === "end" ? 24 : 20;
			tx = 0;
			tz = 0;
		}
		const horiz = dist * Math.cos(pitch);
		const fx = -Math.sin(yaw);
		const fz = -Math.cos(yaw);
		let cx = tx - fx * horiz;
		let cz = tz - fz * horiz;
		const cy = Math.max(.45, 1.35 + dist * Math.sin(pitch));
		if (view.mode === "play") {
			const clamped = pullIn(tx, tz, cx, cz);
			cx = clamped.x;
			cz = clamped.z;
		}
		if (view.snap) this.camera.position.set(cx, cy, cz);
		else {
			const k = 1 - Math.exp(-7 * dt);
			this.camera.position.x += (cx - this.camera.position.x) * k;
			this.camera.position.y += (cy - this.camera.position.y) * k;
			this.camera.position.z += (cz - this.camera.position.z) * k;
		}
		if (this.shake > .001) {
			this.camera.position.x += (Math.random() - .5) * this.shake;
			this.camera.position.y += (Math.random() - .5) * this.shake * .6;
		}
		this.look.set(tx, 1.28, tz);
		this.camera.lookAt(this.look);
	}
	syncActors(dt, view) {
		const seen = /* @__PURE__ */ new Set();
		let mon;
		for (const actor of view.actors) {
			seen.add(actor.id);
			let fig = this.figures.get(actor.id);
			if (!fig) {
				fig = makeFigure(actor.role === "somnarch" ? 2758164 : COATS[this.figures.size % COATS.length], actor.role === "somnarch");
				this.actorRoot.add(fig.group);
				this.figures.set(actor.id, fig);
			}
			const local = actor.id === view.viewerId;
			const g = fig.group;
			if (local || !fig.born) {
				g.position.x = actor.x;
				g.position.z = actor.z;
				g.rotation.y = actor.yaw + Math.PI;
				fig.born = true;
			} else {
				const k = 1 - Math.exp(-10 * dt);
				g.position.x += (actor.x - g.position.x) * k;
				g.position.z += (actor.z - g.position.z) * k;
				const targetYaw = actor.yaw + Math.PI;
				const dy = Math.atan2(Math.sin(targetYaw - g.rotation.y), Math.cos(targetYaw - g.rotation.y));
				g.rotation.y += dy * k;
			}
			const moving = Math.hypot(actor.vx, actor.vz);
			const bob = actor.dead || actor.downed ? 0 : Math.sin(performance.now() * .008 + actor.x) * Math.min(.06, moving * .008);
			const y = actor.dead ? -1.55 : actor.downed ? -.62 : bob;
			g.position.y += (y - g.position.y) * (1 - Math.exp(-6 * dt));
			g.rotation.z = actor.downed ? .9 : 0;
			g.visible = !(actor.dead && g.position.y < -1.35) && !view.hidden.has(actor.id);
			fig.ring.visible = actor.lucid && !actor.dead;
			fig.arm.rotation.x = -.15 - actor.swing * 1.45;
			fig.coat.emissiveIntensity = actor.lucid ? .55 : fig.monster ? .4 : .16;
			if (actor.swing > .65) fig.coat.emissive.setHex(16769476);
			else fig.coat.emissive.setHex(fig.monster ? 3804168 : actor.lucid ? 5916208 : 1312780);
			if (actor.role === "somnarch") {
				mon = actor;
				this.monsterLight.position.set(actor.x, 1.6, actor.z);
			}
		}
		for (const [id, fig] of this.figures) if (!seen.has(id)) {
			this.actorRoot.remove(fig.group);
			this.figures.delete(id);
		}
		const showMon = !!mon && !view.hidden.has(mon.id) && view.mode === "play";
		this.monsterLight.intensity = showMon ? 14 : 0;
	}
	syncPickups(view) {
		const seen = /* @__PURE__ */ new Set();
		const show = view.mode === "play";
		for (const p of view.pickups) {
			seen.add(p.id);
			let mesh = this.loots.get(p.id);
			if (!mesh) {
				mesh = makeLoot(p.kind);
				this.pickupRoot.add(mesh);
				this.loots.set(p.id, mesh);
			}
			mesh.position.set(p.x, 0, p.z);
			mesh.visible = show && !p.taken;
			mesh.rotation.y += .01;
		}
	}
	flicker(dt) {
		const t = performance.now() * .001;
		for (const w of this.windows) {
			const n = .65 + Math.sin(t * (1.5 + w.phase) + w.phase * 6) * .25;
			w.mat.emissiveIntensity = 1.7 + n + (Math.sin(t * 13 + w.phase) > .92 ? .8 : 0);
		}
	}
	driftAsh(dt) {
		const attr = this.ash.getAttribute("position");
		const arr = attr.array;
		for (let i = 1; i < arr.length; i += 3) {
			const y = arr[i] ?? 0;
			arr[i] = y - dt * .45;
			if ((arr[i] ?? 0) < 0) arr[i] = 8 + Math.random() * 6;
		}
		attr.needsUpdate = true;
		const pts = this.scene.getObjectByName("ash");
		if (pts) {
			pts.position.x = this.camera.position.x;
			pts.position.z = this.camera.position.z;
		}
	}
	buildLights() {
		this.scene.add(new HemisphereLight(13155796, 2757140, .95));
		this.scene.add(new AmbientLight(3810352, .42));
		const moon = new DirectionalLight(14147839, 2.6);
		moon.position.set(26, 40, -20);
		this.scene.add(moon);
		const fill = new DirectionalLight(16756872, .7);
		fill.position.set(-18, 10, 14);
		this.scene.add(fill);
	}
	buildSky() {
		const geo = new SphereGeometry(190, 24, 16);
		const mat = new ShaderMaterial({
			side: 1,
			depthWrite: false,
			uniforms: {},
			vertexShader: `
        varying vec3 vDir;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vDir = position;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
			fragmentShader: `
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y * 0.55 + 0.15, 0.0, 1.0);
          vec3 top = vec3(0.025, 0.018, 0.04);
          vec3 hor = vec3(0.22, 0.09, 0.1);
          vec3 col = mix(hor, top, smoothstep(0.0, 0.7, h));
          float moon = pow(max(dot(dir, normalize(vec3(0.42, 0.72, -0.38))), 0.0), 32.0);
          col += vec3(0.9, 0.82, 0.66) * moon;
          gl_FragColor = vec4(col, 1.0);
        }
      `
		});
		this.scene.add(new Mesh(geo, mat));
		const moon = new Mesh(new SphereGeometry(4.2, 20, 16), new MeshBasicMaterial({ color: 15786692 }));
		moon.position.set(32, 46, -28);
		this.scene.add(moon);
	}
	buildGround() {
		const geo = new CircleGeometry(BOUNDARY + 8, 72);
		const mat = new ShaderMaterial({
			uniforms: { uTime: { value: 0 } },
			vertexShader: `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
			fragmentShader: `
        varying vec3 vW;
        void main() {
          vec2 p = vW.xz;
          float r = length(p);
          float ang = atan(p.y, p.x);
          float vein = sin(r * 0.55 - ang * 3.0) * 0.5 + 0.5;
          vec3 ink = vec3(0.035, 0.028, 0.032);
          vec3 rust = vec3(0.28, 0.08, 0.07);
          vec3 bone = vec3(0.42, 0.34, 0.22);
          vec3 col = mix(ink, rust, smoothstep(0.55, 0.92, vein) * 0.55);
          float road = smoothstep(1.6, 0.2, abs(r - 15.0));
          col = mix(col, vec3(0.02, 0.016, 0.018), road * 0.75);
          float chk = abs(step(0.0, sin(p.x * 1.5)) - step(0.0, sin(p.y * 1.5)));
          float altar = smoothstep(9.0, 1.2, r);
          col = mix(col, vec3(0.45, 0.1, 0.1), chk * altar * 0.55);
          col = mix(col, bone, smoothstep(4.0, 0.4, r) * 0.35);
          float edge = smoothstep(32.0, 40.0, r);
          col = mix(col, vec3(0.05, 0.02, 0.03), edge);
          gl_FragColor = vec4(col, 1.0);
        }
      `
		});
		const mesh = new Mesh(geo, mat);
		mesh.rotation.x = -Math.PI / 2;
		this.scene.add(mesh);
		const tick = () => {
			mat.uniforms.uTime.value = performance.now() * .001;
		};
		mesh.onBeforeRender = tick;
	}
	buildHouses() {
		const roofMat = new MeshStandardMaterial({
			color: 1182736,
			roughness: .9,
			metalness: .05
		});
		for (const block of BLOCKS) {
			const wall = new MeshStandardMaterial({
				color: wallColor(block.kind),
				roughness: .88,
				metalness: .06
			});
			const body = new Mesh(new BoxGeometry(block.w, block.h, block.d), wall);
			body.position.set(block.x, block.h * .5, block.z);
			this.scene.add(body);
			const roofH = block.kind === "chapel" ? 3.4 : block.kind === "boiler" ? .8 : 1.45;
			const roof = new Mesh(new ConeGeometry(Math.max(block.w, block.d) * .62, roofH, 4), roofMat);
			roof.position.set(block.x, block.h + roofH * .5, block.z);
			roof.rotation.y = Math.PI / 4;
			this.scene.add(roof);
			if (block.kind === "chapel") {
				const spire = new Mesh(new CylinderGeometry(.35, .7, 4.2, 6), roofMat);
				spire.position.set(block.x, block.h + roofH + 2, block.z);
				this.scene.add(spire);
			}
			if (block.kind === "boiler") {
				const stack = new Mesh(new CylinderGeometry(.55, .7, 5.5, 8), new MeshStandardMaterial({
					color: 1708560,
					roughness: .7,
					metalness: .25
				}));
				stack.position.set(block.x + 3.2, block.h + 2.4, block.z + 1);
				this.scene.add(stack);
				const maw = new Mesh(new BoxGeometry(2.4, 1.6, .3), this.windowMat(16734770, 2.4));
				const face = streetPoint(block);
				maw.position.set(face.x, 1.3, face.z);
				maw.lookAt(block.x, 1.3, block.z);
				this.scene.add(maw);
			}
			const face = streetPoint(block);
			const count = block.kind === "school" ? 5 : 3;
			for (let i = 0; i < count; i++) {
				const along = (i - (count - 1) / 2) * 1.35;
				const win = new Mesh(new BoxGeometry(.7, 1.05, .12), this.windowMat(16761994, 1.8));
				const px = -face.nz * along;
				const pz = face.nx * along;
				win.position.set(face.x + px, 1.6 + i % 2 * .15, face.z + pz);
				win.lookAt(block.x, 1.6, block.z);
				this.scene.add(win);
			}
		}
		for (const [x, z] of LAMPS) {
			const pole = new Mesh(new CylinderGeometry(.06, .08, 3.2, 6), new MeshStandardMaterial({
				color: 2761756,
				roughness: .6,
				metalness: .4
			}));
			pole.position.set(x, 1.6, z);
			this.scene.add(pole);
			const bulb = new Mesh(new SphereGeometry(.16, 8, 8), this.windowMat(16769456, 2.2));
			bulb.position.set(x, 3.25, z);
			this.scene.add(bulb);
		}
	}
	windowMat(color, intensity) {
		const mat = new MeshStandardMaterial({
			color: 1707530,
			emissive: color,
			emissiveIntensity: intensity,
			roughness: .35
		});
		this.windows.push({
			mat,
			phase: Math.random() * 6
		});
		return mat;
	}
	buildTrees() {
		const bark = new MeshStandardMaterial({
			color: 1708564,
			roughness: .95
		});
		const leaf = new MeshStandardMaterial({
			color: 2363416,
			roughness: .9
		});
		for (let i = 0; i < 16; i++) {
			const a = i / 16 * Math.PI * 2 + .2;
			const x = Math.cos(a) * 33.2;
			const z = Math.sin(a) * 33.2;
			if (BLOCKS.some((b) => Math.abs(x - b.x) < b.w && Math.abs(z - b.z) < b.d)) continue;
			const trunk = new Mesh(new CylinderGeometry(.12, .2, 2.4, 5), bark);
			trunk.position.set(x, 1.2, z);
			trunk.rotation.z = (i % 2 === 0 ? 1 : -1) * .08;
			this.scene.add(trunk);
			const top = new Mesh(new ConeGeometry(.9, 2.2, 5), leaf);
			top.position.set(x, 2.8, z);
			this.scene.add(top);
		}
	}
	buildAltar() {
		const stone = new MeshStandardMaterial({
			color: 6971992,
			roughness: .75,
			metalness: .08
		});
		const ring = new Mesh(new TorusGeometry(2.3, .12, 8, 28), stone);
		ring.rotation.x = Math.PI / 2;
		ring.position.y = .08;
		this.scene.add(ring);
		for (let i = 0; i < 4; i++) {
			const a = i / 4 * Math.PI * 2;
			const p = new Mesh(new BoxGeometry(.28, 2.4, .28), stone);
			p.position.set(Math.cos(a) * 1.6, 1.2, Math.sin(a) * 1.6);
			this.scene.add(p);
		}
		const clock = new Mesh(new CylinderGeometry(.7, .7, .18, 20), new MeshStandardMaterial({
			color: 1708558,
			emissive: 12862774,
			emissiveIntensity: .5,
			roughness: .4,
			metalness: .3
		}));
		clock.rotation.x = Math.PI / 2;
		clock.position.y = 2.5;
		this.scene.add(clock);
		const handMat = new MeshBasicMaterial({ color: 15787736 });
		for (const fast of [false, true]) {
			const pivot = new Group();
			pivot.position.set(0, 2.5, .2);
			const hand = new Mesh(new BoxGeometry(fast ? .04 : .07, fast ? .28 : .42, .03), handMat);
			hand.position.y = fast ? .14 : .2;
			pivot.add(hand);
			pivot.userData.fast = fast;
			this.clockHands.push(pivot);
			this.scene.add(pivot);
		}
	}
	setDolls(visible) {
		const list = this.scene.userData.showcase;
		if (!list) return;
		for (const obj of list) obj.visible = visible;
	}
	buildFloaters() {
		const wood = new MeshStandardMaterial({
			color: 4863016,
			roughness: .8
		});
		const cloth = new MeshStandardMaterial({
			color: 7221296,
			roughness: .7
		});
		[
			{
				x: -6,
				z: 10,
				y: 2.2
			},
			{
				x: 8,
				z: -7,
				y: 2.6
			},
			{
				x: -4,
				z: -8,
				y: 1.8
			},
			{
				x: 6,
				z: 9,
				y: 3.1
			}
		].forEach((s, i) => {
			const g = new Group();
			if (i % 2 === 0) {
				const bed = new Mesh(new BoxGeometry(1.6, .2, .8), wood);
				const sheet = new Mesh(new BoxGeometry(1.5, .12, .7), cloth);
				sheet.position.y = .12;
				g.add(bed, sheet);
			} else {
				const door = new Mesh(new BoxGeometry(.9, 1.8, .08), wood);
				g.add(door);
			}
			g.position.set(s.x, s.y, s.z);
			g.userData.base = s.y;
			g.userData.phase = i;
			this.scene.add(g);
			g.onBeforeRender;
			g.onBeforeRender = () => {
				const t = performance.now() * .001;
				g.position.y = s.y + Math.sin(t * .7 + i) * .35;
				g.rotation.y = t * .25 + i;
			};
		});
	}
	buildAsh() {
		const n = 260;
		const positions = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) {
			positions[i * 3] = (Math.random() - .5) * 36;
			positions[i * 3 + 1] = Math.random() * 12;
			positions[i * 3 + 2] = (Math.random() - .5) * 36;
		}
		const geo = new BufferGeometry();
		geo.setAttribute("position", new BufferAttribute(positions, 3));
		const pts = new Points(geo, new PointsMaterial({
			color: 14273462,
			size: .07,
			transparent: true,
			opacity: .45,
			depthWrite: false
		}));
		pts.name = "ash";
		this.scene.add(pts);
		return geo;
	}
	buildShowcase() {
		const dreamer = makeFigure(COATS[0], false);
		dreamer.group.position.set(-2.2, 0, 4.2);
		dreamer.group.rotation.y = Math.PI + .4;
		const mon = makeFigure(2758164, true);
		mon.group.position.set(2.4, 0, 8.5);
		mon.group.rotation.y = Math.PI;
		this.scene.add(dreamer.group, mon.group);
		this.scene.userData.showcase = [dreamer.group, mon.group];
	}
};
function wallColor(kind) {
	switch (kind) {
		case "boiler": return 1445902;
		case "chapel": return 2235428;
		case "nursery": return 2761762;
		case "diner": return 2758164;
		case "school": return 1973282;
		case "manor": return 1709592;
		default: return 2366488;
	}
}
function streetPoint(b) {
	let nx = -b.x;
	let nz = -b.z;
	const l = Math.hypot(nx, nz) || 1;
	nx /= l;
	nz /= l;
	const tx = Math.abs(nx) > .001 ? b.w * .5 / Math.abs(nx) : 1e9;
	const tz = Math.abs(nz) > .001 ? b.d * .5 / Math.abs(nz) : 1e9;
	const t = Math.min(tx, tz);
	return {
		x: b.x + nx * (t + .08),
		z: b.z + nz * (t + .08),
		nx,
		nz
	};
}
function pullIn(px, pz, cx, cz) {
	const steps = 10;
	let lx = px;
	let lz = pz;
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		const x = px + (cx - px) * t;
		const z = pz + (cz - pz) * t;
		if (BLOCKS.some((b) => Math.abs(x - b.x) <= b.w * .5 + .25 && Math.abs(z - b.z) <= b.d * .5 + .25)) return {
			x: lx,
			z: lz
		};
		lx = x;
		lz = z;
	}
	return {
		x: cx,
		z: cz
	};
}
function makeFigure(coatHex, monster) {
	const group = new Group();
	if (monster) group.scale.setScalar(1.24);
	const coat = new MeshStandardMaterial({
		color: coatHex,
		roughness: .72,
		metalness: .08,
		emissive: monster ? 3804168 : 1312780,
		emissiveIntensity: monster ? .4 : .16
	});
	const skin = new MeshStandardMaterial({
		color: monster ? 5910568 : 13350298,
		roughness: .62,
		emissive: monster ? 2754566 : 0,
		emissiveIntensity: .25
	});
	const body = new Mesh(new CylinderGeometry(monster ? .38 : .3, monster ? .46 : .34, monster ? 1.25 : .92, 8), coat);
	body.position.y = monster ? 1.35 : 1.15;
	group.add(body);
	const head = new Mesh(new SphereGeometry(monster ? .28 : .21, 12, 10), skin);
	head.position.y = monster ? 2.2 : 1.82;
	group.add(head);
	const eyeMat = new MeshBasicMaterial({ color: monster ? 16771e3 : 1708564 });
	for (const s of [-1, 1]) {
		const e = new Mesh(new SphereGeometry(monster ? .045 : .03, 8, 8), eyeMat);
		e.position.set(s * .09, head.position.y + .02, .18);
		group.add(e);
	}
	const arm = new Mesh(new CylinderGeometry(.07, .08, monster ? 1.15 : .7, 6), skin);
	arm.position.set(monster ? .55 : .42, monster ? 1.4 : 1.25, .05);
	arm.rotation.z = -.2;
	if (monster) {
		const needle = new MeshStandardMaterial({
			color: 15918800,
			emissive: 16730674,
			emissiveIntensity: 2,
			metalness: .4,
			roughness: .25
		});
		for (let i = 0; i < 4; i++) {
			const n = new Mesh(new ConeGeometry(.03, .46, 5), needle);
			n.rotation.x = -Math.PI / 2;
			n.position.set((i - 1.5) * .07, -.62, .18);
			arm.add(n);
		}
	}
	group.add(arm);
	const armL = arm.clone();
	armL.position.x *= -1;
	armL.rotation.z = .2;
	group.add(armL);
	for (const s of [-1, 1]) {
		const leg = new Mesh(new CylinderGeometry(.09, .1, .72, 6), coat);
		leg.position.set(s * .16, .36, 0);
		group.add(leg);
	}
	const ring = new Mesh(new TorusGeometry(.55, .025, 6, 22), new MeshBasicMaterial({ color: 14996400 }));
	ring.rotation.x = Math.PI / 2;
	ring.position.y = .06;
	ring.visible = false;
	group.add(ring);
	const blob = new Mesh(new CircleGeometry(monster ? .7 : .46, 14), new MeshBasicMaterial({
		color: 0,
		transparent: true,
		opacity: .38,
		depthWrite: false
	}));
	blob.rotation.x = -Math.PI / 2;
	blob.position.y = .03;
	group.add(blob);
	return {
		group,
		arm,
		ring,
		coat,
		born: false,
		monster
	};
}
function makeLoot(kind) {
	const g = new Group();
	const color = kind === "fragment" ? 14996400 : kind === "clock" ? 12862774 : 15787736;
	const beam = new Mesh(new CylinderGeometry(.05, .12, 2.2, 6), new MeshBasicMaterial({
		color,
		transparent: true,
		opacity: .55,
		depthWrite: false
	}));
	beam.position.y = 1.1;
	const orb = new Mesh(new SphereGeometry(kind === "fragment" ? .18 : .14, 10, 8), new MeshBasicMaterial({ color }));
	orb.position.y = .45;
	g.add(beam, orb);
	return g;
}
var BOT_DREAMERS = [
	"Vesper",
	"Ione",
	"Calder",
	"Bramble"
];
var WAKE_NEED = 4;
var WAKE_TIME = 2.2;
var REVIVE_TIME = 1.9;
var ALTAR_R = 3.35;
var TETHER_R = 4.7;
var TETHER_CD = 7.2;
var DREAMER_HP = 100;
var MONSTER_HP = 980;
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = a + 1831565813 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
function shuffle(arr, rnd) {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		const tmp = a[i];
		a[i] = a[j];
		a[j] = tmp;
	}
	return a;
}
function blankActor(partial) {
	const monster = partial.role === "somnarch";
	return {
		...partial,
		yaw: monster ? Math.PI : 0,
		vx: 0,
		vz: 0,
		spd: 0,
		hp: monster ? MONSTER_HP : DREAMER_HP,
		stamina: 100,
		fragments: 0,
		lucid: false,
		downed: false,
		dead: false,
		attackCd: 0,
		abilityCd: monster ? 4 : 2,
		dashCd: .4,
		tetherCd: 1,
		dodgeT: 0,
		stun: 0,
		iframes: 0,
		channel: 0,
		channelT: 0,
		channelTarget: "",
		items: [],
		buffT: 0,
		senseT: 0,
		swing: 0,
		downT: 0,
		patrolI: 0,
		stuckT: 0,
		sideT: 0,
		sideSign: 1,
		botTap: 0,
		hearT: 0
	};
}
function createMatch(seed, humans) {
	const rnd = mulberry32(seed || 1);
	const dreamers = humans.filter((h) => h.role === "dreamer").slice(0, 4);
	const monsterHuman = humans.find((h) => h.role === "somnarch") ?? null;
	while (dreamers.length < 4) {
		const name = BOT_DREAMERS[dreamers.length] ?? `Sleeper ${dreamers.length + 1}`;
		dreamers.push({
			id: `bot-d${dreamers.length}`,
			name,
			role: "dreamer"
		});
	}
	const actors = dreamers.map((h, i) => {
		const spawn = DREAMER_SPAWNS[i] ?? DREAMER_SPAWNS[0];
		return blankActor({
			id: h.id,
			name: h.name,
			role: "dreamer",
			bot: h.id.startsWith("bot-"),
			x: spawn[0],
			z: spawn[1]
		});
	});
	actors.push(blankActor({
		id: monsterHuman?.id ?? "bot-mon",
		name: "The Somnarch",
		role: "somnarch",
		bot: !monsterHuman,
		x: MONSTER_SPAWN[0],
		z: MONSTER_SPAWN[1]
	}));
	const spots = shuffle(LOOT_SPOTS.filter(([x, z]) => spotClear(x, z)), rnd);
	const plan = [
		"fragment",
		"fragment",
		"fragment",
		"fragment",
		"fragment",
		"fragment",
		"fragment",
		"fragment",
		"bandage",
		"bandage",
		"bandage",
		"bandage",
		"adrenaline",
		"adrenaline",
		"adrenaline",
		"clock",
		"clock"
	];
	const pickups = [];
	for (let i = 0; i < plan.length && i < spots.length; i++) {
		const spot = spots[i];
		pickups.push({
			id: `loot-${i}`,
			kind: plan[i],
			x: spot[0],
			z: spot[1],
			taken: false
		});
	}
	return {
		seed,
		time: 0,
		actors,
		pickups,
		phase: "play",
		log: ["The cul-de-sac dreams. Find four latch-keys."],
		banner: "Find four latch-keys. Wake at the clock.",
		bannerT: 4
	};
}
function livingDreamers(m) {
	return m.actors.filter((a) => a.role === "dreamer" && !a.dead);
}
function allLivingLucid(m) {
	const live = livingDreamers(m);
	return live.length > 0 && live.every((a) => a.lucid);
}
function monsterOf(m) {
	return m.actors.find((a) => a.role === "somnarch");
}
function say(m, text) {
	m.log.unshift(text);
	if (m.log.length > 6) m.log.length = 6;
	m.banner = text;
	m.bannerT = 3.4;
}
function dist(a, b) {
	return Math.hypot(a.x - b.x, a.z - b.z);
}
function radiusOf(a) {
	return a.role === "somnarch" ? .72 : .44;
}
function decay(a, dt) {
	a.attackCd = Math.max(0, a.attackCd - dt);
	a.abilityCd = Math.max(0, a.abilityCd - dt);
	a.dashCd = Math.max(0, a.dashCd - dt);
	a.tetherCd = Math.max(0, a.tetherCd - dt);
	a.dodgeT = Math.max(0, a.dodgeT - dt);
	a.stun = Math.max(0, a.stun - dt);
	a.iframes = Math.max(0, a.iframes - dt);
	a.buffT = Math.max(0, a.buffT - dt);
	a.senseT = Math.max(0, a.senseT - dt);
	a.swing = Math.max(0, a.swing - dt * 3.1);
	a.botTap = Math.max(0, a.botTap - dt);
	a.hearT = Math.max(0, a.hearT - dt);
	if (a.sideT > 0) a.sideT = Math.max(0, a.sideT - dt);
}
/** Camera-relative stick/keys → world direction on the shared yaw basis. */
function cameraToWorld(ix, iz, camYaw) {
	const mag = Math.hypot(ix, iz);
	if (mag < .001) return {
		x: 0,
		z: 0
	};
	const nx = ix / mag;
	const nz = iz / mag;
	const fx = -Math.sin(camYaw);
	const fz = -Math.cos(camYaw);
	const rx = Math.cos(camYaw);
	const rz = -Math.sin(camYaw);
	return {
		x: nx * rx + nz * fx,
		z: nx * rz + nz * fz
	};
}
function yawForDirection(x, z) {
	return Math.atan2(-x, -z);
}
function approachYaw(current, target, rate, dt) {
	const d = Math.atan2(Math.sin(target - current), Math.cos(target - current));
	const max = rate * dt;
	return current + Math.max(-max, Math.min(max, d));
}
function locomotion(a, wx, wz, dt, sprint) {
	const monster = a.role === "somnarch";
	let moving = Math.hypot(wx, wz) > .05;
	if (a.dead || a.downed || a.stun > 0 || a.channel !== 0) {
		moving = false;
		wx = 0;
		wz = 0;
	}
	if (a.dodgeT > 0) {
		wx = -Math.sin(a.yaw);
		wz = -Math.cos(a.yaw);
		moving = true;
	} else if (moving) {
		const len = Math.hypot(wx, wz) || 1;
		wx /= len;
		wz /= len;
		if (a.sideT > 0) {
			const s = a.sideSign;
			const ox = wx;
			wx = wx * .55 - wz * s * .85;
			wz = ozMix(ox, wz, s);
		}
	}
	let top = monster ? 5.55 : 4.45;
	if (sprint && (monster || a.stamina > 1) && a.dodgeT <= 0) top *= 1.56;
	if (a.buffT > 0) top *= 1.16;
	if (a.lucid) top *= 1.05;
	if (a.dodgeT > 0) top = monster ? 12.4 : 11.2;
	a.spd += ((moving ? top : 0) - a.spd) * (1 - Math.exp(-12 * dt));
	if (!monster && sprint && moving && a.dodgeT <= 0 && a.spd > 1) {
		a.stamina = Math.max(0, a.stamina - 24 * dt);
		a.hearT = .35;
	} else if (!monster) a.stamina = Math.min(100, a.stamina + 15 * dt);
	else a.stamina = 100;
	const stepX = wx * a.spd * dt;
	const stepZ = wz * a.spd * dt;
	const beforeX = a.x;
	const beforeZ = a.z;
	const next = moveCircle(a.x, a.z, stepX, stepZ, radiusOf(a));
	a.x = next.x;
	a.z = next.z;
	a.vx = (a.x - beforeX) / dt;
	a.vz = (a.z - beforeZ) / dt;
	const moved = Math.hypot(a.vx, a.vz);
	if (moving && a.dodgeT <= 0 && moved > .4) {
		a.yaw = approachYaw(a.yaw, yawForDirection(wx, wz), 11, dt);
		a.stuckT = moved < .8 ? a.stuckT + dt : 0;
		if (a.stuckT > .7) {
			a.sideT = .85;
			a.sideSign = a.sideSign > 0 ? -1 : 1;
			a.stuckT = 0;
		}
	} else if (!moving) a.stuckT = 0;
}
function ozMix(ox, wz, s) {
	return ox * s * .85 + wz * .55;
}
function separate(m) {
	const list = m.actors.filter((a) => !a.dead);
	for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
		const a = list[i];
		const b = list[j];
		const dx = b.x - a.x;
		const dz = b.z - a.z;
		const d = Math.hypot(dx, dz) || 1e-4;
		const need = radiusOf(a) + radiusOf(b) * .85;
		if (d < need) {
			const push = (need - d) * .5 / d;
			const ax = a.x - dx * push;
			const az = a.z - dz * push;
			const bx = b.x + dx * push;
			const bz = b.z + dz * push;
			if (!moveBlocked(ax, az, a)) {
				a.x = ax;
				a.z = az;
			}
			if (!moveBlocked(bx, bz, b)) {
				b.x = bx;
				b.z = bz;
			}
		}
	}
}
function moveBlocked(x, z, a) {
	return Math.hypot(x, z) > 36 || blockedSoft(x, z, a);
}
function blockedSoft(x, z, a) {
	const next = moveCircle(a.x, a.z, x - a.x, z - a.z, radiusOf(a));
	return Math.hypot(next.x - x, next.z - z) > .08;
}
function inArc(ax, az, yaw, tx, tz, range, arc) {
	const dx = tx - ax;
	const dz = tz - az;
	const d = Math.hypot(dx, dz);
	if (d > range || d < .001) return d <= range && d > .001;
	const fx = -Math.sin(yaw);
	const fz = -Math.cos(yaw);
	return (dx * fx + dz * fz) / d > Math.cos(arc * .5);
}
function hurtDreamer(m, a, amount, events) {
	if (a.dead || a.iframes > 0 || a.role !== "dreamer") return;
	if (a.downed) {
		killDreamer(m, a, events);
		return;
	}
	a.hp -= amount;
	a.iframes = .45;
	a.channel = 0;
	a.channelT = 0;
	events.push({
		type: "hit",
		victim: a.id,
		amount
	});
	if (a.hp <= 0) {
		a.hp = 0;
		a.downed = true;
		a.downT = 14;
		a.spd = 0;
		say(m, `${a.name} is bleeding out in the dream.`);
		events.push({
			type: "down",
			who: a.id
		});
	}
}
function killDreamer(m, a, events) {
	if (a.dead) return;
	a.dead = true;
	a.downed = false;
	a.hp = 0;
	a.channel = 0;
	say(m, `The Somnarch stitched ${a.name} under.`);
	events.push({
		type: "death",
		who: a.id
	});
	if (livingDreamers(m).length === 0 && m.phase === "play") {
		m.phase = "lose";
		say(m, "The cul-de-sac keeps every soul.");
		events.push({ type: "lose" });
	}
}
function damageMonster(m, amount, events) {
	const mon = monsterOf(m);
	if (!mon || mon.dead || m.phase !== "play") return;
	if (mon.iframes > 0) return;
	const lucidStrike = allLivingLucid(m);
	const dealt = lucidStrike ? amount * 1.55 : amount;
	mon.hp -= dealt;
	mon.iframes = .12;
	events.push({
		type: "hit",
		victim: mon.id,
		amount: dealt
	});
	if (mon.hp <= 0) {
		if (lucidStrike) {
			mon.hp = 0;
			mon.dead = true;
			m.phase = "win";
			say(m, "The Somnarch unravels. The cul-de-sac wakes.");
			events.push({ type: "win" });
		} else {
			mon.hp = 16;
			say(m, "It will not die while a dreamer still sleeps.");
		}
	}
}
function tryPickup(m, a, events) {
	if (a.role !== "dreamer" || a.dead || a.downed) return;
	for (const p of m.pickups) {
		if (p.taken) continue;
		if (dist(a, p) > 1.45) continue;
		if (p.kind === "fragment") {
			if (a.fragments >= WAKE_NEED || a.lucid) continue;
			p.taken = true;
			a.fragments += 1;
			say(m, `${a.name} latched a key (${a.fragments}/${WAKE_NEED}).`);
			events.push({
				type: "pick",
				who: a.id,
				kind: p.kind
			});
		} else if (a.items.length < 3) {
			p.taken = true;
			a.items.push(p.kind);
			events.push({
				type: "pick",
				who: a.id,
				kind: p.kind
			});
		}
	}
}
function becomeLucid(m, a, events) {
	if (a.lucid || a.dead || a.role !== "dreamer") return;
	a.lucid = true;
	a.fragments = WAKE_NEED;
	a.channel = 0;
	a.channelT = 0;
	a.downed = false;
	a.hp = Math.max(a.hp, 70);
	say(m, `${a.name} is Lucid. The dream answers.`);
	events.push({
		type: "lucid",
		who: a.id
	});
	if (allLivingLucid(m)) say(m, "Every living dreamer is awake. Unmake the Somnarch.");
}
function useItem(m, a, events) {
	if (a.dead || a.downed || a.items.length === 0 || a.role !== "dreamer") return;
	const it = a.items.shift();
	if (it === "bandage") {
		a.hp = Math.min(DREAMER_HP, a.hp + 48);
		say(m, `${a.name} bound a wound.`);
	} else if (it === "adrenaline") {
		a.stamina = Math.min(100, a.stamina + 70);
		a.buffT = Math.max(a.buffT, 4.2);
	} else {
		const mon = monsterOf(m);
		if (mon && dist(a, mon) < 16) {
			mon.stun = Math.max(mon.stun, 2.55);
			mon.channel = 0;
			events.push({ type: "stun" });
			say(m, `${a.name} cracked an alarm in the dream.`);
		} else {
			say(m, "The alarm rings, and something turns to listen.");
			if (mon) mon.hearT = 2;
		}
	}
}
function nearestDowned(m, a) {
	let best = null;
	let bestD = 2.35;
	for (const o of m.actors) {
		if (o === a || !o.downed || o.dead) continue;
		const d = dist(a, o);
		if (d < bestD) {
			bestD = d;
			best = o;
		}
	}
	return best;
}
function nearestSleeper(m, a) {
	let best = null;
	let bestD = TETHER_R;
	for (const o of m.actors) {
		if (o === a || o.role !== "dreamer" || o.dead || o.lucid) continue;
		const d = dist(a, o);
		if (d < bestD) {
			bestD = d;
			best = o;
		}
	}
	return best;
}
function tether(m, a, events) {
	if (!a.lucid || a.tetherCd > 0 || a.dead || a.downed) return;
	const ally = nearestSleeper(m, a);
	if (!ally) return;
	a.tetherCd = TETHER_CD;
	if (ally.fragments >= WAKE_NEED || ally.downed) {
		if (ally.downed) {
			ally.downed = false;
			ally.hp = 55;
			ally.iframes = 1.2;
			ally.downT = 0;
		}
		becomeLucid(m, ally, events);
		say(m, `${a.name} pulled ${ally.name} awake.`);
	} else {
		ally.fragments += 1;
		say(m, `${a.name} tethered a latch-key to ${ally.name} (${ally.fragments}/${WAKE_NEED}).`);
	}
}
function tickInteract(m, a, held, dt, events) {
	if (!held || a.dead || a.role !== "dreamer" || a.stun > 0) {
		a.channel = 0;
		a.channelT = 0;
		return;
	}
	const downed = nearestDowned(m, a);
	if (downed && !a.downed) {
		if (a.channel !== 2 || a.channelTarget !== downed.id) {
			a.channel = 2;
			a.channelTarget = downed.id;
			a.channelT = 0;
		}
		a.channelT += dt;
		if (a.channelT >= REVIVE_TIME) {
			downed.downed = false;
			downed.hp = 58;
			downed.iframes = 1.35;
			downed.downT = 0;
			a.channel = 0;
			a.channelT = 0;
			say(m, `${a.name} dragged ${downed.name} back to their feet.`);
		}
		return;
	}
	const altarR = a.channel === 1 ? 4.45 : ALTAR_R;
	if (!a.lucid && !a.downed && a.fragments >= WAKE_NEED && Math.hypot(a.x, a.z) <= altarR) {
		if (a.channel !== 1) {
			a.channel = 1;
			a.channelT = 0;
			a.channelTarget = "altar";
		}
		a.channelT += dt;
		if (a.channelT >= WAKE_TIME) becomeLucid(m, a, events);
		return;
	}
	a.channel = 0;
	a.channelT = 0;
}
function strike(m, a, aimYaw, events) {
	if (a.attackCd > 0 || a.dead || a.stun > 0 || a.downed) return;
	a.swing = 1;
	a.yaw = approachYaw(a.yaw, aimYaw, 20, 1 / 60);
	events.push({
		type: "swing",
		who: a.id
	});
	if (a.role === "somnarch") {
		a.attackCd = .82;
		for (const o of m.actors) {
			if (o.role !== "dreamer" || o.dead) continue;
			const reach = o.downed ? 2.35 : 2.25;
			if (o.downed ? dist(a, o) <= reach : inArc(a.x, a.z, a.yaw, o.x, o.z, reach, 1.15)) hurtDreamer(m, o, o.downed ? 999 : 36, events);
		}
	} else if (a.lucid) {
		a.attackCd = .9;
		const mon = monsterOf(m);
		if (mon && !mon.dead && inArc(a.x, a.z, a.yaw, mon.x, mon.z, 3.15, 1.25)) damageMonster(m, 16, events);
	} else {
		a.attackCd = 1.15;
		const mon = monsterOf(m);
		if (mon && !mon.dead && inArc(a.x, a.z, a.yaw, mon.x, mon.z, 2.25, 1.1)) {
			mon.stun = Math.max(mon.stun, .28);
			mon.iframes = Math.max(mon.iframes, .55);
			events.push({ type: "stun" });
		}
	}
}
function tryDash(a) {
	if (a.dashCd > 0 || a.dead || a.downed || a.stun > 0) return;
	if (a.role === "dreamer" && a.stamina < 18) return;
	a.dodgeT = a.role === "somnarch" ? .34 : .26;
	a.dashCd = a.role === "somnarch" ? 3.6 : 3.15;
	if (a.role === "dreamer") {
		a.stamina = Math.max(0, a.stamina - 22);
		a.iframes = Math.max(a.iframes, .26);
	}
}
function tryAbility(m, a) {
	if (a.abilityCd > 0 || a.dead || a.downed || a.stun > 0) return;
	if (a.role === "somnarch") {
		a.senseT = 5;
		a.abilityCd = 13;
		say(m, "The Somnarch searches the dream.");
	} else if (a.lucid) {
		a.senseT = 5.5;
		a.abilityCd = 16;
		say(m, `${a.name} sends a lucid pulse.`);
	}
}
function tickHuman(m, a, inp, dt, events) {
	const input = inp ?? {
		ix: 0,
		iz: 0,
		camYaw: a.yaw,
		sprint: false,
		atk: false,
		interactHeld: false,
		usePulse: false,
		ablPulse: false,
		dashPulse: false
	};
	if (a.downed) {
		a.downT -= dt;
		a.spd = 0;
		a.vx = 0;
		a.vz = 0;
		a.channel = 0;
		if (a.downT <= 0) killDreamer(m, a, events);
		return;
	}
	const world = cameraToWorld(input.ix, input.iz, input.camYaw);
	if (!a.dead && Math.hypot(input.ix, input.iz) < .2 && a.dodgeT <= 0 && a.stun <= 0 && a.channel === 0) a.yaw = approachYaw(a.yaw, input.camYaw, 8, dt);
	locomotion(a, world.x, world.z, dt, input.sprint && a.stamina > 1);
	if (input.dashPulse) tryDash(a);
	if (input.usePulse) useItem(m, a, events);
	if (input.ablPulse) tryAbility(m, a);
	if (input.atk) strike(m, a, input.camYaw, events);
	tickInteract(m, a, input.interactHeld && Math.hypot(a.vx, a.vz) < 3.2, dt, events);
	tryPickup(m, a, events);
	input.usePulse = false;
	input.ablPulse = false;
	input.dashPulse = false;
}
function tickBot(m, a, dt, events) {
	if (a.downed) {
		a.downT -= dt;
		a.vx = 0;
		a.vz = 0;
		a.spd = 0;
		if (a.downT <= 0) killDreamer(m, a, events);
		return;
	}
	if (a.role === "somnarch") botMonster(m, a, dt, events);
	else botDreamer(m, a, dt, events);
	tryPickup(m, a, events);
}
function botMonster(m, a, dt, events) {
	if (m.time < 6) {
		const p = PATROL[a.patrolI % PATROL.length];
		const gx = p[0] - a.x;
		const gz = p[1] - a.z;
		if (Math.hypot(gx, gz) < 1.6) a.patrolI += 1;
		locomotion(a, gx, gz, dt, false);
		return;
	}
	let best = null;
	let bestScore = 8;
	for (const o of m.actors) {
		if (o.role !== "dreamer" || o.dead) continue;
		const d = dist(a, o);
		const los = d < 24 && !lineBlocked(a.x, a.z, o.x, o.z);
		const noisy = Math.hypot(o.vx, o.vz) > 6.2 || o.hearT > 0;
		let score = 0;
		if (a.senseT > 0) score = 80 - d;
		else if (los && d < 22) score = 100 - d;
		else if (noisy && d < 18) score = 64 - d;
		else if (d < 7.5) score = 40 - d;
		if (o.downed) score += 24;
		if (!o.lucid) score += 6;
		if (score > bestScore) {
			bestScore = score;
			best = o;
		}
	}
	let wx = 0;
	let wz = 0;
	if (best) {
		wx = best.x - a.x;
		wz = best.z - a.z;
		const d = dist(a, best);
		if (d < (best.downed ? 2.3 : 2.15)) strike(m, a, yawForDirection(wx, wz), events);
		if (d > 4.5 && d < 14 && a.dashCd <= 0 && a.botTap <= 0) {
			tryDash(a);
			a.botTap = 1.2;
		}
	} else {
		const p = PATROL[a.patrolI % PATROL.length];
		wx = p[0] - a.x;
		wz = p[1] - a.z;
		if (Math.hypot(wx, wz) < 1.6) a.patrolI += 1;
		if (a.abilityCd <= 0 && m.time > 6 && a.botTap <= 0) {
			tryAbility(m, a);
			a.botTap = 2;
		}
	}
	locomotion(a, wx, wz, dt, true);
}
function botDreamer(m, a, dt, events) {
	const mon = monsterOf(m);
	const md = mon && !mon.dead ? dist(a, mon) : 999;
	const los = mon ? md < 20 && !lineBlocked(a.x, a.z, mon.x, mon.z) : false;
	const danger = mon && !mon.dead && mon.stun <= 0 && (los || md < 8 || a.senseT > 0 && md < 28);
	let wx = 0;
	let wz = 0;
	let interact = false;
	let sprint = false;
	if (danger && mon && md < 12) {
		wx = a.x - mon.x;
		wz = a.z - mon.z;
		sprint = true;
		if (md < 2.8 && a.dashCd <= 0) tryDash(a);
		if (md < 3.3 && a.lucid) strike(m, a, yawForDirection(mon.x - a.x, mon.z - a.z), events);
		else if (md < 2.3 && !a.lucid) strike(m, a, yawForDirection(mon.x - a.x, mon.z - a.z), events);
		const clock = a.items.indexOf("clock");
		if (clock >= 0 && md < 7 && a.botTap <= 0) {
			a.items.splice(clock, 1);
			mon.stun = Math.max(mon.stun, 2.55);
			events.push({ type: "stun" });
			say(m, `${a.name} cracked an alarm in the dream.`);
			a.botTap = 1;
		}
	} else if (a.lucid) {
		const sleeper = nearestSleeper(m, a);
		const ready = livingDreamers(m).every((d) => d.lucid || d.id === a.id);
		if (sleeper && !ready) {
			wx = sleeper.x - a.x;
			wz = sleeper.z - a.z;
			if (dist(a, sleeper) <= TETHER_R && a.tetherCd <= 0 && a.botTap <= 0) {
				tether(m, a, events);
				a.botTap = .4;
			}
		} else if (mon && !mon.dead) {
			wx = mon.x - a.x;
			wz = mon.z - a.z;
			sprint = md > 6;
			if (md < 3.2) strike(m, a, yawForDirection(wx, wz), events);
		}
	} else if (a.fragments < WAKE_NEED) {
		const frag = nearestFragment(m, a);
		if (frag) {
			wx = frag.x - a.x;
			wz = frag.z - a.z;
		} else {
			const lucid = m.actors.find((o) => o.lucid && !o.dead && o.id !== a.id);
			if (lucid) {
				wx = lucid.x - a.x;
				wz = lucid.z - a.z;
			}
		}
	} else {
		wx = -a.x;
		wz = -a.z;
		if (Math.hypot(a.x, a.z) <= ALTAR_R) interact = true;
	}
	const ally = nearestDowned(m, a);
	if (ally && (!danger || md > 9)) {
		wx = ally.x - a.x;
		wz = ally.z - a.z;
		if (dist(a, ally) < 2.3) interact = true;
	}
	if (a.hp < 52 && a.items.includes("bandage") && !danger) {
		const i = a.items.indexOf("bandage");
		if (i >= 0) {
			a.items.splice(i, 1);
			a.hp = Math.min(DREAMER_HP, a.hp + 48);
		}
	}
	if (a.stamina < 30 && sprint && a.items.includes("adrenaline")) {
		const i = a.items.indexOf("adrenaline");
		if (i >= 0) {
			a.items.splice(i, 1);
			a.stamina = 100;
			a.buffT = 4;
		}
	}
	locomotion(a, wx, wz, dt, sprint);
	tickInteract(m, a, interact, dt, events);
	if (a.lucid && a.abilityCd <= 0 && danger && mon && (lineBlocked(a.x, a.z, mon.x, mon.z) || md > 14)) tryAbility(m, a);
}
function nearestFragment(m, a) {
	const rivals = m.actors.filter((o) => o !== a && o.role === "dreamer" && !o.dead && !o.lucid && o.fragments < WAKE_NEED);
	let best = null;
	let bestD = 1e9;
	for (const p of m.pickups) {
		if (p.taken || p.kind !== "fragment") continue;
		const d = dist(a, p);
		if (rivals.some((r) => dist(r, p) + .4 < d)) continue;
		if (d < bestD) {
			bestD = d;
			best = p;
		}
	}
	if (best) return best;
	for (const p of m.pickups) {
		if (p.taken || p.kind !== "fragment") continue;
		const d = dist(a, p);
		if (d < bestD) {
			bestD = d;
			best = p;
		}
	}
	return best;
}
function step(m, inputs, dt) {
	if (m.phase !== "play") return [];
	const events = [];
	m.time += dt;
	m.bannerT = Math.max(0, m.bannerT - dt);
	for (const a of m.actors) {
		if (a.dead && a.role === "somnarch") continue;
		decay(a, dt);
		if (a.dead) continue;
		if (a.bot) tickBot(m, a, dt, events);
		else tickHuman(m, a, inputs.get(a.id), dt, events);
		if (m.phase !== "play") break;
	}
	if (m.phase === "play") separate(m);
	return events;
}
function objectiveFor(m, id) {
	const me = m.actors.find((a) => a.id === id);
	if (!me) return "";
	if (m.phase === "win") return "The cul-de-sac is awake.";
	if (m.phase === "lose") return "The dream kept everyone.";
	if (me.role === "somnarch") {
		const left = livingDreamers(m).length;
		return left > 0 ? `Stitch them under. ${left} dreamer${left === 1 ? "" : "s"} still breathe${left === 1 ? "s" : ""}.` : "The cul-de-sac is yours.";
	}
	if (me.dead) return "You were stitched under. The others still dream.";
	if (me.downed) return "You are bleeding out. Call for a tether.";
	if (!me.lucid) {
		if (me.fragments >= WAKE_NEED) return "Hold wake at the clock altar.";
		return `Latch-keys ${me.fragments}/${WAKE_NEED}. Wake, then pull the others out.`;
	}
	if (!allLivingLucid(m)) return "You are Lucid. Tether the sleepers, then unmake it.";
	return "Everyone living is awake. Cut the Somnarch apart.";
}
function promptFor(m, id) {
	const me = m.actors.find((a) => a.id === id);
	if (!me || me.dead || m.phase !== "play") return "";
	if (me.downed) return "Bleeding out";
	if (me.channel === 1) return "Waking";
	if (me.channel === 2) return "Reviving";
	if (me.role === "somnarch") {
		if (m.actors.find((a) => a.downed && dist(me, a) < 2.4)) return "Strike to finish";
		return "";
	}
	const down = nearestDowned(m, me);
	if (down) return `Hold to revive ${down.name}`;
	if (!me.lucid && me.fragments >= WAKE_NEED && Math.hypot(me.x, me.z) <= 3.75) return "Hold to wake";
	if (me.lucid) {
		const sleeper = nearestSleeper(m, me);
		if (sleeper && me.tetherCd <= 0) return `Press tether for ${sleeper.name}`;
	}
	return "";
}
var RULES = {
	WAKE_NEED,
	WAKE_TIME,
	REVIVE_TIME,
	DREAMER_HP,
	MONSTER_HP,
	ALTAR_R
};
function monsterVisibleTo(viewer, mon) {
	if (viewer.role === "somnarch") return true;
	if (viewer.dead) return false;
	if (viewer.senseT > 0) return true;
	const d = dist(viewer, mon);
	if (d < 8) return true;
	if (d < 20 && !lineBlocked(viewer.x, viewer.z, mon.x, mon.z)) return true;
	return false;
}
function dreamerVisibleToMonster(mon, dreamer) {
	if (dreamer.dead) return false;
	if (mon.senseT > 0) return true;
	const d = dist(mon, dreamer);
	if (d < 9) return true;
	if ((Math.hypot(dreamer.vx, dreamer.vz) > 6.2 || dreamer.hearT > 0) && d < 20) return true;
	if (d < 26 && !lineBlocked(mon.x, mon.z, dreamer.x, dreamer.z)) return true;
	return false;
}
var GAME_KEYS = /* @__PURE__ */ new Set([
	"KeyW",
	"KeyA",
	"KeyS",
	"KeyD",
	"ArrowUp",
	"ArrowLeft",
	"ArrowDown",
	"ArrowRight",
	"ShiftLeft",
	"ShiftRight",
	"Space",
	"KeyE",
	"KeyQ",
	"KeyF"
]);
function makeId() {
	const bytes = /* @__PURE__ */ new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function emptyInput(yaw = 0) {
	return {
		ix: 0,
		iz: 0,
		camYaw: yaw,
		sprint: false,
		atk: false,
		interactHeld: false,
		usePulse: false,
		ablPulse: false,
		dashPulse: false
	};
}
function isRole(v) {
	return v === "dreamer" || v === "somnarch";
}
function asMsg(data) {
	if (!data || typeof data !== "object" || !("k" in data)) return null;
	return data;
}
var DreamSession = class {
	selfId = makeId();
	canvas;
	audio = new DreamAudio();
	renderer;
	keys = /* @__PURE__ */ new Set();
	injected = null;
	onScreen;
	hud;
	room = null;
	peers = [];
	wants = /* @__PURE__ */ new Map();
	names = /* @__PURE__ */ new Map();
	remotes = /* @__PURE__ */ new Map();
	match = null;
	mode = "menu";
	pause = false;
	ended = false;
	lastRole = "dreamer";
	playerName = "Ash";
	want = "dreamer";
	code = "";
	hostId = "";
	isHost = false;
	camYaw = .4;
	camPitch = .62;
	snapCam = false;
	impulse = 0;
	hurt = 0;
	foot = 0;
	snapAcc = 0;
	sendAcc = 0;
	lookDx = 0;
	lookDy = 0;
	mouse = false;
	prevDown = {
		use: false,
		abl: false,
		dash: false
	};
	localInput = emptyInput();
	touch = {
		ix: 0,
		iz: 0,
		sprint: false,
		atk: false,
		interact: false,
		use: false,
		abl: false,
		dash: false
	};
	reduced = false;
	raf = 0;
	last = 0;
	acc = 0;
	labelPool = [];
	constructor(canvas, hud, onScreen) {
		this.canvas = canvas;
		this.hud = hud;
		this.onScreen = onScreen;
		this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		this.renderer = new DreamRenderer(canvas);
		this.bind();
		window.__controlsTest = {
			getYaw: () => this.me()?.yaw ?? 0,
			getSpeed: () => {
				const me = this.me();
				return me ? Math.hypot(me.vx, me.vz) : 0;
			},
			setKeys: (codes) => {
				this.injected = codes.length ? new Set(codes) : null;
			}
		};
		this.last = performance.now();
		this.raf = requestAnimationFrame(this.frame);
	}
	startSolo(role, name) {
		this.audio.unlock();
		this.closeRoom();
		this.playerName = name || "Ash";
		this.lastRole = role;
		this.mode = "solo";
		this.pause = false;
		this.ended = false;
		this.bootMatch(createMatch(Math.random() * 1e9 >>> 0, [{
			id: this.selfId,
			name: this.playerName,
			role
		}]));
	}
	hostCircle(code, name) {
		this.audio.unlock();
		this.playerName = name || "Ash";
		this.code = code;
		this.isHost = true;
		this.hostId = this.selfId;
		this.want = "dreamer";
		this.wants.set(this.selfId, this.want);
		this.names.set(this.selfId, this.playerName);
		this.openRoom();
		this.pushScreenLobby("Opening the circle…");
	}
	joinCircle(code, name) {
		this.audio.unlock();
		this.playerName = name || "Ash";
		this.code = code;
		this.isHost = false;
		this.hostId = "";
		this.want = "dreamer";
		this.wants.set(this.selfId, this.want);
		this.names.set(this.selfId, this.playerName);
		this.openRoom();
		this.pushScreenLobby("Looking for the circle…");
	}
	setWant(role) {
		this.want = role;
		this.wants.set(this.selfId, role);
		this.room?.send({
			k: "want",
			role,
			name: this.playerName
		});
		if (this.isHost) this.pushScreenLobby("");
	}
	begin() {
		if (!this.isHost && this.mode !== "solo") return;
		const roster = this.roster();
		const seed = Math.random() * 1e9 >>> 0;
		this.room?.send({
			k: "begin",
			seed
		});
		this.mode = this.room ? "host" : "solo";
		this.bootMatch(createMatch(seed, roster));
	}
	again() {
		if (this.mode === "client") return;
		if (this.mode === "host") this.begin();
		else this.startSolo(this.lastRole, this.playerName);
	}
	leave() {
		this.closeRoom();
		this.match = null;
		this.mode = "menu";
		this.pause = false;
		this.ended = false;
		this.renderer.setDolls(true);
		document.exitPointerLock?.();
		this.onScreen({ kind: "menu" });
	}
	togglePause() {
		if (this.mode !== "solo" || !this.match || this.match.phase !== "play") return;
		this.pause = !this.pause;
		if (this.pause) document.exitPointerLock?.();
		this.onScreen({
			kind: "play",
			pause: this.pause
		});
	}
	setMuted(muted) {
		if (!muted) this.audio.unlock();
		this.audio.setMuted(muted);
	}
	setStick(ix, iz) {
		this.touch.ix = ix;
		this.touch.iz = iz;
	}
	addLook(dx, dy) {
		this.lookDx += dx;
		this.lookDy += dy;
	}
	setTouchFlag(key, down) {
		this.touch[key] = down;
	}
	layout() {
		this.renderer.resize();
	}
	dispose() {
		cancelAnimationFrame(this.raf);
		this.closeRoom();
		this.unbind();
		this.renderer.dispose();
		if (window.__controlsTest) delete window.__controlsTest;
	}
	bootMatch(match) {
		this.match = match;
		this.ended = false;
		this.pause = false;
		this.camYaw = 0;
		this.camPitch = .72;
		this.snapCam = true;
		this.renderer.setDolls(false);
		const me = this.me();
		if (me) this.camYaw = me.yaw;
		this.onScreen({
			kind: "play",
			pause: false
		});
	}
	me() {
		return this.match?.actors.find((a) => a.id === this.selfId) ?? null;
	}
	frame = (now) => {
		this.raf = requestAnimationFrame(this.frame);
		const dt = Math.min(.05, (now - this.last) / 1e3);
		this.last = now;
		this.readLook();
		this.buildLocalInput();
		if (this.match && this.match.phase === "play" && !(this.pause && this.mode === "solo")) {
			if (this.mode === "client") this.predict(dt);
			else {
				this.acc += dt;
				let guard = 0;
				const inputs = this.inputMap();
				while (this.acc >= 1 / 60 && guard < 5 && this.match.phase === "play") {
					this.acc -= 1 / 60;
					guard += 1;
					const events = step(this.match, inputs, 1 / 60);
					this.playEvents(events);
				}
			}
		} else this.acc = 0;
		this.netTick(dt);
		this.finishPhase();
		this.audio.heart = this.tension();
		this.audio.update(dt);
		this.hurt = Math.max(0, this.hurt - dt * 1.4);
		this.paint(dt);
		const view = this.makeView();
		this.renderer.render(dt, view);
		view.snap = false;
		this.snapCam = false;
	};
	readLook() {
		this.camYaw -= this.lookDx;
		this.camPitch = Math.max(.28, Math.min(1.08, this.camPitch + this.lookDy));
		this.lookDx = 0;
		this.lookDy = 0;
		const pads = navigator.getGamepads?.() ?? [];
		for (const pad of pads) {
			if (!pad || pad.mapping !== "standard") continue;
			const lx = pad.axes[2] ?? 0;
			const ly = pad.axes[3] ?? 0;
			const mag = Math.hypot(lx, ly);
			if (mag > .18) {
				const s = (mag - .18) / .82 / mag;
				this.camYaw -= lx * s * 2.2 * (1 / 60);
				this.camPitch = Math.max(.28, Math.min(1.08, this.camPitch + ly * s * 1.5 * (1 / 60)));
			}
		}
	}
	down(code) {
		return this.injected ? this.injected.has(code) : this.keys.has(code);
	}
	buildLocalInput() {
		let ix = (this.down("KeyD") || this.down("ArrowRight") ? 1 : 0) - (this.down("KeyA") || this.down("ArrowLeft") ? 1 : 0);
		let iz = (this.down("KeyW") || this.down("ArrowUp") ? 1 : 0) - (this.down("KeyS") || this.down("ArrowDown") ? 1 : 0);
		const pads = navigator.getGamepads?.() ?? [];
		let padSprint = false;
		let padAtk = false;
		let padInteract = false;
		let padUse = false;
		let padAbl = false;
		let padDash = false;
		for (const pad of pads) {
			if (!pad || pad.mapping !== "standard") continue;
			const dz = radial(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0), .18);
			ix += dz.x;
			iz += dz.y;
			padSprint = pad.buttons[4]?.pressed || pad.buttons[10]?.pressed || false;
			padAtk = (pad.buttons[7]?.value ?? 0) > .45 || !!pad.buttons[5]?.pressed;
			padInteract = !!pad.buttons[0]?.pressed;
			padUse = !!pad.buttons[2]?.pressed;
			padAbl = !!pad.buttons[3]?.pressed;
			padDash = !!pad.buttons[1]?.pressed;
		}
		ix += this.touch.ix;
		iz += this.touch.iz;
		const mag = Math.hypot(ix, iz);
		if (mag > 1) {
			ix /= mag;
			iz /= mag;
		}
		const useDown = this.down("KeyF") || this.touch.use || padUse;
		const ablDown = this.down("KeyQ") || this.touch.abl || padAbl;
		const dashDown = this.down("Space") || this.touch.dash || padDash;
		const input = this.localInput;
		input.ix = ix;
		input.iz = iz;
		input.camYaw = this.camYaw;
		input.sprint = this.down("ShiftLeft") || this.down("ShiftRight") || this.touch.sprint || padSprint;
		input.atk = this.mouse || this.touch.atk || padAtk;
		input.interactHeld = this.down("KeyE") || this.touch.interact || padInteract;
		input.usePulse = useDown && !this.prevDown.use;
		input.ablPulse = ablDown && !this.prevDown.abl;
		input.dashPulse = dashDown && !this.prevDown.dash;
		this.prevDown = {
			use: useDown,
			abl: ablDown,
			dash: dashDown
		};
	}
	inputMap() {
		const map = /* @__PURE__ */ new Map();
		map.set(this.selfId, this.localInput);
		const now = performance.now();
		for (const [id, rec] of this.remotes) if (now - rec.at < 450) map.set(id, rec.input);
		return map;
	}
	predict(dt) {
		const me = this.me();
		if (!me || me.dead || me.downed || me.stun > 0) return;
		const world = cameraToWorld(this.localInput.ix, this.localInput.iz, this.camYaw);
		const len = Math.hypot(world.x, world.z);
		if (len < .01) {
			me.vx = 0;
			me.vz = 0;
			me.yaw = approach(me.yaw, this.camYaw, 8, dt);
			return;
		}
		const sprint = this.localInput.sprint ? 1.56 : 1;
		const speed = (me.role === "somnarch" ? 5.55 : 4.45) * sprint;
		const ox = me.x;
		const oz = me.z;
		const next = moveCircle(me.x, me.z, world.x / len * speed * dt, world.z / len * speed * dt, me.role === "somnarch" ? .72 : .44);
		me.x = next.x;
		me.z = next.z;
		me.vx = (me.x - ox) / dt;
		me.vz = (me.z - oz) / dt;
		me.yaw = approach(me.yaw, yawForDirection(world.x, world.z), 11, dt);
	}
	playEvents(events) {
		for (const e of events) if (e.type === "hit" && e.victim === this.selfId) {
			this.hurt = 1;
			if (!this.reduced) this.impulse = Math.max(this.impulse, .22);
			this.audio.hit();
		} else if (e.type === "hit") this.audio.hit();
		else if (e.type === "swing" && e.who === this.selfId) this.audio.swing();
		else if (e.type === "pick" && e.who === this.selfId) this.audio.pick();
		else if (e.type === "lucid" && e.who === this.selfId) this.audio.lucid();
		else if (e.type === "lucid") this.audio.lucid();
		else if (e.type === "down") this.audio.down();
		else if (e.type === "death") this.audio.death();
		else if (e.type === "stun") this.audio.stun();
	}
	finishPhase() {
		if (!this.match || this.ended || this.match.phase === "play") return;
		this.ended = true;
		document.exitPointerLock?.();
		if (this.match.phase === "win") this.audio.win();
		else this.audio.lose();
		this.onScreen({
			kind: "end",
			result: this.match.phase,
			line: this.match.banner,
			canRestart: this.mode !== "client"
		});
	}
	tension() {
		const me = this.me();
		const mon = this.match ? monsterOf(this.match) : void 0;
		if (!me || !mon || mon.dead || me.dead || me.role === "somnarch") {
			if (me?.role === "somnarch" && this.match) {
				let near = 0;
				for (const a of this.match.actors) {
					if (a.role !== "dreamer" || a.dead) continue;
					near = Math.max(near, 1 - Math.hypot(me.x - a.x, me.z - a.z) / 16);
				}
				return near;
			}
			return 0;
		}
		return Math.max(0, Math.min(1, 1 - Math.hypot(me.x - mon.x, me.z - mon.z) / 18));
	}
	makeView() {
		const me = this.me();
		const hidden = /* @__PURE__ */ new Set();
		if (this.match && me) {
			const mon = monsterOf(this.match);
			if (me.role === "dreamer" && mon && !monsterVisibleTo(me, mon)) hidden.add(mon.id);
			if (me.role === "somnarch") {
				for (const a of this.match.actors) if (a.role === "dreamer" && !dreamerVisibleToMonster(me, a)) hidden.add(a.id);
			}
		}
		const playing = this.mode !== "menu" && !!this.match;
		return {
			mode: !playing ? "menu" : this.match && this.match.phase !== "play" ? "end" : "play",
			camYaw: this.camYaw,
			camPitch: this.camPitch,
			targetX: me?.x ?? 0,
			targetZ: me?.z ?? 0,
			snap: this.snapCam,
			actors: playing && this.match ? this.match.actors : [],
			pickups: playing && this.match ? this.match.pickups : [],
			viewerId: this.selfId,
			viewerRole: me?.role ?? null,
			hidden,
			shake: this.impulse
		};
	}
	paint(dt) {
		this.impulse = 0;
		const root = this.hud.root;
		if (root) {
			root.style.setProperty("--hurt", this.hurt.toFixed(3));
			root.style.setProperty("--near", this.tension().toFixed(3));
		}
		const me = this.me();
		if (!(!!this.match && this.mode !== "menu") || !me || !this.match) return;
		if (Math.hypot(me.vx, me.vz) > 2.4 && !me.dead && !me.downed) {
			this.foot += dt;
			if (this.foot > .42) {
				this.foot = 0;
				this.audio.foot();
			}
		}
		setText(this.hud.objective, objectiveFor(this.match, me.id));
		setText(this.hud.prompt, promptFor(this.match, me.id));
		setText(this.hud.role, roleLabel(me));
		const hpMax = me.role === "somnarch" ? RULES.MONSTER_HP : RULES.DREAMER_HP;
		if (this.hud.hp) this.hud.hp.style.transform = `scaleX(${Math.max(0, me.hp / hpMax)})`;
		if (this.hud.stam) this.hud.stam.style.transform = `scaleX(${me.stamina / 100})`;
		setText(this.hud.keys, me.role === "somnarch" ? "Bone and needle" : me.lucid ? "Lucid" : `Latch-keys ${me.fragments}/${RULES.WAKE_NEED}`);
		const channelMax = me.channel === 2 ? RULES.REVIVE_TIME : RULES.WAKE_TIME;
		if (this.hud.channel) this.hud.channel.hidden = me.channel === 0;
		if (this.hud.channelFill) this.hud.channelFill.style.transform = `scaleX(${Math.min(1, me.channelT / channelMax)})`;
		if (this.hud.banner) {
			this.hud.banner.hidden = this.match.bannerT <= 0;
			if (this.match.bannerT > 0) this.hud.banner.textContent = this.match.banner;
		}
		if (this.hud.log) this.hud.log.replaceChildren(...this.match.log.map((line) => {
			const p = document.createElement("p");
			p.textContent = line;
			return p;
		}));
		setText(this.hud.items, me.items.length ? me.items.map(itemLabel).join(" · ") : "Empty pockets");
		const cds = [
			me.role === "dreamer" && me.lucid ? cd("Pulse", me.abilityCd) : me.role === "somnarch" ? cd("Sense", me.abilityCd) : "",
			cd("Dodge", me.dashCd),
			me.lucid ? cd("Tether", me.tetherCd) : ""
		].filter(Boolean);
		setText(this.hud.cds, cds.join("  "));
		const mon = monsterOf(this.match);
		const showMon = !!mon && (me.role === "somnarch" || me.lucid || me.senseT > 0 && !mon.dead);
		if (this.hud.monsterWrap) this.hud.monsterWrap.hidden = !showMon;
		if (this.hud.monsterFill && mon) this.hud.monsterFill.style.transform = `scaleX(${Math.max(0, mon.hp / RULES.MONSTER_HP)})`;
		this.drawMap(me);
		this.drawNames(me);
	}
	drawMap(me) {
		const canvas = this.hud.map;
		if (!canvas || !this.match) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const s = canvas.width;
		ctx.clearRect(0, 0, s, s);
		ctx.fillStyle = "rgba(7,6,10,0.72)";
		ctx.beginPath();
		ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
		ctx.fill();
		const X = (x) => s / 2 + x / BOUNDARY * (s * .42);
		const Y = (z) => s / 2 + z / BOUNDARY * (s * .42);
		ctx.strokeStyle = "rgba(228,211,176,0.35)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(s / 2, s / 2, s * .42, 0, Math.PI * 2);
		ctx.stroke();
		ctx.fillStyle = "rgba(196,69,54,0.9)";
		for (const b of BLOCKS) {
			ctx.globalAlpha = .85;
			ctx.fillStyle = "rgba(240,230,216,0.18)";
			ctx.fillRect(X(b.x - b.w / 2), Y(b.z - b.d / 2), b.w / BOUNDARY * s * .42, b.d / BOUNDARY * s * .42);
		}
		ctx.globalAlpha = 1;
		if (me.role === "dreamer") {
			ctx.fillStyle = "#e4d3b0";
			ctx.beginPath();
			ctx.arc(X(0), Y(0), 3, 0, Math.PI * 2);
			ctx.fill();
			for (const p of this.match.pickups) {
				if (p.taken || p.kind !== "fragment") continue;
				ctx.fillStyle = "#e4d3b0";
				ctx.fillRect(X(p.x) - 1.5, Y(p.z) - 1.5, 3, 3);
			}
		}
		for (const a of this.match.actors) {
			if (a.dead) continue;
			if (a.id !== me.id) {
				const mon = monsterOf(this.match);
				if (a.role === "somnarch" && mon && !monsterVisibleTo(me, mon) && me.role === "dreamer") continue;
				if (me.role === "somnarch" && a.role === "dreamer" && !dreamerVisibleToMonster(me, a)) continue;
			}
			ctx.fillStyle = a.role === "somnarch" ? "#c44536" : a.lucid ? "#e4d3b0" : "#f0e6d8";
			ctx.beginPath();
			ctx.arc(X(a.x), Y(a.z), a.id === me.id ? 4 : 3, 0, Math.PI * 2);
			ctx.fill();
		}
	}
	drawNames(me) {
		const layer = this.hud.names;
		if (!layer || !this.match) return;
		const rect = layer.getBoundingClientRect();
		const actors = this.match.actors.filter((a) => a.id !== me.id && !a.dead);
		while (this.labelPool.length < actors.length) {
			const el = document.createElement("div");
			el.className = "dream-name";
			layer.appendChild(el);
			this.labelPool.push(el);
		}
		const hidden = this.makeHidden();
		actors.forEach((a, i) => {
			const el = this.labelPool[i];
			if (hidden.has(a.id)) {
				el.style.display = "none";
				return;
			}
			const p = this.renderer.project(a.x, a.downed ? 1.1 : 2.25, a.z, rect.width, rect.height);
			if (!p.visible || p.x < -40 || p.y < -40 || p.x > rect.width + 40 || p.y > rect.height + 40) {
				el.style.display = "none";
				return;
			}
			el.style.display = "block";
			el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
			el.textContent = a.role === "somnarch" ? "Somnarch" : a.lucid ? `${a.name} · Lucid` : a.name;
		});
		for (let i = actors.length; i < this.labelPool.length; i++) this.labelPool[i].style.display = "none";
	}
	makeHidden() {
		return this.makeView().hidden;
	}
	netTick(dt) {
		if (!this.room || !this.match || this.match.phase === "lose" && this.ended) {}
		if (this.mode === "client" && this.match) {
			this.sendAcc += dt;
			if (this.sendAcc >= 1 / 20) {
				this.sendAcc = 0;
				this.room?.broadcast({
					k: "input",
					input: {
						...this.localInput,
						items: void 0
					}
				});
				this.localInput.usePulse = false;
				this.localInput.ablPulse = false;
				this.localInput.dashPulse = false;
			}
		}
		if (this.mode === "host" && this.match) {
			this.snapAcc += dt;
			if (this.snapAcc >= 1 / 12) {
				this.snapAcc = 0;
				this.room?.broadcast({
					k: "snap",
					state: snapOf(this.match)
				});
			}
		}
	}
	roster() {
		const members = this.memberList().filter((m) => m.seated);
		const specs = members.map((m) => ({
			id: m.id,
			name: m.name || "Dreamer",
			role: "dreamer"
		}));
		const claim = members.find((m) => (this.wants.get(m.id) ?? "dreamer") === "somnarch");
		if (claim) {
			const row = specs.find((s) => s.id === claim.id);
			if (row) row.role = "somnarch";
		}
		if (specs.filter((s) => s.role === "dreamer").length === specs.length && specs.length >= 5) {
			const host = specs.find((s) => s.id === this.selfId) ?? specs[0];
			if (host) host.role = "somnarch";
		}
		return specs;
	}
	memberList() {
		return [this.selfId, ...this.peers.map((p) => p.id).filter((id) => id !== this.selfId)].map((id, index) => {
			const peer = this.peers.find((p) => p.id === id);
			return {
				id,
				name: id === this.selfId ? this.playerName : this.names.get(id) || peer?.name || "Dreamer",
				want: this.wants.get(id) ?? "dreamer",
				state: id === this.selfId ? "you" : peer ? linkLabel(peer.connectionState) : "linking",
				seated: index < 5
			};
		});
	}
	pushScreenLobby(note) {
		this.onScreen({
			kind: "lobby",
			code: this.code,
			host: this.isHost,
			members: this.memberList(),
			note
		});
	}
	openRoom() {
		this.closeRoom();
		this.room = new P2PRoom({
			room: `somn-${this.code}`,
			selfId: this.selfId,
			name: this.playerName,
			onPeersChanged: (peers) => {
				this.peers = peers;
				if (this.match && (this.mode === "host" || this.isHost)) {
					const live = new Set(peers.map((p) => p.id));
					for (const actor of this.match.actors) if (!actor.bot && actor.id !== this.selfId && !live.has(actor.id)) actor.bot = true;
				}
				this.room?.send({
					k: "want",
					role: this.want,
					name: this.playerName
				});
				if (this.isHost && this.mode !== "solo") this.pushScreenLobby(peers.length ? "" : "Waiting for souls…");
			},
			onMessage: (from, data) => this.onNet(from, data)
		});
		this.room.join();
	}
	onNet(from, data) {
		const msg = asMsg(data);
		if (!msg) return;
		if (msg.k === "want" && isRole(msg.role)) {
			this.wants.set(from, msg.role);
			if (msg.name) this.names.set(from, msg.name.slice(0, 16));
			if (this.isHost) this.pushScreenLobby("");
			return;
		}
		if (msg.k === "lobby" && this.mode !== "solo") {
			this.hostId = msg.hostId;
			this.isHost = msg.hostId === this.selfId;
			for (const m of msg.members) {
				this.wants.set(m.id, m.want);
				this.names.set(m.id, m.name);
			}
			if (!this.match) this.onScreen({
				kind: "lobby",
				code: this.code,
				host: this.isHost,
				members: msg.members,
				note: ""
			});
			return;
		}
		if (msg.k === "begin") {
			this.ended = false;
			this.pause = false;
			this.mode = this.isHost ? "host" : "client";
			if (!this.isHost) {
				this.match = null;
				this.renderer.setDolls(false);
				this.onScreen({
					kind: "play",
					pause: false
				});
			}
			return;
		}
		if (msg.k === "input" && this.mode === "host" && msg.input) {
			this.remotes.set(from, {
				input: {
					...emptyInput(),
					...msg.input
				},
				at: performance.now()
			});
			return;
		}
		if (msg.k === "snap" && this.mode === "client" && msg.state) this.absorb(msg.state);
	}
	absorb(state) {
		const prev = this.me();
		this.match = {
			seed: 0,
			time: state.time,
			phase: state.phase,
			log: state.log ?? [],
			banner: state.banner ?? "",
			bannerT: state.bannerT ?? 0,
			actors: state.actors,
			pickups: state.pickups
		};
		const me = this.me();
		if (prev && me && !me.dead) {
			if (Math.hypot(prev.x - me.x, prev.z - me.z) < 3) {
				me.x = me.x * .35 + prev.x * .65;
				me.z = me.z * .35 + prev.z * .65;
				me.yaw = prev.yaw;
				me.vx = prev.vx;
				me.vz = prev.vz;
			}
		}
		if (!prev && me) {
			this.camYaw = me.yaw;
			this.snapCam = true;
		}
	}
	closeRoom() {
		this.room?.close();
		this.room = null;
		this.peers = [];
		this.remotes.clear();
	}
	bind() {
		window.addEventListener("keydown", this.onKeyDown);
		window.addEventListener("keyup", this.onKeyUp);
		window.addEventListener("blur", this.onBlur);
		document.addEventListener("visibilitychange", this.onVis);
		window.addEventListener("mousemove", this.onMouseMove);
		window.addEventListener("mousedown", this.onMouseDown);
		window.addEventListener("mouseup", this.onMouseUp);
		this.canvas.addEventListener("click", this.onCanvasClick);
		window.addEventListener("resize", this.onResize);
	}
	unbind() {
		window.removeEventListener("keydown", this.onKeyDown);
		window.removeEventListener("keyup", this.onKeyUp);
		window.removeEventListener("blur", this.onBlur);
		document.removeEventListener("visibilitychange", this.onVis);
		window.removeEventListener("mousemove", this.onMouseMove);
		window.removeEventListener("mousedown", this.onMouseDown);
		window.removeEventListener("mouseup", this.onMouseUp);
		this.canvas.removeEventListener("click", this.onCanvasClick);
		window.removeEventListener("resize", this.onResize);
	}
	onKeyDown = (e) => {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		if (GAME_KEYS.has(e.code)) e.preventDefault();
		if (e.repeat) return;
		this.keys.add(e.code);
		if (e.code === "Escape" && this.mode === "solo") this.togglePause();
	};
	onKeyUp = (e) => {
		this.keys.delete(e.code);
	};
	onBlur = () => {
		this.keys.clear();
		this.mouse = false;
	};
	onVis = () => {
		if (document.visibilityState === "visible") this.audio.resume();
		else this.keys.clear();
	};
	onMouseMove = (e) => {
		if (document.pointerLockElement !== this.canvas) return;
		this.camYaw -= e.movementX * .0022;
		this.camPitch = Math.max(.28, Math.min(1.08, this.camPitch + e.movementY * .0018));
	};
	onMouseDown = (e) => {
		if (e.button === 0 && document.pointerLockElement === this.canvas) this.mouse = true;
	};
	onMouseUp = (e) => {
		if (e.button === 0) this.mouse = false;
	};
	onCanvasClick = () => {
		if (this.mode === "menu" || this.pause || this.ended) return;
		if (window.matchMedia("(pointer: coarse)").matches) return;
		this.canvas.requestPointerLock();
	};
	onResize = () => {
		this.renderer.resize();
	};
};
function approach(current, target, rate, dt) {
	const d = Math.atan2(Math.sin(target - current), Math.cos(target - current));
	const max = rate * dt;
	return current + Math.max(-max, Math.min(max, d));
}
function radial(x, y, dz) {
	const m = Math.hypot(x, y);
	if (m < dz) return {
		x: 0,
		y: 0
	};
	const scale = (m - dz) / (1 - dz) / m;
	return {
		x: x * scale,
		y: y * scale
	};
}
function setText(el, text) {
	if (el && el.textContent !== text) el.textContent = text;
}
function roleLabel(a) {
	if (a.dead) return "Stitched under";
	if (a.downed) return "Bleeding out";
	if (a.role === "somnarch") return "The Somnarch";
	if (a.lucid) return "Lucid";
	return "Dreamer";
}
function itemLabel(kind) {
	if (kind === "bandage") return "Bandage";
	if (kind === "adrenaline") return "Adrenaline";
	return "Alarm";
}
function cd(label, time) {
	if (time <= .05) return `${label} ready`;
	return time >= 1 ? `${label} ${time.toFixed(0)}s` : `${label} ${time.toFixed(1)}s`;
}
function linkLabel(state) {
	if (state === "connected") return "linked";
	if (state === "failed") return "blocked";
	return "linking";
}
function snapOf(m) {
	return {
		time: m.time,
		phase: m.phase,
		log: m.log,
		banner: m.banner,
		bannerT: m.bannerT,
		actors: m.actors.map((a) => ({
			...a,
			items: a.items.slice()
		})),
		pickups: m.pickups.map((p) => ({ ...p }))
	};
}
function collectHud(root) {
	const q = (key) => root.querySelector(`[data-hud="${key}"]`);
	for (const key of [
		"monster",
		"channel",
		"banner"
	]) {
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
		map: root.querySelector("[data-hud=\"map\"]"),
		names: q("names"),
		role: q("role")
	};
}
function cleanName(value) {
	return value.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 16) || "Ash";
}
function makeCode() {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	let code = "";
	for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * 32)];
	return code;
}
function DreamApp() {
	const canvasRef = (0, import_react.useRef)(null);
	const rootRef = (0, import_react.useRef)(null);
	const sessionRef = (0, import_react.useRef)(null);
	const [screen, setScreen] = (0, import_react.useState)({ kind: "menu" });
	const [name, setName] = (0, import_react.useState)("Ash");
	const [joinCode, setJoinCode] = (0, import_react.useState)("");
	const [muted, setMuted] = (0, import_react.useState)(false);
	const [coarse, setCoarse] = (0, import_react.useState)(false);
	const [bootError, setBootError] = (0, import_react.useState)("");
	(0, import_react.useEffect)(() => {
		const canvas = canvasRef.current;
		const root = rootRef.current;
		if (!canvas || !root) return;
		let session;
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
		if (saved) try {
			const data = JSON.parse(saved);
			if (data.name) setName(cleanName(data.name));
			if (data.mute) {
				setMuted(true);
				session.setMuted(true);
			}
		} catch {}
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
	function persist(nextName, nextMute) {
		localStorage.setItem("somnarch-v1", JSON.stringify({
			v: 1,
			name: nextName,
			mute: nextMute
		}));
	}
	function play(role) {
		const who = cleanName(name);
		setName(who);
		persist(who, muted);
		sessionRef.current?.startSolo(role, who);
	}
	const playing = screen.kind === "play";
	const showTouch = coarse && playing && !screen.pause;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		ref: rootRef,
		className: "relative h-dvh w-full overflow-hidden bg-bg text-fg",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", {
				ref: canvasRef,
				className: "absolute inset-0 h-full w-full touch-none"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dream-vignette pointer-events-none absolute inset-0" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dream-near pointer-events-none absolute inset-0" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dream-hurt pointer-events-none absolute inset-0" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dream-grain pointer-events-none absolute inset-0" }),
			screen.kind === "menu" || screen.kind === "lobby" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
				className: "dossier absolute inset-y-0 left-0 z-10 w-full overflow-y-auto px-5 py-4 md:w-96 md:py-6",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-display text-xs tracking-widest text-moon",
						children: "FIVE-SOUL HORROR"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "mt-2 font-display text-4xl text-fg md:text-5xl",
						children: "SOMNARCH"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 max-w-md text-sm leading-relaxed text-muted",
						children: "Four dreamers. One stitched butcher. Wake the cul-de-sac, or be sewn into it."
					}),
					bootError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-4 text-sm text-blood",
						children: bootError
					}) : null,
					screen.kind === "menu" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Menu, {
						name,
						joinCode,
						muted,
						onName: (value) => setName(value.slice(0, 16)),
						onJoinCode: setJoinCode,
						onMute: () => {
							const next = !muted;
							setMuted(next);
							persist(cleanName(name), next);
							sessionRef.current?.setMuted(next);
						},
						onDreamer: () => play("dreamer"),
						onMonster: () => play("somnarch"),
						onHost: () => {
							const who = cleanName(name);
							const code = makeCode();
							setName(who);
							persist(who, muted);
							sessionRef.current?.hostCircle(code, who);
						},
						onJoin: () => {
							const code = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
							if (code.length < 4) return;
							const who = cleanName(name);
							setName(who);
							persist(who, muted);
							sessionRef.current?.joinCircle(code, who);
						}
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Lobby, {
						screen,
						onWant: (role) => sessionRef.current?.setWant(role),
						onBegin: () => sessionRef.current?.begin(),
						onLeave: () => sessionRef.current?.leave()
					})
				]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: playing ? "pointer-events-none absolute inset-0 z-10" : "hidden",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "absolute top-4 right-4 left-4 flex items-start justify-between gap-3 md:left-auto md:w-96",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "min-w-0",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								"data-hud": "role",
								className: "font-display text-xs tracking-widest text-moon"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								"data-hud": "objective",
								className: "mt-1 max-w-xs text-sm leading-snug text-fg"
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", {
							"data-hud": "map",
							width: 148,
							height: 148,
							className: "h-24 w-24 shrink-0 rounded-full border border-line"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						"data-hud": "banner",
						className: "absolute top-28 right-4 left-4 text-center font-display text-sm text-moon md:top-24"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						"data-hud": "log",
						className: "absolute top-36 right-4 hidden max-w-xs text-right text-xs text-muted md:block"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						"data-hud": "monster",
						className: "absolute top-4 left-1/2 w-40 -translate-x-1/2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mb-1 text-center text-xs tracking-widest text-blood",
							children: "SOMNARCH"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "meter",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								"data-hud": "monster-fill",
								className: "bg-blood"
							})
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: `absolute right-4 left-4 flex max-w-lg flex-col gap-2 md:left-6 ${coarse ? "bottom-44" : "bottom-6"}`,
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								"data-hud": "prompt",
								className: "font-display text-sm text-moon"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								"data-hud": "channel",
								className: "meter max-w-xs",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									"data-hud": "channel-fill",
									className: "bg-moon"
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								"data-hud": "keys",
								className: "text-sm text-fg"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "meter max-w-xs",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									"data-hud": "hp",
									className: "bg-blood"
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "meter max-w-xs",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									"data-hud": "stam",
									className: "bg-moon"
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								"data-hud": "items",
								className: "text-xs text-muted"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								"data-hud": "cds",
								className: "text-xs text-moon"
							}),
							!coarse ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "text-xs text-muted",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("kbd", { children: "WASD" }),
									" move ",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("kbd", { children: "Shift" }),
									" sprint ",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("kbd", { children: "Space" }),
									" dodge ",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("kbd", { children: "E" }),
									" wake ",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("kbd", { children: "F" }),
									" item ",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("kbd", { children: "Q" }),
									" pulse ",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("kbd", { children: "LMB" }),
									" strike ",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("kbd", { children: "Esc" }),
									" pause"
								]
							}) : null
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						"data-hud": "names",
						className: "pointer-events-none absolute inset-0"
					})
				]
			}),
			showTouch ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TouchPad, { session: sessionRef }) : null,
			screen.kind === "play" && screen.pause ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "dossier absolute top-1/2 left-1/2 z-20 w-[min(100%-2rem,22rem)] -translate-x-1/2 -translate-y-1/2 p-6",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display text-2xl",
						children: "Paused"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm text-muted",
						children: "The cul-de-sac holds its breath."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-5 flex flex-col gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "bg-blood px-4 py-3 text-fg",
							onClick: () => sessionRef.current?.togglePause(),
							children: "Resume"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "border border-line px-4 py-3 text-moon",
							onClick: () => sessionRef.current?.leave(),
							children: "Leave the cul-de-sac"
						})]
					})
				]
			}) : null,
			screen.kind === "end" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "dossier absolute top-1/2 left-1/2 z-20 w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 p-6",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-display text-xs tracking-widest text-moon",
						children: screen.result === "win" ? "THE DREAM BREAKS" : "THE DREAM KEEPS YOU"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "mt-2 font-display text-3xl",
						children: screen.result === "win" ? "Awake" : "Unmade"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-sm leading-relaxed text-muted",
						children: screen.line
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-5 flex flex-col gap-3",
						children: [screen.canRestart ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "bg-blood px-4 py-3 text-fg",
							onClick: () => sessionRef.current?.again(),
							children: "Dream again"
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-sm text-muted",
							children: "Wait for the circle, or step out."
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "border border-line px-4 py-3 text-moon",
							onClick: () => sessionRef.current?.leave(),
							children: "Leave the cul-de-sac"
						})]
					})
				]
			}) : null
		]
	});
}
function Menu(props) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mt-6 flex flex-col gap-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "flex flex-col gap-1 text-sm text-muted",
				children: ["Name in the dream", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					value: props.name,
					maxLength: 16,
					onChange: (e) => props.onName(e.target.value),
					className: "border border-line bg-surface px-3 py-3 text-fg outline-none"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "bg-blood px-4 py-3 text-left text-fg",
				onClick: props.onDreamer,
				children: "Start as Dreamer"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "border border-line px-4 py-3 text-left text-moon",
				onClick: props.onMonster,
				children: "Play as the Somnarch"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "border border-line px-4 py-3 text-left text-fg",
				onClick: props.onHost,
				children: "Open a circle"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "flex gap-2",
				onSubmit: (e) => {
					e.preventDefault();
					props.onJoin();
				},
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					value: props.joinCode,
					maxLength: 4,
					placeholder: "CODE",
					"aria-label": "Circle code",
					onChange: (e) => props.onJoinCode(e.target.value.toUpperCase()),
					className: "w-28 border border-line bg-surface px-3 py-3 tracking-widest text-fg uppercase outline-none"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "submit",
					className: "flex-1 border border-line px-4 py-3 text-moon",
					children: "Join circle"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-2 border-t border-line pt-4 text-sm leading-relaxed text-muted",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Gather four latch-keys, then hold wake at the clock altar. You become Lucid." }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2",
						children: "Lucid souls tether the others awake and can cut the Somnarch. It cannot die while anyone still sleeps."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2",
						children: "The dream ends when the living are awake and the Somnarch is unmade — or when it stitches every dreamer under."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2",
						children: "Circles are for friends on a direct link, not a ranked pit. Empty souls are filled by the dream."
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "text-left text-sm text-moon",
				onClick: props.onMute,
				children: props.muted ? "Sound is sealed" : "Sound is open"
			})
		]
	});
}
function Lobby(props) {
	const mine = props.screen.members.find((m) => m.state === "you");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mt-6 flex flex-col gap-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "font-display text-3xl tracking-widest text-moon",
				children: props.screen.code
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Share the code. Five seats. One Somnarch, four dreamers. The dream fills empty chairs."
			}),
			props.screen.note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-moon",
				children: props.screen.note
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "flex flex-col gap-2",
				children: props.screen.members.map((member) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "flex items-center justify-between gap-3 border border-line px-3 py-2 text-sm",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [member.name, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "text-muted",
						children: [" · ", member.state]
					})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: member.want === "somnarch" ? "text-blood" : "text-moon",
						children: member.seated ? member.want === "somnarch" ? "Somnarch" : "Dreamer" : "Outside"
					})]
				}, member.id))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "flex-1 border border-line px-3 py-3 text-fg",
					onClick: () => props.onWant("dreamer"),
					children: "Dreamer"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "flex-1 border border-blood px-3 py-3 text-blood",
					onClick: () => props.onWant("somnarch"),
					children: "Somnarch"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "text-xs text-muted",
				children: [
					"You are set to ",
					mine?.want === "somnarch" ? "the Somnarch" : "a dreamer",
					"."
				]
			}),
			props.screen.host ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "bg-blood px-4 py-3 text-fg",
				onClick: props.onBegin,
				children: "Begin the dream"
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Waiting for the host to begin."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "text-left text-sm text-moon",
				onClick: props.onLeave,
				children: "Leave the circle"
			})
		]
	});
}
function TouchPad({ session }) {
	const drag = (0, import_react.useRef)(null);
	const look = (0, import_react.useRef)(null);
	const [knob, setKnob] = (0, import_react.useState)({
		x: 0,
		y: 0
	});
	function stick(clientX, clientY) {
		const origin = drag.current;
		if (!origin) return;
		const dx = clientX - origin.x;
		const dy = clientY - origin.y;
		const max = 52;
		const mag = Math.hypot(dx, dy);
		const clamped = mag > max ? max / mag : 1;
		const kx = dx * clamped;
		const ky = dy * clamped;
		setKnob({
			x: kx,
			y: ky
		});
		const nx = kx / max;
		const ny = ky / max;
		const m = Math.hypot(nx, ny);
		if (m < .2) session.current?.setStick(0, 0);
		else {
			const s = (m - .2) / .8 / m;
			session.current?.setStick(nx * s, -ny * s);
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "pointer-events-none absolute inset-0 z-20",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "pointer-events-auto absolute bottom-6 left-4 h-32 w-32 rounded-full border border-line bg-surface/70 touch-none",
				onPointerDown: (e) => {
					e.currentTarget.setPointerCapture(e.pointerId);
					drag.current = {
						id: e.pointerId,
						x: e.clientX,
						y: e.clientY
					};
					stick(e.clientX, e.clientY);
				},
				onPointerMove: (e) => {
					if (drag.current?.id === e.pointerId) stick(e.clientX, e.clientY);
				},
				onPointerUp: (e) => {
					if (drag.current?.id !== e.pointerId) return;
					drag.current = null;
					setKnob({
						x: 0,
						y: 0
					});
					session.current?.setStick(0, 0);
				},
				onPointerCancel: () => {
					drag.current = null;
					setKnob({
						x: 0,
						y: 0
					});
					session.current?.setStick(0, 0);
				},
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "absolute top-1/2 left-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-moon",
					style: { transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "pointer-events-auto absolute inset-y-28 right-0 left-1/2 touch-none",
				onPointerDown: (e) => {
					if (e.target.closest("button")) return;
					look.current = {
						id: e.pointerId,
						x: e.clientX,
						y: e.clientY
					};
					e.currentTarget.setPointerCapture(e.pointerId);
				},
				onPointerMove: (e) => {
					if (look.current?.id !== e.pointerId) return;
					session.current?.addLook((e.clientX - look.current.x) * .005, (e.clientY - look.current.y) * .004);
					look.current = {
						id: e.pointerId,
						x: e.clientX,
						y: e.clientY
					};
				},
				onPointerUp: () => {
					look.current = null;
				},
				onPointerCancel: () => {
					look.current = null;
				}
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "pointer-events-auto absolute right-3 bottom-6 grid grid-cols-2 gap-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TouchButton, {
						label: "Strike",
						on: (down) => session.current?.setTouchFlag("atk", down)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TouchButton, {
						label: "Dodge",
						on: (down) => session.current?.setTouchFlag("dash", down)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TouchButton, {
						label: "Wake",
						on: (down) => session.current?.setTouchFlag("interact", down)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TouchButton, {
						label: "Item",
						on: (down) => session.current?.setTouchFlag("use", down)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TouchButton, {
						label: "Pulse",
						on: (down) => session.current?.setTouchFlag("abl", down)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TouchButton, {
						label: "Sprint",
						on: (down) => session.current?.setTouchFlag("sprint", down)
					})
				]
			})
		]
	});
}
function TouchButton({ label, on }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type: "button",
		className: "h-14 w-14 border border-line bg-surface/80 text-xs text-fg touch-none",
		onPointerDown: (e) => {
			e.currentTarget.setPointerCapture(e.pointerId);
			on(true);
		},
		onPointerUp: () => on(false),
		onPointerCancel: () => on(false),
		children: label
	});
}
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DreamApp, {});
}
//#endregion
export { Home as component };
