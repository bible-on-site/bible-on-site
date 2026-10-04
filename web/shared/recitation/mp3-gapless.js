/* Shared by the website and the native WebView audio bridge. */
(() => {
	/**
	 * Match the MP3 demuxer's time origin used by alignment:
	 * https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/mp3dec.c
	 * MPEG Layer III synthesis latency is 528 + 1 samples; LAME stores encoder
	 * delay and padding separately. This is codec metadata, never word padding.
	 */
	function read(input) {
		const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
		const text = (offset, length) =>
			String.fromCharCode(...bytes.subarray(offset, offset + length));
		let offset = 0;
		if (bytes.length >= 10 && text(0, 3) === "ID3") {
			const size =
				((bytes[6] & 127) << 21) |
				((bytes[7] & 127) << 14) |
				((bytes[8] & 127) << 7) |
				(bytes[9] & 127);
			offset = 10 + size;
		}
		const limit = Math.min(bytes.length - 4, offset + 8192);
		for (; offset < limit; offset++) {
			if (bytes[offset] !== 255 || (bytes[offset + 1] & 224) !== 224) continue;
			const version = (bytes[offset + 1] >> 3) & 3;
			const layer = (bytes[offset + 1] >> 1) & 3;
			const frequency = (bytes[offset + 2] >> 2) & 3;
			const bitrate = bytes[offset + 2] >> 4;
			if (
				version === 1 ||
				layer !== 1 ||
				frequency === 3 ||
				bitrate === 0 ||
				bitrate === 15
			)
				continue;
			const mono = bytes[offset + 3] >> 6 === 3;
			const sideInfo = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
			let position = offset + 4 + sideInfo;
			if (!["Xing", "Info"].includes(text(position, 4))) return null;
			if (position + 8 > bytes.length) return null;
			const view = new DataView(
				bytes.buffer,
				bytes.byteOffset,
				bytes.byteLength,
			);
			const flags = view.getUint32(position + 4);
			position += 8;
			if (!(flags & 1) || position + 4 > bytes.length) return null;
			const frames = view.getUint32(position);
			position +=
				4 + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
			if (
				position + 24 > bytes.length ||
				!["LAME", "Lavf", "Lavc"].includes(text(position, 4))
			)
				return null;
			const delay = (bytes[position + 21] << 4) | (bytes[position + 22] >> 4);
			const padding = ((bytes[position + 22] & 15) << 8) | bytes[position + 23];
			const sampleRate =
				[44100, 48000, 32000][frequency] /
				(version === 3 ? 1 : version === 2 ? 2 : 4);
			const rawSamples = frames * (version === 3 ? 1152 : 576);
			const skip = delay + 529;
			const discard = Math.max(0, padding - 529);
			const samples = rawSamples - skip - discard;
			if (!frames || samples <= 0)
				throw new Error("Invalid MP3 gapless metadata");
			return { sampleRate, rawSamples, samples, skip, discard };
		}
		return null;
	}

	function normalize(decoded, metadata, context) {
		if (!metadata) return decoded;
		const scale = decoded.sampleRate / metadata.sampleRate;
		const expected = Math.round(metadata.samples * scale);
		// Audio resamplers may round one final sample differently.
		if (Math.abs(decoded.length - expected) <= 1) return decoded;
		const raw = Math.round(metadata.rawSamples * scale);
		if (Math.abs(decoded.length - raw) > 1)
			throw new Error("Unsupported MP3 decoder time origin");
		const first = Math.round(metadata.skip * scale);
		if (first + expected > decoded.length)
			throw new Error("Truncated MP3 decoder output");
		const corrected = context.createBuffer(
			decoded.numberOfChannels,
			expected,
			decoded.sampleRate,
		);
		for (let channel = 0; channel < decoded.numberOfChannels; channel++)
			corrected.copyToChannel(
				decoded.getChannelData(channel).subarray(first, first + expected),
				channel,
			);
		return corrected;
	}

	globalThis.recitationMp3 = { read, normalize };
})();
