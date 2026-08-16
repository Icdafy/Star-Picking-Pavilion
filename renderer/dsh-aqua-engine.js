'use strict';

/*
 * Standalone Aqua visual engine for Star-Picking-Pavilion.
 *
 * The implementation below is extracted without algorithmic changes from
 * DSH-Transparent-UI-Plugin 1.1.0's compiled client bundle; only pause/resume
 * lifecycle hooks were added for Electron visibility and power management:
 *   src/client/fluid-shader.ts
 *   src/client/whale.ts
 *
 * Upstream package: @deepseek-ai/dsh-client-ui-aqua 1.1.0
 * Upstream source: https://github.com/WYH66666666/DSH
 * Upstream license: MIT (see THIRD_PARTY_NOTICES.txt)
 */
(function exposeDshAquaEngine(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  if (root) root.DshAquaEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDshAquaEngine() {
/** The exact default parameter set shipped by the site. */
const SITE_FLUID_PARAMS = {
	mouseRadius: .22,
	mouseStrength: 1.1,
	decay: .96,
	distortBoost: 1.35,
	noiseBoost: 0,
	swirlBoost: .45,
	speed: 14,
	distortion: 20,
	swirl: 12,
	swirlIterations: 8,
	scale: .5,
	rotation: -5,
	proportion: 50,
	softness: 100,
	shapeScale: 10,
	offsetX: 0,
	offsetY: 65,
	color1: "#8AA3D6",
	color2: "#FFFFFF",
	color3: "#FFFFFF"
};
const VERTEX_SHADER = `#version 300 es
in vec4 a_position;
out vec2 vUv;
void main() {
  vUv = a_position.xy * 0.5 + 0.5;
  gl_Position = a_position;
}
`;
const FLOW_SHADER = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D u_prev;
uniform vec2 u_mouse;
uniform vec2 u_velocity;
uniform float u_brushRadius;
uniform float u_brushStrength;
uniform float u_decay;
out vec4 fragColor;

void main() {
  vec4 prev = texture(u_prev, vUv);

  prev.r *= u_decay;
  prev.gb = mix(vec2(0.5), prev.gb, u_decay);

  float dist = distance(vUv, u_mouse);

  float influence = exp(-dist * dist / (u_brushRadius * u_brushRadius * 0.5));
  influence = max(0.0, influence - 0.01);

  float speed = length(u_velocity);
  float presenceStrength = u_brushStrength * 0.3;
  float velBonus = min(speed * 3.0, 0.7) * u_brushStrength;
  float totalStrength = presenceStrength + velBonus;

  prev.r = max(prev.r, influence * totalStrength);
  float blendAmt = influence * min(totalStrength, 0.4) * 0.3;
  prev.g = mix(prev.g, clamp(u_velocity.x * 2.0 + 0.5, 0.0, 1.0), blendAmt);
  prev.b = mix(prev.b, clamp(u_velocity.y * 2.0 + 0.5, 0.0, 1.0), blendAmt);

  fragColor = prev;
}
`;
const DISPLAY_SHADER = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform float u_time;
uniform float u_pixelRatio;
uniform vec2 u_resolution;
uniform float u_scale;
uniform float u_rotation;
uniform vec4 u_color1, u_color2, u_color3;
uniform float u_colorCount;
uniform float u_proportion;
uniform float u_softness;
uniform float u_shape;
uniform float u_shapeScale;
uniform float u_distortion;
uniform float u_swirl;
uniform float u_swirlIterations;
uniform vec2 u_offset;
uniform sampler2D u_flowmap;
uniform float u_distortBoost;
uniform float u_noiseBoost;
uniform float u_swirlBoost;
out vec4 fragColor;

#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846

vec2 rotate(vec2 uv, float th) { return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv; }
float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123); }
float noise(vec2 st) {
  vec2 i = floor(st); vec2 f = fract(st);
  float a = random(i), b = random(i + vec2(1,0)), c = random(i + vec2(0,1)), d = random(i + vec2(1,1));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

vec3 blend_multi(float mixer, float softness) {
  float edge = 1.0 - softness;
  vec3 col = u_color1.rgb;
  if (u_colorCount > 1.5) { col = mix(col, u_color2.rgb, smoothstep(0.0 + 0.35*edge, 0.7 - 0.35*edge, mixer)); }
  if (u_colorCount > 2.5) { col = mix(col, u_color3.rgb, smoothstep(0.3 + 0.35*edge, 1.0 - 0.35*edge, mixer)); }
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = .5 * u_time;
  float ns = .0005 + .006 * u_scale;
  uv -= .5; uv *= (ns * u_resolution); uv = rotate(uv, u_rotation * .5 * PI);
  uv /= u_pixelRatio; uv += .5; uv += u_offset;

  vec2 fragUV = gl_FragCoord.xy / u_resolution.xy;
  vec4 flow = texture(u_flowmap, fragUV);
  float influence = flow.r;
  vec2 flowDir = (flow.gb - 0.5) * 2.0;

  float n1 = noise(uv + t), n2 = noise(uv*2. - t);
  float angle = n1 * TWO_PI;

  float totalDistortion = u_distortion + influence * u_distortBoost;
  uv.x += 4. * totalDistortion * n2 * cos(angle);
  uv.y += 4. * totalDistortion * n2 * sin(angle);

  uv += flowDir * influence * 0.15;

  if (influence > 0.001) {
    float localNoise = noise(uv * 2.0 + t * 1.5);
    uv += influence * u_noiseBoost * vec2(cos(localNoise * TWO_PI), sin(localNoise * TWO_PI));
  }

  float iters = ceil(clamp(u_swirlIterations, 1., 30.));
  float swirlAmt = clamp(u_swirl, 0., 2.) + influence * u_swirlBoost;
  for (float i = 1.; i <= 30.0; i++) {
    if (i > iters) break;
    uv.x += swirlAmt / i * cos(t + i*1.5*uv.y);
    uv.y += swirlAmt / i * cos(t + i*1.*uv.x);
  }

  float proportion = clamp(u_proportion, 0., 1.);
  vec2 cuv = uv * (.5 + 3.5 * u_shapeScale);
  float shape = .5 + .5 * sin(cuv.x) * cos(cuv.y);
  float mixer = shape + .48 * sign(proportion - .5) * pow(abs(proportion - .5), .5);
  vec3 col = blend_multi(mixer, clamp(u_softness, 0., 1.));
  fragColor = vec4(col, 1.0);
}
`;
function hexToRgb(value) {
	const hex = value.replace("#", "");
	return [
		parseInt(hex.slice(0, 2), 16) / 255,
		parseInt(hex.slice(2, 4), 16) / 255,
		parseInt(hex.slice(4, 6), 16) / 255
	];
}
/**
* Mount the fluid simulation on a canvas and run it until disposed.
* @param canvas - full-size canvas element (CSS-sized by the ambient layer).
* @param params - simulation parameters (site defaults are the natural input).
* @returns the live handle.
*/
function attachFluidShader(canvas, params) {
	const gl = canvas.getContext("webgl2", {
		alpha: true,
		premultipliedAlpha: false,
		powerPreference: "low-power"
	});
	if (gl === null) return {
		setParams: () => {},
		stir: () => {},
		setPaused: () => {},
		dispose: () => {}
	};
	const compile = (type, source) => {
		const shader = gl.createShader(type);
		if (shader === null) return null;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			console.error("ui-aqua fluid shader:", gl.getShaderInfoLog(shader));
			return null;
		}
		return shader;
	};
	const link = (fragment) => {
		const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
		const frag = compile(gl.FRAGMENT_SHADER, fragment);
		if (vertex === null || frag === null) return null;
		const program = gl.createProgram();
		if (program === null) return null;
		gl.attachShader(program, vertex);
		gl.attachShader(program, frag);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			console.error("ui-aqua fluid link:", gl.getProgramInfoLog(program));
			return null;
		}
		return program;
	};
	const flowProgram = link(FLOW_SHADER);
	const displayProgram = link(DISPLAY_SHADER);
	if (flowProgram === null || displayProgram === null) return {
		setParams: () => {},
		stir: () => {},
		setPaused: () => {},
		dispose: () => {}
	};
	const flow = {
		prev: gl.getUniformLocation(flowProgram, "u_prev"),
		mouse: gl.getUniformLocation(flowProgram, "u_mouse"),
		velocity: gl.getUniformLocation(flowProgram, "u_velocity"),
		brushRadius: gl.getUniformLocation(flowProgram, "u_brushRadius"),
		brushStrength: gl.getUniformLocation(flowProgram, "u_brushStrength"),
		decay: gl.getUniformLocation(flowProgram, "u_decay")
	};
	const display = {
		time: gl.getUniformLocation(displayProgram, "u_time"),
		pixelRatio: gl.getUniformLocation(displayProgram, "u_pixelRatio"),
		resolution: gl.getUniformLocation(displayProgram, "u_resolution"),
		scale: gl.getUniformLocation(displayProgram, "u_scale"),
		rotation: gl.getUniformLocation(displayProgram, "u_rotation"),
		offset: gl.getUniformLocation(displayProgram, "u_offset"),
		color1: gl.getUniformLocation(displayProgram, "u_color1"),
		color2: gl.getUniformLocation(displayProgram, "u_color2"),
		color3: gl.getUniformLocation(displayProgram, "u_color3"),
		colorCount: gl.getUniformLocation(displayProgram, "u_colorCount"),
		proportion: gl.getUniformLocation(displayProgram, "u_proportion"),
		softness: gl.getUniformLocation(displayProgram, "u_softness"),
		shape: gl.getUniformLocation(displayProgram, "u_shape"),
		shapeScale: gl.getUniformLocation(displayProgram, "u_shapeScale"),
		distortion: gl.getUniformLocation(displayProgram, "u_distortion"),
		swirl: gl.getUniformLocation(displayProgram, "u_swirl"),
		swirlIterations: gl.getUniformLocation(displayProgram, "u_swirlIterations"),
		flowmap: gl.getUniformLocation(displayProgram, "u_flowmap"),
		distortBoost: gl.getUniformLocation(displayProgram, "u_distortBoost"),
		noiseBoost: gl.getUniformLocation(displayProgram, "u_noiseBoost"),
		swirlBoost: gl.getUniformLocation(displayProgram, "u_swirlBoost")
	};
	const quadBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
		-1,
		-1,
		1,
		-1,
		-1,
		1,
		1,
		1
	]), gl.STATIC_DRAW);
	const bindQuad = (program) => {
		const position = gl.getAttribLocation(program, "a_position");
		gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
		gl.enableVertexAttribArray(position);
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
	};
	const makeTarget = (width, height, initial) => {
		const tex = gl.createTexture();
		if (tex === null) throw new Error("ui-aqua fluid: texture allocation failed");
		gl.bindTexture(gl.TEXTURE_2D, tex);
		if (initial !== void 0) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, initial);
		else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		const fbo = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		return {
			fbo,
			tex
		};
	};
	let width = 0;
	let height = 0;
	let flowWidth = 0;
	let flowHeight = 0;
	let flip = false;
	let paused = false;
	let disposed = false;
	let current = { ...params };
	const pointer = {
		x: .5,
		y: .5,
		smoothX: .5,
		smoothY: .5,
		vx: 0,
		vy: 0,
		svx: 0,
		svy: 0
	};
	const dprCap = Math.min(window.devicePixelRatio || 1, 1.5);
	width = Math.round(canvas.clientWidth * dprCap);
	height = Math.round(canvas.clientHeight * dprCap);
	canvas.width = width;
	canvas.height = height;
	flowWidth = Math.round(width / 4);
	flowHeight = Math.round(height / 4);
	const initial = new Uint8Array(flowWidth * flowHeight * 4);
	for (let i = 0; i < flowWidth * flowHeight; i += 1) {
		initial[4 * i] = 0;
		initial[4 * i + 1] = 128;
		initial[4 * i + 2] = 128;
		initial[4 * i + 3] = 255;
	}
	let targetA = makeTarget(flowWidth, flowHeight, initial);
	let targetB = makeTarget(flowWidth, flowHeight, initial);
	const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
	const ua = navigator;
	const windows = ua.userAgentData ? ua.userAgentData.platform === "Windows" : navigator.userAgent.includes("Windows");
	const onMouseMove = (event) => {
		const rect = canvas.getBoundingClientRect();
		pointer.x = (event.clientX - rect.left) / rect.width;
		pointer.y = 1 - (event.clientY - rect.top) / rect.height;
	};
	if (!coarse && !windows) window.addEventListener("mousemove", onMouseMove);
	const start = performance.now();
	let raf = 0;
	let previous = 0;
	const step = 1e3 / 30;
	const frame = (now) => {
		if (disposed || paused) return;
		raf = requestAnimationFrame(frame);
		if (now - previous < step) return;
		previous = now - (now - previous) % step;
		const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
		const nextWidth = Math.round(canvas.clientWidth * ratio);
		const nextHeight = Math.round(canvas.clientHeight * ratio);
		if (nextWidth !== width || nextHeight !== height) {
			width = nextWidth;
			height = nextHeight;
			canvas.width = width;
			canvas.height = height;
		}
		const p = current;
		const s = pointer;
		s.svx *= .94;
		s.svy *= .94;
		s.smoothX += (s.x - s.smoothX) * .12;
		s.smoothY += (s.y - s.smoothY) * .12;
		s.svx += ((s.x - s.smoothX) * .5 - s.svx) * .15;
		s.svy += ((s.y - s.smoothY) * .5 - s.svy) * .15;
		const read = flip ? targetA : targetB;
		const write = flip ? targetB : targetA;
		flip = !flip;
		gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
		gl.viewport(0, 0, flowWidth, flowHeight);
		gl.useProgram(flowProgram);
		bindQuad(flowProgram);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, read.tex);
		gl.uniform1i(flow.prev, 0);
		gl.uniform2f(flow.mouse, s.smoothX, s.smoothY);
		gl.uniform2f(flow.velocity, s.svx, s.svy);
		gl.uniform1f(flow.brushRadius, p.mouseRadius);
		gl.uniform1f(flow.brushStrength, p.mouseStrength);
		gl.uniform1f(flow.decay, p.decay);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, width, height);
		gl.useProgram(displayProgram);
		bindQuad(displayProgram);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, write.tex);
		gl.uniform1i(display.flowmap, 0);
		const time = (performance.now() - start) * .001 * (p.speed / 100);
		gl.uniform1f(display.time, time);
		gl.uniform1f(display.pixelRatio, window.devicePixelRatio || 1);
		gl.uniform2f(display.resolution, width, height);
		gl.uniform1f(display.scale, p.scale);
		gl.uniform1f(display.rotation, p.rotation / 90);
		gl.uniform2f(display.offset, p.offsetX / 100, p.offsetY / 100);
		const c1 = hexToRgb(p.color1 || "#2E58A4");
		const c2 = hexToRgb(p.color2 || "#D2E2EE");
		const c3 = hexToRgb(p.color3 || "#FFFFFF");
		gl.uniform4f(display.color1, c1[0], c1[1], c1[2], 1);
		gl.uniform4f(display.color2, c2[0], c2[1], c2[2], 1);
		gl.uniform4f(display.color3, c3[0], c3[1], c3[2], 1);
		gl.uniform1f(display.colorCount, 3);
		gl.uniform1f(display.proportion, p.proportion / 100);
		gl.uniform1f(display.softness, p.softness / 100);
		gl.uniform1f(display.shape, 0);
		gl.uniform1f(display.shapeScale, p.shapeScale / 100);
		gl.uniform1f(display.distortion, p.distortion / 100);
		gl.uniform1f(display.swirl, p.swirl / 50);
		gl.uniform1f(display.swirlIterations, p.swirlIterations);
		gl.uniform1f(display.distortBoost, p.distortBoost);
		gl.uniform1f(display.noiseBoost, p.noiseBoost);
		gl.uniform1f(display.swirlBoost, p.swirlBoost);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	};
	const handle = {
		setParams: (next) => {
			current = { ...next };
		},
		stir: (x, y, vx, vy) => {
			pointer.x += (x - pointer.x) * .35;
			pointer.y += (y - pointer.y) * .35;
			pointer.svx += (vx - pointer.svx) * .3;
			pointer.svy += (vy - pointer.svy) * .3;
		},
		setPaused: (nextPaused) => {
			const next = Boolean(nextPaused);
			if (paused === next || disposed) return;
			paused = next;
			cancelAnimationFrame(raf);
			if (!paused && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
				raf = requestAnimationFrame(frame);
			}
		},
		dispose: () => {
			disposed = true;
			cancelAnimationFrame(raf);
			window.removeEventListener("mousemove", onMouseMove);
		}
	};
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		frame(performance.now());
		cancelAnimationFrame(raf);
		return handle;
	}
	raf = requestAnimationFrame(frame);
	return handle;
}

