import { useState, useCallback, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Smile } from "lucide-react";
import type { MutableRefObject } from "react";

const REACTIONS = [
  "\u{1F680}", // 🚀 rocket
  "\u{1F525}", // 🔥 fire
  "\u{1F4BB}", // 💻 laptop
  "\u{1F41B}", // 🐛 bug
  "\u{1F9E0}", // 🧠 brain
  "\u{1F44F}", // 👏 clap
];

const FLOAT_DURATION = 3000;

interface FloatingEmoji {
  id: number;
  emoji: string;
  x: number;
}

interface ReactionsBarProps {
  room: string;
  ws: MutableRefObject<WebSocket | null>;
}

export function ReactionsBar({ room, ws }: ReactionsBarProps) {
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const [open, setOpen] = useState(false);
  const seedRef = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Listen for incoming reactions on the WebSocket. We poll-read ws.current
  // so reconnects are picked up automatically.
  useEffect(() => {
    let currentWs: WebSocket | null = null;
    let attached: WebSocket | null = null;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "reaction" && data.emoji && data.room === room) {
          const id = ++seedRef.current;
          const x = Math.random() * 60 + 20;
          setFloatingEmojis((prev) => [...prev, { id, emoji: data.emoji, x }]);
          setTimeout(() => {
            setFloatingEmojis((prev) => prev.filter((e) => e.id !== id));
          }, FLOAT_DURATION);
        }
      } catch {
        // ignore non-JSON
      }
    };

    // Poll until ws.current is available and open, then attach listener.
    // Re-check on interval so reconnects swap the listener to the new socket.
    const interval = window.setInterval(() => {
      currentWs = ws.current;
      if (currentWs && currentWs !== attached) {
        if (attached) attached.removeEventListener("message", handleMessage);
        currentWs.addEventListener("message", handleMessage);
        attached = currentWs;
      }
    }, 500);

    return () => {
      window.clearInterval(interval);
      if (attached) attached.removeEventListener("message", handleMessage);
    };
  }, [room, ws]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const sendReaction = useCallback(
    (emoji: string) => {
      const socket = ws.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "reaction", emoji }));
    },
    [ws]
  );

  return (
    <>
      {/* Floating emoji overlay */}
      <div className="pointer-events-none fixed bottom-16 right-4 z-50 h-[50vh] w-28 overflow-hidden sm:bottom-24 sm:right-8 sm:w-32">
        <AnimatePresence>
          {floatingEmojis.map((fe) => (
            <motion.div
              key={fe.id}
              className="absolute text-2xl sm:text-4xl"
              style={{ left: `${fe.x}%`, bottom: 0 }}
              initial={{ y: 0, opacity: 1, scale: 0.5 }}
              animate={{
                y: -400,
                opacity: [1, 1, 0],
                scale: [0.5, 1.2, 1],
                x: [0, 20, -10, 15],
                rotate: [0, 10, -5, 8],
              }}
              transition={{
                duration: FLOAT_DURATION / 1000,
                ease: "easeOut",
                opacity: { duration: FLOAT_DURATION / 1000, times: [0, 0.7, 1] },
              }}
            >
              {fe.emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Reaction trigger + popover */}
      <div
        ref={wrapRef}
        className="fixed bottom-4 right-4 z-50 sm:bottom-8 sm:right-8"
      >
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.9 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="absolute bottom-full right-0 mb-2 flex gap-1 rounded-2xl border border-border bg-card/95 p-1.5 shadow-xl shadow-black/40 backdrop-blur-sm"
            >
              {REACTIONS.map((emoji) => (
                <motion.button
                  key={emoji}
                  whileHover={{ scale: 1.25, y: -2 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => sendReaction(emoji)}
                  className="flex size-10 items-center justify-center rounded-xl text-2xl transition-colors hover:bg-secondary sm:size-11"
                  aria-label={`Reaccionar con ${emoji}`}
                >
                  {emoji}
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setOpen((v) => !v)}
          className={`flex size-11 items-center justify-center rounded-full border shadow-lg shadow-black/40 transition-colors sm:size-12 ${
            open
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-foreground border-border hover:bg-secondary"
          }`}
          aria-label="Abrir reacciones"
        >
          <Smile className="size-5 sm:size-6" />
        </motion.button>
      </div>
    </>
  );
}
