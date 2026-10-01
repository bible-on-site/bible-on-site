type Clip = { startMs: number; endMs: number; ended: () => void };

/** Play exact decoded sample ranges; HTMLMediaElement MP3 seeks can start late. */
export class RecitationAudio {
	private context = new AudioContext();
	private controller = new AbortController();
	private buffer: Promise<AudioBuffer> | null = null;
	private source: AudioBufferSourceNode | null = null;
	private generation = 0;
	private disposed = false;
	private activeClip: (Clip & { startedAt: number }) | null = null;
	private pausedClip: Clip | null = null;

	constructor(
		private url: string,
		private sha256: string,
	) {}

	private load(): Promise<AudioBuffer> {
		if (!this.buffer) {
			this.buffer = (async () => {
				const response = await fetch(this.url, {
					signal: this.controller.signal,
				});
				if (!response.ok) throw new Error("Unable to download recording");
				const bytes = await response.arrayBuffer();
				const hash = Array.from(
					new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
					(value) => value.toString(16).padStart(2, "0"),
				).join("");
				if (hash !== this.sha256)
					throw new Error("Recording differs from aligned source");
				if (this.disposed) throw new Error("Player disposed");
				return this.context.decodeAudioData(bytes);
			})().catch((error) => {
				this.buffer = null;
				throw error;
			});
		}
		return this.buffer;
	}

	async play(
		startMs: number,
		endMs: number,
		ended: () => void,
	): Promise<boolean> {
		if (this.disposed) throw new Error("Player disposed");
		this.stop();
		const generation = this.generation;
		// Resume during the click gesture, before awaiting the download (mobile autoplay).
		const [buffer] = await Promise.all([this.load(), this.context.resume()]);
		if (this.disposed || generation !== this.generation) return false;
		if (
			!Number.isFinite(startMs) ||
			!Number.isFinite(endMs) ||
			startMs < 0 ||
			endMs <= startMs ||
			endMs / 1000 > buffer.duration
		) {
			throw new Error("Clip outside decoded recording");
		}
		const source = this.context.createBufferSource();
		source.buffer = buffer;
		source.connect(this.context.destination);
		source.onended = () => {
			if (this.source !== source) return;
			this.source = null;
			this.activeClip = null;
			source.disconnect();
			ended();
		};
		this.source = source;
		this.activeClip = {
			startMs,
			endMs,
			ended,
			startedAt: this.context.currentTime,
		};
		// Duration is scheduled by the audio clock, never a JavaScript stop timer.
		source.start(0, startMs / 1000, (endMs - startMs) / 1000);
		return true;
	}

	pause(): boolean {
		const clip = this.activeClip;
		if (!clip || !this.source) return false;
		const startMs = Math.min(
			clip.endMs,
			clip.startMs + (this.context.currentTime - clip.startedAt) * 1000,
		);
		this.stop();
		if (startMs >= clip.endMs) {
			clip.ended();
			return false;
		}
		this.pausedClip = { startMs, endMs: clip.endMs, ended: clip.ended };
		return true;
	}

	resume(): Promise<boolean> {
		const clip = this.pausedClip;
		return clip
			? this.play(clip.startMs, clip.endMs, clip.ended)
			: Promise.resolve(false);
	}

	stop() {
		this.activeClip = null;
		this.pausedClip = null;
		this.generation++;
		if (this.source) {
			this.source.onended = null;
			this.source.stop();
			this.source.disconnect();
			this.source = null;
		}
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.stop();
		this.controller.abort();
		this.buffer = null;
		void this.context.close().catch(() => {});
	}
}
