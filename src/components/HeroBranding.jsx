import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

const FINAL_TITLE = ["o", "p", "e", "n", "\u00A0", "s", "t", "r", "e", "a", "m"];
const SCRAMBLE_POOL = "!<>-_\\/[]{}-=+*^?#01░▒▓";
const LOGO_SCRAMBLE_CHARS = "/\\|<>·∙×⋮";
const BRACKET_GLITCH_SETS = [
  ["╔", "╗", "╚", "╝"],
  ["┏", "┓", "┗", "┛"],
  ["+", "+", "+", "+"]
];

function useBrandingAnimations(rootRef, { active = true, immediate = false } = {}) {
  useEffect(() => {
    if (!active || !rootRef.current) return undefined;

    const root = rootRef.current;
    const logo = root.querySelector("[data-logo-glyph]");
    const title = root.querySelector("[data-pixel-title]");
    if (!logo || !title) return undefined;

    const bracketEls = Array.from(logo.querySelectorAll(".bracket"));
    const bracketOrig = bracketEls.map((bracket) => bracket.textContent);
    const logoCells = Array.from(logo.querySelectorAll(".glyph"));
    const logoOrig = logoCells.map((cell) => cell.textContent);
    const titleSpans = Array.from(title.querySelectorAll(".glyph"));

    const intervals = [];
    const timeouts = [];
    const rafs = new Set();

    const addTimeout = (callback, delay) => {
      const id = window.setTimeout(callback, delay);
      timeouts.push(id);
      return id;
    };

    const requestTrackedFrame = (callback) => {
      const id = window.requestAnimationFrame((time) => {
        rafs.delete(id);
        callback(time);
      });
      rafs.add(id);
      return id;
    };

    const glitchBrackets = () => {
      const set = BRACKET_GLITCH_SETS[Math.floor(Math.random() * BRACKET_GLITCH_SETS.length)];
      bracketEls.forEach((bracket, index) => {
        bracket.textContent = set[index];
      });
      addTimeout(() => {
        bracketEls.forEach((bracket, index) => {
          bracket.textContent = bracketOrig[index];
        });
      }, 140);
    };

    const morphLogo = () => {
      const duration = 500;
      const start = performance.now();
      logo.classList.add("scrambling");

      const step = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        logoCells.forEach((cell, index) => {
          cell.textContent = Math.random() < progress
            ? logoOrig[index] || " "
            : LOGO_SCRAMBLE_CHARS[Math.floor(Math.random() * LOGO_SCRAMBLE_CHARS.length)];
        });

        if (progress < 1) {
          requestTrackedFrame(step);
        } else {
          logoCells.forEach((cell, index) => {
            cell.textContent = logoOrig[index] || " ";
          });
          logo.classList.remove("scrambling");
        }
      };

      requestTrackedFrame(step);
    };

    const scrambleTitle = () => {
      const queue = FINAL_TITLE.map((character) => ({
        to: character,
        start: Math.random() * 18,
        end: 18 + Math.random() * 14
      }));
      let frame = 0;

      const step = () => {
        let output = "";
        let done = 0;

        for (const item of queue) {
          if (frame >= item.end) {
            output += item.to;
            done += 1;
          } else if (frame >= item.start) {
            output += SCRAMBLE_POOL[Math.floor(Math.random() * SCRAMBLE_POOL.length)];
          } else {
            output += "\u00A0";
          }
        }

        titleSpans.forEach((span, index) => {
          span.textContent = output[index] || "\u00A0";
        });

        if (done < queue.length) {
          frame += 1;
          addTimeout(step, 28);
        } else {
          titleSpans.forEach((span, index) => {
            span.textContent = FINAL_TITLE[index];
          });
        }
      };

      step();
    };

    const scheduleGlitch = () => {
      const wait = 18000 + Math.random() * 12000;
      addTimeout(() => {
        title.classList.add("glitch-burst");
        addTimeout(() => title.classList.remove("glitch-burst"), 600);
        scheduleGlitch();
      }, wait);
    };

    if (immediate) {
      scrambleTitle();
      morphLogo();
    } else {
      addTimeout(scrambleTitle, 400);
      addTimeout(morphLogo, 1200);
    }

    intervals.push(window.setInterval(glitchBrackets, 5500));
    intervals.push(window.setInterval(morphLogo, 5500));
    intervals.push(window.setInterval(scrambleTitle, 11000));
    addTimeout(scheduleGlitch, 8000);

    return () => {
      intervals.forEach(window.clearInterval);
      timeouts.forEach(window.clearTimeout);
      rafs.forEach(window.cancelAnimationFrame);
    };
  }, [active, immediate, rootRef]);
}

export default function HeroBranding({ className = "", compact = false, header = false, active = true, immediate = false, layoutId = "openstream-branding" }) {
  const rootRef = useRef(null);
  useBrandingAnimations(rootRef, { active, immediate });
  const motionProps = layoutId ? { layoutId } : {};

  return (
    <motion.div
      ref={rootRef}
      className={`openstream-branding ${compact ? "compact" : ""} ${header ? "header-mode" : ""} ${className}`.trim()}
      {...motionProps}
      transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="brand-logo-row">
        <div className="logo-glyph" data-logo-glyph>
          <span className="bracket bracket-tl">┌</span>
          <span className="bracket bracket-tr">┐</span>
          <span className="bracket bracket-bl">└</span>
          <span className="bracket bracket-br">┘</span>
          <span className="glyph">/</span>
          <span className="glyph">&gt;</span>
          <span className="cursor-blink">█</span>
        </div>
        <div className="brand-text-stack">
          <div className="pixel-title" data-pixel-title aria-label="open stream">
            {FINAL_TITLE.map((character, index) => (
              <span className="glyph" key={`${character}-${index}`}>{character}</span>
            ))}
          </div>
          {!header && <div className="brand-tagline">your freedom to stream free<span className="brand-cursor">_</span></div>}
        </div>
      </div>
    </motion.div>
  );
}
