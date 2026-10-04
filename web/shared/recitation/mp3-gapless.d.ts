export type Mp3Gapless = {
	sampleRate: number;
	rawSamples: number;
	samples: number;
	skip: number;
	discard: number;
};

declare global {
	var recitationMp3: {
		read(bytes: ArrayBuffer | Uint8Array): Mp3Gapless | null;
		normalize(
			decoded: AudioBuffer,
			metadata: Mp3Gapless | null,
			context: AudioContext,
		): AudioBuffer;
	};
}
