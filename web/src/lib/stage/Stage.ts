import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * The scene behind a drop: a USDC coin, and around it an arc of orbs — one per
 * prize, lit while it can still be drawn. Arc's blocks run along the outer
 * ring as they are produced. Drawing spins the arc up; the reveal throws one
 * orb at the camera and breaks it open. A sideways drag turns the arc by hand.
 *
 * Colours above 1 are deliberate: only they cross the bloom threshold.
 */

const RING_RADIUS = 3.2;
const OUTER_RADIUS = RING_RADIUS * 1.3;
const MAX_ORBS = 72;
const MAX_PULSES = 8;
const MAX_COINS = 140;
const MAX_SPARKS = 320;
const FOV = 36;
const TARGET = new THREE.Vector3(0, 0.15, 0);

const IDLE_SPIN = 0.16;
const CHARGED_SPIN = 5.2;

/** Coins and sparks thrown by a reveal, by tier. */
const BURST = [
	{ coins: 14, sparks: 60 },
	{ coins: 36, sparks: 120 },
	{ coins: 80, sparks: 220 },
	{ coins: MAX_COINS, sparks: MAX_SPARKS }
] as const;

interface Pulse {
	mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
	angle: number;
	life: number;
}

interface Particle {
	position: THREE.Vector3;
	velocity: THREE.Vector3;
	axis: THREE.Vector3;
	spin: number;
	age: number;
	life: number;
}

interface Reveal {
	tier: 0 | 1 | 2 | 3;
	orb: number;
	from: THREE.Vector3;
	time: number;
	burst: boolean;
	done: () => void;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function glowTexture(inner: string, outer: string): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 128;
	const context = canvas.getContext('2d')!;
	const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
	gradient.addColorStop(0, inner);
	gradient.addColorStop(1, outer);
	context.fillStyle = gradient;
	context.fillRect(0, 0, 128, 128);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

/** The coin's face: a dollar sign, which is all Arc's gas coin needs to say. */
function coinFaceTexture(): THREE.CanvasTexture {
	const size = 512;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const context = canvas.getContext('2d')!;
	const gradient = context.createRadialGradient(
		size * 0.38,
		size * 0.32,
		20,
		size / 2,
		size / 2,
		size / 2
	);
	gradient.addColorStop(0, '#5aa9ff');
	gradient.addColorStop(0.6, '#2775ca');
	gradient.addColorStop(1, '#174f93');
	context.fillStyle = gradient;
	context.fillRect(0, 0, size, size);

	context.strokeStyle = 'rgba(255,255,255,0.85)';
	context.lineWidth = 14;
	context.beginPath();
	context.arc(size / 2, size / 2, size * 0.39, Math.PI * 0.12, Math.PI * 0.88);
	context.stroke();
	context.beginPath();
	context.arc(size / 2, size / 2, size * 0.39, Math.PI * 1.12, Math.PI * 1.88);
	context.stroke();

	context.fillStyle = '#ffffff';
	context.font = `700 ${size * 0.5}px "Plus Jakarta Sans Variable", system-ui, sans-serif`;
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	context.fillText('$', size / 2, size * 0.53);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	// A cylinder's caps are mapped a quarter turn round from how the coin stands.
	texture.center.set(0.5, 0.5);
	texture.rotation = Math.PI / 2;
	return texture;
}

export class Stage {
	#canvas: HTMLCanvasElement;
	#renderer: THREE.WebGLRenderer;
	#composer: EffectComposer;
	#bloom: UnrealBloomPass;
	#scene = new THREE.Scene();
	#camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
	#cameraHome = new THREE.Vector3();
	#lookAt = TARGET.clone();
	/** How far right of centre the scene sits on a wide screen, as a share of half the width. */
	#shift: number;

	/** Tilted to face the camera; `#spinner` turns inside it. */
	#tilt = new THREE.Group();
	#spinner = new THREE.Group();
	#orbs: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
	#orbCount = 0;
	#orbsDrawn = 0;
	#orbScale = 0.2;

	#coin: THREE.Mesh;
	#halo: THREE.Sprite;
	#stars: THREE.Points;
	#dust: THREE.Points;
	#pulses: Pulse[] = [];

