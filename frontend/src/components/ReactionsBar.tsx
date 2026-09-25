import { useState, useCallback, useRef, useEffect } from "react";
import { EmojiReaction } from "@/components/ui/emoji-reaction";
import { AnimatePresence, motion } from "motion/react";
import type { ReactionEvent } from "../types";

const EMOJI_MAP: Record<string, string> = {
  "smiling-face-with-hearts": "🥰",
  "star-struck": "🤩",
  "confused-face": "😕",
  "pleading-face": "🥺",
  "grinning-face-with-smiling-eyes": "😄",
  "clapping-hands": "👏",
  "thumbs-up": "👍",
  "fire": "🔥",
  "party-popper": "🎉",
  "heart": "❤️",
};

const FLOAT_DURATION = 3000;

interface FloatingEmoji {
  id: number;
  emoji: string;
  x: number;
}

interface ReactionsBarProps {
  room: string;
  ws: WebSocket | null;
  onReactionReceived: (emoji: string) => void;
}

export function ReactionsBar({ room, ws, onReactionReceived }: ReactionsBarProps) {
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const seedRef = useRef(0);

  // Listen for incoming reactions on the WebSocket
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "reaction" && data.emoji) {
          const emojiChar = EMOJI_MAP[data.emoji] || "👍";
          const id = ++seedRef.current;
          const x = Math.random() * 60 + 20; // 20% to 80% of width
          setFloatingEmojis((prev) => [...prev, { id, emoji: emojiChar, x }]);

          // Remove after animation
          setTimeout(() => {
            setFloatingEmojis((prev) => prev.filter((e) => e.id !== id));
          }, FLOAT_DURATION);

          onReactionReceived(emojiChar);
        }
      } catch {
        // ignore non-JSON
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [ws, onReactionReceived]);

  const handleReact = useCallback(
    (name: string) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "reaction", emoji: name }));
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

      {/* Reaction trigger button */}
      <div className="fixed bottom-4 right-4 z-50 sm:bottom-8 sm:right-8">
        <EmojiReaction
          onReact={handleReact}
          size="md"
          align="right"
          className="shadow-lg shadow-black/40"
        />
      </div>
    </>
  );
}
