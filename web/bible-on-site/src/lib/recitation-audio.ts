type Range = { startMs: number; endMs: number };
type Plan = {
	ranges: Range[];
	pauseMs: number;
	leadMs: number;
	ended: () => void;
};
type ScheduledRange = Range & { startsAt: number; endsAt: number };

/** Play exact decoded sample ranges; HTMLMediaElement MP3 seeks can start late. */
export class RecitationAudio {
	private context = new AudioContext();
	private controller = new AbortController();
	private buffer: Promise<AudioBuffer> | null = null;
	private sources: AudioBufferSourceNode[] = [];
	private gain: GainNode | null = null;
	private decoded: AudioBuffer | null = null;
	private speed = 1;
	private volume = 1;
	private generation = 0;
	private disposed = false;
	private activePlan:
		| (Plan & { scheduled: ScheduledRange[]; speed: number })
		| null = null;
	private pausedPlan: Plan | null = null;

	constructor(
		private url: string,
		private sha256: string,
		private onProgress: (percent: number | null) => void = () => {},
	) {}

	private async recordingBytes(response: Response): Promise<ArrayBuffer> {
		const total = Number(response.headers.get("content-length"));
		const knownSize = Number.isFinite(total) && total > 0;
		this.onProgress(knownSize ? 0 : null);
		if (!response.body) {
			const bytes = await response.arrayBuffer();
			this.onProgress(100);
			return bytes;
		}
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let received = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
				received += value.byteLength;
				this.onProgress(
					knownSize ? Math.min(100, (received / total) * 100) : null,
				);
			}
		} finally {
			reader.releaseLock();
		}
		const bytes = new Uint8Array(received);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		this.onProgress(100);
		return bytes.buffer;
	}

	async prepare(): Promise<void> {
		if (this.disposed) throw new Error("Player disposed");
		await this.load();
	}

	private load(): Promise<AudioBuffer> {
		if (!this.buffer) {
			this.buffer = (async () => {
				const response = await fetch(this.url, {
					signal: this.controller.signal,
				});
				if (!response.ok) throw new Error("Unable to download recording");
				const bytes = await this.recordingBytes(response);
				const hash = Array.from(
					new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
					(value) => value.toString(16).padStart(2, "0"),
				).join("");
				if (hash !== this.sha256)
					throw new Error("Recording differs from aligned source");
				if (this.disposed) throw new Error("Player disposed");
				// The same pinned decoder runs in the app. Platform MP3 decoders
				// disagree about the sample origin even when their lengths agree.
				const { MPEGDecoderWebWorker } = await import("mpg123-decoder");
				const decoder = new MPEGDecoderWebWorker();
				try {
					await decoder.ready;
					const pcm = await decoder.decode(new Uint8Array(bytes));
					if (pcm.errors.length || !pcm.samplesDecoded)
						throw new Error("Recording could not be decoded accurately");
					if (this.disposed) throw new Error("Player disposed");
					const buffer = this.context.createBuffer(
						pcm.channelData.length,
						pcm.samplesDecoded,
						pcm.sampleRate,
					);
					pcm.channelData.forEach((samples, channel) => {
						buffer.getChannelData(channel).set(samples);
					});
					this.decoded = buffer;
					return buffer;
				} finally {
					await decoder.free();
				}
			})().catch((error) => {
				this.buffer = null;
				throw error;
			});
		}
		return this.buffer;
	}

	/** Apply speed/volume without losing the original source position. */
	setOptions(speed: number, volume: number) {
		if (
			!Number.isFinite(speed) ||
			speed < 0.5 ||
			speed > 2 ||
			!Number.isFinite(volume) ||
			volume < 0 ||
			volume > 1
		)
			throw new Error("Invalid playback settings");
		this.volume = volume;
		if (this.gain) this.gain.gain.value = volume;
		if (speed === this.speed) return;
		const remaining = this.remainingPlan();
		this.speed = speed;
		if (this.activePlan && remaining && this.decoded) {
			this.stopSources();
			this.schedule(this.decoded, remaining);
		}
	}

	async play(
		startMs: number,
		endMs: number | undefined,
		ended: () => void,
	): Promise<boolean> {
		return this.playRanges([{ startMs, endMs }], 0, ended);
	}

	async playRanges(
		ranges: { startMs: number; endMs?: number }[],
		pauseMs: number,
		ended: () => void,
	): Promise<boolean> {
		if (this.disposed) throw new Error("Player disposed");
		this.stop();
		const generation = this.generation;
		// Resume in the user gesture, before the download (mobile autoplay).
		const [buffer] = await Promise.all([this.load(), this.context.resume()]);
		if (this.disposed || generation !== this.generation) return false;
		const intervals = ranges.map((r) => ({
			startMs: r.startMs,
			endMs: r.endMs ?? buffer.duration * 1000,
		}));
		if (
			!intervals.length ||
			!Number.isFinite(pauseMs) ||
			pauseMs < 0 ||
			pauseMs > 5000 ||
			intervals.some(
				(r) =>
					!Number.isFinite(r.startMs) ||
					!Number.isFinite(r.endMs) ||
					r.startMs < 0 ||
					r.endMs <= r.startMs ||
					r.endMs / 1000 > buffer.duration,
			)
		)
			throw new Error("Clip outside decoded recording");
		this.schedule(buffer, { ranges: intervals, pauseMs, leadMs: 0, ended });
		return true;
	}

	private schedule(buffer: AudioBuffer, plan: Plan) {
		this.gain ??= this.context.createGain();
		this.gain.gain.value = this.volume;
		this.gain.disconnect();
		this.gain.connect(this.context.destination);
		const generation = this.generation;
		let cursor = this.context.currentTime + plan.leadMs / 1000;
		const scheduled: ScheduledRange[] = [];
		this.sources = plan.ranges.map((range, index) => {
			const source = this.context.createBufferSource();
			source.buffer = buffer;
			source.playbackRate.value = this.speed;
			source.connect(this.gain as GainNode);
			const startsAt = cursor;
			const endsAt =
				startsAt + (range.endMs - range.startMs) / 1000 / this.speed;
			scheduled.push({ ...range, startsAt, endsAt });
			cursor = endsAt + plan.pauseMs / 1000;
			source.onended = () => {
				source.disconnect();
				if (index !== plan.ranges.length - 1 || generation !== this.generation)
					return;
				this.sources = [];
				this.activePlan = null;
				plan.ended();
			};
			// Both boundaries and inter-verse gaps are scheduled by the audio clock.
			source.start(
				index === 0 && plan.leadMs === 0 ? 0 : startsAt,
				range.startMs / 1000,
				(range.endMs - range.startMs) / 1000,
			);
			return source;
		});
		this.activePlan = { ...plan, scheduled, speed: this.speed };
	}

	playChapter(ended: () => void): Promise<boolean> {
		return this.play(0, undefined, ended);
	}

	/** Original recording position, or null during a deliberate verse pause. */
	get positionMs(): number | null {
		const plan = this.activePlan;
		if (!plan)
			return this.pausedPlan && this.pausedPlan.leadMs === 0
				? this.pausedPlan.ranges[0].startMs
				: null;
		const now = this.context.currentTime;
		const range = plan.scheduled.find(
			(r) => now >= r.startsAt && now < r.endsAt,
		);
		return range
			? range.startMs + (now - range.startsAt) * 1000 * plan.speed
			: null;
	}

	private remainingPlan(): Plan | null {
		const plan = this.activePlan;
		if (!plan) return null;
		const now = this.context.currentTime;
		const index = plan.scheduled.findIndex((r) => now < r.endsAt);
		if (index < 0) return null;
		const range = plan.scheduled[index];
		const startMs =
			now > range.startsAt
				? range.startMs + (now - range.startsAt) * 1000 * plan.speed
				: range.startMs;
		return {
			ranges: [
				{ startMs, endMs: range.endMs },
				...plan.ranges.slice(index + 1),
			],
			leadMs: Math.max(0, (range.startsAt - now) * 1000),
			pauseMs: plan.pauseMs,
			ended: plan.ended,
		};
	}

	pause(): boolean {
		const plan = this.activePlan;
		const remaining = this.remainingPlan();
		if (!plan) return false;
		this.stop();
		if (!remaining) {
			plan.ended();
			return false;
		}
		this.pausedPlan = remaining;
		return true;
	}

	async resume(): Promise<boolean> {
		const plan = this.pausedPlan;
		if (!plan) return false;
		this.stop();
		const generation = this.generation;
		const [buffer] = await Promise.all([this.load(), this.context.resume()]);
		if (this.disposed || generation !== this.generation) return false;
		this.schedule(buffer, plan);
		return true;
	}

	private stopSources() {
		this.generation++;
		for (const source of this.sources) {
			source.onended = null;
			source.stop();
			source.disconnect();
		}
		this.sources = [];
		this.activePlan = null;
	}

	stop() {
		this.stopSources();
		this.pausedPlan = null;
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.stop();
		this.controller.abort();
		this.buffer = null;
		this.decoded = null;
		this.gain?.disconnect();
		void this.context.close().catch(() => {});
	}
}