	#hero: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
	#flash: THREE.Sprite;
	#coins: THREE.InstancedMesh;
	#coinParticles: Particle[] = [];
	#sparks: THREE.Points;
	#sparkParticles: Particle[] = [];

	#energy = 0;
	#charging = false;
	#reveal: Reveal | null = null;
	#pop = 0;
	#pointer = new THREE.Vector2();
	/** The pointer turning the arc, and where it last was. */
	#drag: { id: number; x: number } | null = null;
	/** Spin left over from a drag, in radians a second. */
	#fling = 0;
	#calm: boolean;

	#timer = new THREE.Timer();
	#frame = 0;
	#visible = true;
	#resizeObserver: ResizeObserver;
	#intersectionObserver: IntersectionObserver;
	#disposables: { dispose(): void }[] = [];

	constructor(canvas: HTMLCanvasElement, options: { shift?: number } = {}) {
		this.#canvas = canvas;
		this.#shift = options.shift ?? 0;
		this.#calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

		this.#renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'high-performance' });
		// Bloom is the cost here, and it scales with pixels, so a 3x screen is drawn at 2x.
		this.#renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.#scene.background = new THREE.Color('#0d0c0b');

		this.#scene.add(new THREE.HemisphereLight('#bcd7ff', '#2a1208', 1.1));
		const key = new THREE.DirectionalLight('#ffd9c2', 3.2);
		key.position.set(4, 6, 7);
		const rim = new THREE.PointLight('#4c9bf0', 60, 30);
		rim.position.set(-6, 2, -5);
		const warm = new THREE.PointLight('#f0623a', 40, 30);
		warm.position.set(5, -3, 3);
		this.#scene.add(key, rim, warm);

		this.#stars = this.#buildStars();
		this.#dust = this.#buildDust();
		this.#halo = this.#buildHalo();
		this.#coin = this.#buildCoin();
		this.#orbs = this.#buildRing();
		this.#hero = this.#buildHero();
		this.#flash = this.#buildFlash();
		this.#coins = this.#buildCoins();
		this.#sparks = this.#buildSparks();

		// The scene is drawn into the composer's target, not the canvas, so
		// that is where the orbs' edges have to be smoothed.
		const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
		this.#composer = new EffectComposer(this.#renderer, target);
		this.#composer.addPass(new RenderPass(this.#scene, this.#camera));
		this.#bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.6, 0.86);
		this.#composer.addPass(this.#bloom);
		this.#composer.addPass(new OutputPass());

		this.#resizeObserver = new ResizeObserver(() => this.#resize());
		this.#resizeObserver.observe(canvas);
		this.#intersectionObserver = new IntersectionObserver(([entry]) => {
			this.#visible = entry.isIntersecting;
		});
		this.#intersectionObserver.observe(canvas);
		addEventListener('pointermove', this.#onPointer);
		addEventListener('pointerup', this.#onRelease);
		addEventListener('pointercancel', this.#onRelease);
		canvas.addEventListener('pointerdown', this.#onPress);
		this.#timer.connect(document);

		this.#resize();
		this.setDrop(24, 0);
		this.#frame = requestAnimationFrame(this.#tick);
	}

	/** Shows a drop of `prizes` prizes, `drawn` of them taken. */
	setDrop(prizes: number, drawn: number) {
		const count = Math.max(1, Math.min(prizes, MAX_ORBS));
		// Beyond MAX_ORBS an orb stands for several prizes; the last one goes
		// dark only when the drop is empty.
		let taken = prizes <= MAX_ORBS ? drawn : Math.floor((drawn / prizes) * count);
		if (drawn > 0) taken = Math.max(1, taken);
		if (drawn < prizes) taken = Math.min(taken, count - 1);
		if (count === this.#orbCount && taken === this.#orbsDrawn) return;

		const layout = count !== this.#orbCount;
		this.#orbCount = count;
		this.#orbsDrawn = Math.min(taken, count);
		this.#orbScale = Math.min(0.2, Math.max(0.075, ((Math.PI * 2 * RING_RADIUS) / count) * 0.3));
		if (layout) this.#layoutOrbs();
		this.#paintOrbs();
	}

	/** How long a revealed orb takes to reach the viewer, for whatever accompanies it. */
	get flightSeconds(): number {
		return this.#calm ? 0.25 : 1.05;
	}

	/** A block landed on Arc. */
	pulse() {
		if (this.#calm) return;
		const pulse = this.#pulses.find((candidate) => candidate.life <= 0);
		if (!pulse) return;
		pulse.life = 1;
		pulse.angle = Math.random() * Math.PI * 2;
		pulse.mesh.visible = true;
	}

	/** Something was made — a drop funded: the coin throws its coins and the arc takes a turn. */
	celebrate() {
		this.#charging = false;
		this.#burst(2, this.#coin.position.clone());
		this.#fling = -6;
	}

	/** The draw is out for signature and confirmation: spin up and hold. */
	charge() {
		this.#charging = true;
	}

	/** The draw did not happen: wind back down. */
	settle() {
		this.#charging = false;
	}

	/** Breaks the next orb open. Resolves at the burst, when the prize should show. */
	reveal(tier: 0 | 1 | 2 | 3): Promise<void> {
		this.#charging = false;
		const orb = Math.min(this.#orbsDrawn, this.#orbCount - 1);
		this.#tilt.updateMatrixWorld(true);
		const from = this.#orbPosition(orb).applyMatrix4(this.#spinner.matrixWorld);
		this.#orbs.setMatrixAt(orb, new THREE.Matrix4().makeScale(0, 0, 0));
		this.#orbs.instanceMatrix.needsUpdate = true;

		return new Promise((done) => {
			this.#reveal = { tier, orb, from, time: 0, burst: false, done };
			this.#hero.position.copy(from);
			this.#hero.visible = true;
		});
	}

	dispose() {
		cancelAnimationFrame(this.#frame);
		removeEventListener('pointermove', this.#onPointer);
		removeEventListener('pointerup', this.#onRelease);
		removeEventListener('pointercancel', this.#onRelease);
		this.#canvas.removeEventListener('pointerdown', this.#onPress);
		this.#resizeObserver.disconnect();
		this.#intersectionObserver.disconnect();
		this.#timer.dispose();
		this.#reveal?.done();
		for (const item of this.#disposables) item.dispose();
		this.#bloom.dispose();
		this.#composer.dispose();
		this.#renderer.dispose();
	}

	#keep<T extends { dispose(): void }>(item: T): T {
		this.#disposables.push(item);
		return item;
	}

	#buildStars(): THREE.Points {
		const positions = new Float32Array(1500 * 3);
		const point = new THREE.Vector3();
		for (let i = 0; i < 1500; i++) {
			point.randomDirection().multiplyScalar(60 + Math.random() * 80);
			point.toArray(positions, i * 3);
		}
		const geometry = this.#keep(new THREE.BufferGeometry());
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		const material = this.#keep(
			new THREE.PointsMaterial({
				color: '#d9d2c5',
				size: 1.4,
				sizeAttenuation: false,
				transparent: true,
				opacity: 0.7
			})
		);
		const stars = new THREE.Points(geometry, material);
		this.#scene.add(stars);
		return stars;
	}

	#buildDust(): THREE.Points {
		const count = 220;
		const positions = new Float32Array(count * 3);
		const colors = new Float32Array(count * 3);
		const coral = new THREE.Color('#f0623a');
		const azure = new THREE.Color('#4c9bf0');
		const point = new THREE.Vector3();
		for (let i = 0; i < count; i++) {
			point.randomDirection().multiplyScalar(2.5 + Math.random() * 7);
			point.y *= 0.55;
			point.toArray(positions, i * 3);
			(Math.random() < 0.5 ? coral : azure).toArray(colors, i * 3);
		}
		const geometry = this.#keep(new THREE.BufferGeometry());
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		const map = this.#keep(glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'));
		const material = this.#keep(
			new THREE.PointsMaterial({
				size: 0.09,
				map,
				vertexColors: true,
				transparent: true,
				opacity: 0.55,
				depthWrite: false,
				blending: THREE.AdditiveBlending
			})
		);
		const dust = new THREE.Points(geometry, material);
		this.#scene.add(dust);
		return dust;
	}

	#buildHalo(): THREE.Sprite {
		const sprite = (inner: string, scale: number, x: number, y: number, z: number) => {
			const map = this.#keep(glowTexture(inner, 'rgba(0,0,0,0)'));
			const material = this.#keep(
				new THREE.SpriteMaterial({
					map,
					transparent: true,
					depthWrite: false,
					blending: THREE.AdditiveBlending
				})
			);
			const halo = new THREE.Sprite(material);
			halo.scale.setScalar(scale);
			halo.position.set(x, y, z);
			this.#scene.add(halo);
			return halo;
		};
		sprite('rgba(240,98,58,0.16)', 16, 3.5, -2.5, -5);
		return sprite('rgba(76,155,240,0.3)', 11, 0, 0.2, -2);
	}

	#buildCoin(): THREE.Mesh {
		const geometry = this.#keep(new THREE.CylinderGeometry(1.05, 1.05, 0.17, 72));
		geometry.rotateX(Math.PI / 2);
		const face = this.#keep(coinFaceTexture());
		const edge = this.#keep(
			new THREE.MeshStandardMaterial({ color: '#1d5fae', metalness: 0.85, roughness: 0.32 })
		);
		const front = this.#keep(
			new THREE.MeshStandardMaterial({ map: face, metalness: 0.45, roughness: 0.38 })
		);
		const coin = new THREE.Mesh(geometry, [edge, front, front]);
		this.#scene.add(coin);
		return coin;
	}

	#buildRing(): THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
		this.#scene.add(this.#tilt);
		this.#tilt.add(this.#spinner);

		const track = this.#keep(new THREE.TorusGeometry(RING_RADIUS, 0.012, 8, 220));
		track.rotateX(Math.PI / 2);
		const trackMaterial = this.#keep(
			new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.2, 0.18), toneMapped: false })
		);
		this.#spinner.add(new THREE.Mesh(track, trackMaterial));

		const outer = this.#keep(new THREE.TorusGeometry(OUTER_RADIUS, 0.008, 8, 260));
		outer.rotateX(Math.PI / 2);
		const outerMaterial = this.#keep(
			new THREE.MeshBasicMaterial({ color: new THREE.Color(0.07, 0.2, 0.42), toneMapped: false })
		);
		this.#tilt.add(new THREE.Mesh(outer, outerMaterial));

		const pulseGeometry = this.#keep(new THREE.SphereGeometry(0.055, 12, 8));
		for (let i = 0; i < MAX_PULSES; i++) {
			const material = this.#keep(
				new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true })
			);
			const mesh = new THREE.Mesh(pulseGeometry, material);
			mesh.visible = false;
			this.#tilt.add(mesh);
			this.#pulses.push({ mesh, angle: 0, life: 0 });
		}

		const geometry = this.#keep(new THREE.SphereGeometry(1, 24, 16));
		const material = this.#keep(new THREE.MeshBasicMaterial({ toneMapped: false }));
		const orbs = new THREE.InstancedMesh(geometry, material, MAX_ORBS);
		orbs.count = 0;
		orbs.frustumCulled = false;
		this.#spinner.add(orbs);
		return orbs;
	}

	#buildHero(): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
		const geometry = this.#keep(new THREE.SphereGeometry(1, 32, 20));
		const material = this.#keep(new THREE.MeshBasicMaterial({ toneMapped: false }));
		const hero = new THREE.Mesh(geometry, material);
		hero.visible = false;
		this.#scene.add(hero);
		return hero;
	}

	#buildFlash(): THREE.Sprite {
		const map = this.#keep(glowTexture('rgba(255,244,230,1)', 'rgba(255,160,90,0)'));
		const material = this.#keep(
			new THREE.SpriteMaterial({
				map,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				depthTest: false,
				blending: THREE.AdditiveBlending
			})
		);
		const flash = new THREE.Sprite(material);
		flash.visible = false;
		this.#scene.add(flash);
		return flash;
	}

	#buildCoins(): THREE.InstancedMesh {
		const geometry = this.#keep(new THREE.CylinderGeometry(0.1, 0.1, 0.024, 16));
		const material = this.#keep(
			new THREE.MeshStandardMaterial({
				color: '#ffc861',
				emissive: '#c9761a',
				emissiveIntensity: 0.9,
				metalness: 0.7,
				roughness: 0.3
			})
		);
		const coins = new THREE.InstancedMesh(geometry, material, MAX_COINS);
		coins.count = 0;
		coins.frustumCulled = false;
		this.#scene.add(coins);
		return coins;
	}

	#buildSparks(): THREE.Points {
		const geometry = this.#keep(new THREE.BufferGeometry());
		geometry.setAttribute(
			'position',
			new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3)
		);
		geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
		geometry.setDrawRange(0, 0);
		const map = this.#keep(glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'));
		const material = this.#keep(
			new THREE.PointsMaterial({
				size: 0.16,
				map,
				vertexColors: true,
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				toneMapped: false
			})
		);
		const sparks = new THREE.Points(geometry, material);
		sparks.frustumCulled = false;
		this.#scene.add(sparks);
		return sparks;
	}

	#orbPosition(index: number): THREE.Vector3 {
		const angle = (index / this.#orbCount) * Math.PI * 2;
		return new THREE.Vector3(Math.cos(angle) * RING_RADIUS, 0, Math.sin(angle) * RING_RADIUS);
	}

	#layoutOrbs() {
		const matrix = new THREE.Matrix4();
		const scale = new THREE.Vector3().setScalar(this.#orbScale);
		const upright = new THREE.Quaternion();
		for (let i = 0; i < this.#orbCount; i++) {
			this.#orbs.setMatrixAt(i, matrix.compose(this.#orbPosition(i), upright, scale));
		}
		this.#orbs.count = this.#orbCount;
		this.#orbs.instanceMatrix.needsUpdate = true;
	}

	#paintOrbs() {
		const color = new THREE.Color();
		for (let i = 0; i < this.#orbCount; i++) {
			if (i < this.#orbsDrawn) {
				color.setRGB(0.1, 0.09, 0.085);
			} else {
				// Coral through to gold around the arc, bright enough to bloom.
				const along = (i - this.#orbsDrawn) / Math.max(1, this.#orbCount - this.#orbsDrawn);
				color.setHSL(0.025 + along * 0.085, 1, 0.5).multiplyScalar(1.7);
			}
			this.#orbs.setColorAt(i, color);
		}
		if (this.#orbs.instanceColor) this.#orbs.instanceColor.needsUpdate = true;
	}

	#onPress = (event: PointerEvent) => {
		this.#drag = { id: event.pointerId, x: event.clientX };
		this.#pop = Math.max(this.#pop, 0.35);
	};

	#onRelease = (event: PointerEvent) => {
		if (this.#drag?.id === event.pointerId) this.#drag = null;
	};

	#onPointer = (event: PointerEvent) => {
		if (this.#drag?.id === event.pointerId) {
			const moved = event.clientX - this.#drag.x;
			this.#drag.x = event.clientX;
			this.#fling = THREE.MathUtils.clamp(this.#fling + moved * 0.03, -7, 7);
		}
		if (event.pointerType === 'touch') return;
		this.#pointer.set((event.clientX / innerWidth) * 2 - 1, (event.clientY / innerHeight) * 2 - 1);
	};

	#resize() {
		const width = this.#canvas.clientWidth;
		const height = this.#canvas.clientHeight;
		if (width === 0 || height === 0) return;
		const aspect = width / height;
		this.#renderer.setSize(width, height, false);
		this.#composer.setSize(width, height);
		this.#camera.aspect = aspect;
		this.#camera.updateProjectionMatrix();

		// Wide screens see the arc lying almost flat; tall ones stand it up, so
		// it fills the height it has instead of shrinking to fit the width.
		const tall = clamp01((1.25 - aspect) / 0.6);
		this.#tilt.rotation.set(0.34, 0, 0.14 + tall * 0.98);
		this.#tilt.updateMatrixWorld(true);

		let reachX = 0;
		let reachY = 0;
		const point = new THREE.Vector3();
		for (let i = 0; i < 48; i++) {
			const angle = (i / 48) * Math.PI * 2;
			point
				.set(Math.cos(angle) * OUTER_RADIUS, 0, Math.sin(angle) * OUTER_RADIUS)
				.applyMatrix4(this.#tilt.matrixWorld);
			reachX = Math.max(reachX, Math.abs(point.x));
			reachY = Math.max(reachY, Math.abs(point.y - TARGET.y));
		}
		const slope = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
		// Only a wide screen has room beside the scene to move it into.
		const shift = this.#shift * (1 - tall);
		const distance =
			Math.max((reachX + 0.5) / (slope * aspect * (1 - shift)), (reachY + 0.7) / slope) + 1.5;
		const aside = -shift * distance * slope * aspect;
		this.#cameraHome.set(aside, 0.15 + distance * 0.2, distance);
		this.#lookAt.set(aside, TARGET.y, 0);
	}

	#burst(tier: 0 | 1 | 2 | 3, at: THREE.Vector3) {
		const { coins, sparks } = BURST[tier];
		const toCamera = this.#camera.position.clone().sub(at).normalize();
		const throwOne = (speed: number, life: number): Particle => {
			const velocity = new THREE.Vector3().randomDirection();
			// Mostly outward and up, with some of it toward the viewer.
			velocity.addScaledVector(toCamera, 0.35).normalize().multiplyScalar(speed);
			velocity.y += 1.4;
			return {
				position: at.clone(),
				velocity,
				axis: new THREE.Vector3().randomDirection(),
				spin: 6 + Math.random() * 10,
				age: 0,
				life
			};
		};
		this.#coinParticles = Array.from({ length: coins }, () =>
			throwOne(1.8 + Math.random() * 4.2, 1.5 + Math.random() * 1.1)
		);
		this.#sparkParticles = Array.from({ length: sparks }, () =>
			throwOne(2.5 + Math.random() * 6.5, 0.6 + Math.random() * 0.9)
		);
		this.#flash.position.copy(at);
		this.#flash.visible = true;
		this.#flash.material.opacity = 1;
		this.#flash.scale.setScalar(0.5);
		this.#pop = 1;
	}

	#updateReveal(delta: number) {
		const reveal = this.#reveal;
		if (!reveal) return;
		reveal.time += delta;

		const flight = this.flightSeconds;
		// Between the coin and the camera, a little above the line of sight.
		const to = TARGET.clone().lerp(this.#camera.position, 0.42);
		to.y += 0.35;

		if (!reveal.burst) {
			const t = ease(clamp01(reveal.time / flight));
			this.#hero.position.lerpVectors(reveal.from, to, t);
			this.#hero.position.y += Math.sin(t * Math.PI) * 1.1;
			this.#hero.scale.setScalar(this.#orbScale * (1 + t * 2.4));
			this.#hero.material.color.setRGB(2.2 + t * 2, 1.1 + t * 2.6, 0.6 + t * 3);
			if (reveal.time >= flight) {
				reveal.burst = true;
				this.#hero.visible = false;
				this.#burst(reveal.tier, to);
				this.#orbsDrawn = Math.min(this.#orbCount, Math.max(this.#orbsDrawn, reveal.orb + 1));
				this.#layoutOrbs();
				this.#paintOrbs();
				reveal.done();
			}
			return;
		}

		if (this.#coinParticles.length === 0 && this.#sparkParticles.length === 0) this.#reveal = null;
	}

	#updateParticles(delta: number) {
		const matrix = new THREE.Matrix4();
		const rotation = new THREE.Quaternion();
		const scale = new THREE.Vector3();
		const step = (particle: Particle, gravity: number, drag: number) => {
			particle.age += delta;
			particle.velocity.y -= gravity * delta;
			particle.velocity.multiplyScalar(1 - drag * delta);
			particle.position.addScaledVector(particle.velocity, delta);
			return particle.age < particle.life;
		};

		this.#coinParticles = this.#coinParticles.filter((particle) => step(particle, 5.5, 0.6));
		this.#coinParticles.forEach((particle, index) => {
			const remaining = 1 - particle.age / particle.life;
			rotation.setFromAxisAngle(particle.axis, particle.age * particle.spin);
			scale.setScalar(Math.min(1, remaining * 4));
			this.#coins.setMatrixAt(index, matrix.compose(particle.position, rotation, scale));
		});
		this.#coins.count = this.#coinParticles.length;
		this.#coins.instanceMatrix.needsUpdate = true;

		this.#sparkParticles = this.#sparkParticles.filter((particle) => step(particle, 2.5, 1.6));
		const positions = this.#sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
		const colors = this.#sparks.geometry.getAttribute('color') as THREE.BufferAttribute;
		this.#sparkParticles.forEach((particle, index) => {
			const remaining = 1 - particle.age / particle.life;
			positions.setXYZ(index, particle.position.x, particle.position.y, particle.position.z);
			colors.setXYZ(index, 3 * remaining, 1.7 * remaining, 0.7 * remaining);
		});
		positions.needsUpdate = true;
		colors.needsUpdate = true;
		this.#sparks.geometry.setDrawRange(0, this.#sparkParticles.length);

		if (this.#flash.visible) {
			this.#flash.material.opacity -= delta * 2.4;
			this.#flash.scale.addScalar(delta * 22);
			if (this.#flash.material.opacity <= 0) this.#flash.visible = false;
		}
	}

	#tick = (timestamp: number) => {
		this.#frame = requestAnimationFrame(this.#tick);
		this.#timer.update(timestamp);
		if (!this.#visible) return;
		const delta = Math.min(this.#timer.getDelta(), 0.05);
		const time = this.#timer.getElapsed();
		const pace = this.#calm ? 0.35 : 1;

		// Energy follows the draw: quick to build, slower to let go.
		const wanted = this.#charging ? 1 : 0;
		this.#energy += (wanted - this.#energy) * Math.min(1, delta * (this.#charging ? 2.2 : 1.5));
		const energy = this.#energy * pace;

		this.#fling *= Math.exp(-delta * 1.6);
		this.#spinner.rotation.y += delta * (this.#fling - IDLE_SPIN * pace - energy * CHARGED_SPIN);
		this.#orbs.material.color.setScalar(1 + energy * (0.35 + 0.35 * Math.sin(time * 14)));

		this.#pop = Math.max(0, this.#pop - delta * 1.8);
		this.#coin.rotation.y += delta * (0.55 * pace + energy * 9 + this.#pop * 12);
		this.#coin.position.y = 0.15 + Math.sin(time * 0.9) * 0.07;
		this.#coin.scale.setScalar(1 + this.#pop * 0.22 + energy * 0.04 * Math.sin(time * 20));
		this.#halo.material.opacity = 0.8 + energy * 0.6 + this.#pop * 0.8;

		this.#stars.rotation.y += delta * 0.004;
		this.#dust.rotation.y += delta * (0.02 + energy * 0.5);

		for (const pulse of this.#pulses) {
			if (pulse.life <= 0) continue;
			pulse.life -= delta / 2.6;
			pulse.angle += delta * 2.3;
			pulse.mesh.position.set(
				Math.cos(pulse.angle) * OUTER_RADIUS,
				0,
				Math.sin(pulse.angle) * OUTER_RADIUS
			);
			const glow = Math.sin(clamp01(pulse.life) * Math.PI);
			pulse.mesh.material.color.setRGB(0.5 * glow, 1.5 * glow, 3.2 * glow);
			pulse.mesh.material.opacity = glow;
			pulse.mesh.visible = pulse.life > 0;
		}

		this.#updateReveal(delta);
		this.#updateParticles(delta);

		this.#bloom.strength = 0.55 + energy * 0.45 + this.#pop * 0.6;

		const shake = energy * 0.035;
		this.#camera.position.set(
			this.#cameraHome.x + this.#pointer.x * 0.5 + (Math.random() - 0.5) * shake,
			this.#cameraHome.y - this.#pointer.y * 0.35 + (Math.random() - 0.5) * shake,
			this.#cameraHome.z * (1 - energy * 0.07)
		);
		this.#camera.lookAt(this.#lookAt);

		this.#composer.render(delta);
	};
}
