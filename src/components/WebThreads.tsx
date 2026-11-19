import { useEffect, useRef } from 'react';

/**
 * WebThreads — lightweight WebGL background of slowly flowing light threads.
 * Prop-compatible with the React Bits-style config used in App.tsx.
 * Renders into a canvas that fills its parent; it never affects layout.
 */
export interface WebThreadsProps {
  colors?: string[]; // up to 3 colours, blended across the threads
  coreColor?: string; // bright centre of each thread
  backgroundColor?: string; // 'transparent' or a CSS hex colour
  lightMode?: boolean; // softer normal blending for light UIs
  threadCount?: number; // 1–16
  speed?: number; // animation speed (cycles per ~14s at 0.07)
  frequency?: number; // wave frequency across the screen
  spread?: number; // vertical spread of the bundle (0–1 of height)
  taper?: number; // 0–1 thinner towards the ends
  position?: number; // 0–1 vertical centre of the bundle
  pinch?: number; // 0–1 how much threads converge at nodes
  nodes?: number; // number of pinch points
  angle?: number; // rotation in degrees
  glow?: number; // halo strength
  falloff?: number; // halo softness
  thickness?: number; // line thickness multiplier
  brightness?: number; // overall intensity
  opacity?: number; // final alpha multiplier
  depth?: number; // per-thread speed/amplitude variation (parallax)
  pulses?: number; // travelling light pulses per thread (0 = none)
  shimmer?: boolean; // gentle brightness ripple along threads
  fade?: number; // 0–0.5 edge fade on left/right
  grain?: number; // film grain amount
  intro?: boolean; // fade in on mount
  mouseInteraction?: boolean; // threads lean towards the pointer
  pulseOnClick?: boolean; // brief brightness pulse on click
  paused?: boolean; // stop animating (renders one still frame)
  className?: string;
}

const MAX_THREADS = 16;

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

