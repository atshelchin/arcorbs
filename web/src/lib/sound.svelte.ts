import { browser } from '$app/env';

/**
 * Every sound the game makes. They are synthesised as they are needed, so
 * there are no audio files to load, and none to wait for.
 *
 * A browser only lets a page make sound once it has been touched. Each sound
 * here follows a press — the pull itself, or the wait and the reveal that
 * come out of it — so the audio context is made on first use.
 */

const REMEMBERED = 'arc-orbs:muted';
const VOLUME = 0.9;

/** C6 upward, in thirds and fifths: the notes the coins ring. */
const CHIMES = [1046.5, 1318.5, 1568, 2093, 2637, 3136, 4186];
/** How many of them a reveal rings, by tier. */
const CHIME_COUNT = [2, 3, 5, 7] as const;

interface Tone {
	type?: OscillatorType;
	from: number;
	to?: number;
	/** Seconds from now. */
	at?: number;
	length: number;
	gain: number;
	/** Swells toward the end instead of dying away from the start. */
	rising?: boolean;
}

interface Hiss {
	from: number;
	to: number;
	at?: number;
	length: number;
	gain: number;
	/** Swells toward the end instead of dying away from the start. */
	rising?: boolean;
}

class Sound {
	muted = $state(false);

	#context: AudioContext | undefined;
	#out: GainNode | undefined;
	#noise: AudioBuffer | undefined;
	/** Stops the hum that plays while a pull is out for signature and confirmation. */
	#stopBed: (() => void) | undefined;

	constructor() {
		if (!browser) return;
		try {
			this.muted = localStorage.getItem(REMEMBERED) === '1';
		} catch {
			// Storage is off limits here; sound starts on.
		}
	}

	toggle() {
		this.muted = !this.muted;
		try {
			localStorage.setItem(REMEMBERED, this.muted ? '1' : '0');
		} catch {
			// Not remembered, then.
		}
		if (this.muted) this.settle();
		else this.tap();
	}

	/**
	 * Gets the audio going. A new context takes a moment to start, so the page
	 * calls this on the first touch anywhere, and the first real sound is on time.
	 */
	wake() {
		this.#ready();
	}

	/** A press that starts something. */
	tap() {
		this.#tone({ type: 'triangle', from: 520, to: 880, length: 0.16, gain: 0.45 });
		this.#tone({ from: 1760, length: 0.05, gain: 0.18 });
	}

