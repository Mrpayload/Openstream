import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import HeroBranding from "./HeroBranding";
import "../styles/loading.css";

const MAX_LOADING_WAIT_MS = 10000;
const MIN_LOADING_DISPLAY_MS = 2600;
const TRAIL_GLYPHS = ["·", "°", "∙", "·", "✦", "·"];

export default function LoadingScreen({ isCatalogReady, onFinish }) {
  const gridRef = useRef(null);
  const fxRef = useRef(null);
  const counterRef = useRef(null);
  const sparkleRef = useRef(null);
  const [bootDone, setBootDone] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const mountedAtRef = useRef(0);
  const finishCalledRef = useRef(false);

  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    const endBoot = () => setBootDone(true);
    const bootTimer = window.setTimeout(endBoot, 1600);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") endBoot();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(bootTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (finishCalledRef.current) return undefined;

    const elapsed = Date.now() - mountedAtRef.current;
    const waitForMinimum = Math.max(0, MIN_LOADING_DISPLAY_MS - elapsed);
    const shouldFinish = isCatalogReady || elapsed >= MAX_LOADING_WAIT_MS;

    if (!shouldFinish) {
      const maxTimer = window.setTimeout(() => {
        setIsExiting(true);
        window.setTimeout(() => {
          if (!finishCalledRef.current) {
            finishCalledRef.current = true;
            onFinish();
          }
        }, 650);
      }, MAX_LOADING_WAIT_MS - elapsed);
      return () => window.clearTimeout(maxTimer);
    }

    const timer = window.setTimeout(() => {
      setIsExiting(true);
      window.setTimeout(() => {
        if (!finishCalledRef.current) {
          finishCalledRef.current = true;
          onFinish();
        }
      }, 650);
    }, waitForMinimum + 800);

    return () => window.clearTimeout(timer);
  }, [isCatalogReady, onFinish]);

  useEffect(() => {
    const canvas = gridRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext("2d");
    let width = 0;
    let height = 0;
    let spacing = 16;
    let frameId = 0;
    let mouseX = -1000;
    let mouseY = -1000;
    let ripples = [];
    let lastTrail = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = canvas.width = window.innerWidth * dpr;
      height = canvas.height = window.innerHeight * dpr;
      spacing = 16 * dpr;
    };

    const spawnRipple = (x, y) => {
      const dpr = window.devicePixelRatio || 1;
      ripples.push({ x: x * dpr, y: y * dpr, r: 0, life: 1 });
    };

    const spawnTrail = (x, y) => {
      const now = performance.now();
      if (now - lastTrail < 28) return;
      lastTrail = now;
      const element = document.createElement("div");
      element.className = "trail";
      element.textContent = TRAIL_GLYPHS[Math.floor(Math.random() * TRAIL_GLYPHS.length)];
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      document.body.appendChild(element);
      window.setTimeout(() => element.remove(), 700);
    };

    const updatePointerVars = (x, y) => {
      const mx = (x / window.innerWidth - 0.5) * 2;
      const my = (y / window.innerHeight - 0.5) * 2;
      document.documentElement.style.setProperty("--mx", mx.toFixed(3));
      document.documentElement.style.setProperty("--my", my.toFixed(3));
    };

    const handleMouseMove = (event) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      updatePointerVars(mouseX, mouseY);
      spawnTrail(mouseX, mouseY);

      const sparkle = sparkleRef.current;
      if (sparkle) {
        const rect = sparkle.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const distance = Math.hypot(mouseX - cx, mouseY - cy);
        sparkle.style.setProperty("--spark-scale", distance < 120 ? String(1 + ((120 - distance) / 120) * 0.8) : "1");
      }
    };

    const handleClick = (event) => spawnRipple(event.clientX, event.clientY);

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, width, height);

      for (let x = 0; x < width; x += spacing) {
        for (let y = 0; y < height; y += spacing) {
          const dx = x - mouseX * dpr;
          const dy = y - mouseY * dpr;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const influence = Math.max(0, 1 - distance / (140 * dpr));
          const size = 0.6 + influence * 1.8;
          const alpha = 0.18 + influence * 0.6;
          ctx.fillStyle = `rgba(0,0,0,${alpha})`;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ripples = ripples.filter((ripple) => ripple.life > 0);
      ripples.forEach((ripple) => {
        ripple.r += 2.2 * dpr;
        ripple.life -= 0.015;
        ctx.strokeStyle = `rgba(237,226,204,${ripple.life * 0.6})`;
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, ripple.r, 0, Math.PI * 2);
        ctx.stroke();
      });

      frameId = window.requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("click", handleClick);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("click", handleClick);
      document.documentElement.style.removeProperty("--mx");
      document.documentElement.style.removeProperty("--my");
    };
  }, []);

  useEffect(() => {
    const counter = counterRef.current;
    if (!bootDone || !counter) return undefined;

    const target = 1337;
    const start = performance.now();
    const duration = 2200;
    let frameId = 0;
    let intervalId = 0;

    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      counter.textContent = String(Math.floor(eased * target)).padStart(4, "0");
      if (progress < 1) {
        frameId = window.requestAnimationFrame(step);
      } else {
        let value = target;
        intervalId = window.setInterval(() => {
          value += Math.floor(Math.random() * 11) - 5;
          value = Math.max(1280, Math.min(1399, value));
          counter.textContent = String(value).padStart(4, "0");
        }, 1800);
      }
    };

    frameId = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearInterval(intervalId);
    };
  }, [bootDone]);

  useEffect(() => {
    const canvas = fxRef.current;
    if (!canvas) return undefined;

    let alive = true;
    let frameId = 0;
    let resizeHandler = null;
    let instance = null;

    const init = async () => {
      try {
        const mod = await import("regl");
        if (!alive) return;
        const createREGL = mod.default || mod;
        instance = createREGL({ canvas, attributes: { antialias: true } });
        const waveCount = 48;
        const colCount = 8;
        const cornerBuf = instance.buffer({ data: [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1] });
        const xBuf = instance.buffer({ usage: "dynamic", type: "float", length: waveCount * 4 });
        const hBuf = instance.buffer({ usage: "dynamic", type: "float", length: waveCount * 4 });
        const pBuf = instance.buffer({ usage: "dynamic", type: "float", length: colCount * 8 });
        const cBuf = instance.buffer({ usage: "dynamic", type: "float", length: colCount * 4 });
        const waveData = new Float32Array(waveCount);
        const colData = new Float32Array(colCount * 2);
        const colLenData = new Float32Array(colCount);
        const xInit = new Float32Array(waveCount);

        for (let i = 0; i < waveCount; i += 1) {
          xInit[i] = -0.98 + 1.96 * (i / (waveCount - 1));
          waveData[i] = 0.2;
        }

        const cols = Array.from({ length: colCount }, (_, i) => ({
          x: -0.9 + (i / (colCount - 1)) * 1.8 + (Math.random() - 0.5) * 0.05,
          y: Math.random() * 2 - 1,
          speed: 0.0015 + Math.random() * 0.0035,
          len: 0.1 + Math.random() * 0.2
        }));

        const resize = () => {
          const dpr = window.devicePixelRatio || 1;
          canvas.width = window.innerWidth * dpr;
          canvas.height = window.innerHeight * dpr;
        };

        resizeHandler = resize;
        window.addEventListener("resize", resizeHandler);
        resize();
        xBuf.subdata(xInit);
        hBuf.subdata(waveData);
        pBuf.subdata(colData);
        cBuf.subdata(colLenData);

        const drawWave = instance({
          vert: "precision mediump float; attribute vec2 aCorner; attribute float aX, aH; varying float vH; void main(){ vH=aH; float w=0.018; gl_Position=vec4(aX+aCorner.x*w, aH*aCorner.y-0.78,0,1); }",
          frag: "precision mediump float; varying float vH; void main(){ float a=clamp(vH*0.55,0.0,0.6); gl_FragColor=vec4(0.93,0.89,0.80,a); }",
          attributes: { aCorner: { buffer: cornerBuf, stride: 8 }, aX: { buffer: xBuf, stride: 4 }, aH: { buffer: hBuf, stride: 4 } },
          count: waveCount,
          depth: { enable: false },
          blend: { enable: true, func: { src: "src alpha", dst: "one minus src alpha" } }
        });
        const drawCol = instance({
          vert: "precision mediump float; attribute vec2 aCorner; attribute vec2 aPos; attribute float aH; varying float vH; void main(){ vH=aH; float w=0.008; gl_Position=vec4(aPos.x+aCorner.x*w,aPos.y+aCorner.y*aH,0,1); }",
          frag: "precision mediump float; varying float vH; void main(){ float a=clamp(vH*0.7,0.0,0.7); gl_FragColor=vec4(0.93,0.89,0.80,a); }",
          attributes: { aCorner: { buffer: cornerBuf, stride: 8 }, aPos: { buffer: pBuf, stride: 8 }, aH: { buffer: cBuf, stride: 4 } },
          count: colCount,
          depth: { enable: false },
          blend: { enable: true, func: { src: "src alpha", dst: "one minus src alpha" } }
        });

        let phase = 0;
        const frame = () => {
          if (!alive || !instance) return;
          phase += 0.06;
          for (let i = 0; i < waveCount; i += 1) {
            const env = 0.35 + 0.4 * Math.sin(phase * 0.5 + i * 0.2);
            waveData[i] = 0.15 + env * (0.4 + 0.3 * Math.sin(phase * 1.3 + i * 0.4));
          }
          for (let i = 0; i < colCount; i += 1) {
            cols[i].y -= cols[i].speed;
            if (cols[i].y < -1.1) cols[i].y = 1.1;
            colData[i * 2] = cols[i].x;
            colData[i * 2 + 1] = cols[i].y;
            colLenData[i] = cols[i].len;
          }
          hBuf.subdata(waveData);
          pBuf.subdata(colData);
          cBuf.subdata(colLenData);
          instance.poll();
          instance.clear({ color: [0, 0, 0, 0] });
          drawWave();
          drawCol();
          frameId = window.requestAnimationFrame(frame);
        };

        frame();
      } catch (error) {
        console.warn("Loading WebGL effects disabled:", error);
        canvas.style.display = "none";
      }
    };

    init();
    return () => {
      alive = false;
      window.cancelAnimationFrame(frameId);
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      if (instance) instance.destroy();
    };
  }, []);

  return (
    <motion.div
      className={`loading-screen ${bootDone ? "booting-done" : ""} ${isExiting ? "loading-exit" : ""}`}
      initial={{ opacity: 1 }}
      animate={{ opacity: isExiting ? 0 : 1 }}
      transition={{ duration: 0.65, ease: "easeOut" }}
      aria-label="Openstream loading screen"
    >
      <svg className="loading-noise-filter" aria-hidden="true">
        <filter id="bootNoise">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0.93 0 0 0 0 0.89 0 0 0 0 0.80 0 0 0 0.9 0" />
        </filter>
      </svg>
      <canvas ref={gridRef} className="loading-grid" />
      <canvas ref={fxRef} className="loading-fx" />
      <div className="loading-crosshatch" />
      <div className="loading-scanlines" />
      <div className="loading-vignette" />

      <div className="loading-boot" aria-hidden={bootDone}>
        <div className="boot-text">▓▒░ INITIALIZING OPEN STREAM ░▒▓</div>
        <div className="boot-skip">[ESC] TO SKIP</div>
      </div>

      <div className="loading-side-info">
        <div><span className="dot" />LIVE • CH.404 • 24/7</div>
        <div>~ 0xA2 • 0xB1 • 0xC0</div>
        <div>SIGNAL ACQUIRED</div>
        <div>NODES ONLINE: <span className="counter" ref={counterRef}>0000</span></div>
      </div>

      <main className="loading-stage">
        <HeroBranding className="loading-branding" active={bootDone} />
        <div className="loading-hint">// CLICK ANYWHERE TO BROADCAST • MOVE CURSOR OVER THE GRID</div>
      </main>

      <div className="loading-sparkle" ref={sparkleRef}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill="#ede2cc" />
        </svg>
      </div>

      <div className="loading-ticker">
        <div className="track">
          <span>&gt;&gt; CHANNEL 404 // NO LOGIN REQUIRED</span>
          <span>&gt;&gt; NO ALGORITHM. NO ADS. NO TRACKING.</span>
          <span>&gt;&gt; 1,337 ACTIVE NODES</span>
          <span>&gt;&gt; STREAM ANYWHERE. OWN EVERYWHERE.</span>
          <span>&gt;&gt; BITRATE: ∞ KBPS</span>
          <span>{isCatalogReady ? ">> CATALOG LOCKED" : ">> WAITING FOR TMDB SIGNAL"}</span>
        </div>
      </div>
    </motion.div>
  );
}