const FRAG = `
precision mediump float;
uniform vec2 uRes; uniform float uTime, uIntro, uClick;
uniform vec3 uC0, uC1, uC2, uCore;
uniform float uCount, uFreq, uSpread, uTaper, uPos, uPinch, uNodes, uAngle, uGlow, uFalloff,
  uThick, uBright, uOpacity, uDepth, uPulses, uShimmer, uFade, uGrain, uLight;
uniform vec2 uMouse; uniform float uMouseOn;
const float PI = 3.14159265;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 palette(float t){ return t < .5 ? mix(uC0, uC1, t * 2.) : mix(uC1, uC2, t * 2. - 1.); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  // rotate around the centre, aspect-corrected so the angle looks right
  float asp = uRes.x / uRes.y;
  vec2 p = uv - .5; p.x *= asp;
  float a = radians(uAngle); p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
  p.x /= asp; p += .5;
  float x = p.x;
  float edge = smoothstep(0., uFade + 1e-3, x) * (1. - smoothstep(1. - uFade - 1e-3, 1., x));
  float env = mix(1., abs(sin(PI * max(uNodes, 1.) * x)) * .85 + .15, uPinch);
  float taperF = mix(1., sin(PI * clamp(x, 0., 1.)), uTaper);
  float lean = uMouseOn * (uMouse.y - .5) * .15 * exp(-pow((x - uMouse.x) * 3., 2.));
  vec3 accC = vec3(0.); float accA = 0.;
  for (int i = 0; i < ${MAX_THREADS}; i++) {
    float fi = float(i);
    if (fi >= uCount) break;
    float t = uCount > 1. ? fi / (uCount - 1.) : .5;
    float sp = 1. + uDepth * sin(fi * 2.17);            // parallax speed
    float amp = .035 * (1. + uDepth * cos(fi * 1.31));  // wave height
    float ph = uTime * 6.2832 * sp + fi * 1.7;
    float y = uPos + (t - .5) * uSpread * env
            + amp * sin(x * uFreq * PI + ph) * env
            + amp * .4 * sin(x * uFreq * 2.3 + ph * .7 + fi) + lean;
    float d = abs(p.y - y);
    float w = .0022 * uThick * taperF + 1e-4;
    float line = 1. - smoothstep(0., w * 2.2, d);
    float halo = uGlow * 22. * exp(-d * 55. / max(uFalloff, .05));
    float inten = line + halo;
    if (uShimmer > .5) inten *= .78 + .22 * sin(x * 24. - uTime * 40. + fi * 2.);
    if (uPulses > 0.) {
      float pp = fract(x * uPulses * .5 - uTime * 3. * sp + fi * .37);
      inten *= 1. + 1.5 * (1. - smoothstep(0., .06, abs(pp - .5))) * line;
    }
    vec3 col = mix(palette(t), uCore, (1. - smoothstep(0., w * 1.1, d)) * .65);
    float ai = clamp(inten, 0., 1.) * edge * uBright * (1. + uClick);
    accC += col * ai; accA += ai;
  }
  float alpha = clamp(accA, 0., 1.) * uOpacity * uIntro;
  vec3 color = accC / max(accA, 1e-3);
  if (uLight < .5) color *= 1.2;
  alpha *= 1. + (hash(gl_FragCoord.xy + fract(uTime * 13.)) - .5) * uGrain * 8.;
  alpha = clamp(alpha, 0., 1.);
  gl_FragColor = vec4(color * alpha, alpha); // premultiplied
}`;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export default function WebThreads(props: WebThreadsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Latest props, read every frame without restarting the GL context.
  const propsRef = useRef(props);
  propsRef.current = props;
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl) return; // no WebGL: render nothing, the CSS background remains

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('[WebThreads]', gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U: Record<string, WebGLUniformLocation | null> = {};
    const u = (name: string) => (U[name] ??= gl.getUniformLocation(prog, name));

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25); // capped for performance
      const { clientWidth: w, clientHeight: h } = canvas;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const ro = new ResizeObserver(() => { resize(); draw(); });
    ro.observe(canvas);
    resize();

    const mouse = { x: 0.5, y: 0.5 };
    let click = 0;
    const onMove = (e: PointerEvent) => { mouse.x = e.clientX / window.innerWidth; mouse.y = 1 - e.clientY / window.innerHeight; };
    const onClick = () => { if (propsRef.current.pulseOnClick) click = 1; };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onClick, { passive: true });

    const start = performance.now();
    let simTime = 0; // advances only while running, so pausing freezes the scene
    let last = start;
    let raf = 0;

    function draw() {
      const p = propsRef.current;
      const now = performance.now();
      if (!p.paused) simTime += ((now - last) / 1000) * (p.speed ?? 0.07);
      last = now;
      click *= 0.92;

      const [c0 = '#8EC5FF', c1 = c0, c2 = c1] = p.colors ?? [];
      gl!.clearColor(0, 0, 0, 0);
      if (p.backgroundColor && p.backgroundColor !== 'transparent') {
        const [r, g, b] = hexToRgb(p.backgroundColor);
        gl!.clearColor(r, g, b, 1);
      }
      gl!.clear(gl!.COLOR_BUFFER_BIT);

      gl!.uniform2f(u('uRes'), canvas!.width, canvas!.height);
      gl!.uniform1f(u('uTime'), simTime);
      gl!.uniform1f(u('uIntro'), p.intro && !p.paused ? Math.min(1, (now - start) / 2500) : 1);
      gl!.uniform1f(u('uClick'), click * 0.6);
      gl!.uniform3fv(u('uC0'), hexToRgb(c0));
      gl!.uniform3fv(u('uC1'), hexToRgb(c1));
      gl!.uniform3fv(u('uC2'), hexToRgb(c2));
      gl!.uniform3fv(u('uCore'), hexToRgb(p.coreColor ?? '#FFFFFF'));
      const f = (name: string, v: number) => gl!.uniform1f(u(name), v);
      f('uCount', Math.max(1, Math.min(MAX_THREADS, Math.round(p.threadCount ?? 7))));
      f('uFreq', p.frequency ?? 3);
      f('uSpread', p.spread ?? 0.2);
      f('uTaper', p.taper ?? 0.5);
      f('uPos', p.position ?? 0.5);
      f('uPinch', p.pinch ?? 0.5);
      f('uNodes', p.nodes ?? 1);
      f('uAngle', p.angle ?? 0);
      f('uGlow', p.glow ?? 0.02);
      f('uFalloff', p.falloff ?? 1);
      f('uThick', p.thickness ?? 1);
      f('uBright', p.brightness ?? 0.6);
      f('uOpacity', p.opacity ?? 0.5);
      f('uDepth', p.depth ?? 0.2);
      f('uPulses', p.pulses ?? 0);
      f('uShimmer', p.shimmer ? 1 : 0);
      f('uFade', Math.min(0.5, p.fade ?? 0.2));
      f('uGrain', p.grain ?? 0);
      f('uLight', p.lightMode ? 1 : 0);
      f('uMouseOn', p.mouseInteraction ? 1 : 0);
      gl!.uniform2f(u('uMouse'), mouse.x, mouse.y);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    }

    const loop = () => {
      draw();
      // When paused, stop the loop entirely (no GPU work); a prop change restarts it.
      raf = propsRef.current.paused ? 0 : requestAnimationFrame(loop);
    };
    redrawRef.current = () => { if (!raf) { last = performance.now(); loop(); } };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onClick);
      // Don't force-lose the context here: React StrictMode re-runs this effect on the same
      // canvas, and a lost context would leave the background blank. GC frees it with the canvas.
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, []);

  // Resume (or draw one still frame) whenever props such as `paused` change.
  useEffect(() => redrawRef.current());

  return <canvas ref={canvasRef} className={props.className} style={{ display: 'block', width: '100%', height: '100%' }} aria-hidden="true" />;
}