/**
* Particle whale: the deepseek.com/harness hero's centerpiece fish rendered
* as particles — a faithful 2D port of the site's `HeroDigitileR3F` (chunk
* 776) minus three.js. The 24×18 brand-fish SVG is sampled onto a 60×60
* luminance grid, the particles scatter, then assemble into the silhouette
* with the site's drift / tail-sway / light-shading / pointer-push math.
* Additive canvas blending + `mix-blend-mode: screen` (as on the site).
*/
const WHALE_SVG = `<svg width="24" height="18" viewBox="0 0 24 18" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746V14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z" fill="#FFFFFF"/>
</svg>`;
/** Sampling grid side (the site uses 60). */
const GRID = 60;
/** World units per grid cell (the site: (n - 30) * 0.18). */
const UNIT = .18;
/** Fixed light position (the whale's lightParams: x/y/z with followX). */
const LIGHT_X = 4.5;
const LIGHT_Y = 5.5;
const LIGHT_RANGE = 14;
const SHADE_MIN = .2;
/** Site: shadeMax: 0.4 * P.shadeMax where P.shadeMax = 2.79. */
const SHADE_MAX = .4 * 2.79;
const FOLLOW_X = 1.05;
const LOOSE = 1;
/** Mouse params (DIGITILE_MOUSE_DEFAULTS). */
const MOUSE_RADIUS = 4.9;
const MOUSE_STRENGTH = .8;
const MOUSE_DECAY = .2;
const MOUSE_DISTORT = 5;
/** Render cadence, matching the site's FPS prop. */
const FPS = 30;
/** Camera viewport height in world units (z 18, fov 50). */
const WORLD_H = 36 * Math.tan(50 * Math.PI / 360);
/** Cheap per-particle hash noise in [-0.5, 0.5] (site's fract(sin) jitter). */
function hash(n) {
	const s = Math.sin(n * 12.9898) * 43758.5453;
	return s - Math.floor(s) - .5;
}
/**
* Mount the particle whale into `host` (the ambient scene) and start the
* engine. The wrapper is centered on the MAIN column — the `[data-phase]`
* conversation area, i.e. everything right of the sidebar — not the whole
* viewport.
* @param host - the container the whale wrapper is appended to.
* @param dark - resolved scheme at mount (white particles on dark, gray on light).
* @returns the handle.
*/
function mountWhale(host, dark) {
	const holder = document.createElement("div");
	holder.setAttribute("data-dsh-aqua-whale", "");
	holder.setAttribute("data-scheme", dark ? "dark" : "light");
	const canvas = document.createElement("canvas");
	canvas.setAttribute("aria-hidden", "true");
	holder.appendChild(canvas);
	host.appendChild(holder);
	const ctx = canvas.getContext("2d");
	if (ctx === null) {
		holder.remove();
		return {
			setDark: () => {},
			setPaused: () => {},
			dispose: () => {}
		};
	}
	const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
	const particles = [];
	let raf = 0;
	let disposed = false;
	let paused = false;
	let startedAt = performance.now();
	let darkMode = dark;
	let mouseWorld = {
		x: 0,
		y: 0
	};
	let dpr = 1;
	let scale = 1;
	let width = 0;
	let height = 0;
	/** Center the wrapper on the main column (viewports minus the sidebar). */
	const positionHost = () => {
		const rect = document.querySelector("[data-phase]")?.getBoundingClientRect();
		const r = rect !== void 0 && rect.width > 0 ? rect : {
			left: 0,
			top: 0,
			width: window.innerWidth,
			height: window.innerHeight
		};
		const size = Math.round(Math.max(220, Math.min(660, window.innerHeight * .76, r.width * .8)));
		const left = Math.round(r.left + r.width / 2);
		const top = Math.round(r.top + r.height / 2);
		if (holder.style.width !== `${size}px`) holder.style.width = `${size}px`;
		if (holder.style.height !== `${size}px`) holder.style.height = `${size}px`;
		if (holder.style.left !== `${left}px`) holder.style.left = `${left}px`;
		if (holder.style.top !== `${top}px`) holder.style.top = `${top}px`;
	};
	/** Keep the canvas backing store in step with the holder box. */
	const resize = () => {
		positionHost();
		const rect = holder.getBoundingClientRect();
		width = Math.max(1, rect.width);
		height = Math.max(1, rect.height);
		dpr = Math.min(window.devicePixelRatio || 1, 1.5);
		canvas.width = Math.max(1, Math.round(width * dpr));
		canvas.height = Math.max(1, Math.round(height * dpr));
		scale = height / WORLD_H;
	};
	/** Sample the fish SVG onto the 60×60 grid and build the particle set. */
	const sample = (img) => {
		const off = document.createElement("canvas");
		off.width = GRID;
		off.height = GRID;
		const octx = off.getContext("2d");
		if (octx === null) return;
		octx.fillStyle = "#000";
		octx.fillRect(0, 0, GRID, GRID);
		const fit = Math.min(GRID / img.width, GRID / img.height);
		const w = img.width * fit;
		const h = img.height * fit;
		octx.drawImage(img, (GRID - w) / 2, (GRID - h) / 2, w, h);
		const data = octx.getImageData(0, 0, GRID, GRID).data;
		const lum = new Float32Array(GRID * GRID);
		for (let i = 0; i < GRID * GRID; i++) lum[i] = (.299 * data[4 * i] + .587 * data[4 * i + 1] + .114 * data[4 * i + 2]) / 255;
		const hasBrightNeighbor = (x, y) => {
			for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
				if (dx === 0 && dy === 0) continue;
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
				if (lum[ny * GRID + nx] > .2) return true;
			}
			return false;
		};
		for (let e = 0; e < GRID; e++) for (let n = 0; n < GRID; n++) {
			const a = lum[e * GRID + n];
			if (a <= .2 || !hasBrightNeighbor(n, e)) continue;
			const x = (n - GRID / 2) * UNIT;
			const y = (GRID / 2 - e) * UNIT;
			let edge = 0;
			for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
				if (dx === 0 && dy === 0) continue;
				const nx = n + dx;
				const ny = e + dy;
				if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID || lum[ny * GRID + nx] <= .2) edge++;
			}
			const phi = Math.random() * Math.PI * 2;
			const theta = Math.acos(2 * Math.random() - 1);
			const rad = 3 * (.4 + .6 * Math.random());
			particles.push({
				x,
				y,
				opacity: a,
				edge: edge / 8,
				sx: Math.sin(theta) * Math.cos(phi) * rad,
				sy: Math.sin(theta) * Math.sin(phi) * rad,
				sz: Math.cos(theta) * rad * .5
			});
		}
	};
	/** Draw one frame at the given assembly progress (0..1). */
	const draw = (assembly, time) => {
		if (width === 0 || height === 0) resize();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		ctx.globalCompositeOperation = "lighter";
		const targetX = mouseWorld.x;
		const targetY = mouseWorld.y;
		const lightX = LIGHT_X + targetX * FOLLOW_X;
		const lightY = LIGHT_Y;
		const mouseRadius = MOUSE_RADIUS;
		const strength = MOUSE_STRENGTH;
		const size = Math.max(1.1, .06 * scale * dpr);
		const breathe = .15 * Math.sin(.4 * time);
		for (let i = 0; i < particles.length; i++) {
			const p = particles[i];
			const loose = LOOSE * (.25 + .75 * p.edge) * assembly;
			let px = p.x + hash(i) * .05 * loose;
			let py = p.y + hash(i * 1.37 + 7) * .05 * loose;
			px += Math.sin(time * .5 + i * .53) * .06 * loose;
			py += Math.cos(time * .42 + i * .71) * .06 * loose;
			const tail = smoothstep(.5, 4.5, p.x) * LOOSE * assembly;
			py += Math.sin(time * 1.1 - p.x * .7) * .1 * tail;
			px += Math.cos(time * .9 - p.x * .55) * .06 * tail;
			px = p.sx + (px - p.sx) * assembly;
			py = p.sy + (py - p.sy) * assembly;
			if (assembly > .8) {
				const mouseEffect = (assembly - .8) * 5;
				const mx = px - targetX;
				const my = py - targetY;
				const dist = Math.sqrt(mx * mx + my * my);
				if (dist < mouseRadius && dist > .001) {
					const t = 1 - dist / mouseRadius;
					const force = t * t * t * mouseEffect * strength;
					const angle = Math.sin(i * .37 + time * .5) * MOUSE_DISTORT;
					const ca = Math.cos(angle);
					const sa = Math.sin(angle);
					const ux = mx / dist;
					const uy = my / dist;
					const rx = ux * ca - uy * sa;
					const ry = ux * sa + uy * ca;
					px += rx * force * 2;
					py += ry * force * 2;
				}
			}
			const ldx = px - lightX;
			const ldy = py - lightY;
			const lit = Math.min(1, Math.max(0, 1 - Math.sqrt(ldx * ldx + ldy * ldy) / LIGHT_RANGE));
			const vLight = SHADE_MIN + SHADE_MAX * lit * lit;
			const glow = smoothstep(8, 0, Math.sqrt(px * px + py * py)) * .3 * assembly;
			const baseAlpha = .45 + .3 * assembly;
			const shimmer = Math.sin(time * 1.5 + px * 5 + py * 3) * .1 + .9;
			const alpha = p.opacity * (baseAlpha + glow) * shimmer * Math.min(vLight, 1);
			const br = darkMode ? .75 : .42;
			const bg = darkMode ? .8 : .44;
			const bb = darkMode ? .9 : .47;
			const r = Math.min(255, Math.round((br * assembly + glow * .2) * vLight * 255));
			const g = Math.min(255, Math.round((bg * assembly + glow * .3) * vLight * 255));
			const b = Math.min(255, Math.round((bb * assembly + glow * .5) * vLight * 255));
			if (alpha <= .004) continue;
			ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
			const sx = width / 2 + px * scale - size / 2;
			const sy = height / 2 - (py + breathe) * scale - size / 2;
			ctx.fillRect(sx, sy, size, size);
		}
		ctx.globalCompositeOperation = "source-over";
	};
	function smoothstep(a, b, t) {
		const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
		return x * x * (3 - 2 * x);
	}
	let mouseNdc = {
		x: 0,
		y: 0
	};
	const onMove = (event) => {
		const rect = holder.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		mouseNdc = {
			x: (event.clientX - rect.left) / rect.width * 2 - 1,
			y: -((event.clientY - rect.top) / rect.height * 2 - 1)
		};
	};
	window.addEventListener("pointermove", onMove, { passive: true });
	const start = () => {
		if (disposed || paused) return;
		let last = performance.now();
		const step = (now) => {
			if (disposed || paused) return;
			if (now - last < 1e3 / FPS) {
				raf = requestAnimationFrame(step);
				return;
			}
			last = now - (now - last) % (1e3 / FPS);
			positionHost();
			const elapsed = (now - startedAt) / 1e3;
			const raw = Math.min(1, Math.max(0, (elapsed - .3) / 2.5));
			const assembly = smoothstep(0, 1, 1 - Math.pow(1 - raw, 3));
			const targetX = mouseNdc.x * WORLD_H / 2;
			const targetY = mouseNdc.y * WORLD_H / 2;
			mouseWorld.x += (targetX - mouseWorld.x) * MOUSE_DECAY;
			mouseWorld.y += (targetY - mouseWorld.y) * MOUSE_DECAY;
			draw(assembly, elapsed);
			raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
	};
	resize();
	window.addEventListener("resize", resize);
	const img = new Image();
	img.onload = () => {
		if (disposed) return;
		sample(img);
		resize();
		if (paused) return;
		if (reduced) {
			mouseWorld = {
				x: 0,
				y: 0
			};
			draw(1, 2);
			window.setTimeout(() => {
				if (disposed) return;
				resize();
				draw(1, 2);
			}, 600);
		} else start();
	};
	img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(WHALE_SVG)}`;
	return {
		setDark: (dark) => {
			if (darkMode === dark) return;
			darkMode = dark;
			holder.setAttribute("data-scheme", dark ? "dark" : "light");
			if (reduced && particles.length > 0) draw(1, 2);
		},
		setPaused: (nextPaused) => {
			const next = Boolean(nextPaused);
			if (paused === next || disposed) return;
			paused = next;
			cancelAnimationFrame(raf);
			if (!paused && !reduced && particles.length > 0) start();
		},
		dispose: () => {
			disposed = true;
			cancelAnimationFrame(raf);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("resize", resize);
			holder.remove();
		}
	};
}

  return Object.freeze({
    SITE_FLUID_PARAMS: Object.freeze({ ...SITE_FLUID_PARAMS }),
    attachFluidShader,
    mountWhale
  });
});