	/** The pull is out for signature and confirmation: a hum that winds up and holds. */
	charge() {
		const audio = this.#ready();
		if (!audio || this.#stopBed) return;
		const { context, out } = audio;
		const now = context.currentTime;

		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, now);
		gain.gain.exponentialRampToValueAtTime(0.5, now + 1.4);

		// Air: noise through a filter that opens as the arc winds up.
		const source = context.createBufferSource();
		source.buffer = this.#noiseBuffer(context);
		source.loop = true;
		const filter = context.createBiquadFilter();
		filter.type = 'bandpass';
		filter.Q.value = 1.4;
		filter.frequency.setValueAtTime(300, now);
		filter.frequency.exponentialRampToValueAtTime(1500, now + 2.6);
		const air = context.createGain();
		air.gain.value = 0.55;
		source.connect(filter).connect(air).connect(gain);

		// And a pitch that climbs with it. Noise alone is lost on a laptop's speakers.
		const whir = [0, 7].map((detune) => {
			const oscillator = context.createOscillator();
			oscillator.type = 'triangle';
			oscillator.detune.value = detune;
			oscillator.frequency.setValueAtTime(196, now);
			oscillator.frequency.exponentialRampToValueAtTime(523, now + 2.6);
			const level = context.createGain();
			level.gain.value = 0.22;
			oscillator.connect(level).connect(gain);
			oscillator.start();
			return oscillator;
		});

		// The arc turning: the whole thing beats, faster as it winds up.
		const beat = context.createOscillator();
		beat.frequency.setValueAtTime(4, now);
		beat.frequency.linearRampToValueAtTime(11, now + 3);
		const depth = context.createGain();
		depth.gain.value = 0.2;
		beat.connect(depth).connect(gain.gain);

		gain.connect(out);
		source.start();
		beat.start();

		this.#stopBed = () => {
			const end = context.currentTime + 0.3;
			gain.gain.cancelScheduledValues(context.currentTime);
			gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.08);
			source.stop(end);
			beat.stop(end);
			for (const oscillator of whir) oscillator.stop(end);
		};
	}

	/** The wait is over, one way or the other. */
	settle() {
		this.#stopBed?.();
		this.#stopBed = undefined;
	}

	/** An orb leaves the arc and flies at the viewer for `seconds`. */
	fly(seconds: number) {
		this.settle();
		if (seconds <= 0) return;
		this.#hiss({ from: 500, to: 4200, length: seconds, gain: 0.5, rising: true });
		this.#tone({
			type: 'triangle',
			from: 330,
			to: 1320,
			length: seconds,
			gain: 0.22,
			rising: true
		});
	}

	/** The orb breaks open: a thump, and more coins ringing the better the prize. */
	burst(tier: 0 | 1 | 2 | 3) {
		// The thump has a part small speakers can carry, and one only good ones can.
		this.#tone({ from: 190, to: 48, length: 0.26, gain: 0.4 });
		this.#tone({ type: 'triangle', from: 520, to: 130, length: 0.16, gain: 0.28 });
		this.#hiss({ from: 2400, to: 600, length: 0.22, gain: 0.32 });

		const count = CHIME_COUNT[tier];
		for (let i = 0; i < count; i++) {
			const at = 0.07 + i * 0.075;
			this.#tone({ type: 'triangle', from: CHIMES[i], at, length: 0.7, gain: 0.3 });
			this.#tone({ from: CHIMES[i] * 2, at, length: 0.32, gain: 0.1 });
		}
		if (tier === 3) {
			// A jackpot holds its chord.
			const at = 0.07 + count * 0.075;
			for (const note of [CHIMES[0], CHIMES[1], CHIMES[2], CHIMES[3]]) {
				this.#tone({ type: 'triangle', from: note, at, length: 1.6, gain: 0.2 });
			}
		}
	}

	/** Something was made: a drop funded. */
	success() {
		this.#tone({ type: 'triangle', from: CHIMES[1], length: 0.45, gain: 0.36 });
		this.#tone({ type: 'triangle', from: CHIMES[3], at: 0.11, length: 0.7, gain: 0.36 });
	}

	/** It did not happen. */
	fail() {
		this.settle();
		this.#tone({ type: 'triangle', from: 392, to: 294, length: 0.22, gain: 0.42 });
		this.#tone({ type: 'triangle', from: 294, to: 196, at: 0.18, length: 0.32, gain: 0.42 });
	}

	#ready(): { context: AudioContext; out: GainNode } | undefined {
		if (!browser || this.muted) return;
		try {
			if (!this.#context) {
				this.#context = new AudioContext();
				this.#out = this.#context.createGain();
				this.#out.gain.value = VOLUME;
				// Many coins ring at once on a good pull; this keeps the sum from clipping.
				const limiter = this.#context.createDynamicsCompressor();
				limiter.threshold.value = -8;
				limiter.ratio.value = 12;
				limiter.attack.value = 0.003;
				limiter.release.value = 0.2;
				this.#out.connect(limiter).connect(this.#context.destination);
			}
			if (this.#context.state === 'suspended') void this.#context.resume();
			return { context: this.#context, out: this.#out! };
		} catch {
			// No audio on this device. The game is the same without it.
			return;
		}
	}

	#noiseBuffer(context: AudioContext): AudioBuffer {
		if (!this.#noise) {
			this.#noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
			const samples = this.#noise.getChannelData(0);
			for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
		}
		return this.#noise;
	}

	/** One note: quick to speak, then dying away — or, rising, the other way round. */
	#tone({ type = 'sine', from, to, at = 0, length, gain, rising = false }: Tone) {
		const audio = this.#ready();
		if (!audio) return;
		const { context, out } = audio;
		const start = context.currentTime + at;
		const end = start + length;

		const oscillator = context.createOscillator();
		oscillator.type = type;
		oscillator.frequency.setValueAtTime(from, start);
		if (to) oscillator.frequency.exponentialRampToValueAtTime(to, end);

		// A note falls to a fiftieth of its level over its length. Falling much
		// further than that leaves only a click of it audible.
		const envelope = context.createGain();
		const quiet = gain * 0.02;
		if (rising) {
			envelope.gain.setValueAtTime(quiet, start);
			envelope.gain.exponentialRampToValueAtTime(gain, end - 0.01);
		} else {
			envelope.gain.setValueAtTime(0, start);
			envelope.gain.linearRampToValueAtTime(gain, start + 0.006);
			envelope.gain.exponentialRampToValueAtTime(quiet, end - 0.01);
		}
		envelope.gain.linearRampToValueAtTime(0, end);

		oscillator.connect(envelope).connect(out);
		oscillator.start(start);
		oscillator.stop(end + 0.02);
	}

	/** A sweep of filtered noise: air moving, or something breaking. */
	#hiss({ from, to, at = 0, length, gain, rising = false }: Hiss) {
		const audio = this.#ready();
		if (!audio) return;
		const { context, out } = audio;
		const start = context.currentTime + at;

		const source = context.createBufferSource();
		source.buffer = this.#noiseBuffer(context);
		const filter = context.createBiquadFilter();
		filter.type = 'bandpass';
		filter.Q.value = 0.9;
		filter.frequency.setValueAtTime(from, start);
		filter.frequency.exponentialRampToValueAtTime(to, start + length);
		const envelope = context.createGain();
		const quiet = gain * 0.02;
		envelope.gain.setValueAtTime(rising ? quiet : gain, start);
		envelope.gain.exponentialRampToValueAtTime(rising ? gain : quiet, start + length - 0.01);
		envelope.gain.linearRampToValueAtTime(0, start + length);

		source.connect(filter).connect(envelope).connect(out);
		source.start(start);
		source.stop(start + length + 0.02);
	}
}

export const sound = new Sound();
